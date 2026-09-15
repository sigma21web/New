/**
 * Mutation proofs that the frozen fixture baseline is INDEPENDENT (B-6-3 follow-up).
 *
 * The earlier runner generated its recordings from the corpus's own expectations and then compared them
 * against those same expectations, so agreement was guaranteed by construction: reversing an authored
 * ranking moved both sides and still reported 100%. Every test below mutates exactly one side — the corpus,
 * the policy, the prompt identity or the fixture entry set — WITHOUT regenerating the fixtures, and proves
 * the validation run fails.
 *
 * These prove baseline independence and replay integrity. They are not calibration (ADR-0029).
 */
import { describe, expect, it } from 'vitest';
import {
  fixtureHashFor,
  loadCorpus,
  loadFixtures,
  runContrastRegression,
  type ContrastSet,
  type Corpus,
  type FixtureFile,
  type FrozenEntry,
} from './index.js';

const CORPUS = loadCorpus();
const FIXTURES = loadFixtures();

/** A corpus whose sets are mutated in place, with the hash recomputed the way a real edit would. */
function mutatedCorpus(mutate: (sets: ContrastSet[]) => void): Corpus {
  const sets = JSON.parse(JSON.stringify(CORPUS.sets)) as ContrastSet[];
  mutate(sets);
  // A genuine corpus edit changes the corpus hash, exactly as editing the file on disk would.
  return { sets, hash: `sha256:${'e'.repeat(64)}`, path: CORPUS.path };
}

/** Corpus content mutated but the hash left alone: isolates the semantic checks from the hash check. */
function mutatedCorpusSameHash(mutate: (sets: ContrastSet[]) => void): Corpus {
  const sets = JSON.parse(JSON.stringify(CORPUS.sets)) as ContrastSet[];
  mutate(sets);
  return { sets, hash: CORPUS.hash, path: CORPUS.path };
}

function fixturesWith(mutate: (entries: FrozenEntry[]) => FrozenEntry[]): FixtureFile {
  const copy = JSON.parse(JSON.stringify(FIXTURES)) as FixtureFile;
  const entries = mutate(copy.entries as FrozenEntry[]);
  // Re-hash so the file's own integrity check passes and the DRIFT checks are what fire.
  const body = {
    format: copy.format,
    provenance: copy.provenance,
    pins: copy.pins,
    entries,
  };
  return { ...body, fixture_hash: fixtureHashFor(body) };
}

function codes(failures: readonly { code: string }[]): string[] {
  return [...new Set(failures.map((f) => f.code))];
}

describe('the frozen baseline is independent of the corpus (B-6-3)', () => {
  it('passes unchanged, so every failure below is caused by the mutation alone', async () => {
    const report = await runContrastRegression();
    expect(report.status).toBe('passed');
    expect(report.failures).toEqual([]);
    expect(report.pins.fixture_hash).toBe(FIXTURES.fixture_hash);
    // The baseline is loaded, not derived: its provenance says so in the report.
    expect(report.pins.fixture_provenance).toContain('NOT recorded model output');
  }, 120_000);

  it('fails when corpus text changes but the fixture does not', async () => {
    const corpus = mutatedCorpus((sets) => {
      const set = sets[0];
      if (set)
        (set.variants as Record<string, string>).kwn_english =
          'Entirely different prose that the frozen fixture never scored.';
    });
    const report = await runContrastRegression({ corpus });
    expect(report.status).toBe('failed');
    expect(codes(report.failures)).toContain('CORPUS_DRIFT');
  }, 120_000);

  it('fails when an authored PROSE ranking is reversed but the fixture is unchanged', async () => {
    // The decisive test. Under the old generated-at-runtime design this passed: the recording moved with
    // the expectation. With a frozen baseline only one side moves, so the conflict is detectable.
    const corpus = mutatedCorpusSameHash((sets) => {
      const set = sets[0];
      if (set)
        (set.expected as { prose_rank: string[] }).prose_rank = [
          ...set.expected.prose_rank,
        ].reverse();
    });
    const report = await runContrastRegression({ corpus });
    expect(report.status).toBe('failed');
    expect(codes(report.failures)).toContain('FIXTURE_EXPECTATION_CONFLICT');
    const conflict = report.failures.find((f) => f.code === 'FIXTURE_EXPECTATION_CONFLICT');
    expect(conflict?.detail).toContain('prose_rank');
  }, 120_000);

  it('fails when an authored STRUCTURE ranking is reversed but the fixture is unchanged', async () => {
    const corpus = mutatedCorpusSameHash((sets) => {
      const set = sets[0];
      if (set)
        (set.expected as { structure_rank: string[] }).structure_rank = [
          ...set.expected.structure_rank,
        ].reverse();
    });
    const report = await runContrastRegression({ corpus });
    expect(report.status).toBe('failed');
    const conflict = report.failures.find((f) => f.code === 'FIXTURE_EXPECTATION_CONFLICT');
    expect(conflict?.detail).toContain('structure_rank');
  }, 120_000);

  it.each([
    ['min_gap_prose_vs_translation_like', 'prose'],
    ['min_gap_structure_vs_western_english', 'structure'],
  ] as const)(
    'fails when %s is raised beyond the frozen score gap',
    async (key, dimension) => {
      const corpus = mutatedCorpusSameHash((sets) => {
        const set = sets[0];
        if (set) (set.expected as Record<string, number>)[key] = 95;
      });
      const report = await runContrastRegression({ corpus });
      expect(report.status).toBe('failed');
      expect(codes(report.failures)).toContain('FIXTURE_GAP_CONFLICT');
      const gap = report.failures.find((f) => f.code === 'FIXTURE_GAP_CONFLICT');
      expect(gap?.dimension).toBe(dimension);
    },
    120_000,
  );

  it('reports explicit pin/coverage behaviour when only genre metadata changes', async () => {
    // Re-labelling a genre is a corpus edit: the hash pin catches it, and because the corpus keeps full
    // coverage the failure is a pin mismatch rather than a coverage gap. Both facts are asserted.
    const corpus = mutatedCorpus((sets) => {
      const set = sets.find((s) => s.genre === 'system-progression');
      if (set) (set as { genre: string }).genre = 'hunter-gate';
    });
    const report = await runContrastRegression({ corpus });
    expect(report.status).toBe('failed');
    expect(codes(report.failures)).toContain('CORPUS_DRIFT');
    // The per-genre aggregate reflects the LIVE corpus, not the fixture's assumption: the re-labelled set
    // now counts under hunter-gate. The explicit pin failure is what makes the relabel visible — the
    // aggregate on its own would have looked unremarkable, which is exactly the silent drift being closed.
    const relabelled = await runContrastRegression({ corpus });
    const baseline = await runContrastRegression();
    const total = (r: typeof baseline, genre: string) => {
      const g = r.by_genre[genre];
      return (g?.agreements ?? 0) + (g?.false_positives ?? 0) + (g?.false_negatives ?? 0);
    };
    expect(total(relabelled, 'system-progression')).toBeLessThan(
      total(baseline, 'system-progression'),
    );
    expect(total(relabelled, 'hunter-gate')).toBeGreaterThan(total(baseline, 'hunter-gate'));
  }, 120_000);
});

describe('the frozen baseline is independent of policy, prompts and identity (B-6-3)', () => {
  it('fails with an explicit policy-pin mismatch when a gate threshold changes', async () => {
    const fixtures = JSON.parse(JSON.stringify(FIXTURES)) as FixtureFile;
    // Simulate the live policy having moved by pinning a different threshold in the baseline; the runner
    // reads live thresholds from the policy, so the two no longer agree.
    (fixtures.pins.policy_thresholds as Record<string, number>).prose = 61;
    const body = {
      format: fixtures.format,
      provenance: fixtures.provenance,
      pins: fixtures.pins,
      entries: fixtures.entries,
    };
    const report = await runContrastRegression({
      fixtures: { ...body, fixture_hash: fixtureHashFor(body) },
    });
    expect(report.status).toBe('failed');
    expect(codes(report.failures)).toContain('POLICY_THRESHOLD_DRIFT');
    const f = report.failures.find((x) => x.code === 'POLICY_THRESHOLD_DRIFT');
    expect(f?.detail).toContain('61');
  }, 120_000);

  it.each([
    ['policy_hash', 'POLICY_PIN_MISMATCH'],
    ['policy_id', 'POLICY_PIN_MISMATCH'],
    ['narrative_identity_version_id', 'IDENTITY_PIN_MISMATCH'],
    ['corpus_hash', 'CORPUS_DRIFT'],
  ] as const)(
    'fails when the pinned %s no longer matches the repository',
    async (pin, code) => {
      const fixtures = JSON.parse(JSON.stringify(FIXTURES)) as FixtureFile;
      (fixtures.pins as Record<string, unknown>)[pin] = 'changed-value';
      const body = {
        format: fixtures.format,
        provenance: fixtures.provenance,
        pins: fixtures.pins,
        entries: fixtures.entries,
      };
      const report = await runContrastRegression({
        fixtures: { ...body, fixture_hash: fixtureHashFor(body) },
      });
      expect(report.status).toBe('failed');
      expect(codes(report.failures)).toContain(code);
    },
    120_000,
  );

  it.each([
    ['a prompt version id', 'prompt_version_ids', 'PROMPT_PIN_MISMATCH'],
    ['a single prompt content byte', 'prompt_content_hashes', 'PROMPT_CONTENT_DRIFT'],
  ] as const)(
    'fails when %s changes without the fixtures being updated',
    async (_label, field, code) => {
      const fixtures = JSON.parse(JSON.stringify(FIXTURES)) as FixtureFile;
      (fixtures.pins as unknown as Record<string, Record<string, string>>)[field].prose_judge =
        'sha256:0000000000000000000000000000000000000000000000000000000000000000';
      const body = {
        format: fixtures.format,
        provenance: fixtures.provenance,
        pins: fixtures.pins,
        entries: fixtures.entries,
      };
      const report = await runContrastRegression({
        fixtures: { ...body, fixture_hash: fixtureHashFor(body) },
      });
      expect(report.status).toBe('failed');
      expect(codes(report.failures)).toContain(code);
      // Activity-key replay must not conceal prompt drift: the rendered prompt identity is checked too.
      if (code === 'PROMPT_CONTENT_DRIFT')
        expect(codes(report.failures)).toContain('PROMPT_IDENTITY_MISMATCH');
    },
    120_000,
  );

  it('refuses a fixture file whose own bytes were edited', async () => {
    const tampered = JSON.parse(JSON.stringify(FIXTURES)) as FixtureFile;
    (tampered.entries[0] as { score: number }).score = 99;
    // fixture_hash deliberately NOT recomputed: this is what an unreviewed hand edit looks like.
    await expect(runContrastRegression({ fixtures: tampered })).rejects.toThrow(
      /FIXTURE_HASH_MISMATCH/,
    );
  }, 120_000);
});

describe('the frozen entry set must match the corpus exactly (B-6-3)', () => {
  it('fails when a frozen recording is removed', async () => {
    const victim = FIXTURES.entries[0];
    const fixtures = fixturesWith((entries) => entries.slice(1));
    const report = await runContrastRegression({ fixtures });
    expect(report.status).toBe('failed');
    expect(codes(report.failures)).toContain('FIXTURE_ENTRY_MISSING');
    const missing = report.failures.find((f) => f.code === 'FIXTURE_ENTRY_MISSING');
    expect(missing?.set_id).toBe(victim?.set_id);
  }, 120_000);

  it('fails when an unexpected extra recording is added', async () => {
    const template = FIXTURES.entries[0];
    if (!template) throw new Error('fixtures are empty');
    const fixtures = fixturesWith((entries) => [
      ...entries,
      {
        ...template,
        set_id: 'cs-999',
        activity_key: 'activity:contrast:cs-999:kwn_english:prose',
      },
    ]);
    const report = await runContrastRegression({ fixtures });
    expect(report.status).toBe('failed');
    expect(codes(report.failures)).toContain('FIXTURE_ENTRY_EXTRA');
  }, 120_000);

  it('fails when two recording identities are swapped', async () => {
    const fixtures = fixturesWith((entries) => {
      const next = [...entries];
      const a: FrozenEntry | undefined = next[0];
      const b: FrozenEntry | undefined = next[1];
      if (a && b) {
        // Same keys, swapped activity keys: each entry now replays the other's recording.
        next[0] = { ...a, activity_key: b.activity_key };
        next[1] = { ...b, activity_key: a.activity_key };
      }
      return next;
    });
    const report = await runContrastRegression({ fixtures });
    expect(report.status).toBe('failed');
    expect(codes(report.failures)).toContain('FIXTURE_WRONG_IDENTITY');
  }, 120_000);

  it('fails when a duplicate frozen entry is present', async () => {
    const first = FIXTURES.entries[0];
    if (!first) throw new Error('fixtures are empty');
    const fixtures = fixturesWith((entries) => [first, ...entries]);
    // Duplicates are refused while loading the file, before any evaluation runs.
    const { loadFixtures: load } = await import('./fixtures.js');
    expect(load).toBeTypeOf('function');
    await expect(runContrastRegression({ fixtures })).rejects.toThrow(/FIXTURE_ENTRY_DUPLICATE/);
  }, 120_000);

  it('fails when a frozen score conflicts with the corpus expectation for its class', async () => {
    const fixtures = fixturesWith((entries) =>
      entries.map((e) =>
        e.variant === 'western_english' && e.dimension === 'structure' && e.set_id === 'cs-001'
          ? { ...e, score: 99 }
          : e,
      ),
    );
    const report = await runContrastRegression({ fixtures });
    expect(report.status).toBe('failed');
    // Two independent signals: the rank/gap consistency check and the observed false positive.
    expect(codes(report.failures)).toContain('FIXTURE_GAP_CONFLICT');
    expect(report.totals.false_positives).toBeGreaterThan(0);
  }, 120_000);
});

describe('determinism of the frozen baseline (B-6-3)', () => {
  it('produces byte-identical output and an identical result hash across two runs', async () => {
    const a = await runContrastRegression();
    const b = await runContrastRegression();
    expect(b.result_hash).toBe(a.result_hash);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.pins.fixture_hash).toBe(b.pins.fixture_hash);
  }, 240_000);
});
