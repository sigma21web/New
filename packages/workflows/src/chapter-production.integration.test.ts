/**
 * Checkpoint 5 vertical slice on Postgres: chapter 1 runs end to end through ReplayProvider, is revised once,
 * approved, extracted, verified, committed atomically, summarized and indexed; chapter 2's contract and pack
 * prove chapter 1 is remembered from accepted state only. Every model call is replayed — no credentials, no
 * live provider, no spend.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  acceptedChapter,
  createManuscriptVersion,
  dependencyEdgesFor,
  getManuscriptVersion,
  getProject,
  listCommits,
  quarantineVersion,
  searchDocumentsContaining,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { migrate, resetDatabase } from '@yeonjae/db';
import { checkOutputLanguage, sliceCodePoints, toNfcText } from '@yeonjae/prose';
import {
  exportAccepted,
  produceChapter,
  workflowIdFor,
  workflowStatus,
  type ChapterProductionResult,
} from './chapter-production.js';
import { WorkflowError } from './errors.js';
import { createHarness, EXPECTED, IDS, type Harness } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

const POISON = 'Do-yoon’s left arm was severed at the measurement hall.';

async function expectWorkflowError(p: Promise<unknown>, code: string): Promise<WorkflowError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(WorkflowError);
    const wf = err as WorkflowError;
    expect(wf.code).toBe(code);
    return wf;
  }
  throw new Error(`expected ${code}, workflow completed`);
}

run('chapter production vertical slice (Postgres + ReplayProvider)', () => {
  let pool: Pool;
  let h: Harness;
  let result: ChapterProductionResult;

  beforeAll(async () => {
    pool = await freshDatabase();
    h = await createHarness(pool);
    result = await produceChapter({ pool, gateway: h.gateway(), bindings: h.bindings }, h.input(1));
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('T1 chapter 1 runs end to end with ReplayProvider and no live provider', () => {
    expect(result.status).toBe('completed');
    expect(result.accepted?.canon_version).toBe(3); // bible v1 + v2, chapter 1 acceptance v3
    expect(result.accepted?.item_counts).toEqual({
      fact: 4,
      event: 3,
      promise_event: 1,
      knowledge_state: 1,
      relationship_state: 2,
    });
    expect(h.provider.misses).toEqual([]);
    expect(h.provider.served.every((s) => s.by === 'activity')).toBe(true);
    expect(process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('T2 every model call records prompt, policy and identity pins (style-sensitive calls carry both contract hashes)', async () => {
    const calls = await pool.query<{
      role: string;
      prompt_version_id: string;
      prompt_hash: string;
      production_policy_version: string;
      narrative_identity_version_id: string | null;
      narrative_block_hash: string | null;
      output_language_contract_hash: string | null;
      tradition_contract_hash: string | null;
      pack_id: string | null;
      pack_hash: string | null;
      status: string;
      provider: string;
      artifact_ref: unknown;
    }>(
      `SELECT role, prompt_version_id, prompt_hash, production_policy_version, narrative_identity_version_id, narrative_block_hash,
              output_language_contract_hash, tradition_contract_hash, pack_id, pack_hash, status, provider, artifact_ref
         FROM llm_calls WHERE project_id = $1 ORDER BY created_at`,
      [h.projectId],
    );
    expect(calls.rows.length).toBeGreaterThanOrEqual(20);
    for (const c of calls.rows) {
      expect(c.status).toBe('succeeded');
      expect(c.provider).toBe('replay');
      expect(c.prompt_version_id).toMatch(/@1\.0\.0$/);
      expect(c.prompt_hash).toMatch(/^sha256:/);
      expect(c.production_policy_version).toBe('policy/standard@1');
      expect(c.pack_id).toBeTruthy();
      expect(c.artifact_ref).toBeTruthy();
    }
    const styleSensitive = calls.rows.filter((c) =>
      [
        'scene_writer',
        'scene_planner',
        'chapter_planner',
        'arc_planner',
        'prose_judge',
        'structure_judge',
        'targeted_reviser',
        'factual_summarizer',
      ].includes(c.role),
    );
    expect(styleSensitive.length).toBeGreaterThanOrEqual(10);
    for (const c of styleSensitive) {
      expect(c.narrative_identity_version_id).toBe('0191b2a0-0000-7000-8000-000000060001');
      expect(c.narrative_block_hash).toMatch(/^sha256:/);
      expect(c.output_language_contract_hash).toMatch(/^sha256:/);
      expect(c.tradition_contract_hash).toMatch(/^sha256:/);
    }
    const roles = new Set(calls.rows.map((c) => c.role));
    for (const r of [
      'requirement_interpreter',
      'assumption_explainer',
      'arc_planner',
      'chapter_planner',
      'scene_planner',
      'scene_writer',
      'contract_checker',
      'continuity_checker',
      'knowledge_leak_checker',
      'prose_judge',
      'structure_judge',
      'targeted_reviser',
      'canon_extractor',
      'factual_summarizer',
    ])
      expect(roles.has(r), r).toBe(true);
    // Pinned on the job too.
    const status = await workflowStatus(pool, result.workflow_id);
    expect(status.pins).toMatchObject({
      prompt_set_id: result.pins.promptSetId,
      production_policy_version: 'policy/standard@1',
      production_policy_hash: result.pins.productionPolicyHash,
      narrative_identity_version_id: '0191b2a0-0000-7000-8000-000000060001',
      canon_version_read: 0,
      canon_version_written: 3,
    });
    expect(status.llm_calls).toBe(calls.rows.length);
  });

  it('T3 the manuscript is English and every writer call passed the output-language check', async () => {
    const v = await getManuscriptVersion(pool, result.accepted?.manuscript_version_id ?? '');
    expect(v?.status).toBe('accepted');
    const check = checkOutputLanguage(toNfcText(v?.text ?? ''), { minConfidence: 0.99 });
    expect(check.passed).toBe(true);
    expect(check.english_confidence).toBe(1);
    for (const s of result.scenes) expect(s.english_confidence).toBe(1);
    const writerCalls = await pool.query<{
      output_language_check: { performed: boolean; passed: boolean };
    }>(
      `SELECT output_language_check FROM llm_calls WHERE project_id = $1 AND role IN ('scene_writer','targeted_reviser')`,
      [h.projectId],
    );
    expect(writerCalls.rows.length).toBe(4);
    for (const c of writerCalls.rows)
      expect(c.output_language_check).toMatchObject({ performed: true, passed: true });
  });

  it('T4 prose, structure, genre and voice are separate evaluation dimensions with separate gates', async () => {
    const first = result.scorecards[0];
    const second = result.scorecards[1];
    expect(first).toMatchObject({ prose: 74, structure: 88, auto_approvable: false, major: 1 });
    expect(second).toMatchObject({ prose: 86, structure: 88, auto_approvable: true, major: 0 });
    const card = await pool.query<{
      payload: {
        sections: Record<string, { score: number; passed: boolean; evaluator_call_id?: string }>;
        acceptance: {
          dimension_results: { dimension: string; threshold: number; passed: boolean }[];
        };
      };
    }>('SELECT payload FROM workflow_artifacts WHERE id = $1', [first?.artifact_id]);
    const sc = card.rows[0]?.payload;
    expect(sc?.sections.prose.passed).toBe(false);
    expect(sc?.sections.structure.passed).toBe(true);
    expect(sc?.sections.prose.evaluator_call_id).not.toBe(sc?.sections.structure.evaluator_call_id);
    // Every gated dimension of the pinned policy has its own score, threshold and outcome — fluent
    // English, webnovel structure, genre fit and voice are never folded together (EVAL-SEPARATION-001).
    expect(sc?.acceptance.dimension_results).toEqual([
      { dimension: 'prose', score: 74, threshold: 78, passed: false },
      { dimension: 'structure', score: 88, threshold: 78, passed: true },
      { dimension: 'genre', score: 84, threshold: 72, passed: true },
      { dimension: 'voice', score: 82, threshold: 76, passed: true },
    ]);
    // Four separate evaluator calls, each with its own call id.
    const callIds = (['prose', 'structure', 'genre', 'voice'] as const).map(
      (d) => sc?.sections[d]?.evaluator_call_id,
    );
    expect(new Set(callIds).size).toBe(4);

    // Four judges; the prose and structure rubrics are distinct identity variants.
    const judges = await pool.query<{ role: string; narrative_block_hash: string }>(
      `SELECT role, narrative_block_hash FROM llm_calls WHERE project_id = $1 AND role IN ('prose_judge','structure_judge','genre_judge','voice_judge') ORDER BY role`,
      [h.projectId],
    );
    expect(new Set(judges.rows.map((r) => r.role))).toEqual(
      new Set(['prose_judge', 'structure_judge', 'genre_judge', 'voice_judge']),
    );
    const hashes = new Map(judges.rows.map((r) => [r.role, r.narrative_block_hash]));
    expect(hashes.get('prose_judge')).not.toBe(hashes.get('structure_judge'));
    expect(hashes.get('genre_judge')).not.toBe(hashes.get('structure_judge'));
  });

  it('T6 the targeted revision created a new immutable version with the parent link and the exact code-point patch', async () => {
    expect(result.versions).toHaveLength(2);
    const [v1, v2] = result.versions;
    expect(v1).toMatchObject({ version_no: 1, origin: 'assembled', parent_version_id: null });
    expect(v2).toMatchObject({
      version_no: 2,
      origin: 'revision',
      parent_version_id: v1?.id,
      status: 'accepted',
    });
    expect(result.revision).toMatchObject({ rounds: 1, dimension: 'prose' });
    const parent = await getManuscriptVersion(pool, v1?.id ?? '');
    const child = await getManuscriptVersion(pool, v2?.id ?? '');
    const pText = toNfcText(parent?.text ?? '');
    expect(sliceCodePoints(pText, EXPECTED.bad_sentence.start, EXPECTED.bad_sentence.end)).toBe(
      EXPECTED.bad_sentence.quote,
    );
    expect(child?.text).toContain(EXPECTED.revised_sentence);
    expect(child?.text).not.toContain(EXPECTED.bad_sentence.quote);
    expect(parent?.text).toContain(EXPECTED.bad_sentence.quote);
    // The parent stays as it was (working; never mutated) and the child's bytes differ by exactly the patch.
    expect(parent?.status).toBe('working');
    expect(Array.from(child?.text ?? '').length).toBe(EXPECTED.revised_code_points);
    const patch = await pool.query<{
      payload: {
        from_version_id: string;
        to_version_id: string;
        span: { start: number; end: number };
      };
    }>('SELECT payload FROM workflow_artifacts WHERE id = $1', [
      result.revision?.patch_artifact_id,
    ]);
    expect(patch.rows[0]?.payload).toMatchObject({
      from_version_id: v1?.id,
      to_version_id: v2?.id,
      span: { start: EXPECTED.bad_sentence.start, end: EXPECTED.bad_sentence.end },
    });
    // Immutability: text of the accepted version cannot change.
    await expect(
      pool.query('UPDATE manuscript_versions SET text = $2 WHERE id = $1', [v2?.id, 'x']),
    ).rejects.toThrow(/IMMUTABLE_MANUSCRIPT/);
  });

  it('T8/T9 extraction used only the approved version and every evidence span resolves exactly against its NFC text', async () => {
    const accepted = await getManuscriptVersion(pool, result.accepted?.manuscript_version_id ?? '');
    const delta = await pool.query<{
      payload: {
        manuscript_version_id: string;
        items: {
          local_id: string;
          evidence: { manuscript_version_id: string; start: number; end: number; quote: string }[];
        }[];
      };
    }>(`SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'canon_delta'`, [
      h.projectId,
    ]);
    const d = delta.rows[0]?.payload;
    expect(d?.manuscript_version_id).toBe(accepted?.id);
    expect(d?.items).toHaveLength(EXPECTED.delta_items);
    const nfc = toNfcText(accepted?.text ?? '');
    for (const item of d?.items ?? []) {
      expect(item.evidence.length).toBeGreaterThan(0);
      for (const ev of item.evidence) {
        expect(ev.manuscript_version_id).toBe(accepted?.id);
        expect(sliceCodePoints(nfc, ev.start, ev.end)).toBe(ev.quote);
      }
    }
    // The database stored the same spans and re-verified them on insert.
    const spans = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM evidence_spans WHERE manuscript_version_id = $1',
      [accepted?.id],
    );
    expect(Number(spans.rows[0]?.n)).toBe(EXPECTED.delta_items);
    // The extractor pack cited the approved version, never the working one.
    const packs = await pool.query<{
      manifest: {
        items: { source?: { manuscript_status?: string; manuscript_version_id?: string } }[];
      };
    }>(`SELECT manifest FROM context_packs WHERE project_id = $1 AND role = 'canon_extractor'`, [
      h.projectId,
    ]);
    const chapterText = packs.rows[0]?.manifest.items.find((i) => i.source?.manuscript_status);
    expect(chapterText?.source).toMatchObject({
      manuscript_status: 'approved',
      manuscript_version_id: accepted?.id,
    });
  });

  it('T12 acceptance committed canon exactly once and set accepted inside the commit', async () => {
    const commits = await listCommits(pool, h.projectId);
    expect(commits.map((c) => c.source)).toEqual(['bible', 'bible', 'chapter_acceptance']);
    const accepted = await acceptedChapter(pool, h.projectId, 1);
    expect(accepted.state).toBe('accepted');
    if (accepted.state === 'accepted') {
      expect(accepted.chapter.acceptedCommitId).toBe(result.accepted?.commit_id);
      expect(accepted.chapter.acceptedCanonVersion).toBe(3);
    }
    const project = await getProject(pool, h.projectId);
    expect(project.canon_version).toBe(3);
    const rank = await pool.query<{ value_text: string }>(
      `SELECT value_text FROM facts WHERE project_id = $1 AND attribute = 'power.rank' AND entity_id = $2`,
      [h.projectId, IDS.doyoon],
    );
    expect(rank.rows.map((r) => r.value_text)).toEqual(['F-rank (ch.1 measurement)']);
  });

  it('T14 retry after commit does not duplicate acceptance, versions, patches, evaluations, summaries, indexes or edges', async () => {
    const before = {
      commits: (await listCommits(pool, h.projectId)).length,
      versions: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM manuscript_versions WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
      calls: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM llm_calls WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
      artifacts: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM workflow_artifacts WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
      summaries: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM summaries WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
      docs: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM search_documents WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
      edges: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM dependency_edges WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
    };
    const again = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    );
    expect(again.status).toBe('completed');
    expect(again.accepted?.commit_id).toBe(result.accepted?.commit_id);
    expect(again.steps.every((s) => s.status === 'replayed')).toBe(true);
    const after = {
      commits: (await listCommits(pool, h.projectId)).length,
      versions: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM manuscript_versions WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
      calls: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM llm_calls WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
      artifacts: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM workflow_artifacts WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
      summaries: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM summaries WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
      docs: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM search_documents WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
      edges: (
        await pool.query<{ count: string }>(
          'SELECT count(*) FROM dependency_edges WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0],
    };
    expect(after).toEqual(before);
  });

  it('T15 the L1 summary and the index use accepted content only; the ending hook is verbatim from the accepted text', async () => {
    const accepted = await getManuscriptVersion(pool, result.accepted?.manuscript_version_id ?? '');
    const summary = await pool.query<{
      text: string;
      ending_hook: string;
      manuscript_version_id: string;
      canon_version: number;
    }>(
      `SELECT text, ending_hook, manuscript_version_id, canon_version FROM summaries WHERE project_id = $1`,
      [h.projectId],
    );
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({
      manuscript_version_id: accepted?.id,
      canon_version: 3,
      ending_hook: EXPECTED.ending_hook,
    });
    expect(accepted?.text.endsWith(EXPECTED.ending_hook)).toBe(true);
    expect(summary.rows[0]?.text.split(/\s+/).length).toBeLessThanOrEqual(120);
    // Nothing indexed cites the working (unrevised) version; the calqued sentence is not searchable.
    const docs = await pool.query<{ manuscript_version_id: string | null }>(
      'SELECT DISTINCT manuscript_version_id FROM search_documents WHERE project_id = $1 AND manuscript_version_id IS NOT NULL',
      [h.projectId],
    );
    expect(docs.rows.map((d) => d.manuscript_version_id)).toEqual([accepted?.id]);
    expect(await searchDocumentsContaining(pool, h.projectId, 'exactly same feeling with')).toBe(0);
    expect(
      await searchDocumentsContaining(pool, h.projectId, EXPECTED.revised_sentence),
    ).toBeGreaterThan(0);
    // A summary for a working version is refused by the database.
    const working = result.versions[0];
    await expect(
      pool.query(
        `INSERT INTO summaries (workspace_id, project_id, tier, scope_kind, chapter_from, chapter_to, manuscript_version_id, text, canon_version, content_hash)
         VALUES ($1, $2, 'L1', 'chapter', 1, 1, $3, 'x', 3, 'sha256:x')`,
        [h.workspaceId, h.projectId, working?.id],
      ),
    ).rejects.toThrow(/SUMMARY_SOURCE|accepted/i);
  });

  it('dependency edges were persisted from the packs used, at the canon version read', async () => {
    const edges = await dependencyEdgesFor(
      pool,
      h.projectId,
      result.accepted?.manuscript_version_id ?? '',
    );
    expect(edges.length).toBe(result.accepted?.dependency_edges);
    expect(edges.length).toBeGreaterThan(10);
    const kinds = new Set(edges.map((e) => e.canon_item_kind));
    expect(kinds.has('active_constraint_set')).toBe(true);
    expect(kinds.has('fact') || kinds.has('locked_fact')).toBe(true);
    expect(kinds.has('knowledge_state')).toBe(true);
    for (const e of edges) expect(e.canon_version_read).toBe(2);
    expect(edges.filter((e) => e.materiality === 'material').length).toBeGreaterThan(0);
  });

  it('T18 chapter 2 receives chapter 1: manuscript + canon pins, L1 summary, verbatim tail, hook, state/knowledge/relationship/promise changes, elapsed time', async () => {
    const r2 = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(2, { stage: 'contract_and_pack' }),
    );
    expect(r2.status).toBe('planned');
    expect(r2.contract.status).toBe('locked');
    const accepted = await getManuscriptVersion(pool, result.accepted?.manuscript_version_id ?? '');
    expect(r2.pack_manifest?.previous_chapter).toMatchObject({
      chapter_no: 1,
      manuscript_version_id: accepted?.id,
      version_no: 2,
      accepted_canon_version: 3,
      committed_item_count: EXPECTED.delta_items,
      content_hash: accepted?.content_hash,
    });
    expect(r2.pack_manifest?.pinned.canon_version).toBe(3);
    const prev = r2.pack_variables?.previous_text ?? '';
    expect(prev).toContain('Chapter 1 factual summary (L1, from the accepted version v2)');
    expect(prev).toContain(`Chapter 1 ending hook: “${EXPECTED.ending_hook}”`);
    expect(prev).toContain('Chapter 1 ending, verbatim');
    expect(prev).toContain(EXPECTED.ending_hook);
    expect(prev).toContain('Kang Do-yoon · power.rank = F-rank (ch.1 measurement)');
    expect(prev).toContain('affiliation.party = Porter on Park Mu-jin');
    expect(prev).toContain(
      'knowledge_state/assert @ ch.1.3 (D+0): reader: knows “Kang Do-yoon is a regressor.”',
    );
    expect(prev).toContain(
      'relationship_state/supersede @ ch.1.21 (D+0): Park Mu-jin → Kang Do-yoon: superior',
    );
    expect(prev).toContain('promise_event/open @ ch.1.40 (D+0)');
    // The revised (accepted) sentence is what chapter 2 sees; the working draft's calque never reaches it.
    expect(prev).toContain(EXPECTED.revised_sentence);
    expect(prev).not.toContain(EXPECTED.bad_sentence.quote);
    const timeline = r2.pack_variables?.chapter_contract ?? '';
    expect(timeline).toContain(
      'Elapsed since chapter 1: The next morning, 6 a.m. (1 day of story time (D+0 → D+1))',
    );
    // Current state for chapter 2 comes from the accepted commit.
    expect(r2.pack_variables?.canon_state).toContain('power.rank = F-rank (ch.1 measurement)');
    expect(r2.pack_variables?.canon_state).toContain(
      'evidence: ch.1 p3 “Red letters. The same red letters as ten years ago.”',
    );
  });

  it('T20 export contains accepted manuscript text only', async () => {
    const ex = await exportAccepted(pool, { projectId: h.projectId, title: 'Second Awakening' });
    const accepted = await getManuscriptVersion(pool, result.accepted?.manuscript_version_id ?? '');
    expect(ex.chapters).toEqual([
      {
        chapter_no: 1,
        manuscript_version_id: accepted?.id,
        version_no: 2,
        content_hash: accepted?.content_hash,
        canon_version: 3,
        words: EXPECTED.words.revised,
      },
    ]);
    expect(ex.text).toContain('# Second Awakening');
    expect(ex.text).toContain('## Chapter 1');
    expect(ex.text).toContain(accepted?.text.trim());
    expect(ex.text).not.toContain(EXPECTED.bad_sentence.quote);
    expect(ex.text).not.toContain('IDENTITY_TAIL');
    const txt = await exportAccepted(pool, {
      projectId: h.projectId,
      format: 'text',
      chapters: [1],
    });
    expect(txt.text.startsWith('Chapter 1\n\nThe measurement device screamed.')).toBe(true);
    // Chapter 2 is not accepted: asking for it fails with an actionable error.
    const err = await expectWorkflowError(
      exportAccepted(pool, { projectId: h.projectId, chapters: [1, 2] }),
      'CHAPTER_NOT_ACCEPTED',
    );
    expect(err.options.data).toMatchObject({ chapter_no: 2 });
  });

  it('T16 rejected/quarantined text never reaches the chapter 2 pack or the index', async () => {
    // A rejected draft of chapter 2 with a poison fact; then rebuild the chapter-2 pack.
    const ch2 = await pool.query<{ id: string }>(
      'SELECT id FROM chapters WHERE project_id = $1 AND number = 2',
      [h.projectId],
    );
    const draft = await createManuscriptVersion(pool, {
      workspaceId: h.workspaceId,
      projectId: h.projectId,
      chapterId: ch2.rows[0]?.id ?? '',
      origin: 'candidate',
      text: `${POISON}\n\nHe looked at the stump and said nothing.`,
    });
    await quarantineVersion(pool, draft.id, 'test: poison draft');
    expect(await searchDocumentsContaining(pool, h.projectId, 'left arm was severed')).toBe(0);
    const quarantined = await pool.query(
      'SELECT count(*)::int AS n FROM quarantine_versions WHERE project_id = $1',
      [h.projectId],
    );
    expect(quarantined.rows[0]).toEqual({ n: 1 });
    const r2 = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(2, { stage: 'contract_and_pack' }),
    );
    const everything = JSON.stringify(r2.pack_variables) + JSON.stringify(r2.pack_manifest);
    expect(everything).not.toContain('left arm');
    expect(everything).not.toContain(draft.id);
    const ex = await exportAccepted(pool, { projectId: h.projectId });
    expect(ex.text).not.toContain('left arm');
  });
});

run('chapter production — failure paths (each on a fresh project)', () => {
  let pool: Pool;
  let h: Harness;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 60_000);
  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
    h = await createHarness(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('T17 chapter 2 blocks before chapter 1 is accepted with an actionable error (never a draft substitute)', async () => {
    const err = await expectWorkflowError(
      produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(2, { stage: 'contract_and_pack' }),
      ),
      'PREVIOUS_CHAPTER_NOT_ACCEPTED',
    );
    expect(err.detail).toMatch(/chapter 1 does not exist yet|a draft is never substituted/);
    expect(err.options.recommendedActions).toContain('retry_step');
    // With chapter 1 drafted but not accepted the answer is the same, and names the status.
    const r1 = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1, { failAfterStep: 'assemble' }),
    ).catch((e: unknown) => e);
    expect(r1).toBeInstanceOf(WorkflowError);
    const err2 = await expectWorkflowError(
      produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(2, { stage: 'contract_and_pack' }),
      ),
      'PREVIOUS_CHAPTER_NOT_ACCEPTED',
    );
    expect(err2.detail).toMatch(/chapter 1 is drafted \(latest version working\)/);
    const status = await workflowStatus(pool, workflowIdFor(h.projectId, 2));
    expect(status.status).toBe('failed');
    expect(status.error).toMatchObject({
      code: 'PREVIOUS_CHAPTER_NOT_ACCEPTED',
      step: 'chapter_contract',
    });
  });

  it('T5 blocking evaluation issues prevent approval and leave the version working', async () => {
    // The prose judge scores below the pinned gate with no repairable issue, so there is nothing to revise
    // and the run fails closed at the approval lock. (The "patch repaired nothing" variant now fails one
    // step earlier, at the ADR-0014 regression check — proved in recovery.integration.test.ts.)
    h.provider.alias('activity:prose_judge:1:r0', 'variant:prose_judge:1:r0:low_score_no_issues');
    const err = await expectWorkflowError(
      produceChapter({ pool, gateway: h.gateway(), bindings: h.bindings }, h.input(1)),
      'APPROVAL_BLOCKED',
    );
    expect(err.options.step).toBe('approve');
    expect(err.options.recommendedActions).toContain('regenerate');
    const versions = await pool.query<{ status: string }>(
      'SELECT status FROM manuscript_versions WHERE project_id = $1',
      [h.projectId],
    );
    // No revision round ran (no issue to target), so the assembled version is the only one.
    expect(versions.rows.map((v) => v.status)).toEqual(['working']);
    expect((await listCommits(pool, h.projectId)).map((c) => c.source)).toEqual(['bible', 'bible']);
    const status = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
    expect(status.status).toBe('needs_attention');
    expect(status.error).toMatchObject({ code: 'APPROVAL_BLOCKED' });
  });

  it('T5b a patch that repairs nothing is refused by the regression check, before approval', async () => {
    // ADR-0014 integrated into the real path: the judge reports the same major prose issue after the patch,
    // so the patch did not repair its targeted dimension and cannot proceed to approval or canon.
    h.provider.alias('activity:prose_judge:1:r1', 'variant:prose_judge:1:r1:still_failing');
    const err = await expectWorkflowError(
      produceChapter({ pool, gateway: h.gateway(), bindings: h.bindings }, h.input(1)),
      'PATCH_REGRESSED',
    );
    expect(err.options.step).toBe('revise');
    expect(err.options.data).toMatchObject({ targeted_dimension: 'prose' });
    expect(err.options.data?.failures).toContain('targeted_not_improved');
    // Both versions stay working: nothing was approved and nothing was accepted.
    const versions = await pool.query<{ status: string }>(
      'SELECT status FROM manuscript_versions WHERE project_id = $1',
      [h.projectId],
    );
    expect(versions.rows.map((v) => v.status)).toEqual(['working', 'working']);
    expect((await listCommits(pool, h.projectId)).map((c) => c.source)).toEqual(['bible', 'bible']);
    const report = await pool.query<{ payload: { passed: boolean; targeted: unknown } }>(
      `SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'regression_report'`,
      [h.projectId],
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.payload.passed).toBe(false);
    expect(report.rows[0]?.payload.targeted).toMatchObject({ resolved: false, worsened: false });
  });

  it('T7 extraction rejects a working manuscript at every layer', async () => {
    const r = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1, { failAfterStep: 'assemble' }),
    ).catch((e: unknown) => e);
    expect(r).toBeInstanceOf(WorkflowError);
    const v = await pool.query<{ id: string; chapter_id: string }>(
      `SELECT id, chapter_id FROM manuscript_versions WHERE project_id = $1`,
      [h.projectId],
    );
    const working = v.rows[0];
    // Pack layer: the extractor template refuses working text.
    const { buildPack } = await import('@yeonjae/context');
    const { requirePolicy } = await import('@yeonjae/domain');
    const { composeIdentity, ProfileStore } = await import('@yeonjae/narrative');
    const contract = (
      await pool.query<{ payload: unknown }>(
        `SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'chapter_contract'`,
        [h.projectId],
      )
    ).rows[0]?.payload;
    const spec = (
      await pool.query<{ payload: unknown }>(
        `SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'story_spec'`,
        [h.projectId],
      )
    ).rows[0]?.payload;
    await expect(
      buildPack(pool, {
        projectId: h.projectId,
        role: 'canon_extractor',
        contract: contract as never,
        spec: spec as never,
        policy: requirePolicy('policy/standard@1'),
        identity: composeIdentity(
          ProfileStore.fromDirectory(),
          'project/0191b2a0-0000-7000-8000-000000000001@1',
          '0191b2a0-0000-7000-8000-000000060001',
        ),
        chapterText: { versionId: working?.id ?? '' },
      }),
    ).rejects.toThrow(/PROHIBITED_SOURCE/);
    // Database layer: commit_delta refuses to accept a working version.
    await expect(
      pool.query(
        `SELECT canon.commit_delta($1, 2, 'chapter_acceptance', '{"items":[]}'::jsonb, '{}'::jsonb, $2, $3, NULL, NULL, NULL)`,
        [h.projectId, working?.chapter_id, working?.id],
      ),
    ).rejects.toThrow(/NOT_EXTRACTABLE/);
  });

  it('T10/T13 unsupported extraction claims fail and canon is unchanged (failure before commit)', async () => {
    h.provider.alias('activity:extract:1', 'variant:extract:1:unsupported');
    const err = await expectWorkflowError(
      produceChapter({ pool, gateway: h.gateway(), bindings: h.bindings }, h.input(1)),
      'EXTRACTION_REJECTED',
    );
    expect(err.options.step).toBe('accept');
    expect(JSON.stringify(err.options.data)).toMatch(/EVIDENCE_MISMATCH/);
    const project = await getProject(pool, h.projectId);
    expect(project.canon_version).toBe(2);
    expect((await listCommits(pool, h.projectId)).map((c) => c.source)).toEqual(['bible', 'bible']);
    const versions = await pool.query<{ status: string }>(
      'SELECT status FROM manuscript_versions WHERE project_id = $1 ORDER BY version_no',
      [h.projectId],
    );
    expect(versions.rows.map((v) => v.status)).toEqual(['working', 'approved']);
    const chapter = await pool.query<{ status: string; accepted_version_id: string | null }>(
      'SELECT status, accepted_version_id FROM chapters WHERE project_id = $1 AND number = 1',
      [h.projectId],
    );
    expect(chapter.rows[0]).toEqual({ status: 'approved', accepted_version_id: null });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM facts WHERE project_id = $1 AND entity_id = $2 AND attribute = $3',
          [h.projectId, IDS.doyoon, 'power.rank'],
        )
      ).rows[0],
    ).toEqual({ n: 0 });
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM summaries WHERE project_id = $1', [
          h.projectId,
        ])
      ).rows[0],
    ).toEqual({ n: 0 });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM search_documents WHERE project_id = $1 AND manuscript_version_id IS NOT NULL',
          [h.projectId],
        )
      ).rows[0],
    ).toEqual({ n: 0 });
  });

  it('T11 plans never become realized canon: a plan-framed or future-dated item is rejected', async () => {
    h.provider.alias('activity:extract:1', 'variant:extract:1:planned');
    const err = await expectWorkflowError(
      produceChapter({ pool, gateway: h.gateway(), bindings: h.bindings }, h.input(1)),
      'EXTRACTION_REJECTED',
    );
    const detail = JSON.stringify(err.options.data);
    expect(detail).toMatch(/PLAN_FRAME/);
    expect(detail).toMatch(/FUTURE_VALIDITY/);
    expect((await getProject(pool, h.projectId)).canon_version).toBe(2);
    // The contract's planned state deltas did not leak into canon by themselves either.
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM facts WHERE project_id = $1 AND attribute = $2',
          [h.projectId, 'affiliation.party'],
        )
      ).rows[0],
    ).toEqual({ n: 0 });
  });

  it('T19 workflow resume skips completed idempotent steps and re-spends nothing', async () => {
    // NOTE (ADR-0046): resume reuses one project's job: the same project id, the same deterministic
    // workflow id, no database reset between the interrupted run and its resume. Per-test resets isolate
    // *tests* from each other (fixed fixture UUIDs); they never substitute for this in-test resume proof.
    const first = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1, { failAfterStep: 'evaluate' }),
    ).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(WorkflowError);
    const status1 = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
    expect(status1.status).toBe('failed');
    const completed1 = status1.steps.filter((s) => s.status === 'completed').map((s) => s.step);
    expect(completed1).toEqual(
      expect.arrayContaining([
        'story_spec',
        'story_bible',
        'arc_plan',
        'chapter_contract',
        'pack',
        'scene_plan',
        'scene_draft',
        'assemble',
        'evaluate',
      ]),
    );
    const calls1 = Number(
      (
        await pool.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0]?.n,
    );
    const versions1 = Number(
      (
        await pool.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM manuscript_versions WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0]?.n,
    );
    expect(versions1).toBe(1);

    const second = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    );
    expect(second.status).toBe('completed');
    const replayed = second.steps.filter((s) => s.status === 'replayed').map((s) => s.step);
    expect(replayed).toEqual(
      expect.arrayContaining([
        'story_spec',
        'story_bible',
        'arc_plan',
        'chapter_contract',
        'scene_plan',
        'scene_draft',
        'assemble',
        'evaluate',
      ]),
    );
    const fresh = second.steps.filter((s) => s.status === 'completed').map((s) => s.step);
    expect(fresh).toEqual(
      expect.arrayContaining([
        'revise',
        'approve',
        'extract',
        'accept',
        'summarize',
        'dependency_edges',
      ]),
    );
    expect(fresh).not.toContain('scene_draft');
    const calls2 = Number(
      (
        await pool.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0]?.n,
    );
    // Only the post-failure calls were added: reviser + 7 evaluators of round 1 + extractor + summarizer.
    // The 7 evaluators are contract, continuity, knowledge-leak, prose, structure, genre and voice.
    expect(calls2 - calls1).toBe(10);
    const versions2 = Number(
      (
        await pool.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM manuscript_versions WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0]?.n,
    );
    expect(versions2).toBe(2);
    const status2 = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
    expect(status2.status).toBe('completed');
    expect(
      status2.steps.find(
        (s) => s.step === 'evaluate' && s.key.endsWith(second.versions[0]?.id ?? ''),
      )?.attempt,
    ).toBe(1);
  });

  it('T19b a second project reusing the same deterministic fixture UUIDs fails loudly (global canon identity)', async () => {
    // The fixture's entity/promise ids are global primary keys (ADR-0046): two live projects cannot hold
    // the same deterministic ids. Produce chapter 1 on this test's project first, then attempt the same
    // fixture on a second live project: the bible step must surface the PK violation rather than silently
    // sharing or forking canon rows.
    const first = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    );
    expect(first.status).toBe('completed');
    const h2 = await createHarness(pool, 'Second Awakening (collision)');
    let err: unknown;
    try {
      await produceChapter({ pool, gateway: h2.gateway(), bindings: h2.bindings }, h2.input(1));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WorkflowError);
    const wf = err as WorkflowError;
    // Loud and terminal: either the global PK violation surfaces, or the run fails closed downstream
    // (extraction cites entities the second project does not own). Either way the second project must
    // never complete with canon borrowed from the first.
    expect(['INTERNAL', 'EXTRACTION_REJECTED', 'ACCEPTANCE_FAILED']).toContain(wf.code);
    expect(JSON.stringify({ code: wf.code, detail: wf.detail })).toMatch(
      /duplicate key|entities_pkey|not a known entity|UNKNOWN_ENTITY/i,
    );
    const secondAccepted = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM manuscript_versions WHERE project_id = $1 AND status = 'accepted'`,
      [h2.projectId],
    );
    expect(secondAccepted.rows[0]?.n).toBe('0');
  });

  it('T21 a Korean-prose writer output is discarded by the gateway and the step fails closed', async () => {
    h.provider.alias('activity:scene_draft:1:3', 'variant:scene_draft:1:3:korean');
    const err = await expectWorkflowError(
      produceChapter({ pool, gateway: h.gateway(), bindings: h.bindings }, h.input(1)),
      'OUTPUT_LANGUAGE_FAILED',
    );
    expect(err.options.step).toBe('scene_draft');
    const versions = await pool.query(
      'SELECT count(*)::int AS n FROM manuscript_versions WHERE project_id = $1',
      [h.projectId],
    );
    expect(versions.rows[0]).toEqual({ n: 0 });
    const failed = await pool.query<{ status: string; output_language_check: { passed: boolean } }>(
      `SELECT status, output_language_check FROM llm_calls WHERE project_id = $1 AND role = 'scene_writer' ORDER BY created_at DESC LIMIT 1`,
      [h.projectId],
    );
    expect(failed.rows[0]?.status).toBe('failed');
  });

  it('changing the pins between runs is refused rather than silently resumed', async () => {
    await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1, { failAfterStep: 'story_spec' }),
    ).catch(() => undefined);
    await pool.query(
      `UPDATE projects SET production_policy_version = 'policy/premium@1' WHERE id = $1`,
      [h.projectId],
    );
    await expectWorkflowError(
      produceChapter({ pool, gateway: h.gateway(), bindings: h.bindings }, h.input(1)),
      'STEP_NONDETERMINISTIC',
    );
  });
});
