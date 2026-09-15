# ADR-0043: Truthful planning baseline — starter artifacts are labeled, and implementation status is recorded in one place

- **Status:** Accepted
- **Date:** 2026-09-13
- **Deciders:** engineering agent (Checkpoint 0 audit)

## Context
Several statements in the package described artifacts that did not exist or overstated what did: "MVP seed
≈ 40 contrast sets" (the fixture has 4); "4 core genre profiles as data" (one profile file existed);
a phase-reports directory referenced but absent; the roadmap and handoff guide referred to tests, CI and
a seed script as if present. The README said "planning complete". A reader implementing from the package
could not tell design intent from delivered material.

## Decision
1. **Every quantitative claim about repository contents must be true of the repository at HEAD.** Where a
   target differs from the current count, write both: "N contrast sets in the repo; target ≥ M
   before threshold calibration (B-6-x)", with N read from the file and M from the backlog item. The
   validator checks the contrast-set count claim against the file.
2. **Starter artifacts are labeled `starter`** (in file `_meta` or profile `calibration.notes`) and the
   work to grow them is a backlog item, not a description of the present.
3. **Implementation status lives in `docs/08-delivery/09-progress.md`** (created in Checkpoint 0) — one durable document with
   current state, completed checkpoints, branch/commit, open PRs and dependencies, validation commands,
   latest results, known failures, risks and the next exact tasks. Other documents do not claim
   implementation status; they describe design.
4. The four MVP genre profiles ship as data in `examples/narrative-profiles/` (hunter-gate, regression,
   academy, romance-fantasy); the two production-profile combination rules in the genre catalog are
   validated by the validator (referenced profile ids must exist).
5. No phase-reports directory until a phase report exists; the handoff guide points to the progress
   document.

## Alternatives considered
- Generate 36 filler contrast sets to satisfy the number — low-quality calibration data is worse than a
  labeled starter set (the task brief forbids filler).

## Consequences
Scope, roadmap, testing strategy, drift-repair doc, README and examples README corrected; `09-progress.md`
created; validator gains a truthfulness check for the contrast-set count and profile references.
