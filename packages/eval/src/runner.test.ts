/**
 * B-6-3 proofs for the deterministic contrast regression runner: the corpus is executable validation data,
 * every fail-closed rule refuses rather than skips, the separation rule holds per dimension, and two runs
 * produce byte-identical documents.
 *
 * These prove deterministic fixture agreement and replay integrity. They are NOT live judge calibration and
 * say nothing about how a real model scores (ADR-0029).
 */
import { describe, expect, it } from 'vitest';
import { type Recording } from '@yeonjae/gateway';
import {
  CorpusError,
  CORPUS_GENRES,
  MINIMUM_SETS,
  MVP_GENRES,
  NARRATIVE_FUNCTIONS,
  VARIANT_CLASSES,
  activityIdFor,
  loadCorpus,
  recordingsFor,
  runContrastRegression,
  validateCorpus,
  type ContrastSet,
  type DimensionName,
  type VariantClass,
} from './index.js';

const CORPUS = loadCorpus();
const THRESHOLDS: Record<DimensionName, number> = {
  prose: 78,
  structure: 78,
  genre: 72,
  voice: 76,
};
const ALL: readonly DimensionName[] = ['prose', 'structure', 'genre', 'voice'];

/** A deep copy so a mutation in one case cannot leak into another. */
function corpusCopy(): ContrastSet[] {
  return JSON.parse(JSON.stringify(CORPUS.sets)) as ContrastSet[];
}

function recordings(sets: readonly ContrastSet[]): Map<string, Recording> {
  return recordingsFor(sets, THRESHOLDS, ALL, VARIANT_CLASSES);
}

describe('contrast corpus (B-6-3)', () => {
  it('loads 40 five-class sets covering every genre and narrative function', () => {
    expect(CORPUS.sets.length).toBeGreaterThanOrEqual(MINIMUM_SETS);
    expect(CORPUS.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    for (const set of CORPUS.sets)
      expect(Object.keys(set.variants).sort()).toEqual([...VARIANT_CLASSES].sort());
    expect([...new Set(CORPUS.sets.map((s) => s.genre))].sort()).toEqual([...CORPUS_GENRES]);
    expect([...new Set(CORPUS.sets.map((s) => s.function))].sort()).toEqual([
      ...NARRATIVE_FUNCTIONS,
    ]);
  });

  it('classifies system-progression as extra coverage, not a fifth MVP genre profile', () => {
    // The genre catalog lists it under "Beta overlays (6)"; the MVP four ship as profile data.
    expect(MVP_GENRES).toHaveLength(4);
    expect(MVP_GENRES).not.toContain('system-progression');
    expect(CORPUS_GENRES).toContain('system-progression');
  });

  it.each([
    [
      'a corpus below the required minimum',
      (s: ContrastSet[]) => s.slice(0, 3),
      'CORPUS_TOO_SMALL',
    ],
    [
      'a duplicate set id',
      (s: ContrastSet[]) => [...s, { ...s[0] } as ContrastSet],
      'DUPLICATE_SET_ID',
    ],
    [
      'a missing required variant',
      (s: ContrastSet[]) => {
        delete (s[0] as { variants: Record<string, string> }).variants.literary;
        return s;
      },
      'MISSING_VARIANT',
    ],
    [
      'empty prose',
      (s: ContrastSet[]) => {
        (s[0] as { variants: Record<string, string> }).variants.kwn_english = '   ';
        return s;
      },
      'EMPTY_PROSE',
    ],
    [
      'non-NFC text',
      (s: ContrastSet[]) => {
        // Decomposed é: NFC would compose it, so this is a real normalization violation (ADR-0030).
        (s[0] as { variants: Record<string, string> }).variants.kwn_english = 'cafe\u0301 scene';
        return s;
      },
      'NOT_NFC',
    ],
    [
      'prohibited Hangul in English-only prose',
      (s: ContrastSet[]) => {
        (s[0] as { variants: Record<string, string> }).variants.kwn_english = '게이트가 열렸다.';
        return s;
      },
      'PROHIBITED_HANGUL',
    ],
    [
      'a missing expectation',
      (s: ContrastSet[]) => {
        delete (s[0] as { expected: Record<string, unknown> }).expected.prose_rank;
        return s;
      },
      'MISSING_EXPECTATION',
    ],
    [
      'a malformed rank that does not cover every class',
      (s: ContrastSet[]) => {
        (s[0] as { expected: Record<string, unknown> }).expected.prose_rank = ['kwn_english'];
        return s;
      },
      'MALFORMED_EXPECTATION',
    ],
    [
      // Re-labelled rather than removed, so the corpus stays at full size and the COVERAGE rule is what
      // fires — not the size rule.
      'missing genre coverage',
      (s: ContrastSet[]) =>
        s.map((x) => (x.genre === 'academy' ? { ...x, genre: 'hunter-gate' } : x)),
      'MISSING_GENRE_COVERAGE',
    ],
    [
      'missing narrative-function coverage',
      (s: ContrastSet[]) =>
        s.map((x) => (x.function === 'status_window' ? { ...x, function: 'hook' } : x)),
      'MISSING_FUNCTION_COVERAGE',
    ],
  ])('refuses %s', (_label, mutate, code) => {
    const sets = mutate(corpusCopy());
    // A violation throws with the exact code; it is never downgraded to a skipped record.
    try {
      validateCorpus(sets);
      throw new Error('expected validateCorpus to refuse');
    } catch (err) {
      expect(err).toBeInstanceOf(CorpusError);
      expect((err as CorpusError).code).toBe(code);
    }
  });

  it('refuses an unreadable corpus path rather than reporting an empty pass', () => {
    expect(() => loadCorpus('/nonexistent/contrast.json')).toThrow(CorpusError);
  });
});

describe('contrast regression runner (B-6-3)', () => {
  it('executes every set × variant × dimension with full agreement and no skips', async () => {
    const report = await runContrastRegression();
    expect(report.status).toBe('passed');
    expect(report.totals.evaluations_expected).toBe(CORPUS.sets.length * 5 * 4);
    expect(report.totals.evaluations_executed).toBe(report.totals.evaluations_expected);
    expect(report.totals.evaluations_skipped).toBe(0);
    expect(report.totals.false_positives).toBe(0);
    expect(report.totals.false_negatives).toBe(0);
    expect(report.totals.agreements).toBe(report.totals.assertions);
    expect(report.failures).toEqual([]);
    expect(report.missing_recordings).toEqual([]);
    expect(report.malformed_verdicts).toEqual([]);
  }, 120_000);

  it('records the provenance every result must be reproducible from', async () => {
    const report = await runContrastRegression();
    expect(report.pins.corpus_hash).toBe(CORPUS.hash);
    expect(report.pins.production_policy_version).toBe('policy/standard@1');
    expect(report.pins.provider).toBe('replay');
    // Immutable, content-hashed prompt versions — one family per dimension.
    expect(Object.keys(report.pins.prompt_versions).sort()).toEqual([
      'genre_judge',
      'prose_judge',
      'structure_judge',
      'voice_judge',
    ]);
    for (const hash of Object.values(report.pins.prompt_hashes))
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const first = report.results[0];
    // The model id comes from the pinned routing table, not from the recording.
    expect(first).toMatchObject({ provider: 'replay', model_id: 'replay-m' });
    expect(first?.recording_key).toMatch(/^activity:contrast:/);
    expect(first?.recording_hash).toMatch(/^sha256:/);
    expect(first?.prompt_hash).toMatch(/^sha256:/);
  }, 120_000);

  it('is idempotent: two runs produce byte-identical documents and the same result hash', async () => {
    const a = await runContrastRegression();
    const b = await runContrastRegression();
    expect(b.result_hash).toBe(a.result_hash);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 240_000);

  it('orders results deterministically by set, then class, then dimension', async () => {
    const report = await runContrastRegression();
    const keys = report.results.map((r) => `${r.set_id}|${r.variant}|${r.dimension}`);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate evaluation
    expect(keys.slice(0, 4)).toEqual([
      `${CORPUS.sets[0]?.id}|kwn_english|prose`,
      `${CORPUS.sets[0]?.id}|kwn_english|structure`,
      `${CORPUS.sets[0]?.id}|kwn_english|genre`,
      `${CORPUS.sets[0]?.id}|kwn_english|voice`,
    ]);
  }, 120_000);

  /**
   * The substantive claim of the corpus: the four dimensions are judged independently. Each row asserts
   * what the class must do AND what it must not be penalised for.
   */
  it.each([
    ['kwn_english', { prose: true, structure: true, genre: true, voice: true }],
    // Fluent English, Western pacing: good prose, bad structure. Prose is not penalised for register.
    ['western_english', { prose: true, structure: false, genre: false, voice: false }],
    // Calqued English keeping the webnovel beats: bad prose only. Structure is NOT dragged down with it.
    ['translation_like', { prose: false, structure: true, genre: true, voice: true }],
    ['literary', { prose: false, structure: false, genre: false, voice: false }],
    // Serially inert: fails structure, keeps genre fit and voice. Prose is NOT asserted as passing — the
    // corpus's own prose_rank places `literary` above `weak_serial` in 36 of 40 sets while requiring
    // literary to score only low-mid, so the authored ranking itself puts weak_serial below the prose
    // gate. The corpus asserts no prose expectation for this class (`any`), so nothing is waved through.
    ['weak_serial', { structure: false, genre: true, voice: true }],
  ] as const)(
    '%s keeps its dimensions separate across every set',
    async (variant, expectations) => {
      const report = await runContrastRegression();
      for (const [dimension, shouldPass] of Object.entries(expectations)) {
        const rows = report.results.filter(
          (r) => r.variant === variant && r.dimension === dimension,
        );
        expect(rows).toHaveLength(CORPUS.sets.length);
        expect(rows.every((r) => r.observed_passed === shouldPass)).toBe(true);
      }
    },
    240_000,
  );

  it('reports concrete, dimension-specific reasons rather than one generic verdict', async () => {
    const report = await runContrastRegression();
    const kinds = (variant: VariantClass, dimension: DimensionName) =>
      new Set(
        report.results
          .filter((r) => r.variant === variant && r.dimension === dimension)
          .flatMap((r) => r.issue_kinds),
      );
    expect(kinds('translation_like', 'prose')).toEqual(new Set(['translation_like_english']));
    // The calque's structure verdict carries no issue at all: nothing structural is wrong with it.
    expect(kinds('translation_like', 'structure')).toEqual(new Set());
    expect(kinds('western_english', 'structure')).toEqual(new Set(['western_novel_drift']));
    expect(kinds('weak_serial', 'structure')).toEqual(new Set(['weak_ending']));
    // weak_serial is not accused of bad grammar.
    expect(kinds('weak_serial', 'prose')).toEqual(new Set());
    expect(kinds('western_english', 'voice')).toEqual(new Set(['voice_drift']));
    expect(kinds('kwn_english', 'prose')).toEqual(new Set());
  }, 120_000);

  it('honours each set’s own authored gap between the positive target and the calque', async () => {
    const report = await runContrastRegression();
    for (const set of CORPUS.sets) {
      const at = (variant: string) =>
        report.results.find(
          (r) => r.set_id === set.id && r.variant === variant && r.dimension === 'prose',
        )?.observed_score ?? 0;
      expect(at('kwn_english') - at('translation_like')).toBeGreaterThanOrEqual(
        set.expected.min_gap_prose_vs_translation_like,
      );
    }
  }, 120_000);
});

describe('contrast runner fail-closed behaviour (B-6-3)', () => {
  it('fails on a missing replay recording instead of calling a live provider', async () => {
    const table = recordings(CORPUS.sets);
    const victim = `activity:${activityIdFor(CORPUS.sets[0]?.id ?? '', 'kwn_english', 'prose')}`;
    table.delete(victim);
    const report = await runContrastRegression({ recordings: table });
    expect(report.status).toBe('failed');
    expect(report.missing_recordings).toContain(victim);
    expect(report.totals.evaluations_executed).toBeLessThan(report.totals.evaluations_expected);
    expect(report.totals.evaluations_skipped).toBeGreaterThan(0);
  }, 120_000);

  it.each([
    ['a malformed verdict that is not an object', { json: 'not an object' }, 'MALFORMED_VERDICT'],
    [
      'a verdict with no score',
      { json: { drift_flags: [], issues: [] } },
      'MISSING_REQUIRED_SCORE',
    ],
    [
      'a verdict whose score is out of range',
      { json: { judge_score: 140, issues: [] } },
      'MISSING_REQUIRED_SCORE',
    ],
    [
      'a schema-invalid verdict whose issues are not an array',
      { json: { judge_score: 90, issues: 'nope' } },
      'MALFORMED_VERDICT',
    ],
    [
      'an issue with no kind',
      { json: { judge_score: 90, issues: [{ claim: 'x' }] } },
      'MALFORMED_VERDICT',
    ],
    [
      'a verdict naming a different contrast set',
      {
        json: {
          judge_score: 90,
          issues: [{ kind: 'translation_like_english', claim: 'set cs-039: wrong text scored' }],
        },
      },
      'WRONG_VARIANT_IDENTITY',
    ],
  ])(
    'fails on %s',
    async (_label, recording, code) => {
      const table = recordings(CORPUS.sets);
      const key = `activity:${activityIdFor(CORPUS.sets[0]?.id ?? '', 'kwn_english', 'prose')}`;
      table.set(key, recording);
      const report = await runContrastRegression({ recordings: table });
      expect(report.status).toBe('failed');
      expect(report.failures.map((f) => f.code)).toContain(code);
      const failure = report.failures.find((f) => f.code === code);
      expect(failure).toMatchObject({ set_id: CORPUS.sets[0]?.id, variant: 'kwn_english' });
    },
    120_000,
  );

  it('fails on an expectation mismatch and names the disagreement concretely', async () => {
    const table = recordings(CORPUS.sets);
    // The positive target scored below its gate: a false negative, the judge rejecting good KWN English.
    const key = `activity:${activityIdFor(CORPUS.sets[0]?.id ?? '', 'kwn_english', 'prose')}`;
    table.set(key, { json: { judge_score: 10, drift_flags: [], issues: [] } });
    // Western drift waved through on structure: a false positive, the dangerous direction.
    const key2 = `activity:${activityIdFor(CORPUS.sets[1]?.id ?? '', 'western_english', 'structure')}`;
    table.set(key2, { json: { judge_score: 99, drift_flags: [], issues: [] } });

    const report = await runContrastRegression({ recordings: table });
    expect(report.status).toBe('failed');
    expect(report.totals.false_negatives).toBe(1);
    expect(report.totals.false_positives).toBe(1);
    expect(report.disagreements).toHaveLength(2);
    expect(report.disagreements[0]?.disagreement).toContain('expected pass');
    expect(report.disagreements[1]?.disagreement).toContain('expected fail');
    // Aggregates stay consistent with the per-row classification.
    expect(report.by_variant.kwn_english?.false_negatives).toBe(1);
    expect(report.by_variant.western_english?.false_positives).toBe(1);
    expect(report.by_dimension.prose?.false_negatives).toBe(1);
    expect(report.by_dimension.structure?.false_positives).toBe(1);
  }, 120_000);

  it('classifies false positives and false negatives stably across repeated runs', async () => {
    const table = recordings(CORPUS.sets);
    table.set(`activity:${activityIdFor(CORPUS.sets[2]?.id ?? '', 'weak_serial', 'structure')}`, {
      json: { judge_score: 97, drift_flags: [], issues: [] },
    });
    const a = await runContrastRegression({ recordings: table });
    const b = await runContrastRegression({ recordings: table });
    expect(a.result_hash).toBe(b.result_hash);
    expect(a.totals.false_positives).toBe(1);
    expect(b.totals.false_positives).toBe(1);
  }, 240_000);

  it('aggregates per genre and per narrative function over the whole corpus', async () => {
    const report = await runContrastRegression();
    expect(Object.keys(report.by_genre).sort()).toEqual([...CORPUS_GENRES]);
    expect(Object.keys(report.by_function).sort()).toEqual([...NARRATIVE_FUNCTIONS]);
    const totalAgreements = Object.values(report.by_genre).reduce((n, g) => n + g.agreements, 0);
    expect(totalAgreements).toBe(report.totals.agreements);
    const byFn = Object.values(report.by_function).reduce((n, g) => n + g.agreements, 0);
    expect(byFn).toBe(report.totals.agreements);
  }, 120_000);

  it('never reports calibrated thresholds, whatever the agreement rate', async () => {
    const report = await runContrastRegression();
    expect(report.calibration_status).toBe('uncalibrated');
    expect(report.scope).toContain('NOT live judge calibration');
  }, 120_000);
});
