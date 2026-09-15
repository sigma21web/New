# Examples

Machine-readable examples that conform to `schemas/`. All story content is original fixture material
(*Second Awakening*, see `docs/07-quality/02-fixture-story.md`): **English manuscript prose in the Korean
serialized-webnovel tradition**. Validate with `python tools/validate-planning-package.py`.

```
examples/
  fixture/
    ids.json                          stable fixture UUIDs shared by all fixture files
    story-intake.json                 intake form (English premise; words per chapter; naming/terminology prefs)
    register-profile.seoha.json       Lee Seo-ha's dialogue-register & voice profile with the ch.87 transition
    chapter-contract.ch12.json        full chapter contract (Yu-ri joins / sibling misunderstanding / Mu-jin's leg)
    canon-delta.ch09.json             verified canon delta for ch.9 (injury fact, location supersede, inventory,
                                      knowledge, relationship with register, promise advance) — evidence offsets
                                      point into manuscripts/ch09.accepted.txt and are validator-checked
    manuscripts/ch09.accepted.txt     the accepted English text of fixture ch.9 (NFC; code-point offsets)
    manuscripts/ch09.rejected-draft.txt  the T16 rejected draft (quarantine fixture; contains the poison fact)
    source-story.micro.json           possession micro-fixture: source_story timeline facts + knowledge (ADR-0039)
    knowledge-ledger.json             expected knowledge states through season 1, per-timeline truths, guards,
                                      expected leak detections
    contrast-sets.seed.json           40 contrast sets in the repo, five classes each (kwn_english /
                                      western_english / translation_like / literary / weak_serial) + register
                                      cases; the four MVP genre profiles plus system-progression (a Beta
                                      overlay carried here as extra test coverage, not an MVP profile) ×
                                      eight narrative functions; meets the ≥ 40 pre-calibration target
                                      (B-6-3), no filler (ADR-0043)
  narrative-profiles/
    lang-en.v1.json                   English output-language profile (contract, punctuation, translation markers,
                                      prose lint thresholds, Prose Judge rubric)
    tradition-kr-webnovel.v1.json     Korean serialized-webnovel tradition profile (contract, structure, rhythm,
                                      devices, structure lint thresholds, Structure Judge rubric)
    genre-hunter-gate.v1.json         hunter/gate genre profile (English vocabulary, terminology defaults, devices)
    genre-regression.v1.json          regression overlay (hindsight monologue, countdown, divergence beat)
    genre-academy.v1.json             academy overlay (leaderboard, exam arcs, seniority registers)
    genre-romance-fantasy.v1.json     romance-fantasy overlay (letters, society register, slow-burn cadence)
  production-policies/
    economy.v1.json, standard.v1.json, premium.v1.json   Production Policy versions (ADR-0041): revision limits,
                                      per-dimension gates, candidate/extraction/context thresholds, override matrix
    project-second-awakening.composed.v1.json  composed identity for the fixture project (all eight layers)
```

Notes:
- Evidence offsets are real Unicode code-point offsets into `manuscripts/ch09.accepted.txt`; the validator
  checks length, slice equality, NFC, paragraph id and `quote_hash`. Evidence into chapters whose text does not
  exist yet (ch.12 anchors to future chapters) is limited to ch.9 spans for that reason.
- `knowledge-ledger.json` uses short names (`Do-yoon`, `P1`) and `"chapter.ordinal"` clocks for readability;
  the DB representation uses the ids in `ids.json` and full `storyClock` objects.
- Korean appears in `narrative-profiles/` only as **source terms** in terminology policies (e.g., 헌터 →
  *hunter*); manuscript and working text are English.
- Thresholds in the profiles are **starting values** with `calibration.status = uncalibrated` (ADR-0029).
