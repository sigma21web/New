/**
 * `pnpm generate:contrast-recordings` — MAINTAINER-ONLY fixture proposal.
 *
 * This program PROPOSES frozen fixture data. It is deliberately not part of `validate:contrast`,
 * `pnpm check`, the test suite or CI: if generation ran during validation, the baseline would move with the
 * thing it is supposed to hold still, which is exactly the circularity this split removes.
 *
 * Output is PROPOSED FIXTURE DATA, not calibration evidence. It is written to a `.proposed.json` sibling
 * rather than over the accepted baseline, so nothing is overwritten silently: a maintainer reviews the
 * diff and promotes it explicitly. Promotion is a reviewed Git change.
 */
import { writeFileSync } from 'node:fs';
import { requirePolicy } from '@yeonjae/domain';
import { PromptRegistry } from '@yeonjae/prompts';
import { loadCorpus, VARIANT_CLASSES } from './corpus.js';
import { ALL_DIMENSIONS, type DimensionName } from './expectations.js';
import {
  defaultFixturePath,
  FIXTURE_FORMAT_VERSION,
  fixtureHashFor,
  type FixtureFile,
  type FrozenEntry,
} from './fixtures.js';
import { activityIdFor, recordingFor } from './recordings.js';
import { DIMENSION_JUDGES, IDENTITY_REF, POLICY_REF } from './runner.js';

const IDENTITY_VERSION = '0191b2a0-0000-7000-8000-000000060001';

export function buildProposal(): FixtureFile {
  const corpus = loadCorpus();
  const policy = requirePolicy(POLICY_REF);
  const registry = PromptRegistry.fromDirectory();
  const active = registry.activeSet();

  const dims = policy.gates.dimensions as Record<string, { min_score: number } | undefined>;
  const thresholds = {} as Record<DimensionName, number>;
  for (const d of ALL_DIMENSIONS) {
    const gate = dims[d];
    if (!gate) throw new Error(`the pinned policy does not gate ${d}`);
    thresholds[d] = gate.min_score;
  }

  const promptVersionIds: Record<string, string> = {};
  const promptContentHashes: Record<string, string> = {};
  const families: string[] = [];
  for (const dimension of ALL_DIMENSIONS) {
    const { family } = DIMENSION_JUDGES[dimension];
    const id = active.mapping[family];
    if (!id) throw new Error(`no active ${family} prompt version`);
    const pv = registry.get(id);
    families.push(family);
    promptVersionIds[family] = pv.id;
    promptContentHashes[family] = pv.content_hash;
  }

  const entries: FrozenEntry[] = [];
  for (const set of corpus.sets) {
    for (const variant of VARIANT_CLASSES) {
      for (const dimension of ALL_DIMENSIONS) {
        const rec = recordingFor({ set, variant, dimension, threshold: thresholds[dimension] });
        const json = rec.json as {
          judge_score: number;
          drift_flags: string[];
          issues: { kind: string; claim?: string }[];
          hook_sentence_index?: number;
          local_payoff_present?: boolean;
          ending_type_detected?: string;
        };
        const evidence =
          dimension === 'structure'
            ? {
                hook_sentence_index: json.hook_sentence_index,
                local_payoff_present: json.local_payoff_present,
                ending_type_detected: json.ending_type_detected,
              }
            : undefined;
        entries.push({
          set_id: set.id,
          variant,
          dimension,
          activity_key: `activity:${activityIdFor(set.id, variant, dimension)}`,
          score: json.judge_score,
          issue_kinds: json.issues.map((i) => i.kind),
          drift_flags: json.drift_flags,
          ...(evidence ? { evidence } : {}),
          ...(json.issues[0]?.claim ? { claim: json.issues[0].claim } : {}),
        });
      }
    }
  }

  const body: Omit<FixtureFile, 'fixture_hash'> = {
    format: FIXTURE_FORMAT_VERSION,
    provenance:
      'Reviewed synthetic replay fixtures for the five-class contrast corpus. Authored deterministically for regression, NOT recorded model output and NOT calibration evidence (ADR-0029); live judge calibration is B-4-5 and has not happened.',
    pins: {
      corpus_hash: corpus.hash,
      policy_id: policy.id,
      policy_version: policy.version,
      policy_hash: policy.content_hash,
      policy_thresholds: Object.fromEntries(
        Object.entries(thresholds).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
      narrative_identity_ref: IDENTITY_REF,
      narrative_identity_version_id: IDENTITY_VERSION,
      prompt_families: [...families].sort(),
      prompt_version_ids: Object.fromEntries(
        Object.entries(promptVersionIds).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
      prompt_content_hashes: Object.fromEntries(
        Object.entries(promptContentHashes).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
    },
    entries,
  };
  return { ...body, fixture_hash: fixtureHashFor(body) };
}

function main(): void {
  const accepted = defaultFixturePath();
  const proposed = accepted.replace(/\.json$/, '.proposed.json');
  const file = buildProposal();
  writeFileSync(proposed, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  process.stderr.write(
    [
      'PROPOSED fixture data written (not accepted, nothing overwritten):',
      `  ${proposed}`,
      '',
      'This output is PROPOSED FIXTURE DATA, not calibration evidence. It does not prove anything about',
      'live model quality; thresholds remain uncalibrated (ADR-0029).',
      '',
      'To accept: review the diff against the committed baseline, then move it into place deliberately:',
      `  git diff --no-index ${accepted} ${proposed}`,
      `  mv ${proposed} ${accepted}`,
      '',
      `entries: ${file.entries.length}`,
      `fixture hash: ${file.fixture_hash}`,
      '',
    ].join('\n'),
  );
}

main();
