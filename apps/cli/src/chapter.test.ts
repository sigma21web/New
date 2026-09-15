/**
 * Chapter CLI surface on Postgres: `chapter:produce` runs the production workflow through the same
 * `produceChapter` core loop, `chapter:status` reads the persisted job, `chapter:resume` re-runs the
 * deterministic workflow id, and `export:accepted` exports accepted manuscripts only. Every model call
 * is replayed from the chapter-1 fixture — no credentials, no live provider, no spend.
 *
 * Each test owns a fresh project (global fixture UUIDs collide across projects by design, ADR-0046),
 * and tests that assert on a completed run produce it first — they never rely on another test's rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProject, createWorkspace, migrate, resetDatabase, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { cmdChapterProduce, cmdChapterResume, runDb } from './commands.js';
import { workflowIdFor } from '@yeonjae/workflows';

const run = databaseUrl() ? describe : describe.skip;

const FULL = {
  chapterNo: 1,
  stage: 'full' as const,
  failAfterStep: undefined,
  replayFile: undefined,
};

run('cli chapter surface (Postgres + ReplayProvider)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 60_000);

  // Fixed fixture UUIDs collide across projects by design (ADR-0046): reset per test so each
  // test's project is the only holder of the fixture's global entity/promise ids.
  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function freshProject(title: string): Promise<string> {
    const ws = await createWorkspace(pool, 'cli-chapter');
    const { projectId } = await createProject(pool, { workspaceId: ws, title });
    return projectId;
  }

  it('produces chapter 1 to acceptance with workflow/job ids and status', async () => {
    const projectId = await freshProject('CLI produce');
    const r = await cmdChapterProduce(pool, { projectId, ...FULL });
    expect(r.ok, JSON.stringify(r.output)).toBe(true);
    const out = r.output as {
      workflow_id: string;
      job_id: string;
      status: string;
      accepted: { canon_version: number; item_counts: Record<string, number> } | undefined;
      steps: { step: string; status: string }[];
    };
    expect(out.workflow_id).toBe(workflowIdFor(projectId, 1));
    expect(out.job_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.status).toBe('completed');
    expect(out.accepted?.canon_version).toBe(3);
    expect(out.accepted?.item_counts).toEqual({
      fact: 4,
      event: 3,
      promise_event: 1,
      knowledge_state: 1,
      relationship_state: 2,
    });
    expect(out.steps.length).toBeGreaterThan(10);
  }, 180_000);

  it('re-running produce is idempotent: completed steps replay and no llm call is added', async () => {
    const projectId = await freshProject('CLI idempotency');
    const first = await cmdChapterProduce(pool, { projectId, ...FULL });
    expect(first.ok, JSON.stringify(first.output)).toBe(true);
    const before = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1',
      [projectId],
    );
    const r = await cmdChapterProduce(pool, { projectId, ...FULL });
    expect(r.ok, JSON.stringify(r.output)).toBe(true);
    const out = r.output as { status: string; steps: { status: string }[] };
    expect(out.status).toBe('completed');
    expect(out.steps.every((s) => s.status === 'replayed')).toBe(true);
    const after = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1',
      [projectId],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  }, 240_000);

  it('chapter:status reports the persisted job; chapter 2 without accepted chapter 1 fails closed', async () => {
    const projectId = await freshProject('CLI status');
    const produced = await cmdChapterProduce(pool, { projectId, ...FULL });
    expect(produced.ok, JSON.stringify(produced.output)).toBe(true);
    const status = await runDb(['chapter:status', workflowIdFor(projectId, 1)]);
    expect(status.ok, JSON.stringify(status.output)).toBe(true);
    const s = status.output as { status: string; job_id: string; llm_calls: number };
    expect(s.status).toBe('completed');
    expect(s.llm_calls).toBeGreaterThanOrEqual(20);
    // Chapter 2 on a project whose chapter 1 was never accepted fails closed, resumably.
    const fresh = await freshProject('CLI fail proof');
    const failed = await cmdChapterProduce(pool, {
      projectId: fresh,
      chapterNo: 2,
      stage: 'full',
      failAfterStep: undefined,
      replayFile: undefined,
    });
    expect(failed.ok).toBe(false);
    expect(failed.output as { error: string }).toMatchObject({
      error: 'PREVIOUS_CHAPTER_NOT_ACCEPTED',
    });
    const retry = await cmdChapterResume(pool, {
      workflowId: workflowIdFor(fresh, 2),
      replayFile: undefined,
    });
    expect(retry.ok).toBe(false);
    expect(retry.output as { error: string }).toMatchObject({
      error: 'PREVIOUS_CHAPTER_NOT_ACCEPTED',
    });
  }, 240_000);

  it('interruption followed by resume completes without re-spending completed steps', async () => {
    const pid = await freshProject('CLI resume proof');
    const interrupted = await cmdChapterProduce(pool, {
      projectId: pid,
      chapterNo: 1,
      stage: 'full',
      failAfterStep: 'evaluate',
      replayFile: undefined,
    });
    expect(interrupted.ok).toBe(false);
    expect(interrupted.output as { error: string }).toMatchObject({ error: 'INTERNAL' });
    const callsAtInterrupt = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1',
      [pid],
    );
    const resumed = await cmdChapterResume(pool, {
      workflowId: workflowIdFor(pid, 1),
      replayFile: undefined,
    });
    expect(resumed.ok, JSON.stringify(resumed.output)).toBe(true);
    const out = resumed.output as {
      status: string;
      accepted: { canon_version: number } | undefined;
      steps: { step: string; status: string }[];
    };
    expect(out.status).toBe('completed');
    expect(out.accepted?.canon_version).toBe(3);
    const replayed = out.steps.filter((s) => s.status === 'replayed');
    expect(replayed.length).toBeGreaterThan(5);
    expect(out.steps.some((s) => s.status === 'completed')).toBe(true);
    // Only post-failure calls were added (25 total on the fixture path: two evaluation rounds now each
    // include the genre and voice judges that standard.v1 gates).
    const callsAfter = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1',
      [pid],
    );
    expect(Number(callsAfter.rows[0]?.n)).toBe(25);
    expect(Number(callsAfter.rows[0]?.n)).toBeGreaterThan(Number(callsAtInterrupt.rows[0]?.n));
  }, 240_000);

  it('export:accepted returns accepted text only; usage errors are actionable', async () => {
    const projectId = await freshProject('CLI export');
    const produced = await cmdChapterProduce(pool, { projectId, ...FULL });
    expect(produced.ok, JSON.stringify(produced.output)).toBe(true);
    const ok = await runDb(['export:accepted', projectId]);
    expect(ok.ok, JSON.stringify(ok.output)).toBe(true);
    const ex = ok.output as {
      chapters: { chapter_no: number; words: number }[];
      format: string;
      text_bytes: number;
    };
    expect(ex.format).toBe('markdown');
    expect(ex.chapters.map((c) => c.chapter_no)).toEqual([1]);
    expect(ex.text_bytes).toBeGreaterThan(1000);
    const full = await runDb(['export:accepted', projectId, '--full']);
    expect(full.ok).toBe(true);
    expect((full.output as { text: string }).text).toContain('## Chapter 1');
    expect((await runDb(['chapter:produce'])).ok).toBe(false);
    expect((await runDb(['chapter:produce', projectId, '0'])).ok).toBe(false);
    expect((await runDb(['chapter:produce', '00000000-0000-0000-0000-000000000000', '1'])).ok).toBe(
      false,
    );
    expect(
      (await runDb(['chapter:status', 'chapter:00000000-0000-0000-0000-000000000000:9'])).ok,
    ).toBe(false);
  }, 240_000);
});
