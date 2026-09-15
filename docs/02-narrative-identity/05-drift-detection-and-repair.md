# Drift Detection and Repair

## 1. Detection pipeline (per manuscript version)

```
draft/version text (English)
  │
  ├─► Output-language check (deterministic, blocking gate)
  ├─► English Prose Lint (EP-*) ────────────────► ProseLintReport (dimension A)
  ├─► Structure Lint (ST-*) ────────────────────► StructureLintReport (dimension B)
  ├─► Register check (RG-*) ────────────────────► RegisterReport (dimension D)
  ├─► Prose Judge (LLM, judge_rubric_prose) ────► ProseReport: fluency, idiom, translation-like syntax,
  │                                               literary/Western diction drift, readability (A)
  ├─► Structure Judge (LLM, judge_rubric_structure) ► StructureReport: hook, payoff, pacing, exposition,
  │                                               dialogue-forwardness, ending pull; drift flags (B)
  ├─► Genre Judge (LLM, judge_rubric_genre) ────► GenreReport (C)
  └─► Voice Judge (LLM; participants' register digests + voice exemplars) ► VoiceReport (D)
                                                   │
                                                   ▼
                          Issue merge & span clustering by dimension ──► Scorecard sections
                          prose · structure · genre · voice (+ continuity from other evaluators)
```

- Lint and register results are **given to the judges** so they spend attention on what rules cannot
  see (unnatural collocations, essayistic interiority, Western scene rhythm, humor timing, whether an
  ending truly pulls).
- Judges output **evidence paragraph IDs first**; issues without a resolvable span are downgraded to
  `note` and cannot block.
- The Prose Judge and the Structure Judge are **separate calls with separate rubrics** (EVAL-SEPARATION-001).
  A chapter that is fluent English with Western pacing fails B and passes A; a perfectly serialized
  chapter with translation-like English fails A and passes B. The scorecard shows which, and repair
  targets that dimension.

## 2. Scoring and gating (Production Policy, ADR-0041; starting values, ADR-0029)

| Dimension | Composition (`policy.gates.dimensions.<d>.judge_weight`) | Gate `min_score` (starting values, `economy.v1` / `standard.v1` / `premium.v1`) |
| --- | --- | --- |
| A `prose_score` | Prose Judge 0.6 · Prose Lint composite 0.4 (1 − normalized violation density) | 70 / 78 / 84 |
| B `structure_score` | Structure Judge 0.65 · Structure Lint composite 0.35 | 70 / 78 / 84 |
| C `genre_score` | Genre Judge 0.8 · terminology/device compliance 0.2 | 65 / 72 / 80 |
| D `voice_score` | Voice Judge 0.7 · Register check 0.3 | 70 / 76 / 82 |

The numbers live in `examples/production-policies/*.v1.json`; this table quotes them. **Every gated
dimension must pass on its own**; there is no averaged "style score" and `scorecard.overall.score` is never
a gate input. Any `blocking` violation (`EP-LANG-01` non-English prose, `EP-FMT-01` screenplay/script,
`EP-TERM-03` script outside preserve contexts, `EP-TRUNC-01`) fails regardless of scores and cannot be
overridden (ADR-0042). Drift flags at judge confidence ≥ `policy.gates.drift_flag_min_confidence` across
≥ `policy.gates.drift_flag_scene_repair_ratio` of paragraphs → `major` chapter-level issue → **scene-level**
repair plan for that dimension instead of per-paragraph patches:
- `translation_like` / `literary` (A) → prose scene rewrite;
- `western_novel` / `serial` (B) → structure scene rewrite (re-plan beats: hook, payoff, ending).

## 3. Repair strategy (patch-first, dimension-targeted)

| Cluster kind | Reviser | Context given |
| --- | --- | --- |
| Sentence-level prose (opening repetition, translation marker, filter words, tag overuse) | `prose_reviser` → `sentence_patch` | language contract + prose rules, span ± 1 sentence, rule text |
| Paragraph-level prose (rhythm, long paragraph, literary diction) | `prose_reviser` → `paragraph_patch` | editor block, paragraph ± 1, register digests if dialogue |
| Register/voice (RG-*, voice issues) | `dialogue_reviser` → `dialogue_patch` | editor block, utterance + surrounding beats, pair's register digest at story time, allowed shift reason |
| Structure: weak hook / weak ending / exposition run | `structure_reviser` → opening/ending/paragraph patch | tradition contract + structure rules, scene plan, the opening or closing paragraphs, hook/ending type required by contract |
| Structure: scene-level drift (≥ 30% of scene paragraphs flagged `western_novel`/`serial`) | `scene_rewriter` (structure mode) | writer block, scene plan with beat tags, previous scene tail, facts-in-scene (must preserve), length target |
| Prose: scene-level drift (`translation_like`/`literary` ≥ 30%) | `scene_rewriter` (prose mode) | same, emphasis on language contract |
| Chapter-level drift (> `policy.gates.chapter_regenerate_ratio` of paragraphs) or `policy.revision.max_scene_rewrites` failed scene rewrites | `chapter_regenerate` (counts against candidate budget) | full writer pack |

Reviser output is structured: `{ span_id, new_text, changed_claims[], preserved_facts_ack[] }`.
`changed_claims` non-empty → continuity re-check on the span. Missing acks → patch rejected.

## 4. Regression testing of patches

After applying patches to create version v+1:
1. Output-language check on changed segments (any failure reverts the patch immediately).
2. Re-lint changed paragraphs ± 1 (EP-* and ST-* as relevant) and chapter metrics.
3. Register check on changed utterances.
4. Continuity checker on changed spans if `changed_claims` non-empty or fact-bearing.
5. After ≥ `policy.revision.smoke_after_patches` patches or any scene rewrite: **both** Prose and Structure
   Judges in smoke mode (cheaper model allowed) on the whole chapter + cross-chapter repetition check.
6. Compare scorecards v vs v+1: no dimension may regress beyond `policy.revision.regression_tolerance_points`
   (starting value 3) and no
   new blocking/major issue; otherwise revert the offending patch and try an alternate repair once, then
   escalate.

## 5. Escalation & human review

Repair rounds per chapter are bounded by `policy.revision.max_rounds` (starting value 3 in `standard.v1`;
see `docs/05-generation/02-evaluation-and-revision-pipeline.md` §4.2 for the full limit set). Beyond: review
queue with residual issues per dimension, side-by-side original vs patched, and an "approve with overrides"
action restricted by the override matrix (ADR-0042; `never`-class issues cannot be waived) — recorded,
feeds calibration.

## 6. Anti-self-preference and position bias

Judges never see the writer's exemplars; gating judges default to a **different model family** from the
writer; pairwise comparisons run both orders; evidence-first JSON ordering.

## 7. Calibration — the five-class contrast set (ADR-0029)

Each contrast **set** renders the same story content five ways (all English, all original, studio-authored):

| Class | Intended scores |
| --- | --- |
| `kwn_english` — natural English with Korean-webnovel structure (the target) | A high, B high |
| `western_english` — natural English with Western novel structure/pacing | A high, B low |
| `translation_like` — awkward translation-like English (serialized structure may be intact) | A low, B mid/high |
| `literary` — overly literary English (long sentences, metaphor chains, reflective ending) | A mid/low, B low |
| `weak_serial` — plain English with weak serialized construction (late hook, no payoff, fade-out ending) | A mid, B low |

Requirements: the `kwn_english` version must score **highest on A and B jointly** in ≥ 95% of sets; the
Prose Judge must rank `translation_like` lowest on A in ≥ 90%; the Structure Judge must rank `western_english`
and `weak_serial` below `kwn_english` on B in ≥ 95%; Prose Lint must produce a higher translation-marker rate on
`translation_like` than on `kwn_english` in ≥ 90%; Structure Lint must flag `western_english` late hook/weak
ending in ≥ 80%. Today the repository holds **40 contrast sets in the repo** (`examples/fixture/contrast-sets.seed.json`: the four Checkpoint 0 starter sets plus 36 authored in Checkpoint 6, covering five genres × eight narrative functions — hook, emotional beat, banter, status window, reveal, ending, exposition, action); this meets the ≥ 40 the calibration round requires (backlog B-6-3) and Beta requires ≥ 200. Filler sets are not added to reach a number (ADR-0043).

**Reviewer panel:** bilingual reviewers able to judge native-quality English *and* Korean webnovel
conventions rate 30 sampled chapters monthly on two scales; Spearman ≥ 0.8 between each judge and its
scale; drift > 0.1 triggers rubric/prompt review. Overrides cluster → threshold tuning proposals per profile
version with `calibration_status` updates.

## 8. Failure modes and mitigations

| Failure | Mitigation |
| --- | --- |
| Judge rewards its own dialect / prefers Western literary polish (raising A while B suffers) | separate rubrics; different model family; contrast set includes `western_english` and `literary` classes that must lose on B |
| Lint false positives in stylized passages (deliberate repetition) | `stylistic_repeat` paragraph tag (≤ 2/chapter), judge confirms |
| Repair introduces contradictions | `changed_claims` → continuity re-check; must-preserve acks |
| Repair for A breaks B (prose polish removes the hook) or vice versa | regression runs both judges after scene-level work; no dimension may regress |
| Repair loops on the same span | attempt counter; escalate scope |
| Genre formats (status windows) trip prose rules | system blocks parsed separately before lint |
| Romanized terms flagged as errors | terminology registry is the allowlist; `EP-TERM-01` only fires for unregistered tokens |
| Model writes Korean or mixes scripts | `EP-LANG-01`/`EP-TERM-03` blocking; regenerate with violation named; repeated failure → route to alternate P-class model |
