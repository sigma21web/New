# Requirements Traceability Matrix

Maps each requirement group to design documents, schemas, ADRs, backlog items, and tests. Keep this file
updated in the same change as any requirement/design change (AGENTS.md rule 1). Checkpoint 0 additions
(ADR-0037…0044) are appended to the affected rows; the Production Policy (`schemas/production-policy.schema.json`,
`examples/production-policies/`) is the single source for the numeric limits and gates those rows cite.

## Governing requirements (FR-0)

| Requirement | Statement | Design | Schemas | ADRs | Backlog | Tests (strategy §) |
| --- | --- | --- | --- | --- | --- | --- |
| **OUTPUT-EN-001** | Reader-facing manuscripts are composed directly in natural English. | `02-narrative-identity/01` §2–5; `05-generation/01` §4 step 2 (output-language gate); `06-system/07` §1 (3b) | `common.manuscriptLanguage`, `scene-draft.language`, `narrative-identity.output_language`, `llm-call-record.output_language_check`, `lint-report.output_language_check`; DB CHECK `manuscript_versions.language='en'` | 0026, 0027, 0028 | B-0-6, B-0-8, B-2-5, B-2-15 | §2 output-language check; §4 failure path; §5 scene_writer 20/20; §7 long-form zero failures |
| **STYLE-KWN-001** | Manuscripts use Korean serialized-webnovel narrative conventions regardless of the English output language. | `02-narrative-identity/01` §3.2, §6 dimension B; `02` §2; `03-genre-catalog`; `03-story-planning/01` §1, §9 | `narrative-identity.tradition` (contract, structure, rhythm, devices, rubric), `chapter-contract.hook/opening/local_satisfaction/scene_count`, `scorecard.sections.structure` | 0026, 0012, 0013 | B-1-1, B-1-4, B-2-4, B-2-6 | §2 structure lint; §5 structure_judge; §6 contrast sets (`western_english`/`weak_serial` fail B) |
| **STYLE-GUARD-001** | Every style-sensitive call receives both the English Output-Language Contract and the Korean-webnovel Narrative-Tradition Contract. | `02-narrative-identity/01` §4–5; `06-system/07` §1 (3); `04-memory-canon/04` §2.7 | `context-pack-manifest.narrative_identity_block.{output_language_contract_hash,tradition_contract_hash}`, `context-pack-manifest.validation.both_contracts_present`, `llm-call-record.{output_language_contract_hash,tradition_contract_hash}` | 0027 | B-0-6, B-1-2, B-1-14 | §2 Guard unit tests; §3 pack validation |
| **EVAL-SEPARATION-001** | English fluency and Korean-webnovel structural adherence are evaluated as separate dimensions. | `02-narrative-identity/01` §6; `05` §1–2; `05-generation/02` §1–2, §4 | `common.qualityDimension`, `scorecard.sections.{prose,structure,genre,voice}` (required prose+structure), `issue.dimension`, `patch.dimension` | 0026 | B-2-6, B-2-7 | §5 prose_judge/structure_judge goldens; §6 dimension-targeted repair does not regress the other dimension |
| **NO-TRANSLATION-001** | The pipeline does not generate Korean prose and translate it into English. | `05-generation/01` §1, §4; `05-generation/03` §2 (Language), §7; `02-narrative-identity/01` §5 (post-call check) | `prompt_families.manuscript_producing`; `llm-call-record.output_language_check`; no schema field admits non-English manuscript text | 0026, 0027 | B-0-6, B-2-5, B-2-14 | §4 output-language failure path; §5 scene_writer assertions; `tools/validate-planning-package.py` contradiction scan |

## Functional and nonfunctional requirements

| Requirement(s) | Design | Schemas | ADRs | Backlog | Tests (strategy §) |
| --- | --- | --- | --- | --- | --- |
| FR-1.1–1.8 intake, spec, Active Constraint Set | UW-1; `05-generation/01` §2.1; `05-generation/03` §7; `04-memory-canon/04` §2.5 | `story-intake`, `story-spec` (text + language + text_en; fixture `examples/fixture/story-spec.v3.json`), `common.localizedText`; `active_constraint_sets` table (migration 0003, content-addressed); `chapter-contract.active_constraints_ref`; `context-pack-manifest.active_constraint_set` | 0019, 0033, 0045 | B-1-17, B-2-1, B-3-2 | §2 constraint compiler (scope, dedupe, cap, `CONSTRAINTS_OVERFLOW`); §4 workflow; §10 injection |
| FR-2.1 concepts; FR-4.5 candidate comparison | `05-generation/01` §2.2; `02-eval` §5; `05-generation/04` role catalog (`chapter_comparator`) | `concept`, `comparison-verdict` | 0015 | B-2-2, B-3-3; B-6-4 | §5 position bias — `packages/workflows/src/comparison.test.ts` (early-stop and tie-ladder determinism) + `comparison.integration.test.ts` (both presentation orders, position bias detected and resolved by the shuffled-rubric run, ties to the deterministic ladder, mis-named verdict fails closed) |
| FR-2.2–2.8 bible, locks, register profiles, naming, terminology | `05-generation/01` §2.3; `02-narrative-identity/02` §4–7; `04-memory-canon/02` §1 | `entity` (display/native/romanized names), `register-profile`, `narrative-identity` (setting, naming, register_policy, terminology) | 0006, 0025, 0026 | B-2-3, B-3-4 | §3 bitemporal; §6 register/naming/terminology suites |
| FR-3.1–3.9 hierarchical planning, promises, contracts | `03-story-planning/01`, `02` | `series-blueprint`, `arc-plan`, `chapter-contract` (length_target words), `scene-plan` (register pre-resolution), `promise` | 0012, 0013, 0034 | B-2-4, B-3-5 | §4; §5 chapter_planner |
| FR-4.1–4.10 production pipeline incl. output-language check | `05-generation/01` §4–6; lifecycle §4 of `04-memory-canon/02` (approval-locked → accepted) | `scene-draft` (language, length), `patch`, `job`; `common.manuscriptStatus`/`manuscriptOrigin`, `production-policy` | 0003, 0014, 0015, 0027; 0037, 0041, 0044, 0046 | B-2-5, 2-9, 2-10, 2-11, 2-16; B-CP0-1, B-0-11 | §4; §8 chaos (non-English injection); §2 lifecycle state machine |
| FR-5.1–5.8 evaluation & revision (separate dimensions) | `05-generation/02`; `02-narrative-identity/05` §2 (per-dimension gates) | `issue` (dimension), `scorecard` (sections), `patch` (dimension), `lint-report`; `issue.override_class`, `scorecard.acceptance.dimension_results`, `production-policy.gates/override_matrix` | 0014, 0026; 0041, 0042 | B-2-6, B-2-7, B-2-14; B-CP0-5, B-CP0-6, B-2-9; B-6-4 | §5 regression — `patchRegression` per gated dimension with the targeted dimension exempt and a missing tolerance read as zero (`comparison.test.ts`), and the real ch.1 patch improving prose without regressing structure (`comparison.integration.test.ts`); §2 lint; §2 override matrix; §2 policy pinning |
| FR-6.1–6.13 narrative identity | `02-narrative-identity/01`–`05` | `narrative-identity`, `register-profile`, `lint-report`, `context-pack-manifest.narrative_identity_block` | 0026, 0027, 0028, 0029, 0025 | B-1-1…1-6 | §2, §6 |
| FR-7.1–7.18 memory/canon/knowledge incl. per-timeline truth and materiality | `04-memory-canon/01`–`03`; `04-memory-canon/02` §1.4 (StoryClock), §1.6–1.7 (frames × timelines), §9 (change classes) | `fact`, `event`, `proposition` (truth[]), `knowledge-state`, `relationship-state` (register), `canon-delta` (proposition_truth items), `canon-commit`, `common` (evidenceRef code points, materiality); `canon-delta` discriminated union + `canon-delta-payloads`, `common.storyClock/timelineKind`, `event.narrated_at`, `fact.$defs.factFrame`; `summaries` + `search_documents` accepted-only triggers (FR-7.11, FR-7.17; migration 0003) | 0006, 0007, 0008, 0009, 0022, 0023, 0030, 0031, 0032; 0037, 0038, 0039, 0040; 0045 | B-0-5, B-1-7…1-12, 1-15, 1-16, B-2-8; B-CP0-1…4, B-0-5 | §3 integration; §7 long-form; §2 StoryClock, change classes, frame × timeline matrix; §3 TR1/R1/C1/RB1/SR1, rejected-draft isolation through the assembler and the index (T16); `source-story.micro.json` |
| FR-8.1–8.5 context packs | `04-memory-canon/04`, `05` | `context-pack-manifest` (materiality, contract hashes, active constraints, `sections[]`, `items[].source/provenance`, `degradation`, `previous_chapter`); `production-policy.context.input_budget_tokens`; tables `summaries`, `search_documents`, `active_constraint_sets`, `context_packs`, `embedding_sets` (migration 0003) | 0010, 0011, 0033, 0035, 0045 | B-1-13, B-1-14, B-1-17 | §2 constraint compiler, ranker; §3 recall/determinism, rejected-draft isolation, pack determinism & validation; embedding-set switch (deferred, ADR-0045) |
| FR-9.1–9.6 budgets, jobs, audit, gateway | `06-system/05`, `07`, `04` | `llm-call-record`, `job`, `budget`; `job.production_policy_version`, `llm-call-record.production_policy_version` | 0004, 0018, 0027; 0041 | B-0-6, B-2-12, B-3-8; B-0-12 | §8, §9 |
| FR-10.1–10.4 export & rights | `06-system/06` §9–10; UW-16 | `export-request` (spelling_locale, romanized glossary) | 0025 | B-2-17, B-3-8 | manual + unit |
| FR-11.1–11.5 security & tenancy | `06-system/06` | — | 0020 | B-0-4, B-0-9, B-4-4 | §10 |
| NFR-A auditability | `06-system/05` §5, `07` §1 | `llm-call-record` (identity + contract hashes + language check), `context-pack-manifest` | 0004, 0016, 0027 | B-0-6 | §3 |
| NFR-B reliability | `06-system/04`; ADR-0044 staged orchestration (Postgres-checkpointed steps first) | `job` | 0003; 0044, 0046 | B-2-10, B-4-2; B-6-2 | §8 — `packages/workflows/src/recovery.integration.test.ts` (failure after each pre-commit step leaves no chapter commit/accepted version/summary/index; resume replays completed steps and a third run adds no spend; racing commit → `CANON_STALE`; provider fault fails closed; blocked gate → `needs_attention`). NFR-B.1's "durable (Temporal)" wording is deferred by ADR-0044: durability today is Postgres-checkpointed steps, and these tests assert that mechanism, not Temporal |
| NFR-C performance | `06-system/02` §14, `04-memory-canon/05` | — | 0002 | B-4-x, load | §11 |
| NFR-D cost | `06-system/05` | `budget`, `common.lengthModel` | 0018, 0034 | B-2-12 | §9 |
| NFR-E security/privacy | `06-system/06` | — | 0020 | B-0-4, B-4-4 | §10 |
| NFR-F integrity (code points, length model, embedding sets) | `06-system/02` §12; fixture manuscripts with validator-checked offsets | `common` (evidenceRef, lengthModel, storyClock) | 0022, 0030, 0034, 0035 | B-0-3, B-0-5, B-1-13; B-CP0-8 | §2, §3; validator evidence check (code points, NFC, paragraph ids, hashes) |
| NFR-G observability | `06-system/05` §5 | `llm-call-record` | — | B-0-6, B-4-6 | — |
| NFR-H usability/i18n | `06-system/08` | — | — | B-3-1 | usability pass |
| NFR-I maintainability (calibration, contradiction scan) | `05-generation/03`; AGENTS.md; `tools/validate-planning-package.py` | all | 0016, 0021, 0029 | B-0-1, B-0-2, B-0-7 | §1 contract |

## Hard-question coverage (from the original brief)

| # | Question | Where answered |
| --- | --- | --- |
| 1 | Remember previous chapter exactly | `04-memory-canon/04` §4; proved for ch.1 → ch.2 in `packages/workflows/src/continuity.integration.test.ts` (B-6-1) |
| 2 | Retrieve from hundreds of chapters ago | `04-memory-canon/05`; `04` §2 |
| 3 | Know what each character knows | `04-memory-canon/03` |
| 4 | Truth/belief/suspicion/lies/secrets (truth per timeline) | `04-memory-canon/03` §2, `02` §1.6; ADR-0031 |
| 5 | Future plans vs completed events | `04-memory-canon/02` §3; ADR-0007 |
| 6 | Rejected drafts never enter canon | `04-memory-canon/02` §7; ADR-0009 |
| 7 | Approved chapter updates memory | `04-memory-canon/02` §5; `05-generation/01` §4 step 9 |
| 8 | Conflicting extractions resolved | `04-memory-canon/02` §5.2 |
| 9 | Earlier chapter changes propagate (material edges) | `04-memory-canon/02` §8–9; ADR-0032 |
| 10 | Every relevant call preserves the narrative identity (English + Korean-webnovel form) | `02-narrative-identity/01` §3–5; ADR-0027 |
| 11 | Detect Western-novel drift and translation-like English | `02-narrative-identity/04`, `05` |
| 12 | Repair without rewriting everything (dimension-targeted) | `02-narrative-identity/05` §3; `05-generation/02` §4; ADR-0014 |
| 13 | Reliability in long workflows | `06-system/04` |
| 14 | Cost control | `06-system/05`; ADR-0018 |
| 15 | Another agent can begin | `08-delivery/05`, `01`, `02`; `schemas/`, `examples/` |

Full audit: `docs/08-delivery/07-plan-audit.md`. Correction log: `docs/08-delivery/08-correction-changelog.md`.
