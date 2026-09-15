/**
 * B-6-4 unit proofs for the deterministic half of candidate comparison and patch regression: the pinned
 * policy supplies every number (ADR-0041), the tie ladder of ADR-0015 is total and order-independent, and
 * the ADR-0014 regression rule only passes a patch that actually repaired what it targeted without paying
 * for it elsewhere.
 */
import { describe, expect, it } from 'vitest';
import { requirePolicy } from '@yeonjae/domain';
import { validatorFor } from '@yeonjae/domain';
import {
  breakTie,
  earlyStop,
  earlyStopDecision,
  patchRegression,
  regressionArtifact,
  regressionReportId,
  smokeCheckDue,
  type Candidate,
  type ProductionPolicy,
} from './index.js';
import { type Scorecard } from './evaluation.js';

const POLICY = requirePolicy('policy/standard@1');

function scorecard(input: {
  prose: number;
  structure: number;
  autoApprovable?: boolean;
  blocking?: number;
  major?: number;
}): Scorecard {
  const dims: [string, number][] = [
    ['prose', input.prose],
    ['structure', input.structure],
  ];
  const card: Scorecard = {
    id: '0191b2a0-0000-7000-8000-00000000a001',
    manuscript_version_id: '0191b2a0-0000-7000-8000-00000000b001',
    canon_version: 3,
    overall: {
      score: (input.prose + input.structure) / 2,
      blocking_count: input.blocking ?? 0,
      major_count: input.major ?? 0,
      minor_count: 0,
    },
    sections: {
      prose: { score: input.prose, passed: input.prose >= 78 },
      structure: { score: input.structure, passed: input.structure >= 78 },
      // Required by the schema and never gated by the policy: it must stay out of the ladder and the
      // regression list, which is exactly what the "ignores ungated dimensions" case below proves.
      output_language: { score: 100, passed: true },
    },
    issues: [],
    acceptance: {
      criteria_results: [],
      dimension_results: dims.map(([dimension, score]) => ({
        dimension: dimension as 'prose',
        score,
        threshold: 78,
        passed: score >= 78,
      })),
      auto_approvable: input.autoApprovable ?? true,
      production_policy_version: 'policy/standard@1',
      gate_outcome: 'approved',
    },
  };
  // The fixtures below are asserted against the real schema so a drifting scorecard shape fails here too.
  const v = validatorFor<Scorecard>('scorecard.schema.json')(card);
  if (!v.ok) throw new Error(`test scorecard invalid: ${JSON.stringify(v.errors)}`);
  return v.value;
}

function candidate(
  slot: number,
  input: { prose: number; structure: number; patchCount?: number; autoApprovable?: boolean },
): Candidate {
  return {
    slot,
    id: `0191b2a0-0000-7000-8000-0000000c100${slot}`,
    text: `candidate ${slot}`,
    scorecard: scorecard(input),
    patchCount: input.patchCount ?? 0,
  };
}

describe('candidate comparison determinism (ADR-0015)', () => {
  it('early stop needs every gated dimension of the pinned policy, and standard.v1 gates two the evaluator does not produce', () => {
    const margin = POLICY.candidates.early_stop_margin_points;
    const proseGate = POLICY.gates.dimensions.prose.min_score;
    const structureGate = POLICY.gates.dimensions.structure.min_score;
    expect(margin).toBeGreaterThan(0);

    // Real policy/runtime mismatch, asserted rather than hidden: standard.v1 gates genre and voice, which
    // the Checkpoint 5 evaluator never scores. A missing judge must never read as a silent pass, so early
    // stop refuses and names the gap instead of stopping generation on partial evidence.
    const high = candidate(1, { prose: proseGate + margin, structure: structureGate + margin });
    const decision = earlyStopDecision(POLICY, high);
    expect(decision.stop).toBe(false);
    expect(decision.reason).toBe('dimensions_short');
    expect(decision.missingDimensions).toEqual(['genre', 'voice']);
    expect(decision.shortDimensions).toEqual([]);
    expect(earlyStop(POLICY, high)).toBe(false);

    // With a policy that gates only the dimensions the evaluator produces, the same candidate clears.
    const wiredOnly = {
      ...POLICY,
      gates: {
        ...POLICY.gates,
        dimensions: {
          prose: POLICY.gates.dimensions.prose,
          structure: POLICY.gates.dimensions.structure,
        },
      },
    } as ProductionPolicy;
    expect(earlyStopDecision(wiredOnly, high)).toMatchObject({ stop: true, reason: 'cleared' });

    // Exactly one point short on one dimension is not an early stop: gates are per dimension, never averaged.
    const oneShort = candidate(1, {
      prose: proseGate + margin - 1,
      structure: 100,
    });
    expect(earlyStopDecision(wiredOnly, oneShort)).toMatchObject({
      stop: false,
      reason: 'dimensions_short',
      shortDimensions: ['prose'],
    });

    // A major issue defeats early stop even with high scores.
    expect(
      earlyStopDecision(wiredOnly, {
        ...high,
        scorecard: scorecard({
          prose: proseGate + margin,
          structure: structureGate + margin,
          major: 1,
          autoApprovable: false,
        }),
      }),
    ).toMatchObject({ stop: false, reason: 'not_auto_approvable' });
  });

  it('a gated dimension absent from the scorecard is reported, never treated as cleared', () => {
    const partial = candidate(1, { prose: 100, structure: 100 });
    const stripped: Candidate = {
      ...partial,
      scorecard: {
        ...partial.scorecard,
        sections: {
          prose: { score: 100, passed: true },
          output_language: { score: 100, passed: true },
        },
      } as Scorecard,
    };
    expect(earlyStop(POLICY, stripped)).toBe(false);
  });

  it('the tie ladder is scorecard sum, then fewer patches, then the lower slot — and is symmetric', () => {
    const strong = candidate(1, { prose: 90, structure: 90 });
    const weak = candidate(2, { prose: 80, structure: 80 });
    expect(breakTie(POLICY, strong, weak)).toEqual({
      winnerId: strong.id,
      reason: 'tiebreak_scorecard',
    });
    // Swapping the arguments must not change the winner: the ladder cannot depend on call order.
    expect(breakTie(POLICY, weak, strong).winnerId).toBe(strong.id);

    const sameScoreFewPatches = candidate(1, { prose: 85, structure: 85, patchCount: 1 });
    const sameScoreManyPatches = candidate(2, { prose: 85, structure: 85, patchCount: 3 });
    expect(breakTie(POLICY, sameScoreManyPatches, sameScoreFewPatches)).toEqual({
      winnerId: sameScoreFewPatches.id,
      reason: 'tiebreak_patch_count',
    });

    const identicalA = candidate(1, { prose: 85, structure: 85, patchCount: 2 });
    const identicalB = candidate(2, { prose: 85, structure: 85, patchCount: 2 });
    expect(breakTie(POLICY, identicalB, identicalA)).toEqual({
      winnerId: identicalA.id,
      reason: 'tiebreak_candidate_slot',
    });
  });

  it('the scorecard tie-break sums gated dimensions and ignores overall.score', () => {
    // Same gated dimensions, deliberately contradictory informational aggregate: overall.score is never
    // a gate input (ADR-0041), so the pair must fall through to the next rung.
    const a = candidate(1, { prose: 85, structure: 85, patchCount: 1 });
    const b: Candidate = {
      ...candidate(2, { prose: 85, structure: 85, patchCount: 2 }),
      scorecard: {
        ...scorecard({ prose: 85, structure: 85 }),
        overall: { score: 100, blocking_count: 0, major_count: 0, minor_count: 0 },
      },
    };
    expect(breakTie(POLICY, a, b)).toEqual({ winnerId: a.id, reason: 'tiebreak_patch_count' });
  });
});

describe('patch regression (ADR-0014)', () => {
  const tolerance = POLICY.revision.regression_tolerance_points ?? 0;

  /**
   * A scorecard with explicit issues and per-section pass flags, so the regression rule can be exercised on
   * the evidence it actually reads: issue resolution, protected sections and new issue kinds — not scores alone.
   */
  function card(input: {
    prose: number;
    structure: number;
    /** Omit to supply passing genre/voice evidence; set explicitly to exercise a gate. */
    genre?: number | null;
    voice?: number | null;
    issues?: {
      id: string;
      dimension: Scorecard['issues'][number]['dimension'];
      kind: Scorecard['issues'][number]['kind'];
      severity?: 'blocking' | 'major' | 'minor';
    }[];
    sections?: Record<string, { score: number; passed: boolean }>;
  }): Scorecard {
    const genre = input.genre === undefined ? 85 : input.genre;
    const voice = input.voice === undefined ? 85 : input.voice;
    const base: Record<string, { score: number; passed: boolean }> = {
      prose: { score: input.prose, passed: input.prose >= 78 },
      structure: { score: input.structure, passed: input.structure >= 78 },
      output_language: { score: 100, passed: true },
      contract_compliance: { score: 100, passed: true },
      continuity: { score: 100, passed: true },
      knowledge: { score: 100, passed: true },
      // standard.v1 gates genre and voice, so complete evidence includes them. `null` drops the section,
      // which is how the "required gate unavailable" cases below are built.
      ...(genre === null ? {} : { genre: { score: genre, passed: genre >= 72 } }),
      ...(voice === null ? {} : { voice: { score: voice, passed: voice >= 76 } }),
      ...(input.sections ?? {}),
    };
    const issues = (input.issues ?? []).map((i) => ({
      id: i.id,
      source: 'prose_judge',
      dimension: i.dimension,
      kind: i.kind,
      severity: i.severity ?? ('major' as const),
      override_class: 'reviewer' as const,
      confidence: 0.9,
      claim: `${i.kind} on ${i.dimension}`,
      status: 'open' as const,
    }));
    const blocking = issues.filter((i) => i.severity === 'blocking').length;
    const major = issues.filter((i) => i.severity === 'major').length;
    const candidateCard = {
      id: '0191b2a0-0000-7000-8000-00000000a001',
      manuscript_version_id: '0191b2a0-0000-7000-8000-00000000b001',
      canon_version: 3,
      overall: {
        score: (input.prose + input.structure) / 2,
        blocking_count: blocking,
        major_count: major,
        minor_count: 0,
      },
      sections: base,
      issues,
      acceptance: {
        criteria_results: [],
        dimension_results: [],
        auto_approvable: blocking === 0 && major === 0,
        production_policy_version: 'policy/standard@1',
        gate_outcome: blocking === 0 && major === 0 ? 'approved' : 'rejected',
      },
    };
    const v = validatorFor<Scorecard>('scorecard.schema.json')(candidateCard);
    if (!v.ok) throw new Error(`test scorecard invalid: ${JSON.stringify(v.errors)}`);
    return v.value;
  }

  const ISSUE_A = '0191b2a0-0000-7000-8000-00000000e001';
  const ISSUE_B = '0191b2a0-0000-7000-8000-00000000e002';

  it('passes only when the targeted issue resolves, the target holds and nothing else regresses', () => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 88,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({ prose: 84, structure: 88 - tolerance }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.targeted.resolved).toBe(true);
    expect(report.targeted.materiallyImproved).toBe(true);
    expect(report.targeted.resolvedIssueIds).toEqual([ISSUE_A]);
    expect(report.regressions).toEqual([]);
    expect(report.tolerancePoints).toBe(tolerance);
  });

  it('THE DEFECT: a patch whose targeted dimension did not improve can no longer pass', () => {
    // Before this fix `passed` was `regressions.length === 0`, so a patch that dropped its own targeted
    // dimension 30 points while leaving every other dimension untouched reported passed: true.
    const report = patchRegression(POLICY, {
      before: card({
        prose: 90,
        structure: 85,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({
        prose: 60,
        structure: 85,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.regressions).toEqual([]);
    expect(report.passed).toBe(false);
    expect(report.failures).toContain('targeted_not_improved');
    expect(report.failures).toContain('targeted_worsened');
    expect(report.targeted.resolved).toBe(false);
    expect(report.targeted.unresolvedIssueIds).toEqual([ISSUE_A]);
    expect(report.deltas.find((d) => d.dimension === 'prose')?.delta).toBe(-30);
  });

  it('a flat targeted dimension with the targeted issue still open does not pass', () => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 88,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({
        prose: 70,
        structure: 88,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.passed).toBe(false);
    expect(report.failures).toContain('targeted_not_improved');
    // The calque the patch was asked to remove is still present, so the translation-like guard also fails.
    expect(report.failures).toContain('protection_failed');
    expect(report.targeted.worsened).toBe(false);
  });

  it('fails when repairing prose costs structure more than the pinned tolerance', () => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 88,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({ prose: 90, structure: 88 - tolerance - 1 }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.passed).toBe(false);
    expect(report.failures).toContain('protected_dimension_regressed');
    expect(report.regressions.map((r) => r.dimension)).toEqual(['structure']);
    expect(report.regressions[0]?.delta).toBe(-(tolerance + 1));
  });

  it('a policy without a tolerance treats any drop as a regression rather than unlimited', () => {
    const noTolerance = {
      ...POLICY,
      revision: { ...POLICY.revision, regression_tolerance_points: undefined },
    } as ProductionPolicy;
    const report = patchRegression(noTolerance, {
      before: card({
        prose: 70,
        structure: 88,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({ prose: 84, structure: 87 }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.tolerancePoints).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.regressions.map((r) => r.dimension)).toEqual(['structure']);
  });

  it('a gated dimension absent from BOTH scorecards fails the report, it is not merely recorded', () => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 80,
        genre: null,
        voice: null,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({ prose: 85, structure: 80, genre: null, voice: null }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    // Only the dimensions actually carried are scored...
    expect(report.deltas.map((d) => d.dimension)).toEqual(['prose', 'structure']);
    // ...and the two gates standard.v1 requires but nothing supplied are both reported AND fatal.
    expect(report.missingGatedDimensions).toEqual(['genre', 'voice']);
    expect(report.failures).toContain('gated_dimension_missing');
    expect(report.passed).toBe(false);
    // An unavailable required gate must never present as "inapplicable, therefore fine".
    for (const name of ['genre', 'voice'] as const) {
      expect(report.protections.find((p) => p.protection === name)).toMatchObject({
        applicable: true,
        passed: false,
      });
    }
    expect(report.failures).toContain('protection_failed');
  });

  it.each(['genre', 'voice'] as const)('a missing %s gate alone fails the report', (dimension) => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 80,
        [dimension]: null,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({ prose: 85, structure: 80, [dimension]: null }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.missingGatedDimensions).toEqual([dimension]);
    expect(report.failures).toContain('gated_dimension_missing');
    expect(report.passed).toBe(false);
    expect(report.protections.find((p) => p.protection === dimension)).toMatchObject({
      applicable: true,
      passed: false,
    });
    // The other gate was supplied, so it is not implicated.
    const other = dimension === 'genre' ? 'voice' : 'genre';
    expect(report.protections.find((p) => p.protection === other)).toMatchObject({
      applicable: true,
      passed: true,
    });
  });

  it('multiple missing gates are reported deterministically, in sorted order', () => {
    const build = () =>
      patchRegression(POLICY, {
        before: card({
          prose: 70,
          structure: 80,
          genre: null,
          voice: null,
          issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
        }),
        after: card({ prose: 85, structure: 80, genre: null, voice: null }),
        dimension: 'prose',
        targetedIssueIds: [ISSUE_A],
      });
    const a = build();
    const b = build();
    expect(a.missingGatedDimensions).toEqual(['genre', 'voice']);
    expect(b.missingGatedDimensions).toEqual(a.missingGatedDimensions);
    // The failure list itself is stable, so a persisted artifact is byte-identical across runs.
    expect(b.failures).toEqual(a.failures);
  });

  it('complete required evidence can still pass: the rule tightens the gate, it does not close it', () => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 80,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({ prose: 85, structure: 80 }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.missingGatedDimensions).toEqual([]);
    expect(report.deltas.map((d) => d.dimension)).toEqual(['genre', 'prose', 'structure', 'voice']);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('a dropped dimension stays distinguishable from one missing in both versions', () => {
    // genre present before and gone after = dropped. voice absent throughout = missing.
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 80,
        voice: null,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({ prose: 85, structure: 80, genre: null, voice: null }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.droppedDimensions).toEqual(['genre']);
    expect(report.missingGatedDimensions).toEqual(['voice']);
    // Two distinct reasons, both fatal, neither collapsed into the other.
    expect(report.failures).toContain('dimension_dropped');
    expect(report.failures).toContain('gated_dimension_missing');
    expect(report.passed).toBe(false);
    expect(report.protections.find((p) => p.protection === 'genre')?.detail).toMatch(/dropped/);
    expect(report.protections.find((p) => p.protection === 'voice')?.detail).toMatch(
      /policy gates voice/,
    );
  });

  it('a report failed only by a missing gate is schema-valid when persisted', () => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 80,
        genre: null,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({ prose: 85, structure: 80, genre: null }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    const artifact = regressionArtifact(report, {
      id: regressionReportId('wf-1', '0191b2a0-0000-7000-8000-00000000b002', 1),
      manuscriptVersionId: '0191b2a0-0000-7000-8000-00000000b002',
      parentVersionId: '0191b2a0-0000-7000-8000-00000000b001',
      round: 1,
      productionPolicyVersion: 'policy/standard@1',
    });
    const v = validatorFor('regression-report.schema.json')(artifact);
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : [])).toBe(true);
    expect(artifact.passed).toBe(false);
    expect(artifact.failures).toContain('gated_dimension_missing');
    // Retained for auditability: which gate was unavailable is recoverable from the stored artifact.
    expect(artifact.missing_gated_dimensions).toEqual(['genre']);
  });

  it('a patch may not pass by deleting the dimension evidence it is judged on', () => {
    // `genre` is gated by standard.v1 and is not schema-required, so it can be present on the parent and
    // absent on the revision — exactly the "patch deleted its own evidence" shape.
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 88,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({ prose: 90, structure: 88, genre: null }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.droppedDimensions).toEqual(['genre']);
    expect(report.missingGatedDimensions).toEqual([]);
    expect(report.passed).toBe(false);
    expect(report.failures).toContain('dimension_dropped');
    expect(report.failures).not.toContain('gated_dimension_missing');
    expect(report.failures).toContain('protection_failed');
    expect(report.protections.find((p) => p.protection === 'genre')).toMatchObject({
      applicable: true,
      passed: false,
    });
  });

  it('a new blocking or major issue kind fails the patch even when every score improved', () => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 80,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({
        prose: 95,
        structure: 95,
        issues: [{ id: ISSUE_B, dimension: 'continuity', kind: 'canon_contradiction' }],
      }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.newIssueKinds).toEqual(['canon_contradiction']);
    expect(report.passed).toBe(false);
    expect(report.failures).toContain('new_blocking_or_major_issue');
  });

  it.each([
    ['western_novel_drift', 'westernization'],
    ['literary_drift', 'westernization'],
    ['serial_drift', 'westernization'],
    ['translation_like_english', 'translation_like'],
    ['non_english_output', 'translation_like'],
    ['register_error', 'register'],
    ['voice_drift', 'register'],
    ['address_term_error', 'register'],
  ] as const)('%s fails the %s protection closed', (kind, protection) => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 80,
        issues: [{ id: ISSUE_A, dimension: 'structure', kind: 'weak_pacing' }],
      }),
      after: card({
        prose: 95,
        structure: 95,
        issues: [{ id: ISSUE_B, dimension: 'prose', kind }],
      }),
      dimension: 'structure',
      targetedIssueIds: [ISSUE_A],
    });
    expect(report.protections.find((p) => p.protection === protection)).toMatchObject({
      applicable: true,
      passed: false,
    });
    expect(report.passed).toBe(false);
    expect(report.failures).toContain('protection_failed');
  });

  it.each(['output_language', 'contract_compliance', 'continuity', 'knowledge'] as const)(
    'a failing %s section fails the regression closed',
    (section) => {
      const report = patchRegression(POLICY, {
        before: card({
          prose: 70,
          structure: 80,
          issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
        }),
        after: card({
          prose: 90,
          structure: 80,
          sections: { [section]: { score: 0, passed: false } },
        }),
        dimension: 'prose',
        targetedIssueIds: [ISSUE_A],
      });
      expect(report.passed).toBe(false);
      expect(report.failures).toContain('protection_failed');
      expect(report.protections.filter((p) => p.applicable && !p.passed).length).toBeGreaterThan(0);
    },
  );

  it('the persisted artifact validates against its schema and is deterministic per version+round', () => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 70,
        structure: 88,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({ prose: 84, structure: 88 }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    const versionId = '0191b2a0-0000-7000-8000-00000000b002';
    const id = regressionReportId('wf-1', versionId, 1);
    expect(regressionReportId('wf-1', versionId, 1)).toBe(id);
    expect(regressionReportId('wf-1', versionId, 2)).not.toBe(id);
    const artifact = regressionArtifact(report, {
      id,
      manuscriptVersionId: versionId,
      parentVersionId: '0191b2a0-0000-7000-8000-00000000b001',
      round: 1,
      productionPolicyVersion: 'policy/standard@1',
    });
    const v = validatorFor('regression-report.schema.json')(artifact);
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : [])).toBe(true);
    expect(artifact.passed).toBe(true);
    expect(artifact.failures).toEqual([]);
    expect(artifact.targeted.resolved).toBe(true);
    // The artifact is a pure projection of the report: serializing twice yields identical bytes.
    expect(
      JSON.stringify(
        regressionArtifact(report, {
          id,
          manuscriptVersionId: versionId,
          parentVersionId: '0191b2a0-0000-7000-8000-00000000b001',
          round: 1,
          productionPolicyVersion: 'policy/standard@1',
        }),
      ),
    ).toBe(JSON.stringify(artifact));
  });

  it('a failed report serializes its failures and failed protections for the audit trail', () => {
    const report = patchRegression(POLICY, {
      before: card({
        prose: 90,
        structure: 85,
        issues: [{ id: ISSUE_A, dimension: 'prose', kind: 'translation_like_english' }],
      }),
      after: card({
        prose: 60,
        structure: 85,
        issues: [{ id: ISSUE_B, dimension: 'prose', kind: 'western_novel_drift' }],
      }),
      dimension: 'prose',
      targetedIssueIds: [ISSUE_A],
    });
    const artifact = regressionArtifact(report, {
      id: regressionReportId('wf-1', '0191b2a0-0000-7000-8000-00000000b002', 1),
      manuscriptVersionId: '0191b2a0-0000-7000-8000-00000000b002',
      parentVersionId: '0191b2a0-0000-7000-8000-00000000b001',
      round: 1,
      productionPolicyVersion: 'policy/standard@1',
    });
    const v = validatorFor('regression-report.schema.json')(artifact);
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : [])).toBe(true);
    expect(artifact.passed).toBe(false);
    // The targeted issue id is gone, so "resolved" holds — but the dimension's score fell 30 points, and a
    // patch that pays for its own repair with its own dimension must still fail.
    expect(artifact.failures).toContain('targeted_worsened');
    expect(artifact.failures).toContain('protection_failed');
    expect(artifact.new_issue_kinds).toEqual(['western_novel_drift']);
  });

  it('smoke checks fall due on every Nth patch from the pinned policy', () => {
    const every = POLICY.revision.smoke_after_patches;
    expect(every).toBeGreaterThan(0);
    expect(smokeCheckDue(POLICY, 0)).toBe(false);
    expect(smokeCheckDue(POLICY, every)).toBe(true);
    expect(smokeCheckDue(POLICY, every * 2)).toBe(true);
    expect(smokeCheckDue(POLICY, every + 1)).toBe(false);
  });
});
