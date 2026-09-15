# Scope and Release Tiers

Four tiers: **MVP** (a realistic vertical slice usable by one workspace and a few power users), **Public
Beta** (invited external authors), **Production** (paying customers, SLAs), **Future** (roadmap ideas, not
committed).

The rule for MVP scoping (ADR-0036): **ship a thin but complete vertical slice** — intake → bible →
first arc plan → chapter production with gates → canon commit → inspectors → export — while **never
postponing the foundations that cannot be retrofitted**: canon management, temporal state, character
knowledge, evidence provenance, narrative identity enforcement (English output + Korean-webnovel
tradition), prompt versioning, context construction, rejected-draft isolation, durable checkpoints, atomic
canon commits. Everything on that list is MVP; breadth (all genres, all export formats, autopilot, learning
loops) is not.

## 1. Tier matrix

Legend: ✅ in tier · ◐ partial (noted) · ⏩ later tier · — not planned

### 1.1 Product surface

| Capability | MVP | Beta | Prod | Future |
| --- | --- | --- | --- | --- |
| Create project; minimal or advanced requirement intake (structured form + free text; any input language, English output) | ✅ | ✅ | ✅ | |
| Requirement interpretation → Story Spec with hard/soft/assumption classification | ✅ | | | |
| Assumption review (confirm / edit / reject each) | ✅ | | | |
| Concept candidates (2) with comparison view | ✅ (N=2) | ✅ (N=3 Premium) | | |
| Story bible generation & editing; fact locking; naming & terminology policy editors | ✅ | | | |
| Series blueprint, season, arc plans; rolling-horizon chapter contracts | ✅ | | | |
| Chapter generation (single) with full pipeline | ✅ | | | |
| Chapter batch generation (sequential, N chapters) | ✅ | | | |
| Running directions ("from now on…") | ✅ | | | |
| Candidate comparison for chapters | ◐ mechanism only, off by default | ✅ Premium default | ✅ | |
| Continuity warnings, quality scorecards (separate prose / structure / genre / voice / continuity sections), evidence view | ✅ | | | |
| Canon inspector: facts, timeline, character state history, knowledge matrix, relationships, promises | ✅ | | | |
| User corrections to canon (fact edit with material-dependency impact report) | ✅ | | | |
| Retcon workflow | ◐ mark-stale + manual patches | ✅ automated patch proposals | ✅ | |
| Chapter regeneration (with dependency report) | ✅ | | | |
| Approve / reject / request-changes on chapters | ✅ | | | |
| Cost dashboard (per accepted chapter & per 1,000 accepted words) | ✅ | | | |
| Pause / cancel / resume jobs | ✅ | | | |
| Export TXT / DOCX per volume and whole series | ✅ | ✅ +EPUB, platform profiles | ✅ | |
| Operating modes | Assisted, Semi-auto | +Autopilot | | |
| Reader feedback import (manual paste, sanitized) | — | ✅ | ✅ | |
| Multiple projects per workspace, members & roles | ◐ owner + editor | ✅ | ✅ | |
| UI localization | English UI | +Korean UI | ✅ | |
| "Ask the canon" constrained Q&A inspector | — | ✅ | ✅ | |
| Alternate timelines UI (regression loops) | ◐ data model + basic view | ✅ | ✅ | |
| Additional output languages | — | — | — | ◐ architecture keeps output language explicit; English remains the required default |
| Real-time collaborative editing / cover generation / direct publishing | — | — | — | ✅ |

### 1.2 Narrative identity system

| Capability | MVP | Beta | Prod | Future |
| --- | --- | --- | --- | --- |
| Output-Language Profile (English; `en-US`/`en-GB` locale) with Output-Language Contract | ✅ | | | |
| Narrative-Tradition Profile (Korean serialized webnovel) with Narrative-Tradition Contract | ✅ | | | |
| Genre profiles shipped (as data in `examples/narrative-profiles/`) | 4 core (hunter/gate, regression, academy, romance fantasy) | +6 (system-progression, modern fantasy, murim, villainess, possession, reincarnation) | +6 (dungeon, apocalypse/survival, management, idol/entertainment, game-world, comedy) | custom overlays |
| Setting & Cultural Profile; Naming Profile (romanization system, name order, display/native/romanized names) | ✅ | | | |
| Dialogue-Register Policy (abstract formality → English rendering) | ✅ | | | |
| Terminology & Romanization Policy (translate / romanize / gloss / preserve) | ✅ | | | |
| Narrative Identity Block compiler with role-specific budgets | ✅ | | | |
| Narrative Identity Guard (fail-closed on missing language or tradition contract) | ✅ | | | |
| English Prose Lint (grammar/fluency signals, sentence-opening repetition, dialogue-tag overuse, paragraph length, translation-like syntax, locale consistency, unapproved untranslated terms, format drift) | ✅ | ✅ optional grammar service | | |
| Structure Lint (hook position, payoff markers, ending type, exposition runs, dialogue ratio, cadence) | ✅ | | | |
| Prose Judge, Structure Judge, Genre Judge, Voice Judge with evidence spans (separate dimensions) | ✅ | | | |
| Passage-level repair | ✅ | | | |
| Project exemplar bank (from accepted chapters + user-owned) | ✅ | | | |
| Contrast set (5 classes: KWN-English, Western-English, translation-like, over-literary, weak-serial) | ✅ 40 contrast sets in the repo (5 genres × 8 narrative functions), the ≥ 40 required before the calibration round (B-6-3) | ✅ 200+ | ✅ | |
| Character voice profiles & voice-drift detection | ✅ | | | |
| Threshold calibration tooling (per-project tuning from contrast sets and reviewer overrides) | ◐ manual | ✅ semi-automatic | ✅ | |
| User prose preference learning from edits | — | ◐ | ✅ | |

### 1.3 Memory, canon, knowledge

| Capability | MVP | Beta | Prod | Future |
| --- | --- | --- | --- | --- |
| Immutable manuscript versions with code-point evidence spans | ✅ | | | |
| Bitemporal facts (validity + assertion) | ✅ | | | |
| Canonical events with reality frames | ✅ | | | |
| Knowledge ledger (character/narrator/reader × proposition × stance); per-timeline proposition truth | ✅ | | | |
| Relationship states with history; abstract register + address terms | ✅ | | | |
| Timeline model incl. alternate timelines | ✅ data model; UI basic | ✅ | | |
| Promise ledger | ✅ | | | |
| Hierarchical summaries L1–L4 | ✅ | | | |
| Two-extractor canon extraction + reconciliation + evidence verification | ✅ | | | |
| Atomic canon commit, canon versions, stale detection, material/contextual dependency edges | ✅ | | | |
| Context pack assembler (tiers, compiled active constraints, ranking, compression, manifest, caching) | ✅ | | | |
| Hybrid retrieval (structured + lexical + vector + graph hops) | ✅ | ✅ tuned reranker | | |
| Rollback | ◐ latest commit | ✅ arbitrary | | |
| Retcon propagation with automated patch proposals | ◐ | ✅ | | |

### 1.4 Platform

| Capability | MVP | Beta | Prod | Future |
| --- | --- | --- | --- | --- |
| Model gateway: providers, routing, retries, fallback, structured-output validation, cost accounting | ✅ | | | |
| Prompt registry with versioning & regression suite | ✅ | | | |
| Temporal workflows with checkpoints, idempotency, cancellation | ✅ | | | |
| Budgets & hard limits, cost prediction | ✅ | ✅ better prediction | | |
| Observability: traces per call, structured logs, metrics, dashboards | ✅ | ✅ alerting | ✅ SLOs | |
| Auth (email + OAuth), workspace RLS, RBAC | ✅ | ✅ SSO optional | | |
| Encryption at rest/in transit, secret manager | ✅ | | | |
| Audit log | ✅ | | | |
| Backups & PITR; restore drills | ◐ daily | ✅ PITR | ✅ drills | |
| Data retention, deletion, full export | ◐ | ✅ | ✅ | |
| Provider privacy controls | ✅ config | ✅ | | |
| Prompt-injection defenses for imported text | ✅ | | | |
| Similarity check against user-provided corpus | — | ✅ | ✅ | |
| AI-assistance disclosure options in export | ◐ | ✅ | | |
| Embedding model migration tooling (versioned columns, re-embed jobs) | ✅ minimal | ✅ | | |
| Load testing, chaos testing | — | ◐ | ✅ | |

## 2. MVP definition (the vertical slice)

A single workspace user can: create a project from a 3-paragraph premise (any input language) + form;
review and confirm assumptions; pick one of two concepts; approve a story bible with locked facts, naming
and terminology policies, and dialogue-register profiles; approve a series blueprint and first arc plan;
generate chapter 1 → N **in English** in Semi-automatic mode with Assisted gates on the first arc; see
scorecards (prose / structure / genre / voice / continuity) and issues with evidence; correct a fact and
see the material-dependency report; regenerate a chapter; inspect character knowledge and relationships;
view costs; pause/resume/cancel; export a volume as DOCX. Genre coverage is limited to the four core
profiles. The **English fixture story** (`docs/07-quality/02-fixture-story.md`) passes all continuity traps
and all narrative-identity contrast tests end to end.

## 3. Deferred by design (and why it is safe to defer)

| Deferred | Why safe | Prerequisite kept in MVP |
| --- | --- | --- |
| Autopilot | Same pipeline; only gate policy differs | Mode enum + gate policy abstraction |
| 12 additional genre profiles | Profiles are data; compiler and judges are genre-agnostic | Profile schema + overlay composition |
| Automated retcon patch proposals | Dependency edges + stale marking exist; patches reuse the revision primitive | Material dependency edges, patch primitive |
| Reader feedback import | Sanitization pipeline reused from imported documents | Untrusted-text sanitizer |
| EPUB/platform export | Export from the same manuscript versions | Export service abstraction |
| Similarity service | Provenance + exemplar policy already prevent imitation by construction | Exemplar provenance |
| Arbitrary rollback | Canon versions + deltas are already stored | Deltas stored with inverse |
| Optional self-hosted grammar service | Lint heuristics + Prose Judge cover MVP; service adds precision | Grammar-check interface in `packages/prose` |
| Korean UI | UI strings are catalog-based | i18n scaffolding |
