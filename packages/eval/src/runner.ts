/**
 * Deterministic contrast regression runner (B-6-3).
 *
 * Every variant of every set is evaluated through the REAL judge boundary — PromptRegistry (immutable,
 * content-hashed prompt versions) → Gateway (Guard, budget, audit, structured-output validation) →
 * ReplayProvider — so the runner exercises the same path production evaluation uses. ReplayProvider refuses
 * any prompt it has no recording for, which is what makes "no network, no credentials, no spend" a
 * structural property rather than a promise: a missing recording throws instead of reaching a live provider.
 *
 * Results are content-addressed and free of wall-clock time and random ids, so two runs over the same corpus
 * and the same recordings produce byte-identical documents.
 *
 * SCOPE HONESTY (ADR-0029): this measures deterministic fixture agreement, replay integrity and corpus
 * coverage. It is NOT live judge calibration and says nothing about how a real model would score. Every
 * result document carries `calibration_status: "uncalibrated"`.
 */
import { createHash } from 'node:crypto';
import {
  Gateway,
  GatewayError,
  MemoryAuditStore,
  MemoryBudget,
  ReplayProvider,
  type Recording,
  type RoutingTable,
} from '@yeonjae/gateway';
import { requirePolicy, uuidv7, type Generated } from '@yeonjae/domain';
import {
  compileBlock,
  composeIdentity,
  ProfileStore,
  type ComposedIdentity,
  type RoleVariant,
} from '@yeonjae/narrative';
import { PromptRegistry, renderPrompt } from '@yeonjae/prompts';
import {
  loadCorpus,
  VARIANT_CLASSES,
  type Corpus,
  type ContrastSet,
  type VariantClass,
} from './corpus.js';
import {
  ALL_DIMENSIONS,
  classify,
  CLASS_EXPECTATIONS,
  EXPECTED_DIMENSIONS,
  expectationFor,
  type Agreement,
  type DimensionName,
  type Expectation,
} from './expectations.js';
import { activityIdFor } from './recordings.js';
import {
  loadFixtures,
  recordingsFromFixtures,
  verifyFixtureIntegrity,
  type FixtureFile,
} from './fixtures.js';
import { checkCoverage, checkExpectationConsistency, checkPins, type LiveWorld } from './drift.js';

type ProductionPolicy = Generated.ProductionPolicySchema.ProductionPolicy;

export const POLICY_REF = 'policy/standard@1';
export const IDENTITY_REF = 'project/0191b2a0-0000-7000-8000-000000000001@1';
const IDENTITY_VERSION = '0191b2a0-0000-7000-8000-000000060001';
/** Fixed ids: the runner is a pure function of the corpus, so nothing here may vary between runs. */
const WORKSPACE_ID = '0191b2a0-0000-7000-8000-0000000f0001';
const PROJECT_ID = '0191b2a0-0000-7000-8000-0000000f0002';
const JOB_ID = '0191b2a0-0000-7000-8000-0000000f0003';

/** The judge family and identity variant behind each dimension. Separate families, separate rubrics. */
export const DIMENSION_JUDGES: Readonly<
  Record<DimensionName, { family: string; variant: RoleVariant }>
> = {
  prose: { family: 'prose_judge', variant: 'judge_rubric_prose' },
  structure: { family: 'structure_judge', variant: 'judge_rubric_structure' },
  genre: { family: 'genre_judge', variant: 'judge_rubric_genre' },
  voice: { family: 'voice_judge', variant: 'judge_rubric_prose' },
};

const route = (modelId: string, family: string) => ({
  modelId,
  provider: 'replay',
  priority: 1,
  family,
  priceInPerMTokCents: 100,
  priceOutPerMTokCents: 400,
  maxContextTokens: 200_000,
  supportsJsonSchema: true,
});
const ROUTING: RoutingTable = {
  R: [route('replay-r', 'alpha')],
  P: [route('replay-p', 'alpha')],
  M: [route('replay-m', 'beta')],
  C: [route('replay-c', 'beta')],
  E: [],
};

export interface VariantResult {
  readonly set_id: string;
  readonly variant: VariantClass;
  readonly genre: string;
  readonly narrative_function: string;
  readonly dimension: DimensionName;
  readonly expected: Expectation;
  readonly threshold: number;
  readonly observed_score: number;
  readonly observed_passed: boolean;
  readonly agreement: Agreement;
  readonly disagreement?: string | undefined;
  readonly issue_kinds: readonly string[];
  readonly drift_flags: readonly string[];
  readonly prompt_family: string;
  readonly prompt_version_id: string;
  readonly prompt_hash: string;
  readonly identity_variant: string;
  readonly model_id: string;
  readonly provider: string;
  readonly recording_key: string;
  readonly recording_hash: string;
}

export interface RunnerFailure {
  readonly code: string;
  readonly detail: string;
  readonly set_id?: string | undefined;
  readonly variant?: string | undefined;
  readonly dimension?: string | undefined;
}

export interface ContrastReport {
  readonly schema: 'yeonjae.contrast-regression.v1';
  readonly status: 'passed' | 'failed';
  readonly calibration_status: 'uncalibrated';
  readonly scope: string;
  readonly pins: {
    readonly corpus_path: string;
    readonly corpus_hash: string;
    readonly production_policy_version: string;
    readonly production_policy_hash: string;
    readonly narrative_identity_ref: string;
    readonly prompt_set_id: string;
    readonly prompt_versions: Readonly<Record<string, string>>;
    readonly prompt_hashes: Readonly<Record<string, string>>;
    readonly provider: string;
    readonly recordings_hash: string;
    readonly fixture_format: string;
    readonly fixture_hash: string;
    readonly fixture_provenance: string;
  };
  readonly totals: {
    readonly sets: number;
    readonly variants_per_set: number;
    readonly dimensions_evaluated: number;
    readonly evaluations_expected: number;
    readonly evaluations_executed: number;
    readonly evaluations_skipped: number;
    readonly assertions: number;
    readonly agreements: number;
    readonly false_positives: number;
    readonly false_negatives: number;
    readonly not_asserted: number;
  };
  readonly by_variant: Readonly<
    Record<
      string,
      { agreements: number; false_positives: number; false_negatives: number; not_asserted: number }
    >
  >;
  readonly by_genre: Readonly<
    Record<string, { agreements: number; false_positives: number; false_negatives: number }>
  >;
  readonly by_function: Readonly<
    Record<string, { agreements: number; false_positives: number; false_negatives: number }>
  >;
  readonly by_dimension: Readonly<
    Record<string, { agreements: number; false_positives: number; false_negatives: number }>
  >;
  readonly disagreements: readonly VariantResult[];
  readonly missing_recordings: readonly string[];
  readonly malformed_verdicts: readonly RunnerFailure[];
  readonly failures: readonly RunnerFailure[];
  readonly results: readonly VariantResult[];
  /** sha256 over the logical content of this report, excluding itself. Stable across runs. */
  readonly result_hash: string;
}

export interface RunOptions {
  readonly corpus?: Corpus | undefined;
  readonly corpusPath?: string | undefined;
  /** Frozen baseline. Defaults to the committed fixture file; never derived from expectations. */
  readonly fixtures?: FixtureFile | undefined;
  readonly fixturePath?: string | undefined;
  /** Override recordings to exercise failure paths (missing, malformed, wrong identity). */
  readonly recordings?: Map<string, Recording> | undefined;
  readonly dimensions?: readonly DimensionName[] | undefined;
  readonly variants?: readonly VariantClass[] | undefined;
}

function thresholdsFrom(policy: ProductionPolicy): Record<DimensionName, number> {
  const dims = policy.gates.dimensions as Record<string, { min_score: number } | undefined>;
  const out = {} as Record<DimensionName, number>;
  for (const d of ALL_DIMENSIONS) {
    const gate = dims[d];
    if (!gate)
      throw new GatewayError(
        'PROVIDER_FAILED',
        `the pinned policy does not gate ${d}; the contrast runner reads thresholds only from policy (ADR-0041)`,
      );
    out[d] = gate.min_score;
  }
  return out;
}

function stableHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value), 'utf8').digest('hex')}`;
}

/** Key-sorted JSON so a hash depends on content, never on property insertion order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  // `undefined` serializes to undefined, which must still produce valid JSON text in a canonical form.
  return value === undefined ? 'null' : JSON.stringify(value);
}

interface JudgeVerdict {
  judge_score?: unknown;
  drift_flags?: unknown;
  issues?: unknown;
}

export async function runContrastRegression(options: RunOptions = {}): Promise<ContrastReport> {
  const failures: RunnerFailure[] = [];
  const malformed: RunnerFailure[] = [];
  const missingRecordings: string[] = [];
  const results: VariantResult[] = [];

  const corpus = options.corpus ?? loadCorpus(options.corpusPath);
  const policy = requirePolicy(POLICY_REF);
  const thresholds = thresholdsFrom(policy);
  const dimensions = options.dimensions ?? ALL_DIMENSIONS;
  const variants = options.variants ?? VARIANT_CLASSES;

  const registry = PromptRegistry.fromDirectory();
  const promptSet = registry.activeSet();
  const profiles = ProfileStore.fromDirectory();
  const identity = composeIdentity(profiles, IDENTITY_REF, IDENTITY_VERSION);

  // Frozen baseline: validation LOADS committed fixtures and never derives a score. `recordings` is a
  // test-only seam for exercising failure paths; the default path reads bytes from disk.
  // An injected fixture file is verified exactly like one read from disk: the test seam must not be a way
  // around the baseline's integrity guarantees.
  const fixtures = options.fixtures
    ? verifyFixtureIntegrity(options.fixtures, '(supplied fixture file)')
    : loadFixtures(options.fixturePath);
  const recordings = options.recordings ?? recordingsFromFixtures(fixtures);
  const recordingsHash = stableHash(
    [...recordings.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, v]),
  );
  const provider = new ReplayProvider(recordings, { name: 'replay' });
  const gateway = new Gateway({
    providers: new Map([['replay', provider]]),
    routing: ROUTING,
    budget: new MemoryBudget(100_000_000),
    audit: new MemoryAuditStore(),
    guardContext: { pinnedIdentityVersionId: IDENTITY_VERSION },
    minEnglishConfidence: policy.output_language.min_english_confidence,
  });

  const promptVersions: Record<string, string> = {};
  const promptHashes: Record<string, string> = {};
  for (const dimension of dimensions) {
    const { family } = DIMENSION_JUDGES[dimension];
    const id = promptSet.mapping[family];
    if (!id) {
      failures.push({
        code: 'PROMPT_FAMILY_MISSING',
        detail: `no active ${family} prompt version`,
      });
      continue;
    }
    const pv = registry.get(id);
    promptVersions[family] = pv.id;
    promptHashes[family] = pv.content_hash;
  }

  // ---- Drift: the fixtures are only an independent baseline if a change on EITHER side is detected.
  // Pin, coverage and expectation-consistency divergences are refusals, not re-derivations.
  const live: LiveWorld = {
    corpusHash: corpus.hash,
    policyId: policy.id,
    policyVersion: policy.version,
    policyHash: policy.content_hash,
    thresholds,
    identityRef: IDENTITY_REF,
    identityVersionId: IDENTITY_VERSION,
    promptVersionIds: promptVersions,
    promptContentHashes: promptHashes,
  };
  const drift = [
    ...checkPins(fixtures, live),
    ...checkCoverage(fixtures, corpus, dimensions, variants),
    ...checkExpectationConsistency(fixtures, corpus),
  ];
  failures.push(...drift);

  const expectedEvaluations = corpus.sets.length * variants.length * dimensions.length;
  const seen = new Set<string>();

  // Deterministic order: sets in corpus order, then the canonical class order, then the canonical
  // dimension order. Nothing here depends on map iteration or concurrency.
  for (const set of corpus.sets) {
    for (const variant of variants) {
      for (const dimension of dimensions) {
        const dedupeKey = `${set.id}|${variant}|${dimension}`;
        if (seen.has(dedupeKey)) {
          failures.push({
            code: 'DUPLICATE_EVALUATION',
            detail: `evaluation ${dedupeKey} was produced twice`,
            set_id: set.id,
            variant,
            dimension,
          });
          continue;
        }
        seen.add(dedupeKey);
        const outcome = await evaluateOne({
          gateway,
          registry,
          promptSet: promptSet.mapping,
          identity,
          policy,
          set,
          variant,
          dimension,
          threshold: thresholds[dimension],
          recordings,
          pinnedPromptVersionId:
            fixtures.pins.prompt_version_ids[DIMENSION_JUDGES[dimension].family],
          pinnedPromptHash: fixtures.pins.prompt_content_hashes[DIMENSION_JUDGES[dimension].family],
        });
        if ('failure' in outcome) {
          if (outcome.failure.code === 'MISSING_RECORDING')
            missingRecordings.push(outcome.failure.detail);
          else if (
            outcome.failure.code === 'MALFORMED_VERDICT' ||
            outcome.failure.code === 'MISSING_REQUIRED_SCORE' ||
            outcome.failure.code === 'WRONG_VARIANT_IDENTITY'
          )
            malformed.push(outcome.failure);
          failures.push(outcome.failure);
          continue;
        }
        results.push(outcome.result);
      }
    }
  }

  // Every prompt the provider served must have been served through an activity recording; a prompt-hash
  // match would mean the recording table did not key on the run's own activity ids.
  for (const served of provider.served) {
    if (served.by !== 'activity')
      failures.push({
        code: 'UNEXPECTED_RECORDING_MATCH',
        detail: `recording ${served.key} matched by ${served.by}, expected an activity key`,
      });
  }
  if (provider.misses.length > 0)
    failures.push({
      code: 'REPLAY_MISS',
      detail: `${provider.misses.length} prompt(s) had no recording; a live provider was refused`,
    });

  if (
    results.length + failures.filter((f) => f.set_id !== undefined).length !==
    expectedEvaluations
  )
    failures.push({
      code: 'INCOMPLETE_EXECUTION',
      detail: `expected ${expectedEvaluations} evaluations, accounted for ${
        results.length + failures.filter((f) => f.set_id !== undefined).length
      }`,
    });

  const disagreements = results.filter(
    (r) => r.agreement === 'false_positive' || r.agreement === 'false_negative',
  );
  const report = assemble({
    corpus,
    policy,
    promptSetId: promptSet.id,
    promptVersions,
    promptHashes,
    recordingsHash,
    fixtures,
    dimensions,
    variants,
    expectedEvaluations,
    results,
    disagreements,
    missingRecordings,
    malformed,
    failures,
  });
  return report;
}

interface EvaluateInput {
  gateway: Gateway;
  registry: PromptRegistry;
  promptSet: Readonly<Record<string, string>>;
  identity: ComposedIdentity;
  policy: ProductionPolicy;
  set: ContrastSet;
  variant: VariantClass;
  dimension: DimensionName;
  threshold: number;
  recordings: Map<string, Recording>;
  pinnedPromptVersionId?: string | undefined;
  pinnedPromptHash?: string | undefined;
}

async function evaluateOne(
  input: EvaluateInput,
): Promise<{ result: VariantResult } | { failure: RunnerFailure }> {
  const { set, variant, dimension } = input;
  const judge = DIMENSION_JUDGES[dimension];
  const promptId = input.promptSet[judge.family];
  const where = { set_id: set.id, variant, dimension };
  if (!promptId)
    return { failure: { code: 'PROMPT_FAMILY_MISSING', detail: judge.family, ...where } };
  const pv = input.registry.get(promptId);
  const text = set.variants[variant];
  const activityId = activityIdFor(set.id, variant, dimension);
  const recordingKey = `activity:${activityId}`;
  if (!input.recordings.has(recordingKey))
    return { failure: { code: 'MISSING_RECORDING', detail: recordingKey, ...where } };

  const block = compileIdentityBlock(input.identity, judge.variant);
  const vars: Record<string, string> = {
    narrative_identity_block: block.text,
    identity_tail: block.tail,
  };
  // Supply exactly the variables the immutable prompt version declares; a drifting family fails loudly.
  for (const name of pv.input_variables) {
    vars[name] =
      name === 'chapter_text' || name === 'utterances'
        ? text
        : `contrast set ${set.id} (${set.genre}, ${set.function}); variant ${variant}; dimension ${dimension}.`;
  }
  let rendered;
  try {
    rendered = renderPrompt(pv, vars);
  } catch (err) {
    return { failure: { code: 'PROMPT_RENDER_FAILED', detail: (err as Error).message, ...where } };
  }

  let response;
  try {
    response = await input.gateway.call({
      workspaceId: WORKSPACE_ID as never,
      projectId: PROJECT_ID as never,
      jobId: JOB_ID as never,
      activityId,
      idempotencyKey: `contrast|${set.id}|${variant}|${dimension}`,
      role: pv.role,
      styleSensitive: pv.style_sensitive,
      manuscriptProducing: pv.manuscript_producing,
      promptVersionId: uuidv7(0),
      promptHash: pv.content_hash,
      productionPolicyVersion: POLICY_REF,
      pack: {
        id: uuidv7(0),
        hash: `sha256:${createHash('sha256').update(rendered.user).digest('hex')}`,
        renderedSystem: rendered.system,
        renderedUser: rendered.user,
        tokenEstimate: Math.ceil(rendered.user.length / 4),
      },
      narrativeIdentityRef: {
        blockHash: block.hash,
        identityVersionId: IDENTITY_VERSION as never,
        roleVariant: judge.variant,
        outputLanguage: 'en',
        outputLanguageContractHash: block.outputLanguageContractHash,
        traditionContractHash: block.traditionContractHash,
      },
      modelClass: pv.model_class,
    });
  } catch (err) {
    const message = (err as Error).message;
    if (message.startsWith('ReplayProvider:'))
      return { failure: { code: 'MISSING_RECORDING', detail: recordingKey, ...where } };
    return { failure: { code: 'EVALUATOR_CALL_FAILED', detail: message, ...where } };
  }

  // Requirements 9 & 10: activity-key replay must never conceal prompt drift. The recording is keyed by
  // activity id (needed for workflow resumability), so the rendered-prompt identity is verified here,
  // independently: the prompt version and content hash the fixture pinned must equal the ones actually
  // rendered for this call, and the prompt must actually embed this variant's text.
  if (input.pinnedPromptVersionId !== undefined && input.pinnedPromptVersionId !== pv.id)
    return {
      failure: {
        code: 'PROMPT_IDENTITY_MISMATCH',
        detail: `rendered prompt is ${pv.id}, fixture pinned ${input.pinnedPromptVersionId}`,
        ...where,
      },
    };
  if (input.pinnedPromptHash !== undefined && input.pinnedPromptHash !== pv.content_hash)
    return {
      failure: {
        code: 'PROMPT_IDENTITY_MISMATCH',
        detail: `rendered prompt hashes to ${pv.content_hash}, fixture pinned ${input.pinnedPromptHash}`,
        ...where,
      },
    };
  if (!rendered.user.includes(text.slice(0, 40)))
    return {
      failure: {
        code: 'PROMPT_IDENTITY_MISMATCH',
        detail: 'the rendered prompt does not contain this variant’s prose',
        ...where,
      },
    };

  const verdict = response.output.json as JudgeVerdict | undefined;
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict))
    return {
      failure: { code: 'MALFORMED_VERDICT', detail: 'verdict is not a JSON object', ...where },
    };
  const score = verdict.judge_score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100)
    return {
      failure: {
        code: 'MISSING_REQUIRED_SCORE',
        detail: `judge_score is ${JSON.stringify(score)}; a 0–100 number is required`,
        ...where,
      },
    };
  if (verdict.issues !== undefined && !Array.isArray(verdict.issues))
    return { failure: { code: 'MALFORMED_VERDICT', detail: 'issues is not an array', ...where } };
  if (verdict.drift_flags !== undefined && !Array.isArray(verdict.drift_flags))
    return {
      failure: { code: 'MALFORMED_VERDICT', detail: 'drift_flags is not an array', ...where },
    };
  // Identity check: a recording that names a different set or variant would silently score the wrong text.
  const issues = (verdict.issues ?? []) as { kind?: unknown; claim?: unknown }[];
  for (const issue of issues) {
    if (typeof issue.kind !== 'string')
      return { failure: { code: 'MALFORMED_VERDICT', detail: 'issue has no kind', ...where } };
    if (typeof issue.claim === 'string' && /\bset (cs-\d+)\b/.test(issue.claim)) {
      const named = /\bset (cs-\d+)\b/.exec(issue.claim)?.[1];
      if (named && named !== set.id)
        return {
          failure: {
            code: 'WRONG_VARIANT_IDENTITY',
            detail: `verdict for ${set.id} cites ${named}`,
            ...where,
          },
        };
    }
  }

  const expected = expectationFor(variant, dimension);
  const passed = score >= input.threshold;
  const agreement = classify(expected, passed);
  const result: VariantResult = {
    set_id: set.id,
    variant,
    genre: set.genre,
    narrative_function: set.function,
    dimension,
    expected,
    threshold: input.threshold,
    observed_score: score,
    observed_passed: passed,
    agreement,
    ...(agreement === 'false_positive' || agreement === 'false_negative'
      ? {
          disagreement: `expected ${expected} on ${dimension}, observed ${
            passed ? 'pass' : 'fail'
          } (${score} vs threshold ${input.threshold}) — ${CLASS_EXPECTATIONS[variant].rationale}`,
        }
      : {}),
    issue_kinds: issues.map((i) => String(i.kind)).sort(),
    drift_flags: ((verdict.drift_flags ?? []) as string[]).map(String).sort(),
    prompt_family: judge.family,
    prompt_version_id: pv.id,
    prompt_hash: pv.content_hash,
    identity_variant: judge.variant,
    model_id: response.modelId,
    provider: response.provider,
    recording_key: recordingKey,
    recording_hash: stableHash(input.recordings.get(recordingKey)),
  };
  return { result };
}

/**
 * The same Narrative Identity block the production evaluator compiles, including BOTH contract hashes the
 * Guard requires. Using the real compiler is what makes the runner exercise the real style-sensitive path.
 */
function compileIdentityBlock(identity: ComposedIdentity, variant: RoleVariant) {
  const compiled = compileBlock(identity, { role: variant, budgetTokens: 6000 });
  return {
    text: compiled.text,
    tail: compiled.identityTail ?? '',
    hash: compiled.hash,
    outputLanguageContractHash: compiled.outputLanguageContractHash,
    traditionContractHash: compiled.traditionContractHash,
  };
}

interface AssembleInput {
  corpus: Corpus;
  policy: ProductionPolicy;
  promptSetId: string;
  promptVersions: Record<string, string>;
  promptHashes: Record<string, string>;
  recordingsHash: string;
  fixtures: FixtureFile;
  dimensions: readonly DimensionName[];
  variants: readonly VariantClass[];
  expectedEvaluations: number;
  results: VariantResult[];
  disagreements: VariantResult[];
  missingRecordings: string[];
  malformed: RunnerFailure[];
  failures: RunnerFailure[];
}

function assemble(input: AssembleInput): ContrastReport {
  const tally = () => ({ agreements: 0, false_positives: 0, false_negatives: 0, not_asserted: 0 });
  const byVariant: Record<string, ReturnType<typeof tally>> = {};
  const byGenre: Record<string, ReturnType<typeof tally>> = {};
  const byFunction: Record<string, ReturnType<typeof tally>> = {};
  const byDimension: Record<string, ReturnType<typeof tally>> = {};
  const bump = (
    bucket: Record<string, ReturnType<typeof tally>>,
    key: string,
    agreement: Agreement,
  ) => {
    bucket[key] ??= tally();
    const t = bucket[key];
    if (agreement === 'agree') t.agreements++;
    else if (agreement === 'false_positive') t.false_positives++;
    else if (agreement === 'false_negative') t.false_negatives++;
    else t.not_asserted++;
  };
  for (const r of input.results) {
    bump(byVariant, r.variant, r.agreement);
    bump(byGenre, r.genre, r.agreement);
    bump(byFunction, r.narrative_function, r.agreement);
    bump(byDimension, r.dimension, r.agreement);
  }
  const count = (a: Agreement) => input.results.filter((r) => r.agreement === a).length;
  const falsePositives = count('false_positive');
  const falseNegatives = count('false_negative');
  const strip = (b: Record<string, ReturnType<typeof tally>>) =>
    Object.fromEntries(
      Object.entries(b)
        .sort(([a], [c]) => (a < c ? -1 : 1))
        .map(([k, v]) => [
          k,
          {
            agreements: v.agreements,
            false_positives: v.false_positives,
            false_negatives: v.false_negatives,
          },
        ]),
    );

  const status: 'passed' | 'failed' =
    input.failures.length === 0 && falsePositives === 0 && falseNegatives === 0
      ? 'passed'
      : 'failed';

  const body = {
    schema: 'yeonjae.contrast-regression.v1' as const,
    status,
    calibration_status: 'uncalibrated' as const,
    scope:
      'Deterministic replay regression over the five-class contrast corpus: fixture agreement, replay integrity and coverage. NOT live judge calibration; thresholds remain uncalibrated (ADR-0029) and live-provider quality is unproven.',
    pins: {
      corpus_path: input.corpus.path.slice(input.corpus.path.indexOf('examples/')),
      corpus_hash: input.corpus.hash,
      production_policy_version: POLICY_REF,
      production_policy_hash: input.policy.content_hash,
      narrative_identity_ref: IDENTITY_REF,
      prompt_set_id: input.promptSetId,
      prompt_versions: sortObject(input.promptVersions),
      prompt_hashes: sortObject(input.promptHashes),
      provider: 'replay',
      recordings_hash: input.recordingsHash,
      fixture_format: input.fixtures.format,
      fixture_hash: input.fixtures.fixture_hash,
      fixture_provenance: input.fixtures.provenance,
    },
    totals: {
      sets: input.corpus.sets.length,
      variants_per_set: input.variants.length,
      dimensions_evaluated: input.dimensions.length,
      evaluations_expected: input.expectedEvaluations,
      evaluations_executed: input.results.length,
      evaluations_skipped: input.expectedEvaluations - input.results.length,
      assertions: input.results.filter((r) => r.agreement !== 'not_asserted').length,
      agreements: count('agree'),
      false_positives: falsePositives,
      false_negatives: falseNegatives,
      not_asserted: count('not_asserted'),
    },
    by_variant: Object.fromEntries(Object.entries(byVariant).sort(([a], [b]) => (a < b ? -1 : 1))),
    by_genre: strip(byGenre),
    by_function: strip(byFunction),
    by_dimension: strip(byDimension),
    disagreements: input.disagreements,
    missing_recordings: [...input.missingRecordings].sort(),
    malformed_verdicts: input.malformed,
    failures: input.failures,
    results: input.results,
  };
  return { ...body, result_hash: stableHash(body) };
}

function sortObject(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export { EXPECTED_DIMENSIONS };
