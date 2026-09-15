/**
 * Checks and evaluation for the vertical slice (the minimum set; the full EP, ST and RG lint catalogs are
 * Checkpoint 6). Deterministic checks run first (schema validity was enforced at draft time; here: English
 * output language, word length, truncation, contract shape). Model evaluators run through the gateway with
 * replayed responses: contract compliance, continuity, knowledge leakage, and — as two separate dimensions
 * with separate gates (EVAL-SEPARATION-001) — English prose quality and Korean-webnovel structure.
 *
 * The scorecard is the single gate input: approval requires blocking_count ≤ policy.gates.blocking_max,
 * major_count ≤ major_max, every deterministic criterion passed and every gated dimension at or above its
 * pinned threshold. Numbers come from the pinned Production Policy only.
 */
import { createHash } from 'node:crypto';
import { type ManuscriptVersionRow } from '@yeonjae/db';
import { type Generated, loadSchemas, overrideClassFor, validatorFor } from '@yeonjae/domain';
import {
  checkOutputLanguage,
  judgeLength,
  measure,
  segmentParagraphs,
  toNfcText,
} from '@yeonjae/prose';
import { WorkflowError } from './errors.js';
import { checkpointPack, packCallInput } from './drafting.js';
import { type ChapterContract, type StorySpec, compileFor } from './planning.js';
import { modelCall, runStep, saveArtifact, type WorkflowContext } from './runtime.js';

export type Scorecard = Generated.ScorecardSchema.Scorecard;
export type Issue = Generated.IssueSchema.Issue;
type Severity = Issue['severity'];

interface RawIssue {
  kind?: string;
  severity?: string;
  confidence?: number;
  claim?: string;
  chapter_span?: Issue['chapter_span'];
  repair?: Issue['repair'];
  conflicting_canon?: Issue['conflicting_canon'];
  canon_evidence?: Issue['canon_evidence'];
  metric?: Issue['metric'];
}

const ISSUE_KINDS: ReadonlySet<string> = new Set(
  (
    loadSchemas().schemas.get('issue.schema.json')?.schema as
      { properties?: { kind?: { enum?: string[] } } } | undefined
  )?.properties?.kind?.enum ?? [],
);

function issueIdFor(
  ctx: WorkflowContext,
  versionId: string,
  source: string,
  index: number,
): string {
  // Stable issue ids: sha256(workflow, version, source, index) → v8 UUID, so a replayed evaluation yields the same ids.
  const hex = createHash('sha256')
    .update(`${ctx.workflowId}|${versionId}|${source}|${index}`)
    .digest('hex')
    .slice(0, 32);
  const b = Buffer.from(hex, 'hex');
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x80;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function toIssue(
  ctx: WorkflowContext,
  versionId: string,
  source: string,
  dimension: Issue['dimension'],
  raw: RawIssue,
  index: number,
): Issue {
  const kind = raw.kind && isIssueKind(raw.kind) ? raw.kind : 'other';
  const severity = (['blocking', 'major', 'minor', 'note'] as const).includes(
    raw.severity as Severity,
  )
    ? (raw.severity as Severity)
    : 'minor';
  return {
    id: issueIdFor(ctx, versionId, source, index),
    source,
    dimension,
    kind,
    severity,
    override_class: overrideClassFor(ctx.policy, kind, severity),
    confidence: Math.max(0, Math.min(1, raw.confidence ?? 0.5)),
    claim: raw.claim ?? `${kind} reported by ${source}`,
    status: 'open',
    ...(raw.chapter_span
      ? { chapter_span: { ...raw.chapter_span, manuscript_version_id: versionId } }
      : {}),
    ...(raw.repair ? { repair: raw.repair } : {}),
    ...(raw.conflicting_canon ? { conflicting_canon: raw.conflicting_canon } : {}),
    ...(raw.canon_evidence ? { canon_evidence: raw.canon_evidence } : {}),
    ...(raw.metric ? { metric: raw.metric } : {}),
  };
}

function isIssueKind(k: string): k is Issue['kind'] {
  return ISSUE_KINDS.has(k);
}

export interface DeterministicChecks {
  readonly output_language: {
    passed: boolean;
    english_confidence: number;
    non_english_segments: number;
  };
  readonly length: { passed: boolean; words: number; target: number; ratio: number; warn: boolean };
  readonly truncation: { passed: boolean; reason?: string | undefined };
  readonly contract_shape: { passed: boolean; notes: string[] };
  readonly issues: Issue[];
}

const TRUNCATION_TAIL = /[.!?…”"’')\]]\s*$/u;

export function runDeterministicChecks(
  ctx: WorkflowContext,
  version: ManuscriptVersionRow,
  contract: ChapterContract,
  allowlist: readonly string[],
): DeterministicChecks {
  const nfc = toNfcText(version.text);
  const issues: Issue[] = [];
  let n = 0;
  const lang = checkOutputLanguage(nfc, {
    minConfidence: ctx.policy.output_language.min_english_confidence,
    allowlist,
  });
  if (!lang.passed)
    issues.push(
      toIssue(
        ctx,
        version.id,
        'lint',
        'output_language',
        {
          kind: 'non_english_output',
          severity: 'blocking',
          confidence: 1,
          claim: `English confidence ${lang.english_confidence}; offending paragraphs ${lang.offending_segments.map((s) => s.paragraph_id).join(', ')}`,
          chapter_span: { paragraph_ids: lang.offending_segments.map((s) => s.paragraph_id) },
        },
        n++,
      ),
    );
  const m = measure(nfc);
  const len = judgeLength(m.words, contract.length_target, ctx.policy.length.fail_tolerance_ratio);
  if (len.fail)
    issues.push(
      toIssue(
        ctx,
        version.id,
        'lint',
        'length',
        {
          kind: 'length_out_of_range',
          severity: 'major',
          confidence: 1,
          claim: `${m.words} words vs target ${contract.length_target.value} (${(len.ratio * 100).toFixed(0)}%)`,
          metric: { rule_id: 'LEN-01', value: m.words, threshold: contract.length_target.value },
        },
        n++,
      ),
    );
  else if (len.warn)
    issues.push(
      toIssue(
        ctx,
        version.id,
        'lint',
        'length',
        {
          kind: 'length_out_of_range',
          severity: 'minor',
          confidence: 1,
          claim: `${m.words} words vs target ${contract.length_target.value} (${(len.ratio * 100).toFixed(0)}%, within fail tolerance)`,
          metric: { rule_id: 'LEN-01', value: m.words, threshold: contract.length_target.value },
        },
        n++,
      ),
    );
  const paragraphs = segmentParagraphs(nfc);
  const last = paragraphs[paragraphs.length - 1]?.text.trim() ?? '';
  const truncated =
    last.length === 0 ||
    !TRUNCATION_TAIL.test(last) ||
    /\b(and|the|of|to|a|an|with|but)$/i.test(last);
  if (truncated)
    issues.push(
      toIssue(
        ctx,
        version.id,
        'lint',
        'structure',
        {
          kind: 'truncated_output',
          severity: 'blocking',
          confidence: 0.9,
          claim: `final paragraph does not end a sentence: “${last.slice(-60)}”`,
          chapter_span: { paragraph_ids: [paragraphs[paragraphs.length - 1]?.id ?? 'p?'] },
        },
        n++,
      ),
    );
  const notes: string[] = [];
  let shapeOk = true;
  if (paragraphs.length < contract.scene_count) {
    shapeOk = false;
    notes.push(`only ${paragraphs.length} paragraphs for ${contract.scene_count} scenes`);
  }
  if (/^\s*(#|\*\*|Chapter \d+|Scene \d+)/m.test(nfc.text)) {
    shapeOk = false;
    notes.push('headings or scene labels inside the prose');
    issues.push(
      toIssue(
        ctx,
        version.id,
        'lint',
        'structure',
        {
          kind: 'format_drift',
          severity: 'blocking',
          confidence: 1,
          claim: 'headings/labels inside the manuscript',
        },
        n++,
      ),
    );
  }
  for (const mn of contract.must_not_happen) {
    for (const pat of mn.lexical_patterns ?? []) {
      if (new RegExp(pat, 'i').test(nfc.text)) {
        shapeOk = false;
        issues.push(
          toIssue(
            ctx,
            version.id,
            'lint',
            'contract',
            {
              kind:
                mn.source === 'content_restriction'
                  ? 'content_restriction'
                  : 'forbidden_development',
              severity: 'blocking',
              confidence: 1,
              claim: `must-not ${mn.id} matched lexical pattern /${pat}/`,
            },
            n++,
          ),
        );
      }
    }
  }
  return {
    output_language: {
      passed: lang.passed,
      english_confidence: lang.english_confidence,
      non_english_segments: lang.offending_segments.length,
    },
    length: {
      passed: !len.fail,
      words: m.words,
      target: contract.length_target.value,
      ratio: len.ratio,
      warn: len.warn,
    },
    truncation: {
      passed: !truncated,
      ...(truncated ? { reason: 'final paragraph incomplete' } : {}),
    },
    contract_shape: { passed: shapeOk, notes },
    issues,
  };
}

interface JudgeOutput {
  judge_score?: number;
  dimension_scores?: Record<string, number>;
  drift_flags?: string[];
  issues?: RawIssue[];
  hook_sentence_index?: number;
  local_payoff_present?: boolean;
  ending_type_detected?: string;
}

export interface EvaluationResult {
  readonly scorecard: Scorecard;
  readonly scorecardArtifactId: string;
  readonly blocking: readonly Issue[];
  readonly approvable: boolean;
  readonly packs: { checker: string; checker_hash: string };
}

/** Evaluate one manuscript version (idempotent per version). */
export async function evaluateVersion(
  ctx: WorkflowContext,
  input: {
    version: ManuscriptVersionRow;
    contract: ChapterContract;
    spec: StorySpec;
    canonVersion: number;
    allowlist: readonly string[];
    round: number;
  },
): Promise<EvaluationResult> {
  const v = input.version;
  return runStep(
    ctx,
    'evaluate',
    async () => {
      const det = runDeterministicChecks(ctx, v, input.contract, input.allowlist);
      const paragraphs = segmentParagraphs(toNfcText(v.text));
      const chapterText = paragraphs.map((p) => `[${p.id}] ${p.text}`).join('\n\n');
      const evaluatorCalls: string[] = [];
      const issues: Issue[] = [...det.issues];

      // Checker pack: the working version enters only as job-scoped chapter_text (status recorded in the manifest).
      const checker = await checkpointPack(ctx, {
        label: `continuity_checker:r${input.round}`,
        role: 'continuity_checker',
        contract: input.contract,
        spec: input.spec,
        chapterText: { versionId: v.id },
        lexical: false,
      });
      const packIn = packCallInput(checker.stored);
      const act = (name: string) => `${name}:${input.contract.chapter_number}:r${input.round}`;

      const contractCall = await modelCall<{
        criteria?: {
          criterion_id: string;
          passed: boolean;
          evidence_paragraph_ids?: string[];
          note?: string;
        }[];
      }>(ctx, {
        step: 'evaluate',
        family: 'contract_checker',
        activityId: act('contract_check'),
        variables: {
          chapter_text: chapterText,
          chapter_contract:
            checker.stored.variables.chapter_contract ?? JSON.stringify(input.contract),
        },
        pack: packIn,
      });
      evaluatorCalls.push(contractCall.llmCallId);
      const criteria = contractCall.output.criteria ?? [];
      const criteriaResults = input.contract.acceptance_criteria.map((c) => {
        const r = criteria.find((x) => x.criterion_id === c.id);
        if (c.kind === 'deterministic') {
          const passed = c.id.includes('LANG')
            ? det.output_language.passed
            : c.id.includes('LEN')
              ? det.length.passed
              : (r?.passed ?? false);
          return { criterion_id: c.id, passed, note: 'deterministic' };
        }
        return {
          criterion_id: c.id,
          passed: r?.passed ?? false,
          ...(r?.evidence_paragraph_ids
            ? { evidence_paragraph_ids: r.evidence_paragraph_ids }
            : {}),
          ...(r?.note ? { note: r.note } : {}),
        };
      });
      criteriaResults.forEach((cr, i) => {
        if (!cr.passed)
          issues.push(
            toIssue(
              ctx,
              v.id,
              'judge:contract_checker',
              'contract',
              {
                kind: 'missing_required_event',
                severity: 'major',
                confidence: 0.9,
                claim: `acceptance criterion ${cr.criterion_id} failed${cr.note ? `: ${cr.note}` : ''}`,
              },
              i,
            ),
          );
      });

      const continuity = await modelCall<{ issues?: RawIssue[] }>(ctx, {
        step: 'evaluate',
        family: 'continuity_checker',
        activityId: act('continuity'),
        variables: {
          chapter_text: chapterText,
          locked_facts: checker.stored.variables.timeline_position ?? '(none)',
        },
        pack: packIn,
      });
      evaluatorCalls.push(continuity.llmCallId);
      (continuity.output.issues ?? []).forEach((r, i) =>
        issues.push(toIssue(ctx, v.id, 'judge:continuity_checker', 'continuity', r, i)),
      );

      const leak = await modelCall<{ issues?: RawIssue[] }>(ctx, {
        step: 'evaluate',
        family: 'knowledge_leak_checker',
        activityId: act('knowledge_leak'),
        variables: {
          chapter_text: chapterText,
          knowledge_table: checker.stored.variables.canon_state ?? '(none)',
          knowledge_guards: checker.stored.variables.timeline_position ?? '(none)',
          secrets: checker.stored.variables.canon_state ?? '(none)',
        },
        pack: packIn,
      });
      evaluatorCalls.push(leak.llmCallId);
      (leak.output.issues ?? []).forEach((r, i) =>
        issues.push(toIssue(ctx, v.id, 'judge:knowledge_leak_checker', 'knowledge', r, i)),
      );

      // Two separate judges, two separate identity variants, two separate gates.
      const prose = await modelCall<JudgeOutput>(ctx, {
        step: 'evaluate',
        family: 'prose_judge',
        activityId: act('prose_judge'),
        variables: {
          chapter_text: chapterText,
          prose_lint_report: `English output-language check: confidence ${det.output_language.english_confidence}; length ${det.length.words} words.`,
        },
        block: compileFor(ctx, 'judge_rubric_prose'),
      });
      evaluatorCalls.push(prose.llmCallId);
      (prose.output.issues ?? []).forEach((r, i) =>
        issues.push(toIssue(ctx, v.id, 'judge:prose_judge', 'prose', r, i)),
      );
      const structure = await modelCall<JudgeOutput>(ctx, {
        step: 'evaluate',
        family: 'structure_judge',
        activityId: act('structure_judge'),
        variables: {
          chapter_text: chapterText,
          structure_lint_report: `paragraphs ${paragraphs.length}; truncation check ${det.truncation.passed ? 'passed' : 'FAILED'}.`,
          contract_shape: `opening ${input.contract.opening.type}; hook ${input.contract.hook.type}; local satisfaction ${input.contract.local_satisfaction.map((s) => s.type).join(', ')}; scenes ${input.contract.scene_count}.`,
        },
        block: compileFor(ctx, 'judge_rubric_structure'),
      });
      evaluatorCalls.push(structure.llmCallId);
      (structure.output.issues ?? []).forEach((r, i) =>
        issues.push(toIssue(ctx, v.id, 'judge:structure_judge', 'structure', r, i)),
      );

      // Dimensions C and D. `standard.v1` gates genre and voice, so their evidence is required: without
      // them the per-dimension gates and the ADR-0014 regression check have nothing to read and must fail
      // closed. Each is its own immutable family with its own identity variant and its own gate — fluent
      // English, webnovel structure, genre fit and voice/register are never folded into one score
      // (EVAL-SEPARATION-001). The full evaluator build-out (richer evidence, calibration) is B-6-5.
      const genre = await modelCall<JudgeOutput>(ctx, {
        step: 'evaluate',
        family: 'genre_judge',
        activityId: act('genre_judge'),
        variables: {
          chapter_text: chapterText,
          terminology_report: `allowlisted names ${input.allowlist.length}; primary genre ${input.spec.items.find((i) => i.category === 'genre')?.text ?? '(unspecified)'}.`,
        },
        block: compileFor(ctx, 'judge_rubric_genre'),
      });
      evaluatorCalls.push(genre.llmCallId);
      (genre.output.issues ?? []).forEach((r, i) =>
        issues.push(toIssue(ctx, v.id, 'judge:genre_judge', 'genre', r, i)),
      );
      const voice = await modelCall<JudgeOutput>(ctx, {
        step: 'evaluate',
        family: 'voice_judge',
        activityId: act('voice_judge'),
        variables: {
          utterances: chapterText,
          register_digests: checker.stored.variables.register_digests ?? '(none)',
          register_check_report: `dialogue register digests supplied: ${checker.stored.variables.register_digests ? 'yes' : 'no'}.`,
        },
        block: compileFor(ctx, 'judge_rubric_prose'),
      });
      evaluatorCalls.push(voice.llmCallId);
      (voice.output.issues ?? []).forEach((r, i) =>
        issues.push(toIssue(ctx, v.id, 'judge:voice_judge', 'voice', r, i)),
      );

      const gates = ctx.policy.gates;
      const proseScore = clamp(prose.output.judge_score ?? 0);
      const structureScore = clamp(structure.output.judge_score ?? 0);
      const genreScore = clamp(genre.output.judge_score ?? 0);
      const voiceScore = clamp(voice.output.judge_score ?? 0);
      // Every gated dimension of the pinned policy gets its own result, from the policy's own thresholds.
      // A dimension the policy does not gate contributes no result — and therefore no silent pass.
      const gateFor = (name: 'prose' | 'structure' | 'genre' | 'voice') =>
        gates.dimensions[name]?.min_score;
      const dimensionResult = (
        dimension: 'prose' | 'structure' | 'genre' | 'voice',
        score: number,
      ) => {
        const threshold = gateFor(dimension);
        return threshold === undefined
          ? undefined
          : { dimension, score, threshold, passed: score >= threshold };
      };
      const dimensionResults = [
        dimensionResult('prose', proseScore),
        dimensionResult('structure', structureScore),
        dimensionResult('genre', genreScore),
        dimensionResult('voice', voiceScore),
      ].filter((d): d is NonNullable<typeof d> => d !== undefined);
      const count = (s: Severity) => issues.filter((i) => i.severity === s).length;
      const blockingCount = count('blocking');
      const majorCount = count('major');
      const autoApprovable =
        criteriaResults.every((c) => c.passed) &&
        blockingCount <= gates.blocking_max &&
        majorCount <= gates.major_max &&
        dimensionResults.every((d) => d.passed);
      // Look the gate result up by name: the list only carries dimensions the policy actually gates, so
      // positional access would silently mis-attribute a pass when a gate is absent.
      const dimensionPassed = (name: string) =>
        dimensionResults.find((d) => d.dimension === name)?.passed ?? false;
      const section = (
        dim: Issue['dimension'],
        score: number,
        passed: boolean,
        extra: Record<string, unknown> = {},
      ) => ({
        score,
        passed,
        issue_ids: issues.filter((i) => i.dimension === dim).map((i) => i.id),
        ...extra,
      });
      const scorecard: Scorecard = {
        id: issueIdFor(ctx, v.id, 'scorecard', input.round),
        manuscript_version_id: v.id,
        canon_version: input.canonVersion,
        quality_tier: ctx.policy.quality_tier,
        overall: {
          score: Math.round((proseScore + structureScore) / 2),
          blocking_count: blockingCount,
          major_count: majorCount,
          minor_count: count('minor'),
          note_count: count('note'),
        },
        sections: {
          prose: section('prose', proseScore, dimensionPassed('prose'), {
            judge_score: proseScore,
            drift_flags: prose.output.drift_flags ?? [],
            dimension_scores: prose.output.dimension_scores ?? {},
            evaluator_call_id: prose.llmCallId,
          }),
          structure: section('structure', structureScore, dimensionPassed('structure'), {
            judge_score: structureScore,
            drift_flags: structure.output.drift_flags ?? [],
            dimension_scores: structure.output.dimension_scores ?? {},
            ...(structure.output.hook_sentence_index !== undefined
              ? { hook_sentence_index: structure.output.hook_sentence_index }
              : {}),
            ...(structure.output.local_payoff_present !== undefined
              ? { local_payoff_present: structure.output.local_payoff_present }
              : {}),
            ...(structure.output.ending_type_detected
              ? { ending_type_detected: structure.output.ending_type_detected }
              : {}),
            evaluator_call_id: structure.llmCallId,
          }),
          genre: section('genre', genreScore, dimensionPassed('genre'), {
            judge_score: genreScore,
            drift_flags: genre.output.drift_flags ?? [],
            dimension_scores: genre.output.dimension_scores ?? {},
            evaluator_call_id: genre.llmCallId,
          }),
          voice: section('voice', voiceScore, dimensionPassed('voice'), {
            judge_score: voiceScore,
            drift_flags: voice.output.drift_flags ?? [],
            dimension_scores: voice.output.dimension_scores ?? {},
            evaluator_call_id: voice.llmCallId,
          }),
          output_language: section(
            'output_language',
            det.output_language.passed ? 100 : 0,
            det.output_language.passed,
            {
              english_confidence: det.output_language.english_confidence,
              non_english_segments: det.output_language.non_english_segments,
            },
          ),
          contract_compliance: section(
            'contract',
            criteriaResults.every((c) => c.passed) ? 100 : 0,
            criteriaResults.every((c) => c.passed),
            { evaluator_call_id: contractCall.llmCallId },
          ),
          continuity: section(
            'continuity',
            issues.some((i) => i.dimension === 'continuity' && i.severity !== 'note') ? 0 : 100,
            !issues.some(
              (i) =>
                i.dimension === 'continuity' &&
                (i.severity === 'blocking' || i.severity === 'major'),
            ),
            { evaluator_call_id: continuity.llmCallId },
          ),
          knowledge: section(
            'knowledge',
            issues.some((i) => i.dimension === 'knowledge') ? 0 : 100,
            !issues.some(
              (i) =>
                i.dimension === 'knowledge' &&
                (i.severity === 'blocking' || i.severity === 'major'),
            ),
            { evaluator_call_id: leak.llmCallId },
          ),
          length: section('length', det.length.passed ? 100 : 0, det.length.passed),
        },
        issues,
        acceptance: {
          criteria_results: criteriaResults,
          dimension_results: dimensionResults,
          auto_approvable: autoApprovable,
          production_policy_version: ctx.pins.productionPolicyVersion,
          gate_outcome: autoApprovable
            ? 'approved'
            : blockingCount > 0 || majorCount > 0
              ? 'rejected'
              : 'needs_attention',
        },
        evaluator_calls: evaluatorCalls,
      };
      const valid = validatorFor<Scorecard>('scorecard.schema.json')(scorecard);
      if (!valid.ok)
        throw new WorkflowError(
          'EVALUATION_FAILED',
          `scorecard does not validate: ${valid.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
          { step: 'evaluate' },
        );
      const ref = await saveArtifact(ctx, {
        step: 'evaluate',
        kind: 'scorecard',
        key: v.id,
        schema: 'scorecard.schema.json',
        payload: scorecard,
      });
      return {
        scorecard,
        scorecardArtifactId: ref.artifact_id,
        blocking: issues.filter((i) => i.severity === 'blocking' || i.severity === 'major'),
        approvable: autoApprovable,
        packs: { checker: checker.ref.pack_id, checker_hash: checker.ref.pack_hash },
      };
    },
    v.id,
  );
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

/** Issues that block approval and are candidates for the one targeted revision (dimension-targeted). */
export function revisionTargets(scorecard: Scorecard): Issue[] {
  return scorecard.issues.filter(
    (i) => (i.severity === 'blocking' || i.severity === 'major') && i.status === 'open',
  );
}
