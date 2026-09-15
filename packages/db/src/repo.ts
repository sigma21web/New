/**
 * Typed repository over the canon schema. Reads are plain queries; every write that touches canon goes through
 * `canon.commit_delta` / `canon.rollback_latest` so the atomic boundary is the SQL function, not this module.
 */
import { type Client, type Pool, rethrowCanon, withTransaction } from './client.js';
import { measure, toNfcText } from '@yeonjae/prose';
import { createHash } from 'node:crypto';
import { type StoryClock } from '@yeonjae/domain';

type Queryable = Pool | Client;

export interface ProjectRow {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  operating_mode: string;
  quality_tier: string;
  production_policy_version: string;
  canon_version: number;
  settings: Record<string, unknown>;
}

export interface TimelineRow {
  id: string;
  project_id: string;
  name: string;
  kind: 'main' | 'prior_loop' | 'alternate' | 'source_story';
  parent_timeline_id: string | null;
  divergence_clock: StoryClock | null;
}

export interface EntityRow {
  id: string;
  project_id: string;
  type: string;
  display_name: string;
  native_script_name: string | null;
  romanization: string | null;
  short_forms: string[];
  aliases: string[];
  status: string;
  provisional: boolean;
  fields: Record<string, unknown>;
}

export interface ManuscriptVersionRow {
  id: string;
  chapter_id: string;
  version_no: number;
  origin: string;
  status: 'working' | 'approved' | 'accepted' | 'superseded' | 'retconned' | 'rejected';
  language: 'en';
  text: string;
  length: Record<string, number | string>;
  content_hash: string;
  parent_version_id: string | null;
  accepted_commit_id: string | null;
}

export interface FactRow {
  id: string;
  timeline_id: string;
  entity_id: string;
  attribute: string;
  key: string | null;
  value: unknown;
  value_text: string | null;
  valid_from: StoryClock;
  valid_to: StoryClock | null;
  asserted_at_version: number;
  retracted_at_version: number | null;
  source: string;
  frame: string;
  locked: boolean;
  superseded_by_fact_id: string | null;
}

export interface KnowledgeRow {
  id: string;
  knower_kind: string;
  knower_entity_id: string | null;
  proposition_id: string;
  stance: string;
  believed_value: string | null;
  source: Record<string, unknown>;
  valid_from: StoryClock;
  valid_to: StoryClock | null;
  asserted_at_version: number;
  retracted_at_version: number | null;
}

export interface CommitRow {
  id: string;
  version: number;
  parent_version: number;
  source: string;
  chapter_id: string | null;
  manuscript_version_id: string | null;
  delta: unknown;
  inverse: unknown;
  item_counts: Record<string, number>;
  touched_item_ids: string[];
  created_at: Date;
}

export async function createWorkspace(db: Queryable, name: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [name],
  );
  return r.rows[0]?.id ?? rethrowCanon(new Error('insert returned no row'));
}

export async function createProject(
  db: Queryable,
  input: {
    workspaceId: string;
    title: string;
    qualityTier?: string;
    policyVersion?: string;
    operatingMode?: string;
    /** Project-level pins (e.g. the composed Narrative Identity ref + version id the workflows must use). */
    settings?: Record<string, unknown> | undefined;
    id?: string | undefined;
  },
): Promise<{ projectId: string; mainTimelineId: string }> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO projects (id, workspace_id, title, quality_tier, production_policy_version, operating_mode, settings)
     VALUES (coalesce($6::uuid, canon.uuid_v7()), $1, $2, $3, $4, $5, $7::jsonb) RETURNING id`,
    [
      input.workspaceId,
      input.title,
      input.qualityTier ?? 'standard',
      input.policyVersion ?? 'policy/standard@1',
      input.operatingMode ?? 'assisted',
      input.id ?? null,
      JSON.stringify(input.settings ?? {}),
    ],
  );
  const projectId = r.rows[0]?.id;
  if (!projectId) throw new Error('project insert returned no row');
  const t = await db.query<{ id: string }>(
    `INSERT INTO timelines (workspace_id, project_id, name, kind) VALUES ($1, $2, 'main', 'main') RETURNING id`,
    [input.workspaceId, projectId],
  );
  const mainTimelineId = t.rows[0]?.id;
  if (!mainTimelineId) throw new Error('timeline insert returned no row');
  return { projectId, mainTimelineId };
}

export async function getProject(db: Queryable, projectId: string): Promise<ProjectRow> {
  const r = await db.query<ProjectRow>('SELECT * FROM projects WHERE id = $1', [projectId]);
  const row = r.rows[0];
  if (!row) throw new Error(`project ${projectId} not found`);
  return row;
}

export async function createTimeline(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    name: string;
    kind: TimelineRow['kind'];
    parentTimelineId?: string;
    divergenceClock?: StoryClock;
  },
): Promise<string> {
  const r = await db
    .query<{ id: string }>(
      `INSERT INTO timelines (workspace_id, project_id, name, kind, parent_timeline_id, divergence_clock)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        input.workspaceId,
        input.projectId,
        input.name,
        input.kind,
        input.parentTimelineId ?? null,
        input.divergenceClock ? JSON.stringify(input.divergenceClock) : null,
      ],
    )
    .catch(rethrowCanon);
  return r.rows[0]?.id ?? rethrowCanon(new Error('insert returned no row'));
}

export async function createEntity(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    type: string;
    displayName: string;
    shortForms?: string[];
    aliases?: string[];
    fields?: Record<string, unknown>;
    id?: string | undefined;
  },
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO entities (id, workspace_id, project_id, type, display_name, short_forms, aliases, fields)
     VALUES (coalesce($8::uuid, canon.uuid_v7()), $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.workspaceId,
      input.projectId,
      input.type,
      input.displayName,
      input.shortForms ?? [],
      input.aliases ?? [],
      JSON.stringify(input.fields ?? {}),
      input.id ?? null,
    ],
  );
  return r.rows[0]?.id ?? rethrowCanon(new Error('insert returned no row'));
}

export async function createChapter(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    number: number;
    title?: string | undefined;
    id?: string | undefined;
  },
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO chapters (id, workspace_id, project_id, number, title) VALUES (coalesce($5::uuid, canon.uuid_v7()), $1, $2, $3, $4) RETURNING id`,
    [input.workspaceId, input.projectId, input.number, input.title ?? null, input.id ?? null],
  );
  return r.rows[0]?.id ?? rethrowCanon(new Error('insert returned no row'));
}

export async function setChapterStatus(
  db: Queryable,
  chapterId: string,
  status: string,
): Promise<void> {
  await db
    .query('UPDATE chapters SET status = $2, updated_at = now() WHERE id = $1', [chapterId, status])
    .catch(rethrowCanon);
}

/**
 * Store a new immutable manuscript version. Text is NFC-normalized at this boundary (ADR-0030). Version
 * numbers count quarantined versions too, so a rejected v1 and its replacement never share a number.
 */
export async function createManuscriptVersion(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    chapterId: string;
    origin: string;
    text: string;
    parentVersionId?: string;
    createdByJobId?: string;
  },
): Promise<ManuscriptVersionRow> {
  const nfc = toNfcText(input.text);
  const length = measure(nfc);
  const contentHash = `sha256:${createHash('sha256').update(nfc.text, 'utf8').digest('hex')}`;
  const r = await db
    .query<ManuscriptVersionRow>(
      `INSERT INTO manuscript_versions (workspace_id, project_id, chapter_id, version_no, origin, text, length, content_hash, parent_version_id, created_by_job_id)
       VALUES ($1, $2, $3,
               (SELECT coalesce(max(v), 0) + 1 FROM (SELECT version_no AS v FROM manuscript_versions WHERE chapter_id = $3
                                                    UNION ALL SELECT version_no FROM quarantine_versions WHERE chapter_id = $3) x),
               $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.workspaceId,
        input.projectId,
        input.chapterId,
        input.origin,
        nfc.text,
        JSON.stringify(length),
        contentHash,
        input.parentVersionId ?? null,
        input.createdByJobId ?? null,
      ],
    )
    .catch(rethrowCanon);
  return r.rows[0] ?? rethrowCanon(new Error('insert returned no row'));
}

export async function getManuscriptVersion(
  db: Queryable,
  id: string,
): Promise<ManuscriptVersionRow | undefined> {
  const r = await db.query<ManuscriptVersionRow>(
    'SELECT * FROM manuscript_versions WHERE id = $1',
    [id],
  );
  return r.rows[0];
}

/** Approval-lock a working version (the gate's outcome). Also moves the chapter to `approved`. */
export async function approveManuscriptVersion(
  db: Queryable,
  versionId: string,
  approvedBy: string,
): Promise<void> {
  await db
    .query(`UPDATE manuscript_versions SET status = 'approved', approved_by = $2 WHERE id = $1`, [
      versionId,
      approvedBy,
    ])
    .catch(rethrowCanon);
  await db
    .query(
      `UPDATE chapters SET status = 'approved', updated_at = now() WHERE id = (SELECT chapter_id FROM manuscript_versions WHERE id = $1)`,
      [versionId],
    )
    .catch(rethrowCanon);
}

/**
 * Mark a losing candidate terminal after N-candidate selection (B-6-4). Only `status` moves: the text,
 * content hash, parent link and history stay untouched, so the loser remains immutable and auditable.
 * `working → rejected` is the transition the manuscript guard already authorizes (ADR-0037).
 */
export async function setManuscriptVersionStatus(
  db: Queryable,
  versionId: string,
  status: 'rejected',
): Promise<void> {
  await db
    .query('UPDATE manuscript_versions SET status = $2 WHERE id = $1', [versionId, status])
    .catch(rethrowCanon);
}

export async function quarantineVersion(
  db: Queryable,
  versionId: string,
  reason: string,
): Promise<void> {
  await db
    .query('SELECT canon.quarantine_version($1, $2)', [versionId, reason])
    .catch(rethrowCanon);
}

export interface CommitInput {
  projectId: string;
  parentVersion: number;
  source:
    | 'bible'
    | 'chapter_acceptance'
    | 'user_correction'
    | 'retcon'
    | 'rollback'
    | 'merge_entities'
    | 'regeneration';
  delta: unknown;
  actor?: Record<string, unknown> | undefined;
  chapterId?: string | undefined;
  manuscriptVersionId?: string | undefined;
  justification?: string | undefined;
  clockMax?: StoryClock | undefined;
  supersededManuscriptVersionId?: string | undefined;
}

export interface CommitResult {
  commit_id: string;
  version: number;
  item_ids: Record<string, string>;
  item_counts: Record<string, number>;
}

/** The atomic canon boundary. Runs canon.commit_delta inside one transaction. */
export async function commitDelta(pool: Pool, input: CommitInput): Promise<CommitResult> {
  return withTransaction(pool, async (client) => {
    const r = await client
      .query<{ commit_delta: CommitResult }>(
        `SELECT canon.commit_delta($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9::jsonb, $10) AS commit_delta`,
        [
          input.projectId,
          input.parentVersion,
          input.source,
          JSON.stringify(input.delta),
          JSON.stringify(input.actor ?? {}),
          input.chapterId ?? null,
          input.manuscriptVersionId ?? null,
          input.justification ?? null,
          input.clockMax ? JSON.stringify(input.clockMax) : null,
          input.supersededManuscriptVersionId ?? null,
        ],
      )
      .catch(rethrowCanon);
    const out = r.rows[0]?.commit_delta;
    if (!out) throw new Error('commit_delta returned no row');
    return out;
  });
}

export async function rollbackLatest(
  pool: Pool,
  projectId: string,
  actor: Record<string, unknown> = {},
): Promise<{ commit_id: string; version: number; rolled_back_version: number }> {
  return withTransaction(pool, async (client) => {
    const r = await client
      .query<{
        rollback_latest: { commit_id: string; version: number; rolled_back_version: number };
      }>('SELECT canon.rollback_latest($1, $2::jsonb) AS rollback_latest', [
        projectId,
        JSON.stringify(actor),
      ])
      .catch(rethrowCanon);
    const out = r.rows[0]?.rollback_latest;
    if (!out) throw new Error('rollback_latest returned no row');
    return out;
  });
}

export async function stateAt(
  db: Queryable,
  q: {
    projectId: string;
    entityId: string;
    attribute?: string;
    key?: string;
    clock: StoryClock;
    timelineId?: string;
    asOfVersion?: number;
  },
): Promise<FactRow[]> {
  const r = await db.query<FactRow>(
    'SELECT * FROM canon.state_at($1, $2, $3, $4::jsonb, $5, $6, $7)',
    [
      q.projectId,
      q.entityId,
      q.attribute ?? null,
      JSON.stringify(q.clock),
      q.timelineId ?? null,
      q.asOfVersion ?? null,
      q.key ?? null,
    ],
  );
  return r.rows;
}

export async function knowledgeAt(
  db: Queryable,
  q: {
    projectId: string;
    knowerKind: string;
    knowerEntityId?: string;
    propositionId?: string;
    clock: StoryClock;
    timelineId?: string;
    asOfVersion?: number;
  },
): Promise<KnowledgeRow[]> {
  const r = await db.query<KnowledgeRow>(
    'SELECT * FROM canon.knowledge_at($1, $2, $3, $4, $5::jsonb, $6, $7)',
    [
      q.projectId,
      q.knowerKind,
      q.knowerEntityId ?? null,
      q.propositionId ?? null,
      JSON.stringify(q.clock),
      q.timelineId ?? null,
      q.asOfVersion ?? null,
    ],
  );
  return r.rows;
}

export async function truthAt(
  db: Queryable,
  propositionId: string,
  timelineId: string,
  clock: StoryClock,
  asOfVersion?: number,
): Promise<'true' | 'false' | 'unknown'> {
  const r = await db.query<{ truth_at: 'true' | 'false' | 'unknown' }>(
    'SELECT canon.truth_at($1, $2, $3::jsonb, $4) AS truth_at',
    [propositionId, timelineId, JSON.stringify(clock), asOfVersion ?? null],
  );
  return r.rows[0]?.truth_at ?? 'unknown';
}

export async function listCommits(db: Queryable, projectId: string): Promise<CommitRow[]> {
  const r = await db.query<CommitRow>(
    'SELECT * FROM canon_commits WHERE project_id = $1 ORDER BY version',
    [projectId],
  );
  return r.rows;
}

export async function getFact(db: Queryable, id: string): Promise<FactRow | undefined> {
  const r = await db.query<FactRow>('SELECT * FROM facts WHERE id = $1', [id]);
  return r.rows[0];
}

export async function factsForEntity(
  db: Queryable,
  projectId: string,
  entityId: string,
): Promise<FactRow[]> {
  const r = await db.query<FactRow>(
    'SELECT * FROM facts WHERE project_id = $1 AND entity_id = $2 ORDER BY valid_from_ord, asserted_at_version',
    [projectId, entityId],
  );
  return r.rows;
}

export async function quarantineContains(
  db: Queryable,
  projectId: string,
  phrase: string,
): Promise<boolean> {
  const r = await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM quarantine_versions WHERE project_id = $1 AND text LIKE $2',
    [projectId, `%${phrase}%`],
  );
  return Number(r.rows[0]?.n ?? '0') > 0;
}

/** Everything an accepted-only reader may see: used by tests to prove quarantine isolation. */
export async function acceptedCorpus(db: Queryable, projectId: string): Promise<string[]> {
  const r = await db.query<{ text: string }>(
    `SELECT text FROM manuscript_versions WHERE project_id = $1 AND status = 'accepted'`,
    [projectId],
  );
  return r.rows.map((x) => x.text);
}
