# Progress — durable project state

The single place that records implementation status (ADR-0043). Update it in every checkpoint commit.
Everything else in `docs/` describes design; only this file claims what exists and what has run.

## Current state

| Item | Value |
| --- | --- |
| Project | Yeonjae Studio — English manuscripts in the Korean serialized-webnovel tradition |
| Phase | **Checkpoint 6 — quality and long-form validation** (active); Checkpoint 5 merged via upstream PR #8 at `c8cfb59`; Checkpoints 0–4 in PRs #1–#4 |
| Default branch | `hoplite/ainos-1ac771f8` (this branch's base: PR #8 merge `c8cfb59`) |
| Working branch | `hoplite/delphoi-aefb0cf8` (Checkpoint 6; review PR is sigma20web/Sigma20#1, base `hoplite/maroneia-08771e8d` pinned at the `hoplite/ainos-1ac771f8` tip `c8cfb59`; this thread's source-control tooling is repository-bound to sigma20web/Sigma20, confirmed by direct tool test on 2026-09-15 (the PR tools list and mutate only Sigma20 pull requests), so the upstream PR into jsisiwb/New is a manual human step) |
| Application code | pnpm workspace: `packages/prose`, `packages/domain`, `packages/db` (migrations 0001–0004 — 0004 adds `workflow_id`/idempotency/`pins` on `jobs`, `workflow_artifacts` content-addressed store, `dependency_edges`; `canon.commit_delta`, `canon.rollback_latest`, bitemporal helpers, `retrieval.ts` accepted-only reads, lexical search, summaries, ACS/pack persistence), `packages/canon` (deterministic verifier + acceptance), `packages/narrative` (profile store, composition, Block compiler), `packages/prompts` (25 immutable prompt families v1.0.0, registry, prompt sets), `packages/gateway` (Guard, routing, budget, repair, output-language path, audit; Mock/Replay providers — Replay gains `activity:<id>` binding), `packages/context` (Active Constraint Set compiler, 4 pack templates, query plan, structured fetch, Postgres FTS retriever + vector interface, T0–T3 assembler with ladder, provenance renderer, manifest + pack hash, validation, `buildPack`), `packages/workflows` (Postgres-checkpointed `runStep` runtime, planning/drafting/evaluation/revision/acceptance stages, `produceChapter` core loop with previous-chapter gate before spend, `workflowStatus`, `exportAccepted`; Replay fixture `examples/fixture/ch01`), `apps/cli` (incl. `chapter:produce` / `chapter:status` / `chapter:resume` / `export:accepted` operator surface over the production workflow, replay-only) |
| CI | `planning-validation.yml` (validator) + `ci.yml` (Postgres 16 service; types-fresh, typecheck, lint, format, unit + integration tests, CLI smoke, audit, gitleaks) on every push/PR. Local `pnpm check` is the same sequence; GitHub Actions results are reported per-PR (fork PR shows the fork's runs, upstream PR the upstream's) — a PR with zero check runs is unverified, never "green" |

## Checkpoints

| # | Name | Branch | Status | PR |
| --- | --- | --- | --- | --- |
| 0 | Corrected planning baseline (audit, ADR-0037…0044, validator, schemas, fixture, policies) | `hoplite/prokonnesos-fc9b87c1` | done, awaiting review | [#1](https://github.com/jsisiwb/New/pull/1) |
| 1 | Repository foundation (pnpm workspace, TS strict, lint/format/test, schema→types lockstep, CI, mock provider, CLI skeleton, code-point/length/language primitives, StoryClock + lifecycle machines, policy loader) | `…--build-01-foundation` (stacked on 0) | done, awaiting review | [#2](https://github.com/jsisiwb/New/pull/2) |
| 2 | Domain, database and canon core (migration 0001; immutable versions; code-point evidence trigger; frame × timeline rule; `canon.commit_delta` with change classes + complete `inverse`; `canon.rollback_latest`; quarantine; bitemporal helpers; verifier; CLI DB commands) | `…--build-01-foundation--build-02-domain-canon` (stacked on 1) | done, awaiting review | [#3](https://github.com/jsisiwb/New/pull/3) |
| 3 | Narrative identity (profiles as data, composition, Block compiler with role variants, both contract hashes, shedding, overflow error), prompt registry (24 families, immutable content-hashed versions, strict variables, prompt sets), gateway (fail-closed Guard, routing, budget guard, bounded repair, truncation, output-language discard→regenerate→reroute, idempotent audit; Mock/Replay/fault providers), migration 0002 (append-only `llm_calls` with both contract hashes, immutable `prompt_versions`, `jobs`/`job_steps`) | `…--build-02-domain-canon--build-03-identity-gateway` (stacked on 2) | done, awaiting review | [#4](https://github.com/jsisiwb/New/pull/4) |
| 4 | Context and retrieval (Active Constraint Set compiler with `CONSTRAINTS_OVERFLOW`; templates `pack.scene_writer` / `pack.chapter_planner` / `pack.continuity_checker` / `pack.extractor` v1.0.0; deterministic query plan; structured canon fetch at the pinned canon version on the contract timeline — states with evidence, knower-specific knowledge with secrets and prior-loop/source-story memory labels, directional relationships + register, promises, events, world rules; previous accepted chapter L1 + verbatim tail + hook + committed deltas + elapsed time; migration 0003 `summaries` / `search_documents` (accepted-only triggers, idempotent indexing, de-acceptance cleanup) / `active_constraint_sets` / `context_packs` / `embedding_sets`; Postgres FTS retriever + `VectorRetriever` interface; T0–T3 with `PACK_T0_OVERFLOW` / `PACK_T1_OVERFLOW` and the ladder; provenance-tagged rendering; manifest with sections, sources, versions, rank scores, drop reasons, degradation flags, pack hash; pre-call validation; `pack:build` CLI; ADR-0045) | `…--build-03-identity-gateway--build-04-context-retrieval` (stacked on 3) | done, awaiting review | stacked on #4 |
| 5 | Chapter-production vertical slice (deterministic Postgres-checkpointed core loop: intake → spec → bible → arc → locked contract → scene plan → draft → checks → bounded revision → approval-lock → extraction → verification → atomic commit → L1 summary + accepted-only index + dependency edges; ch.1 → ch.2 carries summary/tail/hook/deltas; `exportAccepted`; migration 0004 `jobs.workflow_id`/idempotency/`pins` + `workflow_artifacts`; Replay `activity:<id>` binding; CLI `chapter:produce` / `chapter:status` / `chapter:resume` / `export:accepted` operator surface with replay-only routing, JSON output, nonzero exit on failure; ADR-0046) | `hoplite/kos-969b8d7e--checkpoint-05-completion` | done, merged | upstream [#8](https://github.com/jsisiwb/New/pull/8) |
| 6 | Quality and long-form validation | `hoplite/delphoi-aefb0cf8` (this change; review PR sigma20web/Sigma20#1; upstream cross-repo PR to jsisiwb/New manual) | active | — |
| 7 | Interface and hardening | stacked on 6 | planned | — |

PR dependency rule: each checkpoint PR is based on the previous checkpoint branch and states its parent;
merge bottom-up. No PR is merged without explicit user authorization.

## Validation commands and latest results

| Command | Purpose | Last result |
| --- | --- | --- |
| `pip install jsonschema && python3 tools/validate-planning-package.py` | schemas, examples, canon-delta union, evidence offsets against fixture manuscripts, cross-file refs, stale terms, truthfulness | **ALL OK** (32 schemas; 14 examples + 1 bundle; 0 contradiction hits) |
| `DATABASE_URL=postgres://… CI=true pnpm check` | types-fresh → typecheck → lint → format:check → unit + Postgres integration tests → validator | **local green** (this branch: 27 test files, 227 tests passed — 22 chapter-production integration incl. T19b collision proof + 11 multi-chapter continuity integration + 14 failure-recovery integration + 9 candidate-comparison/patch-regression integration + 10 comparison unit + 5 CLI chapter-surface tests; Postgres 16, Node 24.19.0, pnpm 10.26.0, Python 3.12.3). Local green is not GitHub green: see the PR's Actions runs for CI evidence |
| `pnpm cli identity:compile project/…@1 writer_full 2000` | compiles the fixture identity block: both contracts first, 11 sections, 1,272 est. tokens, deterministic hash | ok |
| `pnpm cli prompts:list` | 25 immutable prompt versions + active prompt set id | ok |
| `pnpm cli verify-evidence examples/fixture/manuscripts/ch09.accepted.txt examples/fixture/canon-delta.ch09.json` | code-point evidence verification via the CLI | ok: 8 spans verified |
| `pnpm cli db:migrate … manuscript:import … manuscript:approve … canon:accept … canon:state-at` | end-to-end: import fixture ch.9, approval-lock, verified atomic commit (version 0 → 1), state query at ch.11 returns the venom injury | ok (see PR #3 body) |
| `pnpm cli db:migrate` (0003) → `project:create` → `entity:create` ×4 → `manuscript:import` ch.9 → `manuscript:approve` → `canon:accept` (fixture delta remapped) → `summary:set 9` → `search:index` → `pack:build <project> 10 scene_writer contract.json spec.json --persist --identity=project/…@1` | Checkpoint 4 smoke: chapter 10 writer pack over the real canon — 10 sections, 4,057 est. tokens of 24,000 (T0 2,751 / T1 1,083 / T2 223), previous chapter 9 pinned (v1, canon v1, 422-word tail, tail hash), 32 included / 53 excluded (`diversity_cap`), all 11 validation checks true, `degradation.vector = not_configured`, manifest persisted (`stored: true`) | ok |
| `pnpm cli constraints:compile 12 examples/fixture/story-spec.v3.json` | Active Constraint Set for ch.12 from the fixture spec (12 hard incl. one merged duplicate, 4 soft, 2 assumptions, 3 excluded by scope/retirement); cap 100 → `CONSTRAINTS_OVERFLOW` | ok |

Tests not run: none skipped locally. Without `DATABASE_URL` the integration suites skip visibly. `gitleaks`
runs in CI only (not installed in the local sandbox); `pnpm audit --audit-level=high` reported no findings.
Live-model tests: none executed; nothing in this repository is evidence of live-model prose quality. Vector
retrieval has no implementation (interface + `embedding_sets` registry only, ADR-0045).

Checkpoint 4 test inventory (`packages/context`): unit — constraints (6: scope selection, stable ids, dedupe,
classification, determinism, scope-driven hash change, `CONSTRAINTS_OVERFLOW`, locked facts, non-English
text without paraphrase refused, scope predicate); assembler (21: identical inputs → identical bytes/section
hashes/pack hash + schema-valid manifest; item order irrelevant; canon version / Narrative Identity /
Production Policy changes alter the hash; provenance + source version on every item and line; T0 survives
trimming; `PACK_T0_OVERFLOW`; ladder then `PACK_T1_OVERFLOW`; deterministic T2 ranking, diversity cap, T1
dedupe; T16 rejected draft excluded with reason and phrase absent, mandatory draft → `PROHIBITED_SOURCE`;
untrusted text excluded and never in the system position; other-project items excluded; contract rendered as
PLANNED; k−1 summary/tail/hook/deltas with pins; k > 1 without accepted k−1 fails validation; stale canon
version / other timeline fail the pin check; writer pack passes the gateway Guard; templates ↔ registry roles
and identity variants; checker/extractor job-scoped text; deterministic query plan). Postgres integration
(12): quarantined draft not indexed/summarizable/retrievable and indexing idempotent; k receives k−1 L1 +
tail + hook + committed deltas + pins + elapsed time + evidence-bearing states + locked facts, manifest and
ACS persisted; determinism over the DB + idempotent persistence; knower-specific knowledge, secrets, T0
guards; directional + time-correct relationships (ch.10 vs ch.4); prior-loop isolation with labeled memory;
distant ch.3 event recovered lexically with provenance, nothing ≥ k, nothing non-accepted; lexical/vector
outage degrades with flags; dead DB → `STRUCTURED_RETRIEVAL_UNAVAILABLE`; k−1 working/missing →
`PREVIOUS_CHAPTER_NOT_ACCEPTED`; rollback removes search documents + summary and unbuilds k; checker accepts
`working` job text, extractor only `approved`, quarantined ids refused. Repair regression (`packages/db`):
version numbering across quarantined versions.

## Verification of the inherited stack (this session, 2026-09-14)

- Repository `jsisiwb/New` read via the public API and `git fetch`; default branch `hoplite/ainos-1ac771f8`
  (`2823bb9`). PRs #1–#4 open, none merged, bases chain #1 → #2 → #3 → #4 as recorded; heads `ae11f05`,
  `1ee4a80`, `21e054f`, `0a01e80` match the handoff; nothing was pushed after `0a01e80`. GitHub Actions
  (`ci`, `planning-validation`, gitleaks) succeeded on every head.
- `DATABASE_URL=… CI=true pnpm check` at `0a01e80` (Node 22.23.2, pnpm 10.26.0, Postgres 16.14): 18 files,
  116 tests passed, validator ALL OK — the recorded Checkpoint 3 state is confirmed.
- Defect found and repaired on this branch (not blocking merge of #1–#4, fixed forward): manuscript version
  numbering could reuse a quarantined version's `version_no` (see decisions log).
- Merge verdict: PRs #1–#4 are internally consistent and green; merging remains a user decision (none
  authorized). Merge order #1 → #2 → #3 → #4, retargeting each next PR to the default branch after the
  previous merge.

## Known failures / gaps

- Contrast sets: 40 sets in the repo (5 genres × 8 narrative functions), meeting the ≥ 40 pre-calibration
  target of B-6-3. The judge calibration run itself is still outstanding: the expectations in
  `contrast-sets.seed.json` are authored starting expectations, not measured judge output, and thresholds
  stay `uncalibrated` until B-4-5 runs them against live judges with bilingual reviewers.
- Fixture manuscripts: only ch.9 (accepted) and its rejected draft exist as text; ch.12/ch.14 evidence is
  described, not addressable, until Checkpoint 5 produces them.
- Thresholds in profiles and policies are `uncalibrated`.

## Unresolved risks (see `03-risk-analysis.md`)

R1/R2 (translation-like vs Western-pacing drift) remain the top product risks and are not testable until
Checkpoint 3 (gateway + judges) and Checkpoint 6 (contrast-set regression on live models).

## Checkpoint 4 limitations (recorded, not hidden)

- Vector retrieval: interface + `embedding_sets` registry only; no embedder, no pgvector (ADR-0045). Packs
  report `degradation.vector = not_configured`.
- Lexical search uses the `english` FTS configuration without the per-project name thesaurus
  (`05-retrieval-and-indexing.md` §3); entity tagging covers names/short forms/aliases. Thesaurus is B-1-13
  follow-up.
- L1 summaries are stored by `summary:set` (operator/tests); the `factual_summarizer` call that produces them
  belongs to the Checkpoint 5 acceptance workflow. The same workflow will call `canon.index_accepted_version`
  inside the acceptance transaction and write dependency edges from stored packs (ADR-0032).
- Token counts use `english_estimator_v1` (words × 1.3); the manifest records the estimator id so a tokenizer
  can replace it without changing the schema.
- The three Production Policies gained `context.input_budget_tokens` and new content hashes at `version: 1`
  (no project pins them yet).

## Next exact tasks (Checkpoint 5 — chapter-production vertical slice): done in this change

1. ~~`git checkout -b …--build-04-context-retrieval--build-05-chapter-vertical-slice` from the Checkpoint 4 head.~~
   Landed as `hoplite/kos-969b8d7e--checkpoint-05-completion` (repair of
   the WIP slice merged as PR #7 at `4ea8ecd`; fork staging PR `huuuiuh/New#1`, upstream integration PR
   targeting `jsisiwb/New:hoplite/ainos-1ac771f8`).
2. `packages/workflows` (Postgres-checkpointed idempotent steps, ADR-0044/ADR-0046): intake →
   `requirement_interpreter` → Story Spec → assumptions → bible commit → arc → `chapter_planner` with
   `pack.chapter_planner` → Chapter Contract (validated, locked) → `pack.scene_writer` → `scene_planner` →
   `scene_writer` per scene through `ReplayProvider` → assembly → deterministic checks → replayed evaluators
   → targeted revision → approval-lock → `canon_extractor` with `pack.extractor` → `verifyDelta` →
   `acceptChapter` (+ `factual_summarizer` L1, `indexAcceptedVersion`, dependency edges) → Chapter 2 pack
   proving it carries Chapter 1's summary/tail/hook/deltas → export. Done; 22/22 integration tests
   (incl. T19b global-identity collision proof).
3. Replay recordings for every fixture call (no live provider). Done (`examples/fixture/ch01/replay.ch01.json`,
   prompt-hash + `activity:<id>` binding, `misses == []`).
4. CLI operator surface over the production workflow. Done in this change: `chapter:produce <project> <ch>`
   (runs/resumes `produceChapter` with replay-only routing, deterministic workflow id, JSON summary, nonzero
   exit on failure), `chapter:status <workflow-id>`, `chapter:resume <workflow-id>` (same resume entrypoint,
   explicit), `export:accepted <project>` (accepted manuscripts only; `--full` prints text, default prints
   hashes/sizes); 5 CLI chapter-surface tests (success, idempotent repeat, failure, interrupt→resume, export).
   Remaining follow-ups (not in this change): per-project name thesaurus (B-1-13); Checkpoint 6
   quality/long-form scope.

## Checkpoint 6 — quality and long-form validation (in progress on this branch)

| Item | State |
| --- | --- |
| B-6-1 multi-chapter continuity | **done for chapters 1 → 2 (two consecutive accepted chapters), not yet 3**: `examples/fixture/ch02` (authored scenes + generated recordings) and 11 Postgres/Replay tests — both chapters accepted in one project with one canon bump each (v3, v4), chapter 2 remembering chapter 1 from accepted state only, a fact/relationship transition across the chapter boundary, the ch.1 promise paid in ch.2, both chapters summarized and indexed accepted-only, dependency edges at the canon version read, and export carrying both in order. A third chapter is **not** produced: chapter 3 has no fixture recordings, and the suite asserts that the previous-chapter gate refuses it rather than improvising |
| B-6-2 failure-recovery tests (commit fault, stale canon, provider fault, resume) | **done**: 14 Postgres/Replay tests — failure after each of 8 pre-commit steps leaves no chapter commit/accepted version/summary/index, resume from three different steps completes and replays every prior step with a third run adding no spend, a racing canon commit fails `CANON_STALE` with nothing half-committed, a provider fault fails closed without substituting a draft, and a blocked gate reports `needs_attention` rather than `failed`. **This suite found and fixed a real defect** (see decisions log) |
| B-6-3 contrast corpus 4 → ≥ 40 original sets with expectations | **done in this change**: 40 sets in `examples/fixture/contrast-sets.seed.json` (5 genres × 8 narrative functions; 36 authored here), validator count/structure checks green; the judge calibration *run* is B-4-5 and has not happened |
| B-6-4 candidate comparison + patch regression suites on replay | **done**: `chapter_comparator` prompt family (25th), `packages/workflows/src/comparison.ts` (position-swapped pairwise judging, shuffled-rubric retry, deterministic tie ladder — ADR-0015; per-dimension patch regression and smoke checks — ADR-0014), 10 unit tests + 9 Postgres/Replay integration tests proving consistent winner, position-bias detection and resolution, tie fallthrough, fail-closed on a mis-named verdict, comparator audit pins, and the real chapter-1 patch improving prose without regressing structure |

Known mismatch surfaced by B-6-4 (recorded, not fixed here): `standard.v1` gates four dimensions
(`prose`, `structure`, `genre`, `voice`) but the Checkpoint 5 evaluator scores only the first two, so no
candidate can satisfy the ADR-0015 early stop under that policy. `earlyStopDecision` therefore refuses to
stop and names the missing dimensions rather than treating an absent judge as a silent pass; a test asserts
exactly that. Wiring the genre and voice judges (or narrowing the policy) is a separate decision.

B-6-1 scope note (truthfulness, ADR-0043): the backlog wording for B-6-1 is "ch.1 → ch.2 → …" and the
checkpoint blurb says "multi-chapter". What exists is a **two-chapter** chain, proved end to end. Chapter 3
would need another authored chapter of fixture prose and its own recordings; the compressed 120-chapter
long-form run remains B-4-1. Nothing here is evidence about live-model prose over many chapters.

B-6-3 scope note (truthfulness, ADR-0043): the corpus is now large enough for the calibration round, but
nothing in this change measures judge behavior. Every `expected` block is an authored starting expectation
(rank orders, illustrative lint ids from the EP-*/ST-*/RG-*/TRN-* catalog, two gap thresholds); profile and
policy thresholds remain `uncalibrated`. Deterministic replay in CI is not evidence of live-model prose
quality, and synthetic contrast sets are not a substitute for the bilingual reviewer panel (B-4-5).

## Important decisions log

| 2026-09-15 | Acceptance repair found by B-6-2: `acceptChapter` passed the project's *current* `canon_version` as the commit's parent, so the optimistic check compared a value with itself and a commit landing between extraction and acceptance was absorbed silently instead of raising `STALE_CANON`. The parent is now the delta's own `base_canon_version` (the version extraction was performed against), and a delta without an integer `base_canon_version` is rejected rather than committed unpinned | `packages/canon/src/accept.ts`, `packages/workflows/src/recovery.integration.test.ts` |

| Date | Decision | Where |
| --- | --- | --- |
| 2026-09-13 | Lifecycle: `origin` + `status`; approval-locked extraction; accepted on commit | ADR-0037 |
| 2026-09-13 | Five bitemporal change classes; extraction emits transitions only | ADR-0038 |
| 2026-09-13 | `source_story` = fact-bearing timeline kind reached through knowledge; reincarnation reuses prior-loop timelines | ADR-0039 |
| 2026-09-13 | StoryClock: narrative order authoritative; world order partial; calendars; `narrated_at` | ADR-0040 |
| 2026-09-13 | Production Policy = single versioned source of limits/gates; per-dimension gates only | ADR-0041 |
| 2026-09-13 | Issue-override matrix (never / canon_workflow / reviewer / advisory) | ADR-0042 |
| 2026-09-13 | Truthful baseline: starter labels, one progress doc | ADR-0043 |
| 2026-09-13 | Modular monolith first; CLI before API/UI; Temporal after the core loop | ADR-0044 |
| 2026-09-14 | Prompt families live in the repo (`packages/prompts/families/<family>/vX.Y.Z/`) as the review surface; the DB mirror (`prompt_versions`) is hash-verified and immutable; `tools/seed-prompt-families.py` authored v1.0.0 and is idempotent | `packages/prompts` |
| 2026-09-14 | Gateway audit rows never contain prompt or output text (hashes + sizes only; outputs live in the artifact store the workflow owns) | `packages/gateway/src/gateway.ts`, migration 0002 |
| 2026-09-14 | Canon boundary is the SQL function: all canon tables carry BEFORE triggers that refuse writes unless `canon.in_commit` is set by `canon.commit_delta`/`rollback_latest`, and refuse DELETE/TRUNCATE outright; `btree_gist` exclusion constraints make overlapping validity impossible; evidence trigger uses Postgres code-point `substring` on NFC text | `packages/db/migrations/0001_canon_core.sql` |
| 2026-09-14 | Toolchain: TypeScript 5.9 (typescript-eslint peer range), Vitest 4, ESLint 10 flat config, Prettier 3, `json-schema-to-typescript` for types with a freshness check in CI, Ajv 2020-12 at runtime; UUIDv7 implemented in-house (no dependency); deterministic script/lexicon output-language check (no statistical language-id dependency) | README.dev.md |
| 2026-09-14 | Context packs are pure functions of pinned inputs (pack id = UUIDv8 of the pack hash; ACS id = UUIDv8 of its content hash); lexical index is accepted-only by SQL trigger, synchronous with acceptance, removed on de-acceptance; vector retrieval is an interface until an embedder exists; structured failure blocks, optional failure degrades with flags; per-template input budgets live in the Production Policy | ADR-0045 |
| 2026-09-14 | Repair: `createManuscriptVersion` numbers versions across `manuscript_versions ∪ quarantine_versions` so a quarantined draft and its replacement never share a `version_no` (found while seeding the fixture; regression test in `canon.integration.test.ts`) | `packages/db/src/repo.ts` |
| 2026-09-15 | Chapter-production repair: previous-chapter gate runs before any model spend or canon write (T17); Replay `activity:<id>` binding with prompt-hash priority (no live calls); canon identity stays global, failure-paths tests isolate per-test via DB reset (T19/T19b); T11 extract-variant fixture carries schema-valid plan-frame + future-dated items | ADR-0046, `packages/workflows`, `examples/fixture/ch01/replay.ch01.json` |
| 2026-09-15 | CLI chapter surface over the production workflow (no parallel orchestration): `chapter:produce` runs/resumes `produceChapter` with replay-only routing and deterministic workflow ids, `chapter:status` reads the persisted job, `chapter:resume` re-runs the same workflow id explicitly, `export:accepted` exports accepted text only; nonzero exit on failure; T19b proves two live projects cannot share deterministic fixture UUIDs | `apps/cli`, `apps/cli/src/chapter.test.ts` |
