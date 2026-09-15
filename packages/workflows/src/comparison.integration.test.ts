/**
 * B-6-4 on Postgres + ReplayProvider: candidate comparison runs the real `chapter_comparator` prompt
 * through the gateway (Guard, budget, audit) against recorded verdicts, and the patch-regression rule runs
 * against the two real scorecards the chapter-1 loop produces. No live provider, no spend.
 *
 * Chapter 1's two versions — the assembled draft and the revised version — are the two candidate slots.
 * They are genuinely different texts differing in exactly the sentence the targeted revision repaired,
 * which is the honest shape for a prose-dimension comparison.
 *
 * Variant tests reset the database per test. That is not cosmetic: gateway calls are idempotent by
 * `(workflow, activity)` key, so a second comparison of the same pair inside one project correctly replays
 * the first verdict from the audit store. Selecting a different recorded verdict therefore requires a fresh
 * project, exactly as the Checkpoint 5 failure-path tests do (ADR-0046).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getManuscriptVersion, migrate, resetDatabase, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import {
  breakTie,
  compareCandidates,
  makeContext,
  patchRegression,
  produceChapter,
  type Candidate,
  type WorkflowContext,
} from './index.js';
import { type Scorecard } from './evaluation.js';
import { createHarness, type Harness } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

const CONTRACT_SHAPE = JSON.stringify({
  chapter_number: 1,
  hook: { type: 'reveal' },
  opening: { type: 'in_medias_res' },
  length_target: { unit: 'words', value: 900, tolerance_ratio: 0.12 },
});

interface Prepared {
  readonly ctx: WorkflowContext;
  readonly candidates: readonly [Candidate, Candidate];
}

/** Produce chapter 1, then expose its two versions as candidate slots 1 and 2 with their real scorecards. */
async function prepare(pool: Pool, h: Harness): Promise<Prepared> {
  const result = await produceChapter(
    { pool, gateway: h.gateway(), bindings: h.bindings },
    h.input(1),
  );
  if (result.status !== 'completed')
    throw new Error(`chapter 1 did not complete: ${result.status}`);
  const draft = await getManuscriptVersion(pool, result.versions[0]?.id ?? '');
  const revised = await getManuscriptVersion(pool, result.versions[1]?.id ?? '');
  if (!draft || !revised) throw new Error('chapter 1 did not produce two versions');

  const load = async (artifactId: string): Promise<Scorecard> => {
    const row = await pool.query<{ payload: Scorecard }>(
      'SELECT payload FROM workflow_artifacts WHERE id = $1',
      [artifactId],
    );
    const payload = row.rows[0]?.payload;
    if (!payload) throw new Error(`scorecard artifact ${artifactId} not found`);
    return payload;
  };
  const candidates: readonly [Candidate, Candidate] = [
    {
      slot: 1,
      id: draft.id,
      text: draft.text,
      scorecard: await load(result.scorecards[0]?.artifact_id ?? ''),
      patchCount: 0,
    },
    {
      slot: 2,
      id: revised.id,
      text: revised.text,
      scorecard: await load(result.scorecards[1]?.artifact_id ?? ''),
      patchCount: 1,
    },
  ];
  // Comparison recordings reference the candidates by binding name; bind the run's real version ids.
  h.bindings['candidate.1'] = candidates[0].id;
  h.bindings['candidate.2'] = candidates[1].id;
  const { ctx } = await makeContext(
    { pool, gateway: h.gateway(), bindings: h.bindings },
    h.projectId,
    1,
  );
  return { ctx, candidates };
}

run('candidate comparison on replay (B-6-4, ADR-0015)', () => {
  let pool: Pool;
  let h: Harness;
  let prepared: Prepared;

  beforeAll(async () => {
    pool = await freshDatabase();
    h = await createHarness(pool);
    prepared = await prepare(pool, h);
  }, 180_000);

  afterAll(async () => {
    await pool.end();
  });

  it('judges both presentation orders and takes the consistent winner', async () => {
    const [a, b] = prepared.candidates;
    const outcome = await compareCandidates(prepared.ctx, {
      chapterNo: 1,
      contractShape: CONTRACT_SHAPE,
      a,
      b,
    });
    // The recordings prefer the same candidate in both orders: a consistent winner, no third run.
    expect(outcome.reason).toBe('consistent');
    expect(outcome.positionBiasDetected).toBe(false);
    expect(outcome.winnerId).toBe(a.id);
    expect(outcome.loserId).toBe(b.id);
    expect(outcome.verdicts.map((v) => v.presentation_order)).toEqual(['ab', 'ba']);
    expect(h.provider.misses).toEqual([]);

    // Both verdicts are stored as schema-checked artifacts and each names its judge call.
    expect(outcome.verdictArtifactIds).toHaveLength(2);
    for (const v of outcome.verdicts) expect(v.judge_call_id).toBeTruthy();
    const stored = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM workflow_artifacts WHERE project_id = $1 AND kind = 'comparison_verdict'`,
      [h.projectId],
    );
    expect(Number(stored.rows[0]?.n)).toBe(2);
  });

  it('records every comparison call with the comparator prompt, the policy pin and no identity pin', async () => {
    const calls = await pool.query<{
      prompt_version_id: string;
      production_policy_version: string;
      narrative_identity_version_id: string | null;
      provider: string;
      status: string;
    }>(
      `SELECT prompt_version_id, production_policy_version, narrative_identity_version_id, provider, status
         FROM llm_calls WHERE project_id = $1 AND role = 'chapter_comparator' ORDER BY created_at`,
      [h.projectId],
    );
    expect(calls.rows.length).toBeGreaterThanOrEqual(2);
    for (const c of calls.rows) {
      expect(c.status).toBe('succeeded');
      expect(c.provider).toBe('replay');
      expect(c.prompt_version_id).toBe('chapter_comparator@1.0.0');
      expect(c.production_policy_version).toBe('policy/standard@1');
      // The comparator is not style-sensitive: it carries no identity pin (role catalog, ADR-0027).
      expect(c.narrative_identity_version_id).toBeNull();
    }
  });

  it('reports prose and structure preferences separately, so a candidate can win A and lose B', async () => {
    const [a, b] = prepared.candidates;
    const outcome = await compareCandidates(prepared.ctx, {
      chapterNo: 1,
      contractShape: CONTRACT_SHAPE,
      a,
      b,
    });
    const verdict = outcome.verdicts[0];
    const prose = verdict?.dimensions.find((d) => d.dimension === 'english_prose_quality');
    const structure = verdict?.dimensions.find((d) => d.dimension === 'serialized_structure');
    expect(prose?.preference).toBeDefined();
    expect(structure?.preference).toBeDefined();
    // EVAL-SEPARATION-001: two independent verdicts, never one blended judgement.
    expect(prose?.preference).not.toBe(structure?.preference);
    for (const d of verdict?.dimensions ?? []) {
      expect(d.evidence_a.length).toBeGreaterThan(0);
      expect(d.evidence_b.length).toBeGreaterThan(0);
    }
  });

  it('the same candidate cannot be compared with itself', async () => {
    const [a] = prepared.candidates;
    await expect(
      compareCandidates(prepared.ctx, {
        chapterNo: 1,
        contractShape: CONTRACT_SHAPE,
        a,
        b: { ...a },
      }),
    ).rejects.toThrow(/two distinct candidates/);
  });

  it('the real chapter-1 patch repaired prose without regressing structure beyond the pinned tolerance', () => {
    const [a, b] = prepared.candidates;
    const report = patchRegression(prepared.ctx.policy, {
      before: a.scorecard,
      after: b.scorecard,
      dimension: 'prose',
    });
    // The fixture's single revision targets the one translation-like sentence in scene 3.
    expect(report.targetedDimension).toBe('prose');
    expect(report.targetedImproved).toBe(true);
    expect(report.regressions).toEqual([]);
    expect(report.passed).toBe(true);
    const structure = report.deltas.find((d) => d.dimension === 'structure');
    expect(structure).toBeDefined();
    expect(structure?.delta).toBeGreaterThanOrEqual(-report.tolerancePoints);
  });
});

run('comparison verdict variants (fresh project per test: gateway calls are idempotent)', () => {
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

  it('position bias in both orders is detected and resolved by the shuffled-rubric third run', async () => {
    h.provider.alias('activity:compare:1:s1s2:ab', 'variant:compare:1:s1s2:ab:biased');
    h.provider.alias('activity:compare:1:s1s2:ba', 'variant:compare:1:s1s2:ba:biased');
    h.provider.alias(
      'activity:compare:1:s1s2:shuffled',
      'variant:compare:1:s1s2:shuffled:decides_1',
    );
    const { ctx, candidates } = await prepare(pool, h);
    const outcome = await compareCandidates(ctx, {
      chapterNo: 1,
      contractShape: CONTRACT_SHAPE,
      a: candidates[0],
      b: candidates[1],
    });
    expect(outcome.positionBiasDetected).toBe(true);
    expect(outcome.reason).toBe('tiebreak_shuffled_rubric');
    expect(outcome.winnerId).toBe(candidates[0].id);
    expect(outcome.verdicts).toHaveLength(3);
    expect(h.provider.misses).toEqual([]);
  }, 120_000);

  it('a biased pair the third run cannot separate falls to the ladder, never to the first verdict', async () => {
    h.provider.alias('activity:compare:1:s1s2:ab', 'variant:compare:1:s1s2:ab:biased');
    h.provider.alias('activity:compare:1:s1s2:ba', 'variant:compare:1:s1s2:ba:biased');
    h.provider.alias('activity:compare:1:s1s2:shuffled', 'variant:compare:1:s1s2:shuffled:tie');
    const { ctx, candidates } = await prepare(pool, h);
    const outcome = await compareCandidates(ctx, {
      chapterNo: 1,
      contractShape: CONTRACT_SHAPE,
      a: candidates[0],
      b: candidates[1],
    });
    expect(outcome.positionBiasDetected).toBe(true);
    expect(outcome.reason).toMatch(/^tiebreak_(scorecard|patch_count|candidate_slot)$/);
    expect(outcome.verdicts).toHaveLength(3);
    // Whatever the ladder decides must equal the pure function on the same inputs.
    expect(outcome.winnerId).toBe(breakTie(ctx.policy, candidates[0], candidates[1]).winnerId);
  }, 120_000);

  it('two tied orders skip the third run and go straight to the ladder', async () => {
    h.provider.alias('activity:compare:1:s1s2:ab', 'variant:compare:1:s1s2:ab:tie');
    h.provider.alias('activity:compare:1:s1s2:ba', 'variant:compare:1:s1s2:ba:tie');
    const { ctx, candidates } = await prepare(pool, h);
    const outcome = await compareCandidates(ctx, {
      chapterNo: 1,
      contractShape: CONTRACT_SHAPE,
      a: candidates[0],
      b: candidates[1],
    });
    expect(outcome.positionBiasDetected).toBe(false);
    expect(outcome.verdicts).toHaveLength(2);
    expect(outcome.reason).toMatch(/^tiebreak_(scorecard|patch_count|candidate_slot)$/);
  }, 120_000);

  it('a verdict naming the wrong candidates fails closed instead of being trusted', async () => {
    h.provider.alias('activity:compare:1:s1s2:ab', 'variant:compare:1:s1s2:ab:wrong_ids');
    const { ctx, candidates } = await prepare(pool, h);
    await expect(
      compareCandidates(ctx, {
        chapterNo: 1,
        contractShape: CONTRACT_SHAPE,
        a: candidates[0],
        b: candidates[1],
      }),
    ).rejects.toThrow(/comparison verdict names candidates/);
  }, 120_000);
});
