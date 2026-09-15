# Checkpoint 0 — Baseline Audit Report

Repository-wide audit of the planning package performed before implementation, with the corrections that
landed in the same change. Baseline audited: default branch `hoplite/ainos-1ac771f8` at commit `2823bb9`
(129 files; documentation, 30 schemas, 11 examples, one validator; no application code, no CI, no open
pull requests). The validator was green at baseline (`RESULT: ALL OK`) — which is itself a finding: it
passed a package containing the contradictions below.

## 1. Method

1. Read every document, schema, example and the validator; cross-checked claims against repository contents.
2. Three targeted sub-audits (lifecycle language; StoryClock/frames/bitemporal semantics; duplicated
   numbers, dangling references, exaggerated claims), each with file:line citations, verified by hand.
3. For every confirmed finding: decide (ADR when significant), correct schemas → examples → docs →
   traceability → backlog/roadmap → validator rule that prevents regression.

## 2. Findings and resolutions

| # | Finding (baseline) | Evidence | Resolution |
| --- | --- | --- | --- |
| F1 | **Contrast-set claim false**: "MVP seed ≈ 40 sets" / "(40)" / "~40 sets" in three documents; the fixture held 4 sets at the Checkpoint 0 baseline | `00-overview/03` §1.2, `02-narrative-identity/05` §7, `08-delivery/01` Phase 1 vs `examples/fixture/contrast-sets.seed.json` | Reworded everywhere to state the true count with the pre-calibration target beside it; **no filler added**; validator compares the claim with the file (ADR-0043). Checkpoint 6 (B-6-3) later authored 36 further original sets, so the same validator check now holds against 40 |
| F2 | **Genre profiles**: "4 core profiles as data" but only `genre-hunter-gate.v1.json` existed; the composed fixture identity referenced `genre/regression@1` which did not exist | `examples/narrative-profiles/`, `project-second-awakening.composed.v1.json#lineage` | Authored `genre-regression`, `genre-academy`, `genre-romance-fantasy` profiles (original devices, cadences, register defaults, rubrics); validator checks lineage and the catalog's MVP list against files |
| F3 | **Lifecycle words conflated**: `manuscript_versions.kind` mixed provenance (draft/revision/candidate) with status (approved/accepted/retconned); glossary and ADR-0009's title said canon comes from *accepted* chapters while §7 said extraction reads *approved*; "auto-accepted when scorecard ≥ tier threshold"; contract status reused `approved` | `04-memory-canon/02` §1.1/§4/§7, `06-system/02` §5/§12, `00-overview/01` §modes, `00-overview/02` glossary, `schemas/chapter-contract.schema.json` | ADR-0037: `origin` + `status`; `approved` = approval-locked for extraction; `accepted` set only inside the commit; contract status `locked`; gates approve, commits accept; every doc/schema/example aligned; validator flags `auto-accept`, `kind='accepted'`, `auto_acceptable` |
| F4 | **Bitemporal semantics unnamed**: no rule said which op a healing uses; `retract` vs `supersede` unconstrained; rollback semantics incomplete (no statement that `inverse` restores `valid_to`) | `schemas/canon-delta.schema.json` op enum, `04-memory-canon/02` §1.3/§9 | ADR-0038: five change classes with a rule table; `close` op added; extraction may emit transitions only; complete `inverse`; fixture cases TR1 (transition), R1 (retcon), C1 (correction), RB1 (rollback), SR1 (system-time retraction); tests listed |
| F5 | **`source_story` contradictory**: fact-bearing in `common.realityFrame` and `fact.frame`; excluded in ADR-0007 and `04-memory-canon/02` §1.6; called a frame in one catalog entry and a knowledge source in another; no `source_story` timeline kind; undefined `prior_life` frame | `schemas/common.schema.json`, `schemas/fact.schema.json`, ADR-0007, `02-narrative-identity/03` §8–10 | ADR-0039: `source_story` is a timeline kind and fact-bearing frame *on that timeline*, reaching `main` only as knowledge; frame × timeline-kind verifier rule (`FRAME_VIOLATION`); `prior_life` removed (reincarnation = prior loop); possession micro-fixture added; ADR-0007/0023 amended |
| F6 | **StoryClock ordering ambiguous**: "(timeline, world_date if comparable, chapter_no, ordinal)" left unknown precision, calendars, flashbacks, simultaneity and derived keys undefined | `schemas/common.schema.json#storyClock`, `04-memory-canon/02` §1.4, `06-system/02` §6 | ADR-0040: narrative order authoritative (derived `ord`), world order partial with `calendar` and `uncertainty_days`, `narrated_at` on events, tie-break and cross-timeline rules; schema + docs + tests |
| F7 | **Duplicated / contradictory numbers**: revision rounds "Standard 3 / Economy 2 / Premium 4" vs "2 (Standard), 3 (Premium)"; `early_stop_threshold` 88/100 aggregate; tail "~400" / "350–500" / "400 → 250" words; per-tier gate scores only in prose; extraction 0.8 / 0.98 thresholds inline | `05-generation/02` §4.2/§5 vs `02-narrative-identity/05` §5; `01-requirements/01` FR-4.3; `04-memory-canon/04` §2.4–2.5, §4 | ADR-0041: `schemas/production-policy.schema.json` + `examples/production-policies/{economy,standard,premium}.v1.json`; docs reference `policy.*` keys and quote starting values; validator flags bare policy numbers |
| F8 | **Aggregate gating**: "scorecard ≥ 88", "score ≥ threshold", `acceptance.auto_acceptable` + `threshold_used` conflicted with the per-dimension prose/structure gates | `00-overview/01`, `01-requirements/03` UW-6, `05-generation/02` §5, `schemas/scorecard.schema.json` | Per-dimension `acceptance.dimension_results`; `overall.score` informational only; early stop is a per-dimension margin; validator flags aggregate gating phrases |
| F9 | **Override policy generic**: FR-5.4 "explicit user override" for any major; UI `override(issue_ids, reason)` | `01-requirements/01` FR-5.4, `05-generation/02` §3/§6 | ADR-0042 override matrix (`never` / `canon_workflow` / `reviewer` / `advisory`); `issue.override_class`; policy carries the matrix; locked-fact contradictions require a correction/retcon |
| F10 | **Stale character-based fields**: `accepted_chars`, `cost_per_1k_chars` survived the English correction | `06-system/02` §9 | `accepted_words`, `cost_per_1k_words`; validator pattern extended |
| F11 | **Validator weaknesses**: dropped required fields to validate canon-delta payloads; no `$ref` resolution check; evidence checked for length only (offsets were placeholders); no cross-file reference checks; no truthfulness checks; example coverage hard-coded | `tools/validate-planning-package.py` (baseline) | Rewritten: metaschema + every `$ref` resolved; manifest coverage of all example JSON; discriminated `oneOf` for canon-delta payloads with `canon-delta-payloads.schema.json` mirroring stored schemas (mirror enforced); evidence verified against real fixture manuscripts (slice equality, NFC, paragraph id, hash); ids, lineage, ADRs, paths, lint-rule ids, trap ids, contrast counts, ledger enums checked; stale lifecycle/length/gating terms; non-zero exit |
| F12 | **Evidence offsets were placeholders** ("actual start values are placeholders until the fixture manuscripts exist") | `examples/README.md`, `canon-delta.ch09.json` | Wrote the original fixture ch.9 manuscript (2,284 words, English, Korean-webnovel form) and the T16 rejected draft; recomputed every offset; added an inventory fact and hypothesis evidence |
| F13 | **Missing/dangling references**: a phase-reports directory referenced but absent; shorthand doc paths; `prior_life` | handoff guide §6, catalog | Progress document `09-progress.md` replaces the reports directory (ADR-0043); validator resolves paths |
| F14 | **Delivery order** prescribed Temporal + API + web from Phase 0, ahead of proving the story loop | ADR-0003/0021/0036, roadmap Phase 0 | ADR-0044 modular monolith first (CLI + Postgres-checkpointed steps); roadmap §0 checkpoint map; backlog items tagged [CP7] |
| F15 | **No CI** | repository root | `.github/workflows/planning-validation.yml` runs the validator and a fixture NFC/Hangul check on every push and PR |
| F16 | Role naming drift (`reconciler`/`verifier` unnamed in the catalog; both are deterministic) | `05-generation/01` §4 step 9 | Pipeline step names the deterministic reconciler and verifier explicitly; `extraction_adjudicator` is the only LLM role in that stage |

Items reviewed and found consistent (no change): reality-frame table for `lie/dream/hypothetical/
prediction`; per-timeline truth (ADR-0031) and the P5 divergence fixture; rejected-draft quarantine
guarantees (§7); knowledge source kinds vs ledger usage; lint rule ids used in docs and examples all defined;
all 29 fixture traps defined; length model (ADR-0034) in words.

## 3. What did not change (and why)

- The governing principle, the five FR-0 requirements, the eight-profile Narrative Identity, the
  two-contract Guard, separate prose/structure evaluation, tiered deterministic packs, evidence-backed
  bitemporal canon, the knowledge ledger and the fixture story are sound and were kept.
- No contrast sets were fabricated to reach a number; growth is a Checkpoint 6 task with an acceptance test.
- No live-model claims exist anywhere; nothing in the package is presented as tested.

## 4. Validation

```
$ python3 tools/validate-planning-package.py --quiet
schemas: 32 checked against metaschema; all $ref resolved
contradiction / stale-term scan: 0 hit(s)
RESULT: ALL OK
```

Full (non-quiet) output lists 14 example validations, the source-story bundle entries, payload-mirror
checks, evidence verification, fixture-id/lineage/ADR/path/lint-rule/trap resolution and the contrast-set
count check.

## 5. Open items carried into implementation

| Item | Where tracked |
| --- | --- |
| Grow contrast sets to ≥ 40 (original, four genres × functions) | B-6-3 |
| Fixture manuscripts beyond ch.9 (ch.12, ch.14 for TR1) | produced by Checkpoint 5 pipeline runs on the mock/replay provider |
| Calibration of every threshold (`uncalibrated`) | Phase 4 / B-4-5 |
| Temporal adoption decision point | Checkpoint 7 (ADR-0044) |
| Cross-calendar conversion anchors | Beta (ADR-0040 §5) |
