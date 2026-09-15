/**
 * Frozen contrast replay fixtures (B-6-3).
 *
 * WHY THIS EXISTS. The first version of the runner generated its recordings at validation time from the
 * corpus's own expectations, the current policy thresholds and the current prompt registry — then compared
 * those recordings against the same expectations. Agreement was guaranteed by construction: reversing an
 * authored ranking moved BOTH sides of the comparison and still reported 100%. That proved the wiring and
 * nothing else.
 *
 * So generation and validation are now separate programs:
 *   - `pnpm generate:contrast-recordings` PROPOSES fixture data (maintainer-only, never in CI).
 *   - `pnpm validate:contrast` CONSUMES this committed file and never recomputes a score.
 *
 * The frozen file is an independent baseline: its scores are bytes on disk, reviewed in Git, pinned to the
 * exact corpus / policy / prompt / identity they were frozen against. Any drift on either side is a
 * mismatch rather than a silently co-moving pass.
 *
 * WHAT THESE FIXTURES ARE. Reviewed synthetic replay fixtures — deterministic stand-ins authored for this
 * regression. They are NOT recorded model judgments and are NOT calibration evidence (ADR-0029). Live judge
 * calibration is B-4-5 and has not happened.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Recording } from '@yeonjae/gateway';
import { type VariantClass } from './corpus.js';
import { type DimensionName } from './expectations.js';

export const FIXTURE_FORMAT_VERSION = 'yeonjae.contrast-fixtures.v1';

/** One frozen evaluation. Compact: the pins live once on the envelope, not on all 800 entries. */
export interface FrozenEntry {
  readonly set_id: string;
  readonly variant: VariantClass;
  readonly dimension: DimensionName;
  readonly activity_key: string;
  readonly score: number;
  readonly issue_kinds: readonly string[];
  readonly drift_flags: readonly string[];
  /** Structured evidence the judge schema carries for this dimension (structure only). */
  readonly evidence?:
    | {
        readonly hook_sentence_index?: number | undefined;
        readonly local_payoff_present?: boolean | undefined;
        readonly ending_type_detected?: string | undefined;
      }
    | undefined;
  /** The claim text, kept so a wrong-identity recording is detectable from the fixture itself. */
  readonly claim?: string | undefined;
}

export interface FixturePins {
  readonly corpus_hash: string;
  readonly policy_id: string;
  readonly policy_version: number;
  readonly policy_hash: string;
  /** The exact gate thresholds the scores were frozen against (ADR-0041). */
  readonly policy_thresholds: Readonly<Record<string, number>>;
  readonly narrative_identity_ref: string;
  readonly narrative_identity_version_id: string;
  readonly prompt_families: readonly string[];
  readonly prompt_version_ids: Readonly<Record<string, string>>;
  readonly prompt_content_hashes: Readonly<Record<string, string>>;
}

export interface FixtureFile {
  readonly format: typeof FIXTURE_FORMAT_VERSION;
  readonly provenance: string;
  readonly pins: FixturePins;
  readonly entries: readonly FrozenEntry[];
  /** sha256 over format + pins + entries. Detects any edit to the frozen baseline itself. */
  readonly fixture_hash: string;
}

export class FixtureError extends Error {
  constructor(
    readonly code:
      | 'FIXTURE_UNREADABLE'
      | 'FIXTURE_FORMAT_UNKNOWN'
      | 'FIXTURE_HASH_MISMATCH'
      | 'FIXTURE_ENTRY_DUPLICATE',
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'FixtureError';
  }
}

export function defaultFixturePath(): string {
  return fileURLToPath(new URL('../fixtures/contrast-recordings.v1.json', import.meta.url));
}

/** Key-sorted canonical JSON so a hash depends on content, never on property order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return value === undefined ? 'null' : JSON.stringify(value);
}

export function hashOf(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

/** The hash a fixture file must carry: over its format, provenance, pins and entries — never itself. */
export function fixtureHashFor(file: Omit<FixtureFile, 'fixture_hash'>): string {
  return hashOf({
    format: file.format,
    provenance: file.provenance,
    pins: file.pins,
    entries: file.entries,
  });
}

export function entryKey(setId: string, variant: string, dimension: string): string {
  return `${setId}|${variant}|${dimension}`;
}

/**
 * Integrity checks every fixture file must pass, whoever supplied it. Applied to an injected file as well
 * as one read from disk, so a test seam can never be a way around the baseline's own guarantees.
 */
export function verifyFixtureIntegrity(parsed: FixtureFile, origin: string): FixtureFile {
  // The declared type says the format is correct; at runtime the file is untrusted JSON and may say
  // anything, so the check reads through a loose view rather than trusting the annotation.
  const declaredFormat: string = (parsed as { format: string }).format;
  if (declaredFormat !== FIXTURE_FORMAT_VERSION)
    throw new FixtureError(
      'FIXTURE_FORMAT_UNKNOWN',
      `${origin} declares format ${declaredFormat}, expected ${FIXTURE_FORMAT_VERSION}`,
    );
  // The file's own integrity comes first: an edited baseline must not be able to pass anything.
  const computed = fixtureHashFor(parsed);
  if (parsed.fixture_hash !== computed)
    throw new FixtureError(
      'FIXTURE_HASH_MISMATCH',
      `${origin} carries ${parsed.fixture_hash} but hashes to ${computed}; regenerate with pnpm generate:contrast-recordings and review the diff`,
    );
  const seen = new Set<string>();
  for (const e of parsed.entries) {
    const key = entryKey(e.set_id, e.variant, e.dimension);
    if (seen.has(key))
      throw new FixtureError('FIXTURE_ENTRY_DUPLICATE', `fixture entry ${key} appears twice`);
    seen.add(key);
  }
  return parsed;
}

export function loadFixtures(path: string = defaultFixturePath()): FixtureFile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new FixtureError('FIXTURE_UNREADABLE', `${path}: ${(err as Error).message}`);
  }
  let parsed: FixtureFile;
  try {
    parsed = JSON.parse(raw) as FixtureFile;
  } catch (err) {
    throw new FixtureError('FIXTURE_UNREADABLE', `${path}: ${(err as Error).message}`);
  }
  return verifyFixtureIntegrity(parsed, path);
}

/** The ReplayProvider recording a frozen entry replays. Built from FROZEN bytes only. */
export function recordingFromEntry(entry: FrozenEntry): Recording {
  const json: Record<string, unknown> = {
    judge_score: entry.score,
    drift_flags: [...entry.drift_flags],
    issues: entry.issue_kinds.map((kind) => ({
      kind,
      severity: 'major',
      confidence: 0.9,
      claim: entry.claim ?? `set ${entry.set_id}: ${kind} on ${entry.dimension}.`,
    })),
  };
  if (entry.evidence) {
    if (entry.evidence.hook_sentence_index !== undefined)
      json.hook_sentence_index = entry.evidence.hook_sentence_index;
    if (entry.evidence.local_payoff_present !== undefined)
      json.local_payoff_present = entry.evidence.local_payoff_present;
    if (entry.evidence.ending_type_detected !== undefined)
      json.ending_type_detected = entry.evidence.ending_type_detected;
  }
  return { json, modelId: 'replay-model', usage: { input: 1000, output: 400, cached: 0 } };
}

export function recordingsFromFixtures(file: FixtureFile): Map<string, Recording> {
  const table = new Map<string, Recording>();
  for (const entry of file.entries) table.set(entry.activity_key, recordingFromEntry(entry));
  return table;
}
