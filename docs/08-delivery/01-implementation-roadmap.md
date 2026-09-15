# Implementation Roadmap

Phases are sequential with overlapping tails; each has exit criteria tied to the English fixture story.
Effort is expressed in engineer-weeks for a 3–4 person team (or equivalent agent capacity); numbers are
planning estimates, not commitments. The MVP is the vertical slice defined in ADR-0036, delivered as a
modular monolith first (ADR-0044). Implementation status is recorded only in `09-progress.md` (ADR-0043).

## 0. Delivery order: checkpoints (ADR-0044)

The phases below describe *what* is built; delivery happens in reviewable checkpoint pull requests, each
stacked on the previous one, each proving something end to end before adding surface area:

| Checkpoint | Branch slug | Content (phase items) | Proves |
| --- | --- | --- | --- |
| 0 | planning baseline | audit, ADR-0037…0044, validator, schemas, fixture manuscripts, policies, CI for the validator | the plan is internally consistent and truthful |
| 1 | `build-01-foundation` | pnpm workspace, TS strict, lint/format/test, schema→types lockstep, code-point + length utilities, mock provider, `apps/cli` skeleton, CI, secret scanning | tooling and contracts compile and are enforced |
| 2 | `build-02-domain-canon` | Postgres migrations, immutable versions, evidence trigger, StoryClock, facts/events/propositions/knowledge/relationships/promises, `canon.commit_delta` with change classes, quarantine, integration tests | atomic evidence-backed canon with history |
| 3 | `build-03-identity-gateway` | profiles as data, identity compiler, fail-closed Guard, prompt registry + immutable versions, provider-neutral gateway with mock/replay/fault, output-language check, budget guard, audit records | no style-sensitive call without both contracts; every call reproducible |
| 4 | `build-04-context-retrieval` | Active Constraint Set, deterministic packs with manifests/hashes/tiers, structured + lexical retrieval, previous-chapter continuity, rejected-draft exclusion | chapter k sees exactly what it should about k−1 |
| 5 | `build-05-chapter-vertical-slice` | intake → spec → assumptions → bible → arc → contract → scene plan → draft → checks → revision → approval → extraction → verification → atomic commit → **ch.2 remembers ch.1** → export | the core story loop on the fixture |
| 6 | `build-06-quality-revision` | prose/structure lints and judges, continuity/knowledge checkers, patch regression, contrast sets ≥ 40, multi-chapter and failure-recovery tests | quality gates and long-form continuity |
| 7 | `build-07-interface-hardening` | API, web review UI, inspectors, jobs/costs, pause/resume, correction/retcon flows, Temporal (if warranted), observability, security, deployment docs | a user can operate it |

Phase 0 ≈ Checkpoints 1–2; Phase 1 ≈ Checkpoints 2–4; Phase 2 ≈ Checkpoints 5–6 (API items move to 7);
Phase 3 = Checkpoint 7; Phase 4 continues after.

## Phase 0 — Foundations (3–4 weeks)

**Goal:** the skeleton every later phase depends on; no story generation yet.

- Monorepo scaffold (pnpm, TS strict, ESLint/Prettier configured to never reflow fixture prose or
  terminology data, Vitest), CI (lint, test, schema validation, planning-package validator with
  contradiction scan, secret scanning), docker-compose (Postgres+pgvector, Temporal dev, MinIO, OTel;
  optional grammar-service).
- `packages/domain`: types generated from `schemas/`; **code-point addressing utilities** with the
  cross-runtime conformance vector (ADR-0030); **length model** (ADR-0034); StoryClock; IDs.
- `packages/db`: migrations for tenancy, projects, spec + active constraint sets, entities (display/native/
  romanized names), register profiles, terminology terms, manuscripts (language check constraint), canon
  (facts/events/proposition truths per timeline/knowledge/relationships with register/promises/commits/
  evidence), dependency edges with materiality, embedding sets, packs, llm_calls (identity + contract
  hashes + language check), budgets; RLS policies; SQL functions `canon.commit_delta`, `canon.state_at`,
  evidence trigger (code-point semantics); pgTAP tests.
- `packages/gateway`: adapters (2 providers + mock/replay/fault), routing table, **Narrative Identity Guard
  (both contracts)**, **post-call output-language check**, budget guard, idempotency, schema validation,
  audit persistence, OTel.
- `packages/prompts`: registry model, loader, hashing, prompt set pinning; regression runner skeleton.
- `packages/prose` (core): output-language identification, tokenizer/POS tagger, length model integration,
  registry enforcement primitives; grammar-service client interface (service itself optional/deferred).
- `apps/cli` skeleton driving the packages against a local Postgres (ADR-0044); `apps/api`/`apps/worker`
  (Temporal) follow in Checkpoint 7 once the core loop is proven.

**Exit:** fixture bible loads into DB via a seed script; a `mock` LLM call through the gateway is
recorded with all audit fields including both contract hashes; the Guard rejects a style-sensitive call
missing either contract; the output-language check rejects a Korean-prose mock output; RLS test green;
canon commit tx test (atomicity, optimistic version) green; code-point conformance vector green in TS and
SQL.

## Phase 1 — Canon core & narrative identity core (4–5 weeks)

- `packages/narrative`: profile model (8 layers), composition, `lang/en` + `tradition/kr-webnovel` + 4 genre
  profiles as data, Narrative Identity Block compiler with role variants and IDENTITY_TAIL, structure lint
  (ST-*), calibration records; the 40 contrast sets in the repo in tests (the ≥ 40 pre-calibration target of B-6-3, met in Checkpoint 6).
- `packages/prose`: English Prose Lint (all EP-* in the spec), translation-marker set, register check (RG-*)
  against register digests, naming/terminology registry rules, thresholds from profiles.
- `packages/canon`: extraction pre-pass (registry NER, status-window numbers, speaker/register
  annotations), reconciler, evidence verifier (code points), commit orchestration, dependency edges with
  materiality + claim-based promotion, stale marking, rollback (latest), retcon diff, per-timeline truth.
- Knowledge ledger queries; relationship/register tracking; promise ledger.
- `packages/context`: query planner, structured fetch, English lexical + vector retrieval (embedding sets),
  ranker, compressors, renderers, validation (both contract hashes, Active Constraint Set bytes), manifest,
  caching; templates for writer/planner/checker/judge/extractor.
- Summaries L1–L4 generation activities (with `summarizer_min` identity block).

**Exit:** with `ReplayProvider` outputs for the fixture, ch.1–ch.20 canon deltas commit and produce the
expected facts/knowledge/truths/relationships (annotated); bitemporal queries answer trap-related
questions; T16 isolation test green; pack recall tests green; prose lint separates `translation_like`
from `kwn_english` (≥ 90% of seed sets) and structure lint flags `western_english`/`weak_serial` (≥ 80%);
register check catches T9/T13/T21; R1 marks only material dependents stale.

## Phase 2 — Planning & production pipeline (5–6 weeks)

- Workflows: RequirementInterpretation (any input language → English working text; Active Constraint Set
  compilation), Concept, StoryBible (register/naming/terminology/identity binder), SeriesPlanning,
  PlanningHorizon, ChapterProduction (scenes with output-language gate, assembler, deterministic checks,
  prose/structure/genre/voice/continuity evaluators, RevisionWorkflow with dimension-targeted revisers),
  CanonCommit child, Batch.
- Prompt families v1 for all MVP roles (English prompts; both contracts in every style-sensitive block);
  regression suite golden cases from the fixture incl. contrast sets and output-language assertions.
- Evaluators + scorecards (separate sections) + issue clustering by dimension + patch application +
  regression re-checks.
- Cost prediction v1 (words-based), budgets enforcement end-to-end, quality tiers.
- API for all production/plan/canon endpoints; SSE progress.

**Exit:** fixture ch.1–ch.12 produced end-to-end **in English** on live models (Standard) in staging with
Assisted gates via API; every chapter passes the output-language check; seeded traps in `ReplayProvider`
drafts are detected (T1–T15, T17–T19, T21, T23–T29) and patched or escalated per spec; chaos suite basic
cases green; P-class benchmark executed on the configured providers and recorded.

## Phase 3 — UI & review experience (4–5 weeks)

- Web app screens per UI plan (Requirements/Assumptions, Concept Compare, Bible + Register Profiles + Naming
  Registry + Terminology Policy + Narrative Identity, Plan boards, Chapter Review with per-dimension
  scorecard/issues/evidence/candidates/delta preview/trace, Canon inspectors incl. per-timeline truth and
  material/contextual dependents, Jobs/Attention, Costs, Export TXT/DOCX).
- English UI; mobile preview with locale typography.

**Exit:** UW-1…UW-17 (MVP variants) executable in the UI by a non-operator; usability pass with 2 authors
who write English serials in the Korean webnovel tradition; export DOCX opens correctly with locale
typography.

## Phase 4 — MVP hardening (3–4 weeks)

- Long-form continuity test (120-chapter compressed) green; live 20-chapter nightly green for 5
  consecutive nights with zero output-language failures.
- Threshold calibration round 1 (contrast set + reviewer overrides → `contrast_calibrated`); cost
  calibration; provider fallback drills; backup/restore runbook; security tests; docs/runbooks.
- Bilingual reviewer evaluation round 1 (30 chapters, two scales) → threshold tuning.

**Exit:** MVP Definition of Done (`docs/07-quality/03-definition-of-done.md` §3).

## Phase 5 — Public Beta (6–8 weeks)

Autopilot mode with escalation; 6 more genre profiles; automated retcon patch proposals; arbitrary
rollback; reader feedback import (sanitized, soft signals); candidate comparison default for Standard;
EPUB + platform export profiles; members/roles; alerting; PITR; similarity screening; optional
grammar-service integration; semi-automatic threshold calibration; contrast set ≥ 200; Korean UI
localization; OAuth providers, 2FA.

## Phase 6 — Production (ongoing)

SLOs, load testing at 3,000 chapters, chaos drills, restore drills, WCAG AA, cross-encoder reranker A/B,
remaining genre profiles and mode refinements (character drama, slow-burn romance), cost optimizations
(distillation of cheap classifiers), reviewer program.

## Dependency graph (high level)

```
P0 foundations ─► P1 canon + narrative identity core ─► P2 pipeline ─► P3 UI ─► P4 hardening ─► P5 beta ─► P6 prod
                     └──────── prompt regression suite + contrast sets grow continuously ─────────┘
```
