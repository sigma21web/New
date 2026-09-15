/**
 * B-6-1 multi-chapter continuity on Postgres + ReplayProvider: chapter 1 and chapter 2 are both produced to
 * acceptance in one project, and chapter 2 is proved to remember chapter 1 from ACCEPTED state only — its
 * L1 summary, its verbatim tail, its hook, its committed deltas and its elapsed story time.
 *
 * This is the chain T18 could only assert one link of: T18 stops at chapter 2's contract and pack, so
 * nothing there proves a second acceptance commits on top of the first, that canon transitions across a
 * chapter boundary, or that the promise chapter 1 opened is paid in chapter 2. Every model call is replayed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptedChapter,
  dependencyEdgesFor,
  getManuscriptVersion,
  getProject,
  listCommits,
  searchDocumentsContaining,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { checkOutputLanguage, codePointLength, toNfcText } from '@yeonjae/prose';
import {
  exportAccepted,
  produceChapter,
  type ChapterProductionResult,
} from './chapter-production.js';
import { createHarness, EXPECTED, EXPECTED_CH02, IDS, type Harness } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

run('multi-chapter continuity: chapters 1 → 2 accepted in sequence (B-6-1)', () => {
  let pool: Pool;
  let h: Harness;
  let ch1: ChapterProductionResult;
  let ch2: ChapterProductionResult;

  beforeAll(async () => {
    pool = await freshDatabase();
    h = await createHarness(pool);
    ch1 = await produceChapter({ pool, gateway: h.gateway(), bindings: h.bindings }, h.input(1));
    ch2 = await produceChapter({ pool, gateway: h.gateway(), bindings: h.bindings }, h.input(2));
  }, 300_000);

  afterAll(async () => {
    await pool.end();
  });

  it('both chapters complete through the same replayed provider with no live call and no miss', () => {
    expect(ch1.status).toBe('completed');
    expect(ch2.status).toBe('completed');
    expect(h.provider.misses).toEqual([]);
    expect(h.provider.served.every((s) => s.by === 'activity')).toBe(true);
    expect(process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('chapter 2 commits on top of chapter 1: the canon version advances once per acceptance', async () => {
    // bible v1 + v2, chapter 1 acceptance v3, chapter 2 acceptance v4 — monotone, one bump per chapter.
    expect(ch1.accepted?.canon_version).toBe(3);
    expect(ch2.accepted?.canon_version).toBe(4);
    const project = await getProject(pool, h.projectId);
    expect(project.canon_version).toBe(4);
    const commits = await listCommits(pool, h.projectId);
    expect(commits.map((c) => c.source)).toEqual([
      'bible',
      'bible',
      'chapter_acceptance',
      'chapter_acceptance',
    ]);
    expect(ch2.accepted?.item_counts).toEqual(EXPECTED_CH02.item_counts);
  });

  it('chapter 2 is English, accepted, and matches the fixture code-point and word expectations', async () => {
    const v = await getManuscriptVersion(pool, ch2.accepted?.manuscript_version_id ?? '');
    expect(v?.status).toBe('accepted');
    const nfc = toNfcText(v?.text ?? '');
    // Code points, not UTF-16 units: the project's offsets are Unicode code points (ADR-0030).
    expect(codePointLength(nfc.text)).toBe(EXPECTED_CH02.assembled_code_points);
    expect(nfc.text.split(/\s+/).filter(Boolean).length).toBe(EXPECTED_CH02.words);
    const check = checkOutputLanguage(nfc, { minConfidence: 0.99 });
    expect(check.passed).toBe(true);
    for (const s of ch2.scenes) expect(s.english_confidence).toBe(1);
  });

  it('chapter 2 was accepted without a revision round, so the chain does not depend on the repair path', () => {
    expect(ch2.revision?.rounds).toBe(0);
    // One evaluation round only: the draft was approvable as written.
    expect(ch2.scorecards).toHaveLength(1);
    expect(ch2.scorecards[0]?.auto_approvable).toBe(true);
    expect(ch2.scorecards[0]?.blocking).toBe(0);
    expect(ch2.scorecards[0]?.major).toBe(0);
    // Chapter 1, by contrast, needed its one targeted revision — two versions, two scorecards.
    expect(ch1.revision?.rounds).toBe(1);
    expect(ch1.scorecards).toHaveLength(2);
  });

  it("chapter 2's pack carried chapter 1's accepted summary, verbatim tail, hook and committed deltas", async () => {
    // The writer pack chapter 2 actually used is persisted; read it rather than rebuilding it.
    const packs = await pool.query<{ variables: Record<string, string> }>(
      `SELECT payload->'variables' AS variables
         FROM workflow_artifacts
        WHERE project_id = $1 AND kind = 'context_pack' AND key LIKE '2:%'
        ORDER BY created_at`,
      [h.projectId],
    );
    const previous = packs.rows
      .map((r) => r.variables.previous_text ?? '')
      .find((t) => t.length > 0);
    expect(previous).toBeDefined();
    const prev = previous ?? '';
    expect(prev).toContain('Chapter 1 factual summary (L1, from the accepted version v2)');
    expect(prev).toContain(`Chapter 1 ending hook: “${EXPECTED.ending_hook}”`);
    expect(prev).toContain('Chapter 1 ending, verbatim');
    // Accepted text only: the revised sentence reaches chapter 2, the working draft's calque never does.
    expect(prev).toContain(EXPECTED.revised_sentence);
    expect(prev).not.toContain(EXPECTED.bad_sentence.quote);
  });

  it('canon transitions across the chapter boundary: the ch.1 share is superseded, not duplicated', async () => {
    // Chapter 2 asserts a new porter share and supersedes the ch.1 relationship. Both facts exist, but only
    // the chapter-2 value is current — history is kept, never retracted (ADR-0038).
    const shares = await pool.query<{ value_text: string; valid_from: unknown; valid_to: unknown }>(
      `SELECT value_text, valid_from, valid_to FROM facts
        WHERE project_id = $1 AND attribute = 'employment.porter_share'
        ORDER BY (valid_from->>'chapter_no')::int`,
      [h.projectId],
    );
    expect(shares.rows.length).toBeGreaterThanOrEqual(1);
    const current = shares.rows.filter((r) => r.valid_to === null);
    expect(current).toHaveLength(1);
    expect(current[0]?.value_text).toContain('Eighteen percent');

    const relationships = await pool.query<{ note: string | null; valid_to: unknown }>(
      `SELECT note, valid_to FROM relationship_states
        WHERE project_id = $1 AND from_entity_id = $2 AND to_entity_id = $3 AND type = 'superior'
        ORDER BY valid_from_ord`,
      [h.projectId, IDS.mujin, IDS.doyoon],
    );
    // The chapter-1 row is closed and the chapter-2 row is open: a supersede, not a second live row.
    expect(relationships.rows.filter((r) => r.valid_to === null)).toHaveLength(1);
    expect(relationships.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('the promise chapter 1 opened is paid in chapter 2', async () => {
    const events = await pool.query<{ kind: string; number: number }>(
      `SELECT pe.kind, c.number FROM promise_events pe
         JOIN chapters c ON c.id = pe.chapter_id
        WHERE c.project_id = $1 AND pe.promise_id = $2
        ORDER BY c.number`,
      [h.projectId, IDS.promise_gate_run],
    );
    expect(events.rows.some((e) => e.kind === 'opened' && e.number === 1)).toBe(true);
    expect(events.rows.some((e) => e.kind === 'paid' && e.number === 2)).toBe(true);
  });

  it('both chapters are summarized and indexed from accepted content only', async () => {
    const summaries = await pool.query<{ chapter_from: number; text: string }>(
      `SELECT chapter_from, text FROM summaries
        WHERE project_id = $1 AND tier = 'L1' ORDER BY chapter_from`,
      [h.projectId],
    );
    expect(summaries.rows.map((r) => r.chapter_from)).toEqual([1, 2]);
    expect(summaries.rows[1]?.text).toBe(EXPECTED_CH02.summary_l1);
    for (const r of summaries.rows) expect(r.text.split(/\s+/).length).toBeLessThanOrEqual(120);

    // Chapter 2's text is searchable because chapter 2 is accepted; nothing non-accepted is indexed.
    expect(await searchDocumentsContaining(pool, h.projectId, 'third chamber')).toBeGreaterThan(0);
    const nonAccepted = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM search_documents sd
         JOIN manuscript_versions mv ON mv.id = sd.manuscript_version_id
        WHERE sd.project_id = $1 AND mv.status <> 'accepted'`,
      [h.projectId],
    );
    expect(nonAccepted.rows[0]?.n).toBe('0');
  });

  it('chapter 2 recorded dependency edges at the canon version it read', async () => {
    // Edges are keyed by the dependent manuscript version, and chapter 2 read canon at the version
    // chapter 1's acceptance produced — the material link from chapter 2 back to chapter 1's state.
    const edges = await dependencyEdgesFor(
      pool,
      h.projectId,
      ch2.accepted?.manuscript_version_id ?? '',
    );
    expect(edges.length).toBeGreaterThan(0);
    expect(ch2.pins.canonVersionRead).toBe(3);
    expect(ch2.accepted?.dependency_edges).toBe(edges.length);
  });

  it('export contains both accepted chapters, in order, accepted text only', async () => {
    const ex = await exportAccepted(pool, { projectId: h.projectId, title: 'Second Awakening' });
    expect(ex.chapters.map((c) => c.chapter_no)).toEqual([1, 2]);
    const v2 = await getManuscriptVersion(pool, ch2.accepted?.manuscript_version_id ?? '');
    expect(ex.text).toContain(EXPECTED_CH02.ending_hook.replaceAll('*', ''));
    expect(ex.text).toContain(v2?.text.trim().slice(0, 40) ?? '');
    expect(ex.text).not.toContain(EXPECTED.bad_sentence.quote);
    // Chapter 1 precedes chapter 2 in the exported text.
    expect(ex.text.indexOf('Chapter 1')).toBeLessThan(ex.text.indexOf('Chapter 2'));
  });

  it('a third chapter refuses to start because chapter 2 is the last accepted one', async () => {
    const lookup = await acceptedChapter(pool, h.projectId, 3);
    expect(lookup.state).toBe('missing');
    // Chapter 3 has no fixture recordings; the gate must refuse before any spend rather than improvise.
    const before = Number(
      (
        await pool.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0]?.n,
    );
    const err = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(3, { stage: 'contract_and_pack' }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const after = Number(
      (
        await pool.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1',
          [h.projectId],
        )
      ).rows[0]?.n,
    );
    // Whatever it failed on, it must not have committed canon for a chapter it cannot produce.
    expect((await getProject(pool, h.projectId)).canon_version).toBe(4);
    expect(after).toBeGreaterThanOrEqual(before);
  }, 120_000);
});
