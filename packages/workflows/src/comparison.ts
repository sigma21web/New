/**
 * Candidate comparison and patch-regression checks (Checkpoint 6, B-6-4; ADR-0015, ADR-0014).
 *
 * Comparison (ADR-0015): two candidates for the same locked contract are judged pairwise in BOTH
 * presentation orders by `chapter_comparator`. A consistent winner wins. An inconsistent pair (the judge
 * preferred whichever text sat in position A, or flipped) is position bias and is never silently resolved:
 * a third run with a shuffled rubric order decides it. Remaining ties fall to the deterministic ladder —
 * higher scorecard first, then fewer patches, then the lower candidate slot — so the outcome never depends
 * on call order. `earlyStop` skips further candidates when the first is auto-approvable and clears every
 * gated dimension by the pinned margin (never an aggregate score; ADR-0041).
 *
 * Patch regression (ADR-0014): a dimension-targeted patch may not pay for its own dimension with another
 * one. `patchRegression` compares the gated dimension scores before and after a patch and reports any
 * non-targeted dimension that fell by more than `policy.revision.regression_tolerance_points`.
 *
 * The predicates take the pinned Production Policy rather than the whole workflow context: they are pure
 * functions of policy + scorecards, and the numbers always come from the policy (ADR-0041).
 */
import { createHash } from 'node:crypto';
import { type Generated } from '@yeonjae/domain';
import { type Issue, type Scorecard } from './evaluation.js';
import { WorkflowError } from './errors.js';
import { modelCall, saveArtifact, type ProductionPolicy, type WorkflowContext } from './runtime.js';

export type ComparisonVerdict = Generated.ComparisonVerdictSchema.ComparisonVerdict;

/**
 * One chapter candidate. `slot` is the candidate's generation slot (1-based) and is what activity ids and
 * tie-breaks use, so a replayed comparison is keyed deterministically and never by a runtime UUID.
 */
export interface Candidate {
  readonly slot: number;
  readonly id: string;
  readonly text: string;
  readonly scorecard: Scorecard;
  readonly patchCount: number;
}

export type ComparisonReason =
  | 'consistent'
  | 'tiebreak_shuffled_rubric'
  | 'tiebreak_scorecard'
  | 'tiebreak_patch_count'
  | 'tiebreak_candidate_slot';

export interface ComparisonOutcome {
  readonly winnerId: string;
  readonly loserId: string;
  readonly reason: ComparisonReason;
  /** True when the two presentation orders disagreed — the position-bias signal of ADR-0015. */
  readonly positionBiasDetected: boolean;
  readonly verdicts: readonly ComparisonVerdict[];
  readonly verdictArtifactIds: readonly string[];
}

/** The dimensions a chapter comparison judges, in the canonical order (subset of the schema enum). */
export const CHAPTER_COMPARISON_DIMENSIONS = [
  'contract_fit',
  'hook',
  'pacing',
  'emotional_impact',
  'english_prose_quality',
  'serialized_structure',
  'continuity_risk',
] as const;

/** Gated dimensions come from the pinned policy, never from a hardcoded list (ADR-0041). */
function gatedDimensions(policy: ProductionPolicy): readonly string[] {
  return Object.keys(policy.gates.dimensions).sort();
}

function sectionScore(scorecard: Scorecard, dimension: string): number | undefined {
  const sections = scorecard.sections as Record<string, { score?: number } | undefined>;
  return sections[dimension]?.score;
}

export interface EarlyStopDecision {
  readonly stop: boolean;
  /** Gated dimensions the scorecard does not carry — these can never count as cleared. */
  readonly missingDimensions: readonly string[];
  /** Gated dimensions present but short of threshold + margin. */
  readonly shortDimensions: readonly string[];
  readonly marginPoints: number;
  readonly reason: 'cleared' | 'not_auto_approvable' | 'open_issues' | 'dimensions_short';
}

/**
 * ADR-0015 early stop: a candidate ends generation only when it is auto-approvable with no
 * blocking/major issues AND every gated dimension clears its threshold by the pinned margin. A gated
 * dimension the scorecard does not carry is never treated as cleared — that would turn a missing judge
 * into a silent pass — so the decision reports it instead.
 *
 * Note (real mismatch, not a defect of this function): `standard.v1` gates `genre` and `voice`, which the
 * Checkpoint 5 evaluator does not yet produce. Under that policy `earlyStop` therefore reports
 * `missingDimensions` and refuses to stop until those judges are wired. See the progress document.
 */
export function earlyStopDecision(
  policy: ProductionPolicy,
  candidate: Candidate,
): EarlyStopDecision {
  const margin = policy.candidates.early_stop_margin_points;
  const dims = Object.entries(policy.gates.dimensions);
  const missing: string[] = [];
  const short: string[] = [];
  for (const [name, gate] of dims) {
    const score = sectionScore(candidate.scorecard, name);
    if (score === undefined) missing.push(name);
    else if (score < gate.min_score + margin) short.push(name);
  }
  const base = { missingDimensions: missing, shortDimensions: short, marginPoints: margin };
  if (!candidate.scorecard.acceptance.auto_approvable)
    return { stop: false, ...base, reason: 'not_auto_approvable' };
  if (candidate.scorecard.overall.blocking_count > 0 || candidate.scorecard.overall.major_count > 0)
    return { stop: false, ...base, reason: 'open_issues' };
  if (dims.length === 0 || missing.length > 0 || short.length > 0)
    return { stop: false, ...base, reason: 'dimensions_short' };
  return { stop: true, ...base, reason: 'cleared' };
}

export function earlyStop(policy: ProductionPolicy, candidate: Candidate): boolean {
  return earlyStopDecision(policy, candidate).stop;
}

/** Deterministic ladder for a pair the judge could not separate (ADR-0015): scorecard → patches → slot. */
export function breakTie(
  policy: ProductionPolicy,
  a: Candidate,
  b: Candidate,
): { winnerId: string; reason: ComparisonReason } {
  // "Higher scorecard" is the sum over gated dimensions — never `overall.score`, which is not a gate input.
  const total = (c: Candidate) =>
    gatedDimensions(policy).reduce((sum, d) => sum + (sectionScore(c.scorecard, d) ?? 0), 0);
  const ta = total(a);
  const tb = total(b);
  if (ta !== tb) return { winnerId: ta > tb ? a.id : b.id, reason: 'tiebreak_scorecard' };
  if (a.patchCount !== b.patchCount)
    return { winnerId: a.patchCount < b.patchCount ? a.id : b.id, reason: 'tiebreak_patch_count' };
  return { winnerId: a.slot < b.slot ? a.id : b.id, reason: 'tiebreak_candidate_slot' };
}

function preferredId(verdict: ComparisonVerdict): string | undefined {
  if (verdict.overall_preference === 'tie') return undefined;
  return verdict.overall_preference === 'a' ? verdict.candidate_a_id : verdict.candidate_b_id;
}

function validateVerdict(
  verdict: ComparisonVerdict,
  expected: { aId: string; bId: string; order: 'ab' | 'ba' },
): void {
  if (verdict.candidate_a_id !== expected.aId || verdict.candidate_b_id !== expected.bId)
    throw new WorkflowError(
      'EVALUATION_FAILED',
      `comparison verdict names candidates ${verdict.candidate_a_id}/${verdict.candidate_b_id}, expected ${expected.aId}/${expected.bId}`,
      { step: 'compare', recommendedActions: ['regenerate'] },
    );
  if (verdict.presentation_order !== expected.order)
    throw new WorkflowError(
      'EVALUATION_FAILED',
      `comparison verdict reports order ${verdict.presentation_order}, expected ${expected.order}`,
      { step: 'compare', recommendedActions: ['regenerate'] },
    );
}

/** Scorecards reach the judge as evidence, not as prose: gate-relevant numbers and counts only. */
function scorecardDigest(scorecard: Scorecard): Record<string, unknown> {
  const sections = scorecard.sections as Record<string, { score?: number } | undefined>;
  return {
    dimension_scores: Object.fromEntries(
      Object.entries(sections)
        .filter(([, s]) => s?.score !== undefined)
        .map(([name, s]) => [name, s?.score]),
    ),
    blocking_count: scorecard.overall.blocking_count,
    major_count: scorecard.overall.major_count,
    minor_count: scorecard.overall.minor_count,
    auto_approvable: scorecard.acceptance.auto_approvable,
  };
}

async function judgePair(
  ctx: WorkflowContext,
  input: {
    chapterNo: number;
    first: Candidate;
    second: Candidate;
    order: 'ab' | 'ba';
    contractShape: string;
    rubricOrder: readonly string[];
    activitySuffix: string;
  },
): Promise<{ verdict: ComparisonVerdict; artifactId: string }> {
  const call = await modelCall<ComparisonVerdict>(ctx, {
    step: 'compare',
    family: 'chapter_comparator',
    activityId: `compare:${input.chapterNo}:${input.activitySuffix}`,
    variables: {
      contract_shape: input.contractShape,
      presentation_order: input.order,
      rubric_order: input.rubricOrder.join(', '),
      candidate_a: input.first.text,
      candidate_b: input.second.text,
      scorecard_a: JSON.stringify(scorecardDigest(input.first.scorecard)),
      scorecard_b: JSON.stringify(scorecardDigest(input.second.scorecard)),
    },
  });
  const verdict: ComparisonVerdict = { ...call.output, judge_call_id: call.llmCallId };
  validateVerdict(verdict, { aId: input.first.id, bId: input.second.id, order: input.order });
  const ref = await saveArtifact(ctx, {
    step: 'compare',
    kind: 'comparison_verdict',
    key: `${input.chapterNo}:${input.activitySuffix}`,
    schema: 'comparison-verdict.schema.json',
    payload: verdict,
  });
  return { verdict, artifactId: ref.artifact_id };
}

/**
 * Compare two candidates in both presentation orders (ADR-0015). Disagreement between the orders is
 * position bias: it is recorded and resolved by a third run with a shuffled rubric order, never by
 * trusting whichever verdict came first.
 */
export async function compareCandidates(
  ctx: WorkflowContext,
  input: { chapterNo: number; contractShape: string; a: Candidate; b: Candidate },
): Promise<ComparisonOutcome> {
  const { a, b } = input;
  if (a.id === b.id || a.slot === b.slot)
    throw new WorkflowError(
      'INTERNAL',
      `compareCandidates needs two distinct candidates (slots ${a.slot}/${b.slot})`,
      { step: 'compare' },
    );
  const pair = `s${a.slot}s${b.slot}`;
  const rubric = [...CHAPTER_COMPARISON_DIMENSIONS];
  const ab = await judgePair(ctx, {
    chapterNo: input.chapterNo,
    first: a,
    second: b,
    order: 'ab',
    contractShape: input.contractShape,
    rubricOrder: rubric,
    activitySuffix: `${pair}:ab`,
  });
  const ba = await judgePair(ctx, {
    chapterNo: input.chapterNo,
    first: b,
    second: a,
    order: 'ba',
    contractShape: input.contractShape,
    rubricOrder: rubric,
    activitySuffix: `${pair}:ba`,
  });
  const firstPick = preferredId(ab.verdict);
  const secondPick = preferredId(ba.verdict);
  const verdicts = [ab.verdict, ba.verdict];
  const artifacts = [ab.artifactId, ba.artifactId];

  if (firstPick !== undefined && firstPick === secondPick)
    return {
      winnerId: firstPick,
      loserId: firstPick === a.id ? b.id : a.id,
      reason: 'consistent',
      positionBiasDetected: false,
      verdicts,
      verdictArtifactIds: artifacts,
    };

  // Both orders tied: nothing to resolve, straight to the deterministic ladder.
  if (firstPick === undefined && secondPick === undefined) {
    const tie = breakTie(ctx.policy, a, b);
    return {
      winnerId: tie.winnerId,
      loserId: tie.winnerId === a.id ? b.id : a.id,
      reason: tie.reason,
      positionBiasDetected: false,
      verdicts,
      verdictArtifactIds: artifacts,
    };
  }

  // Inconsistent: the orders disagree (or exactly one tied). Third run, shuffled rubric order.
  const third = await judgePair(ctx, {
    chapterNo: input.chapterNo,
    first: a,
    second: b,
    order: 'ab',
    contractShape: input.contractShape,
    rubricOrder: [...rubric].reverse(),
    activitySuffix: `${pair}:shuffled`,
  });
  verdicts.push(third.verdict);
  artifacts.push(third.artifactId);
  const decider = preferredId(third.verdict);
  if (decider !== undefined)
    return {
      winnerId: decider,
      loserId: decider === a.id ? b.id : a.id,
      reason: 'tiebreak_shuffled_rubric',
      positionBiasDetected: true,
      verdicts,
      verdictArtifactIds: artifacts,
    };
  const tie = breakTie(ctx.policy, a, b);
  return {
    winnerId: tie.winnerId,
    loserId: tie.winnerId === a.id ? b.id : a.id,
    reason: tie.reason,
    positionBiasDetected: true,
    verdicts,
    verdictArtifactIds: artifacts,
  };
}

export interface DimensionDelta {
  readonly dimension: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

export type RegressionFailure =
  | 'targeted_not_improved'
  | 'targeted_worsened'
  | 'gated_dimension_missing'
  | 'dimension_dropped'
  | 'protected_dimension_regressed'
  | 'new_blocking_or_major_issue'
  | 'protection_failed';

export type ProtectionName =
  | 'output_language'
  | 'contract'
  | 'continuity'
  | 'knowledge'
  | 'genre'
  | 'voice'
  | 'register'
  | 'prose'
  | 'structure'
  | 'westernization'
  | 'translation_like'
  | 'no_new_blocking_major';

export interface ProtectionOutcome {
  readonly protection: ProtectionName;
  /** False when neither scorecard carries the evidence this protection reads. */
  readonly applicable: boolean;
  readonly passed: boolean;
  readonly detail?: string | undefined;
  readonly issueKinds?: readonly string[] | undefined;
}

export interface TargetedOutcome {
  readonly scoreBefore?: number | undefined;
  readonly scoreAfter?: number | undefined;
  readonly delta?: number | undefined;
  readonly blockingMajorBefore: number;
  readonly blockingMajorAfter: number;
  /** Every targeted blocking/major issue is gone from the revised version. */
  readonly resolved: boolean;
  /** The targeted issues resolved, or the targeted dimension's score rose. */
  readonly materiallyImproved: boolean;
  readonly worsened: boolean;
  readonly resolvedIssueIds: readonly string[];
  readonly unresolvedIssueIds: readonly string[];
}

export interface RegressionReport {
  readonly targetedDimension: Issue['dimension'];
  readonly tolerancePoints: number;
  readonly deltas: readonly DimensionDelta[];
  /** Non-targeted gated dimensions that fell by more than the tolerance. */
  readonly regressions: readonly DimensionDelta[];
  /** Gated dimensions no scorecard carries — an unwired judge, never a silent pass. */
  readonly missingGatedDimensions: readonly string[];
  /** Dimensions the parent carried that the revision no longer carries. */
  readonly droppedDimensions: readonly string[];
  readonly targeted: TargetedOutcome;
  readonly protections: readonly ProtectionOutcome[];
  readonly newIssueKinds: readonly string[];
  readonly failures: readonly RegressionFailure[];
  /** Kept for callers that only need "did the target move"; never sufficient on its own. */
  readonly targetedImproved: boolean;
  readonly passed: boolean;
}

/**
 * Westernization / translation-like drift is protected by ISSUE KIND, not by a dimension score: a patch can
 * leave `prose` numerically flat while introducing a calque or an English-epic cadence. These kinds are in
 * the policy's `never`/`reviewer` override classes and must fail the regression closed.
 */
const WESTERNIZATION_KINDS: ReadonlySet<string> = new Set([
  'western_novel_drift',
  'literary_drift',
  'serial_drift',
]);
const TRANSLATION_KINDS: ReadonlySet<string> = new Set([
  'translation_like_english',
  'non_english_output',
]);
const REGISTER_KINDS: ReadonlySet<string> = new Set([
  'register_error',
  'address_term_error',
  'voice_drift',
]);

/** Sections whose `passed` flag is a fail-closed protection, mapped to the scorecard section that carries it. */
const PROTECTION_SECTIONS: readonly (readonly [ProtectionName, string])[] = [
  ['output_language', 'output_language'],
  ['contract', 'contract_compliance'],
  ['continuity', 'continuity'],
  ['knowledge', 'knowledge'],
  ['genre', 'genre'],
  ['voice', 'voice'],
  ['prose', 'prose'],
  ['structure', 'structure'],
];

function sectionPassed(scorecard: Scorecard, name: string): boolean | undefined {
  const sections = scorecard.sections as Record<string, { passed?: boolean } | undefined>;
  return sections[name]?.passed;
}

function openBlockingMajor(scorecard: Scorecard): readonly Issue[] {
  return scorecard.issues.filter(
    (i) => (i.severity === 'blocking' || i.severity === 'major') && i.status === 'open',
  );
}

function kindsMatching(scorecard: Scorecard, kinds: ReadonlySet<string>): readonly string[] {
  return [...new Set(openBlockingMajor(scorecard).map((i) => i.kind))].filter((k) => kinds.has(k));
}

/**
 * ADR-0014 regression check. A patch targeting one dimension must earn its approval: it must actually repair
 * what it targeted, must not pay for that repair with another dimension, and must not smuggle in new damage.
 *
 * `passed` is the conjunction of ALL of:
 *   - the targeted issues resolved or the targeted dimension's score materially improved;
 *   - the targeted dimension did not worsen;
 *   - every dimension the pinned policy gates is present in BOTH scorecards — required evidence, so an
 *     unwired judge fails the check rather than passing silently;
 *   - no dimension the parent scorecard carried disappeared (a patch may not delete its own evidence);
 *   - no protected (non-targeted) gated dimension fell by more than the pinned tolerance;
 *   - no new blocking/major issue kind appeared;
 *   - every applicable protection still passes — output language, contract, continuity, knowledge, genre,
 *     voice, register, prose and structure, plus the westernization and translation-like kind guards.
 *
 * Numbers come only from the pinned Production Policy (ADR-0041); an absent tolerance means zero, never
 * unlimited. `missingGatedDimensions` records which gate was unavailable, in sorted order, for the audit
 * trail — it is both reported and fatal.
 */
export function patchRegression(
  policy: ProductionPolicy,
  input: {
    before: Scorecard;
    after: Scorecard;
    dimension: Issue['dimension'];
    /** The blocking/major issues the patch was asked to repair. Defaults to the parent's issues on the dimension. */
    targetedIssueIds?: readonly string[] | undefined;
  },
): RegressionReport {
  const tolerance = policy.revision.regression_tolerance_points ?? 0;
  const deltas: DimensionDelta[] = [];
  const missing: string[] = [];
  const dropped: string[] = [];
  for (const dimension of gatedDimensions(policy)) {
    const before = sectionScore(input.before, dimension);
    const after = sectionScore(input.after, dimension);
    if (before === undefined && after === undefined) {
      missing.push(dimension);
      continue;
    }
    // The parent scored it and the revision does not: the patch removed the evidence it is judged on.
    if (before !== undefined && after === undefined) {
      dropped.push(dimension);
      continue;
    }
    if (before === undefined || after === undefined) continue;
    deltas.push({ dimension, before, after, delta: after - before });
  }
  const regressions = deltas.filter((d) => d.dimension !== input.dimension && d.delta < -tolerance);
  const targetedDelta = deltas.find((d) => d.dimension === input.dimension);

  const beforeOpen = openBlockingMajor(input.before);
  const afterOpen = openBlockingMajor(input.after);
  const targetedIds =
    input.targetedIssueIds ??
    beforeOpen.filter((i) => i.dimension === input.dimension).map((i) => i.id);
  const targetedIdSet = new Set(targetedIds);
  const targetedIssues = beforeOpen.filter((i) => targetedIdSet.has(i.id));
  // Issue ids are derived per manuscript version (`workflow|version|source|index`), so the SAME unrepaired
  // finding comes back from the judge under a NEW id. Resolution is therefore decided on the issue's
  // signature — dimension + kind — never on the id, which would read every patch as having resolved
  // everything it targeted.
  const signature = (i: Issue) => `${i.dimension}|${i.kind}`;
  const afterSignatures = new Set(afterOpen.map(signature));
  const resolvedIssueIds = targetedIssues
    .filter((i) => !afterSignatures.has(signature(i)))
    .map((i) => i.id);
  const unresolvedIssueIds = targetedIssues
    .filter((i) => afterSignatures.has(signature(i)))
    .map((i) => i.id);
  const targetedBlockingBefore = beforeOpen.filter((i) => i.dimension === input.dimension).length;
  const targetedBlockingAfter = afterOpen.filter((i) => i.dimension === input.dimension).length;
  const allTargetedResolved = targetedIssues.length > 0 && unresolvedIssueIds.length === 0;
  const scoreRose = (targetedDelta?.delta ?? 0) > 0;
  const worsened = (targetedDelta?.delta ?? 0) < 0;
  // "Materially improved" = the targeted issues are gone, or the score rose and no targeted issue remains
  // that the patch was asked to repair. A flat score with unresolved targeted issues is NOT an improvement.
  const materiallyImproved =
    allTargetedResolved ||
    (scoreRose && targetedBlockingAfter < Math.max(targetedBlockingBefore, 1));

  const beforeKinds = new Set(beforeOpen.map((i) => i.kind));
  const newIssueKinds = [...new Set(afterOpen.map((i) => i.kind))]
    .filter((k) => !beforeKinds.has(k))
    .sort();

  const protections: ProtectionOutcome[] = [];
  const missingGated = new Set(missing);
  for (const [protection, section] of PROTECTION_SECTIONS) {
    const beforePassed = sectionPassed(input.before, section);
    const afterPassed = sectionPassed(input.after, section);
    if (afterPassed === undefined) {
      // A dimension the POLICY GATES is required evidence: absent on both scorecards it fails closed as
      // an applicable protection, never as `applicable: false, passed: true` — an unavailable required
      // gate must not read as a pass. Absent only on the revision is the `dimension_dropped` case.
      const gated = missingGated.has(protection) || dropped.includes(protection);
      protections.push({
        protection,
        applicable: beforePassed !== undefined || gated,
        passed: beforePassed === undefined && !gated,
        detail:
          beforePassed !== undefined
            ? `the revised scorecard dropped the ${section} section the parent carried`
            : gated
              ? `policy gates ${section} but neither scorecard carries it`
              : `no ${section} section on either scorecard`,
      });
      continue;
    }
    protections.push({ protection, applicable: true, passed: afterPassed });
  }
  const westernization = kindsMatching(input.after, WESTERNIZATION_KINDS);
  protections.push({
    protection: 'westernization',
    applicable: true,
    passed: westernization.length === 0,
    ...(westernization.length ? { issueKinds: westernization } : {}),
  });
  const translationLike = kindsMatching(input.after, TRANSLATION_KINDS);
  protections.push({
    protection: 'translation_like',
    applicable: true,
    passed: translationLike.length === 0,
    ...(translationLike.length ? { issueKinds: translationLike } : {}),
  });
  const registerKinds = kindsMatching(input.after, REGISTER_KINDS);
  protections.push({
    protection: 'register',
    applicable: true,
    passed: registerKinds.length === 0,
    ...(registerKinds.length ? { issueKinds: registerKinds } : {}),
  });
  protections.push({
    protection: 'no_new_blocking_major',
    applicable: true,
    passed: newIssueKinds.length === 0,
    ...(newIssueKinds.length ? { issueKinds: newIssueKinds } : {}),
  });

  const failures: RegressionFailure[] = [];
  if (!materiallyImproved) failures.push('targeted_not_improved');
  if (worsened) failures.push('targeted_worsened');
  // Required policy-gated evidence that no scorecard carries fails the report rather than only being
  // recorded: a gate whose judge is unwired must never let a patch through (ADR-0041).
  if (missing.length > 0) failures.push('gated_dimension_missing');
  if (dropped.length > 0) failures.push('dimension_dropped');
  if (regressions.length > 0) failures.push('protected_dimension_regressed');
  if (newIssueKinds.length > 0) failures.push('new_blocking_or_major_issue');
  if (protections.some((p) => p.applicable && !p.passed)) failures.push('protection_failed');

  return {
    targetedDimension: input.dimension,
    tolerancePoints: tolerance,
    deltas,
    regressions,
    missingGatedDimensions: missing,
    droppedDimensions: dropped,
    targeted: {
      scoreBefore: targetedDelta?.before,
      scoreAfter: targetedDelta?.after,
      delta: targetedDelta?.delta,
      blockingMajorBefore: targetedBlockingBefore,
      blockingMajorAfter: targetedBlockingAfter,
      resolved: allTargetedResolved,
      materiallyImproved,
      worsened,
      resolvedIssueIds,
      unresolvedIssueIds,
    },
    protections,
    newIssueKinds,
    failures,
    targetedImproved: scoreRose,
    passed: failures.length === 0,
  };
}

export type RegressionReportArtifact = Generated.RegressionReportSchema.PatchRegressionReport;

/** Stable v8 UUID for a regression report, so a replayed revision persists the same artifact id. */
export function regressionReportId(workflowId: string, versionId: string, round: number): string {
  const hex = createHash('sha256')
    .update(`${workflowId}|regression|${versionId}|${round}`)
    .digest('hex')
    .slice(0, 32);
  const b = Buffer.from(hex, 'hex');
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x80;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Serialize a report to its schema shape for persistence. Kept separate from `patchRegression` so the
 * predicate stays a pure function of policy + scorecards and the stored artifact stays a validated contract.
 */
export function regressionArtifact(
  report: RegressionReport,
  input: {
    id: string;
    manuscriptVersionId: string;
    parentVersionId: string;
    patchId?: string | undefined;
    round: number;
    productionPolicyVersion: string;
  },
): RegressionReportArtifact {
  type Dim = RegressionReportArtifact['targeted_dimension'];
  return {
    id: input.id,
    manuscript_version_id: input.manuscriptVersionId,
    parent_version_id: input.parentVersionId,
    ...(input.patchId ? { patch_id: input.patchId } : {}),
    targeted_dimension: report.targetedDimension,
    round: input.round,
    tolerance_points: report.tolerancePoints,
    production_policy_version: input.productionPolicyVersion,
    deltas: report.deltas.map((d) => ({
      dimension: d.dimension as Dim,
      before: d.before,
      after: d.after,
      delta: d.delta,
    })),
    regressions: report.regressions.map((d) => ({
      dimension: d.dimension as Dim,
      before: d.before,
      after: d.after,
      delta: d.delta,
    })),
    missing_gated_dimensions: report.missingGatedDimensions.map((d) => d as Dim),
    dropped_dimensions: report.droppedDimensions.map((d) => d as Dim),
    targeted: {
      ...(report.targeted.scoreBefore !== undefined
        ? { score_before: report.targeted.scoreBefore }
        : {}),
      ...(report.targeted.scoreAfter !== undefined
        ? { score_after: report.targeted.scoreAfter }
        : {}),
      ...(report.targeted.delta !== undefined ? { delta: report.targeted.delta } : {}),
      blocking_major_before: report.targeted.blockingMajorBefore,
      blocking_major_after: report.targeted.blockingMajorAfter,
      resolved: report.targeted.resolved,
      materially_improved: report.targeted.materiallyImproved,
      worsened: report.targeted.worsened,
      resolved_issue_ids: [...report.targeted.resolvedIssueIds],
      unresolved_issue_ids: [...report.targeted.unresolvedIssueIds],
    },
    protections: report.protections.map((p) => ({
      protection: p.protection,
      applicable: p.applicable,
      passed: p.passed,
      ...(p.detail ? { detail: p.detail } : {}),
      ...(p.issueKinds ? { issue_kinds: [...p.issueKinds] } : {}),
    })),
    new_issue_kinds: [...report.newIssueKinds],
    failures: [...report.failures],
    passed: report.passed,
  };
}

/** ADR-0014: run a smoke re-check once this many patches have been applied in a round. */
export function smokeCheckDue(policy: ProductionPolicy, patchesApplied: number): boolean {
  const every = policy.revision.smoke_after_patches;
  return every > 0 && patchesApplied > 0 && patchesApplied % every === 0;
}
