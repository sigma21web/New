/**
 * Contrast corpus loading and fail-closed structural validation (B-6-3).
 *
 * The corpus is executable validation data, not stored examples: every rule below is a reason to REFUSE the
 * regression run rather than to skip a record. An unreadable, incomplete or malformed set is a failure, so a
 * corpus that silently shrank can never present as a pass.
 *
 * The five variant classes are authoritative (ADR-0029 "five-class contrast set",
 * docs/02-narrative-identity/05 §7): `literary` is a required class, not an optional extra, and this module
 * never invents a class the corpus does not define.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toNfcText } from '@yeonjae/prose';

export const VARIANT_CLASSES = [
  'kwn_english',
  'western_english',
  'translation_like',
  'literary',
  'weak_serial',
] as const;
export type VariantClass = (typeof VARIANT_CLASSES)[number];

/** The pre-calibration floor the backlog requires (B-6-3). Below this the run fails rather than reports. */
export const MINIMUM_SETS = 40;

/** The four MVP genre profiles ship as data in examples/narrative-profiles/ (ADR-0036, ADR-0043). */
export const MVP_GENRES = ['academy', 'hunter-gate', 'regression', 'romance-fantasy'] as const;
/**
 * Extra corpus coverage beyond the MVP four. `system-progression` is a Beta overlay in the genre catalog
 * (docs/02-narrative-identity/03 "Beta overlays (6)" #5), so it is an additional TEST category here and is
 * never counted as a fifth MVP genre profile.
 */
export const ADDITIONAL_GENRES = ['system-progression'] as const;
export const CORPUS_GENRES = [...MVP_GENRES, ...ADDITIONAL_GENRES].sort();

/** The eight narrative functions the corpus must cover (B-6-3). */
export const NARRATIVE_FUNCTIONS = [
  'action',
  'banter',
  'emotional_beat',
  'ending',
  'exposition',
  'hook',
  'reveal',
  'status_window',
] as const;

export interface ContrastExpectations {
  readonly prose_rank: readonly string[];
  readonly structure_rank: readonly string[];
  readonly min_gap_prose_vs_translation_like: number;
  readonly min_gap_structure_vs_western_english: number;
}

export interface ContrastSet {
  readonly id: string;
  readonly genre: string;
  readonly function: string;
  readonly variants: Readonly<Record<VariantClass, string>>;
  readonly expected: ContrastExpectations;
}

export interface Corpus {
  readonly sets: readonly ContrastSet[];
  /** sha256 over the canonical corpus content — pinned in every result document. */
  readonly hash: string;
  readonly path: string;
}

/** The loose runtime shape validation reads; the declared ContrastSet is what it proves. */
interface RawSet {
  id?: unknown;
  genre?: unknown;
  function?: unknown;
  variants?: Record<string, unknown> | undefined;
  expected?: Record<string, unknown> | undefined;
}

export class CorpusError extends Error {
  constructor(
    readonly code:
      | 'CORPUS_UNREADABLE'
      | 'CORPUS_TOO_SMALL'
      | 'DUPLICATE_SET_ID'
      | 'MISSING_VARIANT'
      | 'UNKNOWN_VARIANT'
      | 'EMPTY_PROSE'
      | 'NOT_NFC'
      | 'PROHIBITED_HANGUL'
      | 'MISSING_EXPECTATION'
      | 'MALFORMED_EXPECTATION'
      | 'MISSING_GENRE_COVERAGE'
      | 'MISSING_FUNCTION_COVERAGE',
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'CorpusError';
  }
}

const HANGUL = /[\uac00-\ud7a3]/u;

export function defaultCorpusPath(): string {
  return fileURLToPath(
    new URL('../../../examples/fixture/contrast-sets.seed.json', import.meta.url),
  );
}

/** sha256 of the exact bytes on disk: the corpus identity every result document pins. */
export function corpusHash(raw: string): string {
  return `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`;
}

export function loadCorpus(path: string = defaultCorpusPath()): Corpus {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new CorpusError('CORPUS_UNREADABLE', `${path}: ${(err as Error).message}`);
  }
  let parsed: { sets?: unknown };
  try {
    parsed = JSON.parse(raw) as { sets?: unknown };
  } catch (err) {
    throw new CorpusError(
      'CORPUS_UNREADABLE',
      `${path} is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed.sets))
    throw new CorpusError('CORPUS_UNREADABLE', `${path} has no \`sets\` array`);
  const sets = parsed.sets as ContrastSet[];
  validateCorpus(sets);
  return { sets, hash: corpusHash(raw), path };
}

/**
 * Every check throws on the FIRST violation with the exact record named. Callers that want a report rather
 * than an exception catch CorpusError — nothing here downgrades a violation to a skip.
 */
export function validateCorpus(input: readonly ContrastSet[]): void {
  // The corpus is untrusted JSON at runtime whatever its declared type says, so validation reads through a
  // loose shape. Anything the declared type promises is exactly what this function must actually verify.
  const sets = input as readonly unknown[] as readonly RawSet[];
  if (sets.length < MINIMUM_SETS)
    throw new CorpusError(
      'CORPUS_TOO_SMALL',
      `the corpus has ${sets.length} sets; B-6-3 requires at least ${MINIMUM_SETS}`,
    );

  const seen = new Set<string>();
  for (const set of sets) {
    if (typeof set.id !== 'string' || set.id.length === 0)
      throw new CorpusError('CORPUS_UNREADABLE', 'a set has no id');
    if (seen.has(set.id))
      throw new CorpusError('DUPLICATE_SET_ID', `set id ${set.id} appears twice`);
    seen.add(set.id);

    const variants: Record<string, unknown> = set.variants ?? {};
    for (const cls of VARIANT_CLASSES) {
      const text = variants[cls];
      if (text === undefined)
        throw new CorpusError('MISSING_VARIANT', `set ${set.id} has no ${cls} variant`);
      if (typeof text !== 'string' || text.trim().length === 0)
        throw new CorpusError('EMPTY_PROSE', `set ${set.id} variant ${cls} has no prose`);
      if (toNfcText(text).text !== text)
        throw new CorpusError(
          'NOT_NFC',
          `set ${set.id} variant ${cls} is not NFC-normalized (ADR-0030)`,
        );
      // Manuscript-language variants are English by construction; Hangul here would mean translated or
      // pasted source text, which ADR-0026 forbids in reader-facing prose.
      if (HANGUL.test(text))
        throw new CorpusError(
          'PROHIBITED_HANGUL',
          `set ${set.id} variant ${cls} contains Hangul; corpus prose is English (ADR-0026)`,
        );
    }
    for (const key of Object.keys(variants)) {
      if (!(VARIANT_CLASSES as readonly string[]).includes(key))
        throw new CorpusError('UNKNOWN_VARIANT', `set ${set.id} declares unknown variant ${key}`);
    }

    const expected = set.expected;
    if (!expected)
      throw new CorpusError('MISSING_EXPECTATION', `set ${set.id} has no expectations`);
    for (const key of ['prose_rank', 'structure_rank'] as const) {
      const rank = expected[key];
      if (!Array.isArray(rank))
        throw new CorpusError('MISSING_EXPECTATION', `set ${set.id} has no ${key}`);
      if (rank.length !== VARIANT_CLASSES.length || new Set(rank).size !== rank.length)
        throw new CorpusError(
          'MALFORMED_EXPECTATION',
          `set ${set.id} ${key} must rank each of the ${VARIANT_CLASSES.length} classes exactly once`,
        );
      for (const cls of rank as unknown[])
        if (typeof cls !== 'string' || !(VARIANT_CLASSES as readonly string[]).includes(cls))
          throw new CorpusError(
            'MALFORMED_EXPECTATION',
            `set ${set.id} ${key} names unknown class ${JSON.stringify(cls)}`,
          );
    }
    for (const key of [
      'min_gap_prose_vs_translation_like',
      'min_gap_structure_vs_western_english',
    ] as const) {
      const gap = expected[key];
      if (typeof gap !== 'number' || !Number.isFinite(gap))
        throw new CorpusError('MISSING_EXPECTATION', `set ${set.id} has no numeric ${key}`);
    }
  }

  // Coverage: every genre and every narrative function the corpus claims must actually be present.
  const genres = new Set(sets.map((s) => s.genre));
  for (const genre of CORPUS_GENRES)
    if (!genres.has(genre))
      throw new CorpusError('MISSING_GENRE_COVERAGE', `no set covers genre ${genre}`);
  const functions = new Set(sets.map((s) => s.function));
  for (const fn of NARRATIVE_FUNCTIONS)
    if (!functions.has(fn))
      throw new CorpusError('MISSING_FUNCTION_COVERAGE', `no set covers narrative function ${fn}`);
}
