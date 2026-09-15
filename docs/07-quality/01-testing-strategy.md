# Testing Strategy

Principle: **the fixture story is the integration test**. Every subsystem test that touches story content
uses `docs/07-quality/02-fixture-story.md` + `examples/fixture/` (English manuscript, Korean-webnovel form)
so that traps are shared and failures are explainable in story terms. Model-dependent tests run against
`ReplayProvider` (recorded outputs) in CI and against live models in a nightly/spend-capped suite.

## 1. Test pyramid

| Layer | Tooling | Runs |
| --- | --- | --- |
| Unit (pure functions: prose/structure lint rules, identity compiler, rankers, reconcilers, state machines, code-point utilities, length model, SQL functions) | Vitest; pgTAP for SQL functions | every PR |
| Contract (schemas ↔ types ↔ API) | JSON Schema validation of examples; generated types compile; API schema tests; `tools/validate-planning-package.py` contradiction scan | every PR |
| Integration (DB + services: canon commit, pack assembly, retrieval, RLS, embedding-set switch) | Vitest + testcontainers Postgres/pgvector (+ optional grammar service) | every PR |
| Workflow (Temporal test server; MockProvider/ReplayProvider) | Temporal TS testing framework | every PR |
| Prompt regression (live or replayed models) | custom runner; golden assertions incl. contrast sets and output-language check | on prompt/model change; nightly |
| End-to-end (fixture story 20 chapters on live models, low budget) | staging | nightly / release |
| Long-form continuity (fixture 120-chapter compressed run with synthetic acceptance) | staging | weekly |
| Chaos/failure recovery | FaultInjectingProvider; worker kills; DB faults | weekly + release |
| Load | k6 against API + synthetic pack assembly on a 3,000-chapter dataset | release |
| Security | RLS tests, authz matrix, injection corpus, dependency & secret scanning | every PR / nightly |
| Human bilingual-reviewer evaluation | blind rating protocol on two scales | monthly |

## 2. Unit tests (highlights)

- **Output-language check**: English passes; Korean, mixed-script, and romanized-heavy samples classified
  correctly; registry romanizations and preserved-script contexts excluded from detection.
- **English Prose Lint**: each EP-* rule has positive/negative English samples
  (`packages/prose/fixtures/*.en.txt`); the translation-marker set must score `translation_like` variants
  above `kwn_english` variants on every contrast set; calque list and honorific-morpheme detection
  (`Seo-ha-nim`) tests; locale consistency (`en-US` vs `en-GB` word lists).
- **Structure Lint**: hook index, opening/ending classifiers, payoff markers, exposition runs, cadence
  windows on synthetic chapters; `western_english` and `weak_serial` variants must trip ST-HOOK/ST-END/
  ST-PAY as expected.
- **Register check**: expected register derivation from policy + relationship state at story time;
  rendered-register feature extraction (titles, address terms, contractions, imperatives); RG-01..06 on
  `register_cases` in `contrast-sets.seed.json` (Yu-ri → Mu-jin, the ch.86/ch.88 milestone, public
  variant, honorific morpheme).
- **Narrative Identity compiler**: determinism (same inputs → same hash), both contracts always present and
  first, shedding order, never-shed sections, compile error on overflow, IDENTITY_TAIL content, separate
  contract hashes in the manifest, preferences cannot override contracts.
- **Narrative Identity Guard**: rejects missing block, missing either contract, stale hash, unembedded
  header, unsupported output language; passes valid; records versions and both hashes.
- **StoryClock ordering** (ADR-0040): narrative order total; derived `ord`; flashback with earlier
  `world_date` and later chapter; `unknown` precision excluded from world order; overlapping `approx`
  windows unordered; cross-calendar → `calendar_incomparable`; tie-break by id; cross-timeline only through
  the divergence clock. **Bitemporal change classes** (ADR-0038): one test per class — transition keeps the
  prior row asserted with closed `valid_to` (TR1); correction retracts and re-asserts; retcon retracts old-version
  rows; rollback restores exact prior `valid_to`/`superseded_by`/`retracted_at_version` from `inverse`;
  system-time retraction changes no validity. **Reality-frame × timeline-kind matrix** (ADR-0039): facts from
  `lie/dream/plan` rejected; `source_story` fact legal only on a `source_story` timeline; `prior_loop` fact
  on `main` → `FRAME_VIOLATION`; per-timeline truth inheritance up to divergence; source-story divergence.
- **Lifecycle state machine** (ADR-0037): extraction refuses `working` versions; `accepted` only set by the
  commit; failed commit leaves `approved`; `origin` and `status` independent; contract `locked` ≠ manuscript
  `approved`.
- **Override matrix** (ADR-0042): `never`-class issues cannot be approved by any signal; a locked-fact
  contradiction opens a correction proposal and the gate stays closed until the re-run passes; `reviewer`
  overrides are recorded and never alter scorecard sections.
- **Production Policy pinning** (ADR-0041): a job pins `policy/standard@1`; per-dimension gate evaluation
  ignores `overall.score`; early stop requires every dimension over threshold + margin.
- **Reconciler**: agreed / single-source / conflict classification; canonicalization; alias resolution via
  the naming registry.
- **Evidence verifier**: exact and fuzzy anchoring on code-point offsets; rejects paraphrases; conformance
  vector across ASCII, curly quotes, em dashes, emoji, combining marks, Hangul registry names (ADR-0030)
  — identical results in TS, Python (tooling), PostgreSQL and the browser offset mapper.
- **Ranker**: deterministic scores; diversity caps; dedupe vs T1; materiality assignment of items.
- **Budget guard**: reservations, releases, hard stop.
- **Length model** (ADR-0034): words/code points/paragraphs/sentences on tricky English (hyphenated names,
  em dashes, ellipses, numerals, contractions).
- **Active Constraint Set compiler** (ADR-0033): scope filtering, dedupe, supersession, cap enforcement,
  `CONSTRAINTS_OVERFLOW`.

## 3. Integration tests

- **Atomic canon commit**: fault injected mid-transaction → no partial rows; version unchanged; retry
  succeeds exactly once.
- **Optimistic version check**: two commits racing → one fails with `STALE_CANON`.
- **Rejected-draft isolation**: quarantine content never appears in facts/summaries/packs/exemplars/search
  (trap T16).
- **Evidence trigger**: mismatched quote rejected; non-accepted version rejected; code-point semantics on
  non-BMP characters.
- **RLS**: cross-workspace queries return zero rows for every tenant table.
- **Retrieval recall**: fixture contracts → packs must include specified items (recall@pack targets);
  English full-text with registry thesaurus ("Do-yoon" ↔ "Kang Do-yoon").
- **Embedding-set switch** (ADR-0035): new set built, recall test passes, atomic flip, old set retired;
  retrieval never mixes sets.
- **Pack determinism & validation**: identical inputs → identical hash; T0 byte-equality incl. Active
  Constraint Set bytes; both contract hashes present; prev tail hash; degradation ladder.
- **Context packs over the real canon** (`packages/context/src/context.integration.test.ts`): chapter k
  receives chapter k−1's L1 summary, verbatim tail, ending hook and committed deltas with version + canon
  pins; knowledge is knower-specific and secrets never leak; relationships are directional and time-correct;
  prior-loop facts stay off the main timeline (memory is labeled); distant accepted events are recovered
  lexically with provenance; optional retrieval outages degrade with flags; structured failure blocks
  (`STRUCTURED_RETRIEVAL_UNAVAILABLE`); k−1 not accepted fails (`PREVIOUS_CHAPTER_NOT_ACCEPTED`) and never
  substitutes a draft; rollback removes the version's search documents and summary; checker/extractor
  packs accept only job-scoped `working`/`approved` text and refuse quarantined ids.
- **Dependency edges** (ADR-0032): material vs contextual assignment from T0/T1/T2; promotion from
  writer claims at commit; R1 marks only material dependents stale.
- **Bitemporal queries**: state at chapter k / as of version v for injuries, locations, ranks (fixture).
- **Knowledge & truth queries**: stance at chapter k per knower; per-timeline truth for P5/P8; guards; leak
  detection cases.
- **Migrations**: apply all → fixture load → down last 3 → up; data preserved; performance of indexes.

## 4. Workflow tests

- Chapter pipeline happy path with MockProvider → accepted; trace complete; output-language check recorded.
- Output-language failure path: mock returns Korean prose → discarded, regenerated once, then rerouted;
  chapter never proceeds to evaluation with non-English text.
- Revision loop: seeded issues → dimension-targeted patches → regression → clean; round limit →
  `needs_attention`.
- Gate policies per mode; signals (approve/reject/request changes/pause/cancel/direction).
- Batch: sequential dependency; pause on review; resume; cancellation mid-scene keeps partial artifacts
  non-canonical.
- Stale canon between evaluation and commit → re-validate path.
- Duplicate start rejected; lease expiry.
- Extraction failure → chapter remains `approved`; retry path.
- Rehydration from artifacts after simulated history loss.

## 5. Prompt regression suite

Golden cases per family (inputs = fixture packs; assertions structured). Examples:
- `prose_judge`: on every contrast set, `kwn_english` and `western_english` score high on A;
  `translation_like` scores lowest on A; `literary` scores below `kwn_english` on A; evidence paragraph IDs
  present for every score < 4.
- `structure_judge`: `kwn_english` highest on B; `western_english` and `weak_serial` fail B; `translation_like`
  is not penalized on B for its language problems (dimension separation).
- `continuity_checker`: recall ≥ 0.9 on seeded blocking traps (forgotten injury, wrong location, rank
  regression, inventory impossibility); precision ≥ 0.8 on majors; every issue has span + canon evidence.
- `knowledge_leak_checker`: detects Seo-ha acting on P1 before ch.58; does not flag narrator knowledge.
- `extractor_a/b`: recover ≥ 95% of the fixture's annotated canon items with valid quotes; zero items from
  `plan` hypotheses the text did not realize; emit `proposition_truth` for P5 on `main` at ch.19.
- `scene_writer`: outputs schema-valid; **passes the output-language check 20/20**; prose lint
  translation-marker rate ≤ threshold; structure lint hook index ≤ 5 on ≥ 18/20; register rendering accuracy
  ≥ 95% on speaker pairs; length within tolerance (words) on 10 samples.
- `chapter_planner`: contracts validate; no knowledge delta without channel; cadence checks pass; length
  target in words.
- Position bias: comparator both-order consistency ≥ 85% on fixture pairs.
Runner records model versions, cost, latency; promotion gate per prompt architecture §5.

## 6. Narrative-identity tests (English prose + Korean-webnovel structure)

- **Five-class contrast set** (40 in the repo → 200 at Beta): per `docs/02-narrative-identity/05` §7 — `kwn_english`
  must rank highest jointly on A and B in ≥ 95% of sets; lint separations as specified; after repair of a
  `translation_like` variant, its prose metrics must improve ≥ 60% on marker rate and its structure score
  must not regress (dimension-targeted repair does not break the other dimension).
- **Register suite**: pairs × contexts generated from the fixture register profiles (junior → senior;
  lovers after ch.87 in private vs public; forced public formality after ch.60); register check + Voice Judge
  accuracy; honorific-morpheme and kinship-vocative anti-patterns.
- **Naming & terminology suite**: registry enforcement (`EP-NAME-*`, `EP-TERM-*`), romanization
  consistency, first-use gloss, preserve-script contexts; unregistered romanized term (T27) flagged.
- **Format drift suite**: screenplay/webtoon/markdown/LN samples blocked.
- **Human reviewer protocol (monthly)**: 30 chapters, 3 bilingual reviewers (native-quality English judgment
  *and* familiarity with Korean webnovel conventions), blind 1–5 on two scales — "natural English" and
  "reads as a Korean webnovel of this genre" — plus free comments; Spearman ≥ 0.8 between each judge and its
  scale; results feed threshold calibration (ADR-0029).

## 7. Long-form continuity tests

- **Compressed 120-chapter run**: fixture bible + plans; chapters supplied by `ReplayProvider` from a
  recorded English corpus with annotated canon; every commit's delta compared to annotations; at chapters
  40, 80, 120: state-at-time, knowledge, per-timeline truth and relationship/register assertions; pack
  recall for distant events; summary fidelity (L2/L3 contain the annotated core events); no output-language
  failures.
- **Live 20-chapter run** nightly with a small budget: end-to-end acceptance, zero blocking issues at
  acceptance, prose and structure score medians, cost per chapter within tier.

## 8. Failure-recovery & chaos

Inject: provider 5xx/timeouts/429; invalid JSON; truncation; **non-English output**; worker kill during
scene 2; DB failure during commit; stale canon race; cancellation during extraction; budget exhaustion
mid-revision. Assert: no duplicate spend beyond one call; no partial canon; resumable; final states correct;
audit complete.

## 9. Cost-limit tests

Hard limit reached mid-chapter → pause at activity boundary, no further calls, resume after raise;
prediction accuracy tracked (±30% after calibration); candidate early-stop respected.

## 10. Security tests

RLS matrix; authz per route per role; injection corpus (English/Korean meta-instructions in requirements,
comments, documents, including attempts to change the output language or disable the tradition contract)
→ classifier flags and downstream isolation; secrets scanning; dependency audit; SSRF/XSS/CSRF suites.

## 11. Load tests

3,000-chapter synthetic English project: pack assembly p95 ≤ 3 s; inspector queries p95 ≤ 500 ms; 8
concurrent chapter jobs per workspace; Temporal task latency; DB connection pool saturation behavior.

## 12. Definition of test data

- `examples/fixture/` (this repo): intake, register profile, ch.12 contract, ch.9 canon delta with evidence
  offsets into `examples/fixture/manuscripts/ch09.accepted.txt` (and the T16 rejected draft
  `ch09.rejected-draft.txt`), knowledge ledger, the 40 contrast sets in the repo (the ≥ 40 target of B-6-3 met),
  register cases, the possession micro-fixture `source-story.micro.json` (ADR-0039);
  `examples/narrative-profiles/`: language, tradition, four MVP genre profiles and the composed identity;
  `examples/production-policies/`: economy / standard / premium policy versions (ADR-0041).
- Recorded model outputs for `ReplayProvider` are produced during implementation and stored in a
  git-LFS or object-storage bucket (not in this planning repo).
