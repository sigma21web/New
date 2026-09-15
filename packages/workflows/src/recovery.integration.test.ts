/**
 * B-6-2 failure recovery on Postgres + ReplayProvider (NFR-B, ADR-0046): the loop must fail closed at every
 * stage, leave no partial canon, resume without re-spending, and bump exactly once.
 *
 * Each test resets the database: the fixture's ids are deterministic global primary keys, and gateway calls
 * are idempotent by (workflow, activity) key, so a fresh project is what isolates one failure scenario from
 * the next (ADR-0046). Every model call is replayed — no credentials, no live provider, no spend.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getProject, listCommits, migrate, resetDatabase, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { produceChapter, workflowIdFor, workflowStatus } from './chapter-production.js';
import { WorkflowError } from './errors.js';
import { createHarness, type Harness } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

/** Steps whose failure must never leave canon, an accepted version or a commit behind. */
const PRE_COMMIT_STEPS = [
  'story_spec',
  'chapter_contract',
  'scene_plan',
  'scene_draft',
  'assemble',
  'evaluate',
  'revise',
  'approve',
] as const;

async function counts(pool: Pool, projectId: string) {
  const q = async (sql: string) =>
    Number((await pool.query<{ n: string }>(sql, [projectId])).rows[0]?.n ?? '0');
  return {
    llmCalls: await q('SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1'),
    versions: await q('SELECT count(*)::text AS n FROM manuscript_versions WHERE project_id = $1'),
    accepted: await q(
      `SELECT count(*)::text AS n FROM manuscript_versions WHERE project_id = $1 AND status = 'accepted'`,
    ),
    commits: await q('SELECT count(*)::text AS n FROM canon_commits WHERE project_id = $1'),
    facts: await q('SELECT count(*)::text AS n FROM facts WHERE project_id = $1'),
    summaries: await q('SELECT count(*)::text AS n FROM summaries WHERE project_id = $1'),
    searchDocs: await q('SELECT count(*)::text AS n FROM search_documents WHERE project_id = $1'),
  };
}

run('failure recovery and resume (B-6-2, NFR-B)', () => {
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

  it.each(PRE_COMMIT_STEPS)(
    'a failure after %s leaves no canon commit, no accepted version and no index',
    async (step) => {
      const err = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(1, { failAfterStep: step }),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WorkflowError);

      const after = await counts(pool, h.projectId);
      // The bible commits before drafting, so two commits are legitimate; a chapter acceptance is not.
      const commits = await listCommits(pool, h.projectId);
      expect(commits.every((c) => c.source === 'bible')).toBe(true);
      expect(after.accepted).toBe(0);
      expect(after.summaries).toBe(0);
      expect(after.searchDocs).toBe(0);
      const project = await getProject(pool, h.projectId);
      expect(project.canon_version).toBe(commits.length);

      const status = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
      expect(status.status).toBe('failed');
      // The persisted error names the step an operator has to act on, never a bare stack trace.
      const persisted = status.error as { code?: unknown; step?: unknown };
      expect(typeof persisted.code).toBe('string');
      expect(persisted.step).toBe(step);
    },
    120_000,
  );

  it.each(['scene_draft', 'evaluate', 'approve'] as const)(
    'resuming after a failure at %s completes and re-spends nothing already spent',
    async (step) => {
      const first = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(1, { failAfterStep: step }),
      ).catch((e: unknown) => e);
      expect(first).toBeInstanceOf(WorkflowError);
      const before = await counts(pool, h.projectId);
      const status1 = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
      const completedBefore = status1.steps
        .filter((s) => s.status === 'completed')
        .map((s) => s.step);

      const second = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(1),
      );
      expect(second.status).toBe('completed');

      // Every step completed before the failure is replayed, not re-run.
      const replayed = second.steps.filter((s) => s.status === 'replayed').map((s) => s.step);
      for (const s of completedBefore) expect(replayed).toContain(s);

      const after = await counts(pool, h.projectId);
      // Exactly one acceptance, one summary, one chapter commit — the bump happened once.
      expect(after.accepted).toBe(1);
      expect(after.summaries).toBe(1);
      const commits = await listCommits(pool, h.projectId);
      expect(commits.filter((c) => c.source === 'chapter_acceptance')).toHaveLength(1);
      // Resume adds only the calls the remaining steps need; the replayed ones are never re-spent.
      expect(after.llmCalls).toBeGreaterThanOrEqual(before.llmCalls);
      const secondResume = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(1),
      );
      expect(secondResume.status).toBe('completed');
      const afterIdempotent = await counts(pool, h.projectId);
      // A third run is a pure replay: no new spend, no new version, no second commit.
      expect(afterIdempotent.llmCalls).toBe(after.llmCalls);
      expect(afterIdempotent.versions).toBe(after.versions);
      expect(afterIdempotent.commits).toBe(after.commits);
      expect(afterIdempotent.facts).toBe(after.facts);
    },
    180_000,
  );

  it('a racing canon commit between extraction and acceptance fails with CANON_STALE and commits nothing', async () => {
    // Extraction pins base_canon_version. Interrupt after it, then let another writer advance canon —
    // exactly the optimistic-version race the commit function guards (STALE_CANON → CANON_STALE).
    const interrupted = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1, { failAfterStep: 'extract' }),
    ).catch((e: unknown) => e);
    expect(interrupted).toBeInstanceOf(WorkflowError);
    const beforeRace = await counts(pool, h.projectId);
    expect(beforeRace.accepted).toBe(0);

    const project = await getProject(pool, h.projectId);
    const raced = project.canon_version + 1;
    await pool.query('UPDATE projects SET canon_version = $2 WHERE id = $1', [h.projectId, raced]);

    const err = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowError);
    const wf = err as WorkflowError;
    expect(wf.code).toBe('CANON_STALE');
    expect(wf.options.step).toBe('accept');
    // Actionable, not a bare failure: the operator is told to revalidate and retry.
    expect(wf.options.recommendedActions).toContain('revalidate_contract');
    expect(wf.options.recommendedActions).toContain('retry_step');

    // Nothing was half-committed: no chapter acceptance, no accepted version, no summary or index.
    const after = await counts(pool, h.projectId);
    expect(after.accepted).toBe(0);
    expect(after.summaries).toBe(0);
    expect(after.searchDocs).toBe(0);
    expect((await listCommits(pool, h.projectId)).every((c) => c.source === 'bible')).toBe(true);
    expect((await getProject(pool, h.projectId)).canon_version).toBe(raced);
    const status = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
    expect(status.status).toBe('failed');
    expect(status.error).toMatchObject({ code: 'CANON_STALE' });
  }, 180_000);

  it('a provider fault fails the step closed and never substitutes a draft', async () => {
    // A recording the provider does not have is the replay equivalent of a provider outage: the step must
    // fail with an actionable MODEL_CALL_FAILED rather than inventing text or calling a live provider.
    h.provider.override({
      'activity:scene_draft:1:2': { text: undefined, json: undefined },
    });
    const err = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowError);
    const wf = err as WorkflowError;
    expect(wf.code).toBe('MODEL_CALL_FAILED');
    expect(wf.options.step).toBe('scene_draft');
    const after = await counts(pool, h.projectId);
    expect(after.versions).toBe(0);
    expect(after.accepted).toBe(0);
    expect((await listCommits(pool, h.projectId)).every((c) => c.source === 'bible')).toBe(true);
  }, 120_000);

  it('a patch that does not repair its targeted dimension is stopped by the regression check before approval', async () => {
    // The evaluator keeps reporting the same major prose issue after the patch, so the round-1 patch
    // repaired nothing. ADR-0014: that fails the regression check at `revise` — it must never reach the
    // approval lock, let alone canon. Before the B-6-4 correction this passed the regression helper
    // (no OTHER dimension had regressed) and only failed later, at approval.
    h.provider.alias('activity:prose_judge:1:r1', 'variant:prose_judge:1:r1:still_failing');
    const err = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowError);
    const wf = err as WorkflowError;
    expect(wf.code).toBe('PATCH_REGRESSED');
    expect(wf.options.step).toBe('revise');
    expect(wf.options.data).toMatchObject({ targeted_dimension: 'prose' });
    expect(wf.options.data?.failures).toContain('targeted_not_improved');
    const status = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
    // A quality gate is an attention state for a human, not an engineering failure.
    expect(status.status).toBe('needs_attention');
    const after = await counts(pool, h.projectId);
    expect(after.accepted).toBe(0);
    expect(after.commits).toBe(2); // the two bible commits only
    expect(after.summaries).toBe(0);
    expect(after.searchDocs).toBe(0);
    // The failed regression is persisted as an auditable artifact rather than discarded.
    const artifacts = await pool.query<{ payload: { passed: boolean; failures: string[] } }>(
      `SELECT payload FROM workflow_artifacts
        WHERE project_id = $1 AND kind = 'regression_report'`,
      [h.projectId],
    );
    expect(artifacts.rows).toHaveLength(1);
    expect(artifacts.rows[0]?.payload.passed).toBe(false);
    expect(artifacts.rows[0]?.payload.failures).toContain('targeted_not_improved');
  }, 120_000);

  it('a blocked approval leaves the chapter working and reports needs_attention, not failed', async () => {
    // A gate-only block: the prose judge reports no issue at all but scores below the pinned threshold, so
    // there is nothing to revise and the run fails closed at the approval lock itself.
    h.provider.alias('activity:prose_judge:1:r0', 'variant:prose_judge:1:r0:low_score_no_issues');
    const err = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowError);
    expect((err as WorkflowError).code).toBe('APPROVAL_BLOCKED');
    expect((err as WorkflowError).options.step).toBe('approve');
    const status = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
    // A quality gate is an attention state for a human, not an engineering failure.
    expect(status.status).toBe('needs_attention');
    const after = await counts(pool, h.projectId);
    expect(after.accepted).toBe(0);
    expect(after.summaries).toBe(0);
  }, 120_000);

  it.each([['genre'], ['voice']])(
    'the newly wired %s dimension is a protected dimension in the regression check',
    async (dim) => {
      // r0 keeps the passing recording so the prose revision round proceeds; the post-patch round scores
      // this dimension far below its pre-patch value. Repairing prose at the cost of genre or voice is
      // exactly what ADR-0014 forbids, so the patch is refused at `revise` — before approval, before canon.
      h.provider.alias(`activity:${dim}_judge:1:r1`, `variant:${dim}_judge:1:r1:below_gate`);
      const err = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(1),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WorkflowError);
      const wf = err as WorkflowError;
      expect(wf.code).toBe('PATCH_REGRESSED');
      expect(wf.options.step).toBe('revise');
      expect(wf.options.data?.failures).toContain('protected_dimension_regressed');
      // The regressed dimension is named, and it is the newly wired one — not prose or structure.
      const regressed = (wf.options.data?.regressions ?? []) as { dimension: string }[];
      expect(regressed.map((r) => r.dimension)).toContain(dim);
      const after = await counts(pool, h.projectId);
      expect(after.accepted).toBe(0);
      expect(after.commits).toBe(2); // the two bible commits only
      expect(after.summaries).toBe(0);
    },
    120_000,
  );

  it.each([['genre'], ['voice']])(
    'a %s score below its pinned gate blocks approval on a chapter with no revision round',
    async (dim) => {
      // Chapter 2's fixture is approvable as written (no revision round), so a below-threshold score with
      // no repairable issue isolates the GATE itself: the run fails closed at the approval lock and
      // chapter 2 commits no canon on top of chapter 1's.
      const ch1 = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(1),
      );
      expect(ch1.status).toBe('completed');
      const afterCh1 = await counts(pool, h.projectId);
      h.provider.alias(`activity:${dim}_judge:2:r0`, `variant:${dim}_judge:1:r0:below_gate`);
      const err = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(2),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WorkflowError);
      const wf = err as WorkflowError;
      expect(wf.code).toBe('APPROVAL_BLOCKED');
      expect(wf.options.step).toBe('approve');
      expect(wf.detail).toContain(dim);
      const after = await counts(pool, h.projectId);
      // Chapter 1 stays accepted; chapter 2 added no acceptance, no commit and no summary.
      expect(after.accepted).toBe(afterCh1.accepted);
      expect(after.commits).toBe(afterCh1.commits);
      expect(after.summaries).toBe(afterCh1.summaries);
    },
    240_000,
  );

  it('the regression artifact of a passing patch is written once and is idempotent across a retry', async () => {
    // Chapter 1's fixture takes the revision path and its patch DOES repair prose, so the regression check
    // passes and the chapter reaches acceptance. Re-running must not add a second report or re-spend.
    const first = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    );
    expect(first.status).toBe('completed');
    expect(first.revision?.rounds).toBe(1);
    expect(first.revision?.regression).toMatchObject({ passed: true, targeted_resolved: true });
    expect(first.revision?.regression?.failures).toEqual([]);

    const reports = async () =>
      (
        await pool.query<{ id: string; content_hash: string; payload: { passed: boolean } }>(
          `SELECT id, content_hash, payload FROM workflow_artifacts
            WHERE project_id = $1 AND kind = 'regression_report'`,
          [h.projectId],
        )
      ).rows;
    const before = await reports();
    expect(before).toHaveLength(1);
    expect(before[0]?.payload.passed).toBe(true);
    const spendBefore = (await counts(pool, h.projectId)).llmCalls;

    const second = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    );
    expect(second.status).toBe('completed');
    const afterRows = await reports();
    // Same artifact id and same content hash: the deterministic report id makes the retry a no-op.
    expect(afterRows).toHaveLength(1);
    expect(afterRows[0]?.id).toBe(before[0]?.id);
    expect(afterRows[0]?.content_hash).toBe(before[0]?.content_hash);
    expect((await counts(pool, h.projectId)).llmCalls).toBe(spendBefore);
    // Exactly one acceptance commit on top of the two bible commits, and one accepted version.
    const c = await counts(pool, h.projectId);
    expect(c.accepted).toBe(1);
    expect(c.commits).toBe(3);
  }, 180_000);
});
