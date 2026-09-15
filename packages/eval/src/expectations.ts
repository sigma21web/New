/**
 * Expected dimension outcomes per variant class (B-6-3), derived from the corpus's own authoritative
 * expectations and the pinned Production Policy thresholds — never from hardcoded numbers (ADR-0041).
 *
 * The separation rule (EVAL-SEPARATION-001) is the point of the whole corpus and is encoded literally here:
 * English prose quality (dimension A) and Korean-webnovel serialized structure (dimension B) are judged and
 * expected INDEPENDENTLY. A fluently written Western-epic chapter is good English and bad webnovel
 * structure; a calqued sentence is bad English regardless of how the beats are shaped.
 *
 * The corpus header states the contract this module implements: "Judges must rank kwn_english highest on
 * BOTH prose (A) and structure (B); western_english must fail B while passing A; translation_like must fail
 * A; literary must fail B and score low-mid on A; weak_serial must fail B."
 */
import { type VariantClass } from './corpus.js';

export type DimensionName = 'prose' | 'structure' | 'genre' | 'voice';

/** What a variant class must do on a gated dimension. `any` = the corpus states no expectation. */
export type Expectation = 'pass' | 'fail' | 'any';

export interface ClassExpectation {
  readonly prose: Expectation;
  readonly structure: Expectation;
  /** Why the class is expected to fail, in the corpus's own terms — reported on every disagreement. */
  readonly rationale: string;
}

/**
 * Per-class expectations. Note what is deliberately NOT asserted:
 *   - `translation_like` fails PROSE only. Its beats are the webnovel beats; failing it on structure too
 *     would reward conflating "bad English" with "bad structure", which is the exact confusion the
 *     separation rule exists to prevent.
 *   - `western_english` passes PROSE. It is fluent, grammatical English; penalising its prose would mean
 *     the system was rewarding the Korean-webnovel register for its own sake rather than for structure.
 *   - `weak_serial` may stay grammatically fluent, so no prose expectation is asserted; it must fail
 *     structure, where hook/payoff/escalation/cadence live.
 *   - genre and voice carry no per-class expectation: the corpus states none, and inventing one would
 *     manufacture agreement. They are observed and reported separately (requirement: genre and voice
 *     results remain separate from prose and structure).
 */
export const CLASS_EXPECTATIONS: Readonly<Record<VariantClass, ClassExpectation>> = {
  kwn_english: {
    prose: 'pass',
    structure: 'pass',
    rationale:
      'the positive target: natural idiomatic English AND Korean-webnovel serialized structure both hold',
  },
  western_english: {
    prose: 'pass',
    structure: 'fail',
    rationale:
      'fluent English, but Western-novel pacing: late hook, deferred payoff, no escalation cadence (ST-HOOK-01/ST-OPEN-01)',
  },
  translation_like: {
    prose: 'fail',
    structure: 'any',
    rationale:
      'calqued English — article omission, wrong prepositions, transliterated idiom (TRN-01/TRN-02/TRN-14); structure is NOT expected to fail with it',
  },
  literary: {
    prose: 'any',
    structure: 'fail',
    rationale:
      'over-written literary register: essayistic interiority and long paragraphs displace the serialized beat (EP-LEN-01/EP-LEN-03/ST-HOOK-01)',
  },
  weak_serial: {
    prose: 'any',
    structure: 'fail',
    rationale:
      'grammatical but serially inert: weak or absent hook, no local payoff, flat ending (ST-HOOK-01/ST-END-01/ST-PAY-01)',
  },
};

/** Dimensions the corpus states expectations for. Genre and voice are observed, never expected, here. */
export const EXPECTED_DIMENSIONS = ['prose', 'structure'] as const;
/** Dimensions recorded for separation evidence but not scored for agreement. */
export const OBSERVED_ONLY_DIMENSIONS = ['genre', 'voice'] as const;
export const ALL_DIMENSIONS = [...EXPECTED_DIMENSIONS, ...OBSERVED_ONLY_DIMENSIONS] as const;

export function expectationFor(cls: VariantClass, dimension: DimensionName): Expectation {
  if (dimension === 'prose') return CLASS_EXPECTATIONS[cls].prose;
  if (dimension === 'structure') return CLASS_EXPECTATIONS[cls].structure;
  return 'any';
}

/**
 * Agreement classification for one (variant, dimension) observation.
 *
 * "Positive" is the product claim "this text is acceptable on this dimension":
 *   - false positive = expected fail, observed pass — the judge waved through Western drift, a calque or
 *     inert serial prose. This is the dangerous direction.
 *   - false negative = expected pass, observed fail — the judge rejected the positive target or penalised
 *     fluent English for not being Korean-flavoured.
 */
export type Agreement = 'agree' | 'false_positive' | 'false_negative' | 'not_asserted';

export function classify(expected: Expectation, observedPassed: boolean): Agreement {
  if (expected === 'any') return 'not_asserted';
  if (expected === 'pass') return observedPassed ? 'agree' : 'false_negative';
  return observedPassed ? 'false_positive' : 'agree';
}
