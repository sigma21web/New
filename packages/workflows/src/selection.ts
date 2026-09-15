/**
 * N-candidate winner selection (Checkpoint 6, B-6-4; ADR-0015, ADR-0014, ADR-0041).
 *
 * The comparator of ADR-0015 is pairwise, so selection is pairwise too: candidates are ordered
 * deterministically and reduced by SEQUENTIAL SINGLE ELIMINATION — the standing winner meets the next
 * eligible candidate, and the survivor of each decisive pair carries forward. No aggregate score is
 * invented: ADR-0015 says a consistent pairwise winner wins, inconsistency is position bias resolved by a
 * third shuffled-rubric run, and remaining ties fall to the deterministic ladder. An opaque ranking would
 * replace that rule rather than implement it.
 *
 * Why single elimination and not round-robin: ADR-0015's cost consequence is "2× comparison calls when
 * N=2", i.e. per PAIR. Single elimination is N−1 decisive pairs (2(N−1) judgments, plus a third where
 * position bias appears); round-robin would be N(N−1)/2 pairs for no additional authority, since the
 * pairwise verdict plus the tie ladder is already a total order on any pair. The ladder is total and
 * order-independent (proved in comparison.test.ts), so the bracket's outcome does not depend on the
 * schedule — the same candidate set yields the same winner whatever order the rows arrived in.
 *
 * Determinism: candidates are sorted by `slot` then `id` before anything runs, so database row order,
 * insertion order, resume boundary and process restart cannot change the schedule or the winner. Each
 * decisive pair is a durable `runStep`, keyed by the two candidate slots, so a retry replays a completed
 * comparison instead of re-judging it, and a resume begins at the first incomplete pair.
 *
 * Winner-only propagation is enforced at the source: only the selected winner may proceed to approval, and
 * `verifySelectedWinner` re-reads the PERSISTED selection rather than trusting a caller-supplied id.
 */
import { createHash } from 'node:crypto';
import { getManuscriptVersion, setManuscriptVersionStatus } from '@yeonjae/db';
import { GatewayError } from '@yeonjae/gateway';
import {
  compareCandidates,
  earlyStopDecision,
  type Candidate,
  type ComparisonOutcome,
  type EarlyStopDecision,
} from './comparison.js';
import { type Scorecard } from './evaluation.js';
import { WorkflowError } from './errors.js';
import { runStep, saveArtifact, type ProductionPolicy, type WorkflowContext } from './runtime.js';

/** Why a candidate may not take part. Deterministic, explicit, and persisted. */
export type IneligibilityCode =
  | 'CROSS_PROJECT'
  | 'CROSS_CHAPTER'
  | 'CANON_VERSION_MISMATCH'
  | 'IDENTITY_VERSION_MISMATCH'
  | 'POLICY_VERSION_MISMATCH'
  | 'PROMPT_PROVENANCE_MISMATCH'
  | 'NOT_IMMUTABLE'
  | 'EVALUATION_INCOMPLETE'
  | 'GATE_EVIDENCE_MISSING'
  | 'BLOCKING_GATE_FAILED'
  | 'ALREADY_TERMINAL';

/** A candidate as submitted, with the provenance eligibility is decided on. */
export interface CandidateSubmission extends Candidate {
  readonly manuscriptVersionId: string;
  readonly projectId: string;
  readonly chapterNo: number;
  readonly baseCanonVersion: number;
  readonly narrativeIdentityVersionId: string;
  readonly productionPolicyVersion: string;
  readonly promptSetId: string;
}

export interface EligibilityDecision {
  readonly candidateId: string;
  readonly slot: number;
  readonly eligible: boolean;
  readonly codes: readonly IneligibilityCode[];
  readonly detail?: string | undefined;
}

export interface ComparisonScheduleEntry {
  readonly pair: string;
  readonly aId: string;
  readonly bId: string;
  readonly winnerId: string;
  readonly loserId: string;
  readonly reason: ComparisonOutcome['reason'];
  readonly positionBiasDetected: boolean;
  readonly judgments: number;
  readonly verdictArtifactIds: readonly string[];
}

export interface ExclusionRecord {
  readonly candidateId: string;
  readonly slot: number;
  readonly reason: 'ineligible' | 'lost_comparison' | 'not_reached_early_stop';
  readonly codes?: readonly IneligibilityCode[] | undefined;
  readonly detail: string;
}

export type SelectionStatus = 'selected' | 'needs_attention';

export interface SelectionResult {
  readonly status: SelectionStatus;
  readonly chapterNo: number;
  readonly winnerId?: string | undefined;
  readonly winnerManuscriptVersionId?: string | undefined;
  readonly candidateIds: readonly string[];
  readonly eligibility: readonly EligibilityDecision[];
  readonly schedule: readonly ComparisonScheduleEntry[];
  readonly excluded: readonly ExclusionRecord[];
  readonly earlyStop: {
    readonly applied: boolean;
    readonly candidateId?: string | undefined;
    readonly decision: EarlyStopDecision | undefined;
    readonly detail: string;
  };
  readonly budget: {
    readonly pairsBudgeted: number;
    readonly judgmentsSpent: number;
    readonly detail: string;
  };
  readonly needsAttentionReason?: string | undefined;
  readonly artifactId: string;
  readonly pins: {
    readonly baseCanonVersion: number;
    readonly narrativeIdentityVersionId: string;
    readonly productionPolicyVersion: string;
    readonly promptSetId: string;
  };
}

export interface SelectionInput {
  readonly chapterNo: number;
  readonly chapterId: string;
  readonly contractShape: string;
  readonly candidates: readonly CandidateSubmission[];
  /** The world the run itself is pinned to; every candidate must match it. */
  readonly expect: {
    readonly baseCanonVersion: number;
    readonly narrativeIdentityVersionId: string;
    readonly productionPolicyVersion: string;
    readonly promptSetId: string;
  };
  /** Maximum comparator judgments this selection may spend. Defaults to the policy-derived budget. */
  readonly maxJudgments?: number | undefined;
}

/** Gated dimensions come from the pinned policy, never a hardcoded list (ADR-0041). */
function gatedDimensions(policy: ProductionPolicy): readonly string[] {
  return Object.keys(policy.gates.dimensions).sort();
}

function sectionOf(
  scorecard: Scorecard,
  dimension: string,
): { score?: number; passed?: boolean } | undefined {
  return (scorecard.sections as Record<string, { score?: number; passed?: boolean } | undefined>)[
    dimension
  ];
}

/**
 * Deterministic candidate order: slot, then id. Applied BEFORE any scheduling so the bracket cannot depend
 * on database row-return order, insertion order or a resume boundary.
 */
export function orderCandidates<T extends { slot: number; id: string }>(
  candidates: readonly T[],
): readonly T[] {
  return [...candidates].sort((a, b) =>
    a.slot !== b.slot ? a.slot - b.slot : a.id < b.id ? -1 : 1,
  );
}

/**
 * Eligibility. Every rule is a REFUSAL of that candidate with an explicit code — never a silent drop, and
 * never a reason to let a blocked candidate win because its rivals were worse.
 */
export async function decideEligibility(
  ctx: WorkflowContext,
  input: SelectionInput,
): Promise<readonly EligibilityDecision[]> {
  const decisions: EligibilityDecision[] = [];
  const policy = ctx.policy;
  const gated = gatedDimensions(policy);
  for (const candidate of orderCandidates(input.candidates)) {
    const codes: IneligibilityCode[] = [];
    const details: string[] = [];

    if (candidate.projectId !== ctx.projectId) {
      codes.push('CROSS_PROJECT');
      details.push(`candidate belongs to project ${candidate.projectId}`);
    }
    if (candidate.chapterNo !== input.chapterNo) {
      codes.push('CROSS_CHAPTER');
      details.push(`candidate is for chapter ${candidate.chapterNo}`);
    }
    if (candidate.baseCanonVersion !== input.expect.baseCanonVersion) {
      codes.push('CANON_VERSION_MISMATCH');
      details.push(
        `candidate read canon v${candidate.baseCanonVersion}, selection pins v${input.expect.baseCanonVersion}`,
      );
    }
    if (candidate.narrativeIdentityVersionId !== input.expect.narrativeIdentityVersionId) {
      codes.push('IDENTITY_VERSION_MISMATCH');
      details.push('candidate was produced under a different Narrative Identity version');
    }
    if (candidate.productionPolicyVersion !== input.expect.productionPolicyVersion) {
      codes.push('POLICY_VERSION_MISMATCH');
      details.push('candidate was produced under a different Production Policy version');
    }
    if (candidate.promptSetId !== input.expect.promptSetId) {
      codes.push('PROMPT_PROVENANCE_MISMATCH');
      details.push('candidate was produced with a different pinned prompt set');
    }

    // The manuscript version must exist, belong here, and still be a working candidate. A version that is
    // already accepted, rejected or superseded has a terminal history that selection must not reopen.
    const row = await getManuscriptVersion(ctx.pool, candidate.manuscriptVersionId);
    if (!row) {
      codes.push('NOT_IMMUTABLE');
      details.push(`manuscript version ${candidate.manuscriptVersionId} does not exist`);
    } else {
      // Project membership is verified through the stored chapter, which is the real integrity link:
      // a version's project is whatever its chapter belongs to, not whatever the submission claims.
      const owner = await ctx.pool.query<{ project_id: string; number: number }>(
        'SELECT project_id, number FROM chapters WHERE id = $1',
        [row.chapter_id],
      );
      const chapter = owner.rows[0];
      if (chapter?.project_id !== ctx.projectId) {
        if (!codes.includes('CROSS_PROJECT')) codes.push('CROSS_PROJECT');
        details.push('stored manuscript version belongs to another project');
      }
      if (chapter?.number !== undefined && chapter.number !== input.chapterNo) {
        if (!codes.includes('CROSS_CHAPTER')) codes.push('CROSS_CHAPTER');
        details.push(`stored manuscript version is chapter ${chapter.number}`);
      }
      if (row.chapter_id !== input.chapterId) {
        if (!codes.includes('CROSS_CHAPTER')) codes.push('CROSS_CHAPTER');
        details.push('stored manuscript version belongs to another chapter');
      }
      if (row.status !== 'working') {
        codes.push('ALREADY_TERMINAL');
        details.push(`manuscript version is ${row.status}`);
      }
      if (row.content_hash !== contentHashOfText(row.text)) {
        codes.push('NOT_IMMUTABLE');
        details.push('stored text does not match its recorded content hash');
      }
    }

    // Evaluation must be complete: every gated dimension present, and no blocking/major issue open.
    const missing = gated.filter((d) => sectionOf(candidate.scorecard, d)?.score === undefined);
    if (missing.length > 0) {
      codes.push('GATE_EVIDENCE_MISSING');
      details.push(`no evidence for gated dimension(s) ${missing.join(', ')}`);
    }
    if (candidate.scorecard.acceptance.dimension_results.length === 0) {
      codes.push('EVALUATION_INCOMPLETE');
      details.push('scorecard carries no dimension results');
    }
    // A candidate that fails a blocking gate is eliminated BEFORE comparison, so it can never win by
    // comparing favourably against even worse candidates.
    const failed = gated.filter((d) => {
      const section = sectionOf(candidate.scorecard, d);
      return section?.score !== undefined && section.passed === false;
    });
    const blocking =
      candidate.scorecard.overall.blocking_count > policy.gates.blocking_max ||
      candidate.scorecard.overall.major_count > policy.gates.major_max;
    if (failed.length > 0 || blocking) {
      codes.push('BLOCKING_GATE_FAILED');
      if (failed.length > 0) details.push(`failed gate(s) ${failed.join(', ')}`);
      if (blocking)
        details.push(
          `${candidate.scorecard.overall.blocking_count} blocking / ${candidate.scorecard.overall.major_count} major issues exceed the pinned maxima`,
        );
    }

    decisions.push({
      candidateId: candidate.id,
      slot: candidate.slot,
      eligible: codes.length === 0,
      codes,
      ...(details.length ? { detail: details.join('; ') } : {}),
    });
  }
  return decisions;
}

function contentHashOfText(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * The comparator judgments a selection may spend: 2 per decisive pair (both presentation orders) plus one
 * bias-breaker per pair in the worst case (ADR-0015). Derived, never hardcoded.
 */
export function judgmentBudgetFor(eligibleCount: number): number {
  if (eligibleCount < 2) return 0;
  return (eligibleCount - 1) * 3;
}

/**
 * Select one winner from N ≥ 1 candidates.
 *
 * Returns `needs_attention` — never an arbitrary pick — when no candidate is eligible, or when a pair ends
 * in a tie the policy authorizes no deterministic fallback for. Array position is never a tie-break: the
 * ladder's last rung is the candidate's stable `slot` identity.
 */
export async function selectWinner(
  ctx: WorkflowContext,
  input: SelectionInput,
): Promise<SelectionResult> {
  // A duplicate selection request returns the PERSISTED decision instead of recomputing it. This is what
  // makes a retry idempotent in the strong sense: selection has side effects (losers become terminal), so
  // a second pass over the same candidates would legitimately see a different eligibility set and could
  // not reproduce the original record. The stored artifact is the single source of truth.
  const existing = await loadSelection(ctx, input.chapterNo);
  if (existing) return existing;

  const ordered = orderCandidates(input.candidates);
  const eligibility = await decideEligibility(ctx, input);
  const eligibleIds = new Set(eligibility.filter((d) => d.eligible).map((d) => d.candidateId));
  const eligible = ordered.filter((c) => eligibleIds.has(c.id));
  const excluded: ExclusionRecord[] = [];
  for (const decision of eligibility) {
    if (decision.eligible) continue;
    excluded.push({
      candidateId: decision.candidateId,
      slot: decision.slot,
      reason: 'ineligible',
      codes: decision.codes,
      detail: decision.detail ?? decision.codes.join(', '),
    });
  }

  const pins = {
    baseCanonVersion: input.expect.baseCanonVersion,
    narrativeIdentityVersionId: input.expect.narrativeIdentityVersionId,
    productionPolicyVersion: input.expect.productionPolicyVersion,
    promptSetId: input.expect.promptSetId,
  };
  const budgeted = input.maxJudgments ?? judgmentBudgetFor(eligible.length);
  const base = {
    chapterNo: input.chapterNo,
    candidateIds: ordered.map((c) => c.id),
    eligibility,
    pins,
  };

  if (eligible.length === 0)
    return finish(ctx, input, {
      ...base,
      status: 'needs_attention',
      schedule: [],
      excluded,
      earlyStop: { applied: false, decision: undefined, detail: 'no eligible candidate' },
      budget: { pairsBudgeted: 0, judgmentsSpent: 0, detail: 'no comparison was scheduled' },
      needsAttentionReason:
        'no candidate is eligible; every candidate was excluded before comparison (see eligibility)',
    });

  // ---- Early stop (ADR-0015). Only with complete evidence for EVERY gate the policy requires, the
  // required margin above each, and no open blocking/major issue. Never an aggregate score.
  const first = eligible[0];
  if (!first)
    throw new WorkflowError('INTERNAL', 'ordered eligible list is empty', { step: 'select' });
  const earlyDecision = earlyStopDecision(ctx.policy, first);
  const earlyAllowed = eligible.length > 1 && earlyDecision.stop;
  if (earlyAllowed) {
    for (const c of eligible.slice(1))
      excluded.push({
        candidateId: c.id,
        slot: c.slot,
        reason: 'not_reached_early_stop',
        detail: `slot ${first.slot} cleared every gated dimension by the pinned margin of ${earlyDecision.marginPoints}, so later candidates were not compared (ADR-0015 early stop)`,
      });
    return finish(ctx, input, {
      ...base,
      status: 'selected',
      winnerId: first.id,
      winnerManuscriptVersionId: first.manuscriptVersionId,
      schedule: [],
      excluded,
      earlyStop: {
        applied: true,
        candidateId: first.id,
        decision: earlyDecision,
        detail: `allowed: every gated dimension cleared threshold + ${earlyDecision.marginPoints}, no blocking or major issue, and the candidate is auto-approvable`,
      },
      budget: {
        pairsBudgeted: budgeted,
        judgmentsSpent: 0,
        detail: 'early stop spent no comparator judgment',
      },
    });
  }

  // ---- Sequential single elimination over the deterministic order.
  const schedule: ComparisonScheduleEntry[] = [];
  let spent = 0;
  let standing = first;
  for (const challenger of eligible.slice(1)) {
    const pair = `s${standing.slot}s${challenger.slot}`;
    // Budget is checked BEFORE the provider is reached: a pair needs 2 judgments, and up to 3 if the
    // presentation orders disagree. Refusing here means no comparator call happens at all.
    const worstCase = 3;
    if (spent + worstCase > budgeted)
      throw new WorkflowError(
        'MODEL_CALL_FAILED',
        `comparator budget exhausted before pair ${pair}: ${spent} judgment(s) spent, ${budgeted} budgeted, up to ${worstCase} needed`,
        {
          step: 'select',
          data: {
            gateway_error: 'BUDGET_EXHAUSTED',
            pair,
            judgments_spent: spent,
            judgments_budgeted: budgeted,
            standing_candidate_id: standing.id,
            schedule,
          },
          recommendedActions: ['raise_budget'],
        },
      );

    // Durable per-pair step: a completed comparison replays instead of re-judging, so a retry adds no
    // judgment and a resume starts at the first incomplete pair.
    const outcome = await runStep(
      ctx,
      'select',
      async () =>
        compareCandidates(ctx, {
          chapterNo: input.chapterNo,
          contractShape: input.contractShape,
          a: standing,
          b: challenger,
        }),
      `${input.chapterNo}:${pair}`,
    );
    spent += outcome.verdicts.length;
    schedule.push({
      pair,
      aId: standing.id,
      bId: challenger.id,
      winnerId: outcome.winnerId,
      loserId: outcome.loserId,
      reason: outcome.reason,
      positionBiasDetected: outcome.positionBiasDetected,
      judgments: outcome.verdicts.length,
      verdictArtifactIds: outcome.verdictArtifactIds,
    });

    // An unresolved pair must not be decided by array order. `compareCandidates` applies the ADR-0015
    // ladder (scorecard → patches → slot), which is total, so it always names a winner; if a future
    // policy withdraws that authorization the outcome is needs_attention instead of an arbitrary pick.
    const ladderAuthorized = ctx.policy.candidates.judge_families_differ_from_writer !== undefined;
    if (outcome.reason.startsWith('tiebreak_') && !ladderAuthorized)
      return finish(ctx, input, {
        ...base,
        status: 'needs_attention',
        schedule,
        excluded,
        earlyStop: {
          applied: false,
          decision: earlyDecision,
          detail: earlyStopDetail(earlyDecision),
        },
        budget: {
          pairsBudgeted: budgeted,
          judgmentsSpent: spent,
          detail: 'stopped at an unresolved tie',
        },
        needsAttentionReason: `pair ${pair} could not be separated and the pinned policy authorizes no deterministic fallback`,
      });

    const loser = outcome.loserId === standing.id ? standing : challenger;
    excluded.push({
      candidateId: loser.id,
      slot: loser.slot,
      reason: 'lost_comparison',
      detail: `lost pair ${pair} by ${outcome.reason}${outcome.positionBiasDetected ? ' after position bias was detected and resolved by a third shuffled-rubric judgment' : ''}`,
    });
    standing = outcome.winnerId === standing.id ? standing : challenger;
  }

  return finish(ctx, input, {
    ...base,
    status: 'selected',
    winnerId: standing.id,
    winnerManuscriptVersionId: standing.manuscriptVersionId,
    schedule,
    excluded,
    earlyStop: { applied: false, decision: earlyDecision, detail: earlyStopDetail(earlyDecision) },
    budget: {
      pairsBudgeted: budgeted,
      judgmentsSpent: spent,
      detail: `${schedule.length} decisive pair(s) over ${eligible.length} eligible candidates`,
    },
  });
}

function earlyStopDetail(decision: EarlyStopDecision): string {
  if (decision.reason === 'cleared') return 'not applied: only one eligible candidate';
  if (decision.missingDimensions.length > 0)
    return `refused: no evaluator evidence for gated dimension(s) ${decision.missingDimensions.join(', ')} — a missing judge is never a silent pass`;
  if (decision.shortDimensions.length > 0)
    return `refused: dimension(s) ${decision.shortDimensions.join(', ')} are short of threshold + ${decision.marginPoints}`;
  if (decision.reason === 'not_auto_approvable') return 'refused: candidate is not auto-approvable';
  if (decision.reason === 'open_issues') return 'refused: blocking or major issues are open';
  return `refused: ${decision.reason}`;
}

/** Persist the selection as a content-addressed artifact and mark losers terminal. */
async function finish(
  ctx: WorkflowContext,
  input: SelectionInput,
  draft: Omit<SelectionResult, 'artifactId'>,
): Promise<SelectionResult> {
  const ref = await saveArtifact(ctx, {
    step: 'select',
    kind: 'candidate_selection',
    key: String(input.chapterNo),
    payload: {
      chapter_no: draft.chapterNo,
      status: draft.status,
      winner_id: draft.winnerId ?? null,
      winner_manuscript_version_id: draft.winnerManuscriptVersionId ?? null,
      candidate_ids: draft.candidateIds,
      eligibility: draft.eligibility,
      schedule: draft.schedule,
      excluded: draft.excluded,
      early_stop: {
        applied: draft.earlyStop.applied,
        candidate_id: draft.earlyStop.candidateId ?? null,
        detail: draft.earlyStop.detail,
        decision: draft.earlyStop.decision ?? null,
      },
      budget: {
        pairs_budgeted: draft.budget.pairsBudgeted,
        judgments_spent: draft.budget.judgmentsSpent,
        detail: draft.budget.detail,
      },
      needs_attention_reason: draft.needsAttentionReason ?? null,
      pins: {
        base_canon_version: draft.pins.baseCanonVersion,
        narrative_identity_version_id: draft.pins.narrativeIdentityVersionId,
        production_policy_version: draft.pins.productionPolicyVersion,
        prompt_set_id: draft.pins.promptSetId,
      },
    },
  });
  // Losers become terminal so nothing downstream can mistake one for a live version. They stay immutable:
  // only `status` moves, and their text, hash and history are untouched.
  if (draft.status === 'selected') {
    for (const record of draft.excluded) {
      const submission = input.candidates.find((c) => c.id === record.candidateId);
      if (!submission) continue;
      const row = await getManuscriptVersion(ctx.pool, submission.manuscriptVersionId);
      if (row?.status !== 'working') continue;
      await setManuscriptVersionStatus(ctx.pool, submission.manuscriptVersionId, 'rejected');
    }
  }
  return { ...draft, artifactId: ref.artifact_id };
}

interface StoredSelection {
  status: SelectionStatus;
  winner_id: string | null;
  winner_manuscript_version_id: string | null;
  candidate_ids: string[];
  eligibility: EligibilityDecision[];
  schedule: ComparisonScheduleEntry[];
  excluded: ExclusionRecord[];
  early_stop: {
    applied: boolean;
    candidate_id: string | null;
    detail: string;
    decision: EarlyStopDecision | null;
  };
  budget: { pairs_budgeted: number; judgments_spent: number; detail: string };
  needs_attention_reason: string | null;
  pins: {
    base_canon_version: number;
    narrative_identity_version_id: string;
    production_policy_version: string;
    prompt_set_id: string;
  };
}

/** Read the persisted selection for a chapter, if one exists. */
async function loadSelection(
  ctx: WorkflowContext,
  chapterNo: number,
): Promise<SelectionResult | undefined> {
  const row = await ctx.pool.query<{ id: string; payload: StoredSelection }>(
    `SELECT id, payload FROM workflow_artifacts
      WHERE project_id = $1 AND kind = 'candidate_selection' AND key = $2`,
    [ctx.projectId, String(chapterNo)],
  );
  const found = row.rows[0];
  if (!found) return undefined;
  const p = found.payload;
  return {
    status: p.status,
    chapterNo,
    ...(p.winner_id === null ? {} : { winnerId: p.winner_id }),
    ...(p.winner_manuscript_version_id === null
      ? {}
      : { winnerManuscriptVersionId: p.winner_manuscript_version_id }),
    candidateIds: p.candidate_ids,
    eligibility: p.eligibility,
    schedule: p.schedule,
    excluded: p.excluded,
    earlyStop: {
      applied: p.early_stop.applied,
      ...(p.early_stop.candidate_id === null ? {} : { candidateId: p.early_stop.candidate_id }),
      decision: p.early_stop.decision ?? undefined,
      detail: p.early_stop.detail,
    },
    budget: {
      pairsBudgeted: p.budget.pairs_budgeted,
      judgmentsSpent: p.budget.judgments_spent,
      detail: p.budget.detail,
    },
    ...(p.needs_attention_reason === null
      ? {}
      : { needsAttentionReason: p.needs_attention_reason }),
    artifactId: found.id,
    pins: {
      baseCanonVersion: p.pins.base_canon_version,
      narrativeIdentityVersionId: p.pins.narrative_identity_version_id,
      productionPolicyVersion: p.pins.production_policy_version,
      promptSetId: p.pins.prompt_set_id,
    },
  };
}

/**
 * Winner-only propagation guard. Approval and canon acceptance call this with the version they are about to
 * approve; it re-reads the PERSISTED selection artifact and refuses anything that is not the recorded
 * winner — so a caller-supplied or stale candidate id cannot reach canon.
 */
export async function verifySelectedWinner(
  ctx: WorkflowContext,
  input: { chapterNo: number; manuscriptVersionId: string },
): Promise<{ winnerManuscriptVersionId: string }> {
  const row = await ctx.pool.query<{
    payload: {
      status: SelectionStatus;
      winner_manuscript_version_id: string | null;
      needs_attention_reason: string | null;
    };
  }>(
    `SELECT payload FROM workflow_artifacts
      WHERE project_id = $1 AND kind = 'candidate_selection' AND key = $2`,
    [ctx.projectId, String(input.chapterNo)],
  );
  const payload = row.rows[0]?.payload;
  if (!payload)
    throw new WorkflowError(
      'APPROVAL_BLOCKED',
      `chapter ${input.chapterNo} has no persisted candidate selection; approval may not proceed on an unselected candidate`,
      { step: 'approve', recommendedActions: ['retry_step'] },
    );
  if (payload.status !== 'selected' || payload.winner_manuscript_version_id === null)
    throw new WorkflowError(
      'APPROVAL_BLOCKED',
      `chapter ${input.chapterNo} selection is ${payload.status}: ${payload.needs_attention_reason ?? 'no winner was selected'}`,
      { step: 'approve', recommendedActions: ['edit_manually', 'regenerate'] },
    );
  if (payload.winner_manuscript_version_id !== input.manuscriptVersionId)
    throw new WorkflowError(
      'APPROVAL_BLOCKED',
      `manuscript version ${input.manuscriptVersionId} is not the selected winner (${payload.winner_manuscript_version_id}) for chapter ${input.chapterNo}`,
      {
        step: 'approve',
        data: {
          supplied: input.manuscriptVersionId,
          selected: payload.winner_manuscript_version_id,
        },
        recommendedActions: ['edit_manually'],
      },
    );
  return { winnerManuscriptVersionId: payload.winner_manuscript_version_id };
}

export { GatewayError };
