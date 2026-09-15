# Definition of Done

## 1. Per backlog item

- Behavior matches the referenced requirement IDs and ADRs; deviations have an ADR.
- Schemas updated first if the wire/storage shape changes; generated types regenerated; examples validate;
  `tools/validate-planning-package.py` green (schemas, examples, contradiction scan).
- Unit + integration tests added/updated; fixture-story assertions extended when story semantics are
  touched.
- Prompt changes pass the prompt regression suite (including contrast sets and the output-language check
  for manuscript roles) and record results; prompt version bumped, never edited.
- Observability: new activity/role emits spans + metrics; cost accounted.
- Security: RLS on new tables; inputs schema-validated; no secrets; untrusted text handling respected.
- Docs: affected `docs/` updated; traceability matrix row updated.
- Reviewed by one other engineer (or agent review pass) with the checklist below.

## 2. Per phase (roadmap)

Each phase has explicit exit criteria in `docs/08-delivery/01-implementation-roadmap.md`. A phase is done
when all its P0 backlog items meet §1, the fixture-story checks for that phase pass in CI, and a demo
script for the phase runs end to end on staging.

## 3. MVP done (vertical slice, ADR-0036)

- All FR items tagged **M/P0** implemented and traced, including the governing requirements OUTPUT-EN-001,
  STYLE-KWN-001, STYLE-GUARD-001, EVAL-SEPARATION-001, NO-TRANSLATION-001.
- Fixture story: all traps T1–T29 detected as specified; R1/C1/RB1 behave as specified (material vs
  contextual dependents); T16 isolation proven.
- Live 20-chapter run (Standard tier) completes with: **every accepted chapter passes the output-language
  check (English)**; zero blocking issues at acceptance; median `prose_score` ≥ 78 **and** median
  `structure_score` ≥ 78 (separately, each against `policy.gates.dimensions.<d>.min_score` of `standard.v1`; no averaging); cost per accepted chapter within tier envelope; every
  accepted fact traceable to evidence.
- Contrast-set regression green for the pinned prompt set: `kwn_english` ranks highest jointly on prose and
  structure in ≥ 95% of the contrast sets, with ≥ 40 sets present (B-6-3; 40 sets exist today).
- Chaos suite green; RLS suite green; prompt regression green for the pinned prompt set.
- A user can complete UW-1…UW-17 (MVP variants) in the UI without operator help.
- Runbooks: deploy, restore, rotate secrets, raise budgets, handle `needs_attention`.

## 4. Review checklist (invariants)

1. Canon extracted only from approval-locked (`approved`) versions and read only from `accepted` versions; commit atomic; version bump optimistic and exactly once; the version is set `accepted` inside the commit (ADR-0037).
2. Every fact/event/knowledge change with evidence (or bible source); offsets are code points.
3. Plans never rendered as facts; frames respected per timeline kind (ADR-0039); proposition truth per timeline; normal transitions close validity and never retract history (ADR-0038).
4. Rejected drafts quarantined; not reachable by assembler/extractor/exemplar/search.
5. Narrative Identity Guard enforced for style-sensitive roles with **both** contracts; identity version and
   contract hashes recorded.
6. Manuscript-producing roles pass the output-language check; no translation step anywhere.
7. Prompt version recorded; no ad-hoc prompt strings in code.
8. Context packs manifested and hashed; T0 validated byte-for-byte; Active Constraint Set bytes verified; every item carries source + version + provenance label; excluded items carry a reason; the previous chapter comes only from the accepted version (never a draft); structured retrieval failure blocks, optional retrieval failure degrades with a flag (ADR-0045).
9. Activities idempotent; budgets checked pre-call.
10. Dependency edges carry materiality; only material edges mark stale by default.
11. Numeric thresholds and workflow limits live in profile data and the pinned Production Policy with calibration status, never in code; gates are per dimension (ADR-0041); overrides follow the override matrix (ADR-0042).
12. Tenancy: `workspace_id` + RLS on every new table.
13. English fixture prose and Korean terminology entries are never machine-translated or reflowed by tooling.
