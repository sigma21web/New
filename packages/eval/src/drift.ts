/**
 * Drift detection between the frozen fixture baseline and the live repository (B-6-3).
 *
 * The frozen fixtures are only an independent baseline if a change on EITHER side is detected. This module
 * compares the fixture's pinned world against the live one and refuses the run on any divergence, so a
 * corpus edit, a policy threshold change, a prompt byte, an identity bump or an entry set that no longer
 * matches the corpus can never pass unnoticed.
 *
 * It also checks the fixtures against the corpus's authored expectations INDEPENDENTLY: the frozen scores
 * must actually satisfy the ranks and gaps the corpus asserts. Because the scores are bytes on disk rather
 * than derived at run time, reversing an authored ranking makes exactly one side move — which is the whole
 * point of the separation.
 */
import { VARIANT_CLASSES, type ContrastSet, type Corpus, type VariantClass } from './corpus.js';
import { type DimensionName } from './expectations.js';
import { entryKey, type FixtureFile, type FrozenEntry } from './fixtures.js';

export interface DriftFinding {
  readonly code: string;
  readonly detail: string;
  readonly set_id?: string | undefined;
  readonly variant?: string | undefined;
  readonly dimension?: string | undefined;
}

export interface LiveWorld {
  readonly corpusHash: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly policyHash: string;
  readonly thresholds: Readonly<Record<string, number>>;
  readonly identityRef: string;
  readonly identityVersionId: string;
  readonly promptVersionIds: Readonly<Record<string, string>>;
  readonly promptContentHashes: Readonly<Record<string, string>>;
}

/**
 * Pin drift: the fixture was frozen against a different world than the one now in the repository. Every
 * case here is a REFUSAL with an explicit mismatch, never a silent re-derivation.
 */
export function checkPins(file: FixtureFile, live: LiveWorld): DriftFinding[] {
  const out: DriftFinding[] = [];
  const pins = file.pins;
  const cmp = (code: string, what: string, frozen: unknown, now: unknown) => {
    if (frozen !== now)
      out.push({
        code,
        detail: `${what}: fixture pins ${String(frozen)}, repository has ${String(now)} — regenerate the fixtures and review the diff`,
      });
  };
  // 1 & 2: any corpus change at all — text, rank or gap — changes the corpus hash.
  cmp('CORPUS_DRIFT', 'corpus hash', pins.corpus_hash, live.corpusHash);
  // 3: policy identity and thresholds.
  cmp('POLICY_PIN_MISMATCH', 'policy id', pins.policy_id, live.policyId);
  cmp('POLICY_PIN_MISMATCH', 'policy version', pins.policy_version, live.policyVersion);
  cmp('POLICY_PIN_MISMATCH', 'policy hash', pins.policy_hash, live.policyHash);
  for (const [dimension, frozen] of Object.entries(pins.policy_thresholds)) {
    const now = live.thresholds[dimension];
    if (now !== frozen)
      out.push({
        code: 'POLICY_THRESHOLD_DRIFT',
        detail: `gate threshold for ${dimension}: fixture pins ${frozen}, policy has ${String(now)}`,
        dimension,
      });
  }
  for (const dimension of Object.keys(live.thresholds))
    if (!(dimension in pins.policy_thresholds))
      out.push({
        code: 'POLICY_THRESHOLD_DRIFT',
        detail: `the policy now gates ${dimension}, which the fixtures do not pin`,
        dimension,
      });
  // 5: identity version.
  cmp(
    'IDENTITY_PIN_MISMATCH',
    'narrative identity ref',
    pins.narrative_identity_ref,
    live.identityRef,
  );
  cmp(
    'IDENTITY_PIN_MISMATCH',
    'narrative identity version',
    pins.narrative_identity_version_id,
    live.identityVersionId,
  );
  // 4: prompt families, active version ids and content hashes.
  for (const family of pins.prompt_families) {
    const frozenId = pins.prompt_version_ids[family];
    const nowId = live.promptVersionIds[family];
    if (frozenId !== nowId)
      out.push({
        code: 'PROMPT_PIN_MISMATCH',
        detail: `${family}: fixture pins version ${String(frozenId)}, registry active version is ${String(nowId)}`,
      });
    const frozenHash = pins.prompt_content_hashes[family];
    const nowHash = live.promptContentHashes[family];
    if (frozenHash !== nowHash)
      out.push({
        code: 'PROMPT_CONTENT_DRIFT',
        detail: `${family}: fixture pins content hash ${String(frozenHash)}, registry computes ${String(nowHash)} — a prompt byte changed`,
      });
  }
  for (const family of Object.keys(live.promptVersionIds))
    if (!pins.prompt_families.includes(family))
      out.push({
        code: 'PROMPT_PIN_MISMATCH',
        detail: `the runner now evaluates with ${family}, which the fixtures do not pin`,
      });
  return out;
}

/** 6 & 7: the frozen entry set must match the corpus exactly — no missing, extra or miskeyed entries. */
export function checkCoverage(
  file: FixtureFile,
  corpus: Corpus,
  dimensions: readonly DimensionName[],
  variants: readonly VariantClass[],
): DriftFinding[] {
  const out: DriftFinding[] = [];
  const byKey = new Map<string, FrozenEntry>();
  for (const e of file.entries) byKey.set(entryKey(e.set_id, e.variant, e.dimension), e);
  const required = new Set<string>();
  for (const set of corpus.sets)
    for (const variant of variants)
      for (const dimension of dimensions) {
        const key = entryKey(set.id, variant, dimension);
        required.add(key);
        const entry = byKey.get(key);
        if (!entry) {
          out.push({
            code: 'FIXTURE_ENTRY_MISSING',
            detail: `no frozen fixture for ${key}`,
            set_id: set.id,
            variant,
            dimension,
          });
          continue;
        }
        // 7: the activity key must name exactly this set, variant and dimension. A swapped pair would
        // otherwise replay one text's verdict for another.
        const expectedKey = `activity:contrast:${set.id}:${variant}:${dimension}`;
        if (entry.activity_key !== expectedKey)
          out.push({
            code: 'FIXTURE_WRONG_IDENTITY',
            detail: `fixture ${key} carries activity key ${entry.activity_key}, expected ${expectedKey}`,
            set_id: set.id,
            variant,
            dimension,
          });
        if (entry.claim !== undefined) {
          const named = /\bset (cs-\d+)\b/.exec(entry.claim)?.[1];
          if (named !== undefined && named !== set.id)
            out.push({
              code: 'FIXTURE_WRONG_IDENTITY',
              detail: `fixture ${key} carries a claim naming ${named}`,
              set_id: set.id,
              variant,
              dimension,
            });
        }
      }
  for (const [key, entry] of byKey)
    if (!required.has(key))
      out.push({
        code: 'FIXTURE_ENTRY_EXTRA',
        detail: `frozen fixture ${key} has no corresponding corpus evaluation`,
        set_id: entry.set_id,
        variant: entry.variant,
        dimension: entry.dimension,
      });
  return out;
}

/**
 * 8: the frozen scores must independently satisfy the corpus's authored expectations — the rank orders and
 * the `min_gap_*` values. This is the check that can only be meaningful because the scores are frozen: if a
 * ranking is reversed in the corpus, the fixture no longer satisfies it and the run fails.
 */
export function checkExpectationConsistency(file: FixtureFile, corpus: Corpus): DriftFinding[] {
  const out: DriftFinding[] = [];
  const score = new Map<string, number>();
  for (const e of file.entries) score.set(entryKey(e.set_id, e.variant, e.dimension), e.score);
  const at = (set: ContrastSet, variant: string, dimension: DimensionName) =>
    score.get(entryKey(set.id, variant, dimension));

  for (const set of corpus.sets) {
    for (const [dimension, rank] of [
      ['prose', set.expected.prose_rank],
      ['structure', set.expected.structure_rank],
    ] as const) {
      const scores = rank.map((cls) => ({ cls, score: at(set, cls, dimension) }));
      if (scores.some((s) => s.score === undefined)) continue; // reported by checkCoverage
      // The authored rank is strictly descending in frozen score. A reversed corpus ranking breaks this.
      for (let i = 1; i < scores.length; i++) {
        const prev = scores[i - 1];
        const cur = scores[i];
        if (prev && cur && (prev.score ?? 0) < (cur.score ?? 0))
          out.push({
            code: 'FIXTURE_EXPECTATION_CONFLICT',
            detail: `set ${set.id} ${dimension}_rank places ${prev.cls} above ${cur.cls}, but the frozen scores are ${prev.score} and ${cur.score}`,
            set_id: set.id,
            dimension,
          });
      }
    }
    const kwnProse = at(set, 'kwn_english', 'prose');
    const tlProse = at(set, 'translation_like', 'prose');
    if (kwnProse !== undefined && tlProse !== undefined) {
      const gap = set.expected.min_gap_prose_vs_translation_like;
      if (kwnProse - tlProse < gap)
        out.push({
          code: 'FIXTURE_GAP_CONFLICT',
          detail: `set ${set.id}: corpus requires a prose gap of at least ${gap} between kwn_english and translation_like, frozen scores give ${kwnProse - tlProse}`,
          set_id: set.id,
          dimension: 'prose',
        });
    }
    const kwnStruct = at(set, 'kwn_english', 'structure');
    const weStruct = at(set, 'western_english', 'structure');
    if (kwnStruct !== undefined && weStruct !== undefined) {
      const gap = set.expected.min_gap_structure_vs_western_english;
      if (kwnStruct - weStruct < gap)
        out.push({
          code: 'FIXTURE_GAP_CONFLICT',
          detail: `set ${set.id}: corpus requires a structure gap of at least ${gap} between kwn_english and western_english, frozen scores give ${kwnStruct - weStruct}`,
          set_id: set.id,
          dimension: 'structure',
        });
    }
  }
  // Sanity: every class the corpus defines must be represented, so a shrunken class set is visible here too.
  for (const cls of VARIANT_CLASSES)
    if (!file.entries.some((e) => e.variant === cls))
      out.push({ code: 'FIXTURE_ENTRY_MISSING', detail: `no frozen fixture covers class ${cls}` });
  return out;
}
