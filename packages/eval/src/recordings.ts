/**
 * Fixture DERIVATION — used only by `pnpm generate:contrast-recordings` (maintainer-only).
 *
 * Nothing in the validation path imports this module. `pnpm validate:contrast` loads frozen bytes from
 * packages/eval/fixtures/ via fixtures.ts and never recomputes a score: deriving expected judge output at
 * validation time was the circularity this split removes, because the recording then moved together with
 * the expectation it was being compared against.
 *
 * Scores for prose and structure are RANK-DRIVEN from each set's own authored `*_rank` and `min_gap_*`, so
 * a proposal honours the corpus as authored rather than imposing one fixed per-class curve (the corpus does
 * not use a single order for every set). Genre and voice have their own independent curves, so a genre or
 * register verdict is never a restatement of the structure verdict.
 *
 * Output is PROPOSED fixture data: reviewed synthetic replay fixtures, not recorded model judgments and not
 * calibration evidence (ADR-0029). Live judge calibration is B-4-5 and has not happened.
 */
import { createHash } from 'node:crypto';
import { type Recording } from '@yeonjae/gateway';
import { type ContrastSet, type VariantClass } from './corpus.js';
import { type DimensionName } from './expectations.js';

/** A stable small integer in [0, span) derived from a key — jitter that is reproducible, never random. */
function spread(key: string, span: number): number {
  const hex = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 8);
  return parseInt(hex, 16) % span;
}

export interface ScoreInputs {
  readonly set: ContrastSet;
  readonly variant: VariantClass;
  readonly dimension: DimensionName;
  /** The pinned gate for this dimension, from the Production Policy (ADR-0041). */
  readonly threshold: number;
}

/**
 * The score a variant receives on a dimension.
 *
 * Passing scores sit above the pinned threshold; failing scores sit below it by at least the set's own
 * authored gap where the corpus states one, so `min_gap_prose_vs_translation_like` and
 * `min_gap_structure_vs_western_english` are honoured by construction rather than asserted by coincidence.
 */
export function scoreFor(input: ScoreInputs): number {
  const { set, variant, dimension, threshold } = input;

  // prose and structure are RANK-DRIVEN: the set's own authored rank order decides the ordering of every
  // class, and the authored `min_gap_*` decides how far the named pair must be apart. A fixed per-class
  // curve cannot do this, because the corpus does not use one order for every set (36 sets rank literary
  // above weak_serial on prose, 4 rank it below; 39 rank literary above western_english on structure,
  // 1 ranks it below). Deriving from the rank is what lets the frozen fixtures satisfy the corpus.
  if (dimension === 'prose' || dimension === 'structure') {
    const rank = dimension === 'prose' ? set.expected.prose_rank : set.expected.structure_rank;
    const gap =
      dimension === 'prose'
        ? set.expected.min_gap_prose_vs_translation_like
        : set.expected.min_gap_structure_vs_western_english;
    // The class the authored gap is measured against, and which classes must clear the gate.
    const gapPartner = dimension === 'prose' ? 'translation_like' : 'western_english';
    // Classes the separation rule requires to clear their gate. NOTE on prose: only kwn_english and
    // western_english are listed. `weak_serial` is NOT, because the corpus's own authored prose rank puts
    // `literary` above `weak_serial` in 36 of 40 sets while requiring `literary` to score only low-mid —
    // so in those sets the authored ranking itself places weak_serial below the prose gate. The corpus
    // rank is authoritative over any intuition that "serially inert prose is still fluent", and the
    // corpus asserts no prose expectation for weak_serial (`any`), so nothing is being waved through.
    const mustPass: readonly string[] =
      dimension === 'prose'
        ? ['kwn_english', 'western_english']
        : ['kwn_english', 'translation_like'];

    const top = Math.min(96, threshold + 9 + spread(`${set.id}|${dimension}|top`, 4));
    const bottom = Math.max(2, top - gap);
    const position = rank.indexOf(variant);
    const partnerPosition = rank.indexOf(gapPartner);
    if (position < 0) return bottom;

    // Place the ranked classes on a strictly descending ladder from `top` down to `bottom`, so the
    // authored order holds exactly and the named pair is at least `gap` apart.
    const last = rank.length - 1;
    const span = top - bottom;
    const step = span / Math.max(1, last);
    let score = Math.round(top - step * position);

    // The gap partner sits at or below `top - gap`, whatever its rank position.
    if (variant === gapPartner) score = Math.min(score, bottom);
    // Classes the separation rule requires to clear their gate must not be dragged under it by the
    // ladder; classes it requires to fail must not be lifted over it.
    if (mustPass.includes(variant)) score = Math.max(score, threshold + 2);
    else if (partnerPosition >= 0) score = Math.min(score, threshold - 2);

    // Re-assert strict descent against the class ranked immediately above, so no two classes tie and the
    // authored order is never violated by the clamps above.
    if (position > 0) {
      const above = rank[position - 1];
      if (above !== undefined) {
        const aboveScore = scoreFor({ ...input, variant: above as VariantClass });
        if (score >= aboveScore) score = aboveScore - 1;
      }
    }
    return Math.max(1, Math.min(99, score));
  }

  const jitter = spread(`${set.id}|${variant}|${dimension}`, 5);
  if (dimension === 'genre') {
    switch (variant) {
      case 'kwn_english':
        return Math.min(95, threshold + 12 + jitter);
      // Western-epic framing loses the genre's reader fantasy and devices.
      case 'western_english':
        return Math.max(1, threshold - 16 - jitter);
      // The calque still delivers the genre's devices and vocabulary — bad English, right genre.
      case 'translation_like':
        return Math.min(93, threshold + 7 + jitter);
      // Literary interiority displaces the genre devices.
      case 'literary':
        return Math.max(1, threshold - 12 - jitter);
      // Serially inert prose still uses the genre furniture; genre fit is not what it fails.
      case 'weak_serial':
        return Math.min(90, threshold + 3 + jitter);
    }
  }

  // voice: dialogue register and character distinguishability — independent of pacing and of grammar.
  switch (variant) {
    case 'kwn_english':
      return Math.min(95, threshold + 11 + jitter);
    // Fluent Western prose flattens the register hierarchy into neutral literary dialogue.
    case 'western_english':
      return Math.max(1, threshold - 13 - jitter);
    // The calque's register CHOICES are right even where its grammar is wrong.
    case 'translation_like':
      return Math.min(92, threshold + 6 + jitter);
    // Essayistic narration absorbs the characters' distinct voices.
    case 'literary':
      return Math.max(1, threshold - 15 - jitter);
    // Inert beats, but the voices stay distinguishable.
    case 'weak_serial':
      return Math.min(89, threshold + 2 + jitter);
  }
}

/** Concrete, class-specific issues — the "for reasons" half of the expectation. */
function issuesFor(
  set: ContrastSet,
  variant: VariantClass,
  dimension: DimensionName,
): Record<string, unknown>[] {
  if (dimension === 'prose') {
    if (variant === 'translation_like')
      return [
        {
          kind: 'translation_like_english',
          severity: 'major',
          confidence: 0.93,
          claim: `set ${set.id}: calqued English — omitted articles, transferred prepositions and transliterated idiom (TRN-01, TRN-02, TRN-14).`,
        },
      ];
    if (variant === 'literary')
      return [
        {
          kind: 'literary_drift',
          severity: 'major',
          confidence: 0.86,
          claim: `set ${set.id}: essayistic register and over-long paragraphs displace the scene (EP-LEN-01, EP-LEN-03).`,
        },
      ];
    return [];
  }
  if (dimension === 'genre') {
    if (variant === 'western_english')
      return [
        {
          kind: 'western_novel_drift',
          severity: 'major',
          confidence: 0.87,
          claim: `set ${set.id}: the ${set.genre} reader fantasy and its devices are replaced by Western-epic framing.`,
        },
      ];
    if (variant === 'literary')
      return [
        {
          kind: 'literary_drift',
          severity: 'major',
          confidence: 0.82,
          claim: `set ${set.id}: interiority displaces the ${set.genre} devices the ${set.function} beat needs.`,
        },
      ];
    return [];
  }
  if (dimension === 'voice') {
    if (variant === 'western_english')
      return [
        {
          kind: 'voice_drift',
          severity: 'major',
          confidence: 0.85,
          claim: `set ${set.id}: the register hierarchy flattens into neutral literary dialogue; speakers stop being distinguishable.`,
        },
      ];
    if (variant === 'literary')
      return [
        {
          kind: 'register_error',
          severity: 'major',
          confidence: 0.8,
          claim: `set ${set.id}: essayistic narration absorbs the characters' distinct voices.`,
        },
      ];
    return [];
  }
  if (variant === 'western_english')
    return [
      {
        kind: 'western_novel_drift',
        severity: 'major',
        confidence: 0.9,
        claim: `set ${set.id}: Western-novel pacing — the hook arrives after the scene-setting and the ${set.function} beat is deferred (ST-HOOK-01, ST-OPEN-01).`,
      },
    ];
  if (variant === 'weak_serial')
    return [
      {
        kind: 'weak_ending',
        severity: 'major',
        confidence: 0.88,
        claim: `set ${set.id}: the ${set.function} beat has no local payoff and the ending does not pull forward (ST-PAY-01, ST-END-01).`,
      },
    ];
  if (variant === 'literary')
    return [
      {
        kind: 'serial_drift',
        severity: 'major',
        confidence: 0.84,
        claim: `set ${set.id}: interiority replaces escalation; the serialized cadence stalls (ST-HOOK-01).`,
      },
    ];
  return [];
}

function driftFlags(variant: VariantClass, dimension: DimensionName): string[] {
  if (dimension !== 'prose') return [];
  if (variant === 'translation_like') return ['translation_like'];
  if (variant === 'literary') return ['literary'];
  return [];
}

/** The activity id a contrast evaluation uses. Deterministic and unique per (set, variant, dimension). */
export function activityIdFor(
  setId: string,
  variant: VariantClass,
  dimension: DimensionName,
): string {
  return `contrast:${setId}:${variant}:${dimension}`;
}

export interface RecordingInputs {
  readonly set: ContrastSet;
  readonly variant: VariantClass;
  readonly dimension: DimensionName;
  readonly threshold: number;
}

export function recordingFor(input: RecordingInputs): Recording {
  const score = scoreFor(input);
  const { set, variant, dimension } = input;
  const json: Record<string, unknown> = {
    judge_score: score,
    drift_flags: driftFlags(variant, dimension),
    issues: issuesFor(set, variant, dimension),
  };
  if (dimension === 'structure') {
    // Structure evidence is concrete: where the hook lands and whether the beat pays off locally.
    const strong = variant === 'kwn_english' || variant === 'translation_like';
    json.hook_sentence_index = strong ? 1 : spread(`${set.id}|${variant}|hook`, 6) + 6;
    json.local_payoff_present = strong;
    json.ending_type_detected = strong ? 'forward_pull' : 'flat_close';
  }
  return {
    json,
    modelId: 'replay-model',
    usage: { input: 1000, output: 400, cached: 0 },
  };
}

/**
 * The full recording table for a corpus: one entry per (set, variant, dimension). Keyed by activity id, the
 * same key space the workflow replay fixtures use, so ReplayProvider resolves them with no special case.
 */
export function recordingsFor(
  sets: readonly ContrastSet[],
  thresholds: Readonly<Record<DimensionName, number>>,
  dimensions: readonly DimensionName[],
  variants: readonly VariantClass[],
): Map<string, Recording> {
  const table = new Map<string, Recording>();
  for (const set of sets) {
    for (const variant of variants) {
      for (const dimension of dimensions) {
        const threshold = thresholds[dimension];
        table.set(
          `activity:${activityIdFor(set.id, variant, dimension)}`,
          recordingFor({ set, variant, dimension, threshold }),
        );
      }
    }
  }
  return table;
}
