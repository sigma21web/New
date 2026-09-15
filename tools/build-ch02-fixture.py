#!/usr/bin/env python3
"""
Builds the Checkpoint 6 chapter-2 replay fixture (examples/fixture/ch02/) from the authored scene texts:

  * replay.ch02.json   — ReplayProvider recordings keyed by workflow activity id (`activity:<id>`),
                         with {{placeholders}} bound at replay time
  * expected.ch02.json — code-point offsets and counts the multi-chapter continuity tests assert against

Chapter 2 runs in the SAME project as chapter 1 and against the contract chapter 1's run already recorded
(`activity:chapter_contract:2` in replay.ch01.json), so this file adds only what chapter 2 itself needs:
its scene plan, its scene drafts, its evaluators, its extraction and its L1 summary. The two fixtures are
loaded together by the harness.

Continuity is the point of the fixture, so the chapter-2 canon deliberately touches chapter 1's canon:
Mu-jin's trust in Do-yoon is superseded (relationship), Do-yoon's porter share changes from eight to
eighteen percent, and the ch.1 gate-run promise is paid off. Mu-jin's spoken suspicion is deliberately NOT
extracted as a knowledge_state: the only proposition it could attach to is P1 (the regression), which this
chapter's contract guards him against knowing.

Shares tools/fixture_common.py with the chapter-1 builder. Never edit replay.ch02.json by hand.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixture_common import (  # noqa: E402
    IDS,
    ROOT,
    clock,
    evidence,
    find_span,
    paragraph_of,
    paragraphs,
    read_scene,
    rec,
    scene_draft,
)

FX = os.path.join(ROOT, "examples", "fixture", "ch02")


def main() -> None:
    s1, s2 = read_scene(2, 1), read_scene(2, 2)
    assembled = "\n\n".join(t.strip() for t in (s1, s2))
    paras = paragraphs(assembled)

    def ev(quote: str) -> list[dict]:
        return [evidence(assembled, paras, quote, "version.2.approved", chapter_no=2)]

    # ---- Scene plan (planner output for the locked chapter-2 contract)
    reg_dm = {"formality": 3, "deference": 3, "familiarity": 0, "directness": 2, "contractions": "neutral", "address_terms": ["Mister Park", "sir"]}
    reg_md = {"formality": 1, "deference": 0, "familiarity": 0, "directness": 4, "contractions": "free", "address_terms": ["kid"]}
    scene_plan = {
        "scenes": [
            {
                "scene_no": 1,
                "objective": "5:52 a.m. at Gate 3: Do-yoon is early, is taken on at eight percent, and plants the corridor question.",
                "pov": {"character_id": IDS["doyoon"], "person": "third_limited"},
                "participants": [IDS["doyoon"], IDS["mujin"]],
                "location_id": IDS["mapo_gate3"],
                "beats": [
                    {"type": "action", "description": "The gate above the loading yard; the wrong kind of cold.", "tags": ["tension"]},
                    {"type": "dialogue", "description": "Mu-jin arrives at 5:58; eight percent; say yes.", "tags": ["information"]},
                    {"type": "dialogue", "description": "'Which corridor do you take?' — left, always left.", "tags": ["tension"]},
                ],
                "length_target": {"unit": "words", "value": 380},
                "speaker_pairs": [
                    {"speaker_id": IDS["doyoon"], "addressee_id": IDS["mujin"], "register": reg_dm},
                    {"speaker_id": IDS["mujin"], "addressee_id": IDS["doyoon"], "register": reg_md},
                ],
                "opening_beat_type": "continue_cliffhanger",
            },
            {
                "scene_no": 2,
                "objective": "The corridor decision pays off: the left corridor collapses, Mu-jin raises the share, and the cores come out two grades high.",
                "pov": {"character_id": IDS["doyoon"], "person": "third_limited"},
                "participants": [IDS["doyoon"], IDS["mujin"]],
                "location_id": IDS["mapo_gate3"],
                "beats": [
                    {"type": "dialogue", "description": "'Give me a reason. Not a feeling.' Three chambers.", "tags": ["tension"]},
                    {"type": "action", "description": "The left corridor comes down behind them.", "tags": ["satisfaction"]},
                    {"type": "revelation", "description": "Nine of eleven cores are two grades above envelope.", "tags": ["tension"]},
                ],
                "length_target": {"unit": "words", "value": 560},
                "speaker_pairs": [
                    {"speaker_id": IDS["doyoon"], "addressee_id": IDS["mujin"], "register": reg_dm},
                    {"speaker_id": IDS["mujin"], "addressee_id": IDS["doyoon"], "register": reg_md},
                ],
                "ending_beat_type": "reveal",
            },
        ]
    }

    # ---- Scene drafts (writer output)
    s1p, s2p = paragraphs(s1), paragraphs(s2)
    speakers1 = {}
    for pid, _, _, body in s1p:
        if body.startswith(("“You're early", "“You said six", "“I say six", "“Mm.", "“Eight percent", "“Good.", "“D-grade", "“Left. Always left", "“It's shorter", "“Get your bag")):
            speakers1[pid] = IDS["mujin"]
        elif body.startswith(("“Kang Do-yoon", "“Yes.", "“Mister Park,”", "“Is it shorter", "“Then it isn't")):
            speakers1[pid] = IDS["doyoon"]
    speakers2 = {}
    for pid, _, _, body in s2p:
        if body.startswith(("“What.", "“The right one is", "“Give me a reason", "“Right corridor", "“Water,", "“I know what it is")):
            speakers2[pid] = IDS["mujin"]
        elif body.startswith(("“Mister Park.", "“The right one.”", "“Yes,")):
            speakers2[pid] = IDS["doyoon"]

    drafts = {
        1: scene_draft(1, s1, speakers1, [
            ("Do-yoon and Park Mu-jin meet at Mapo Gate 3 before 6 a.m.", paragraph_of(s1p, s1.find("Park Mu-jin arrived")), [IDS["doyoon"], IDS["mujin"]]),
            ("Mu-jin takes Do-yoon on at eight percent for the Mapo Gate 3 run.", paragraph_of(s1p, s1.find("“Eight percent.")), [IDS["doyoon"], IDS["mujin"]]),
        ]),
        2: scene_draft(2, s2, speakers2, [
            ("Do-yoon persuades Mu-jin to take the right corridor.", paragraph_of(s2p, s2.find("“Right corridor.”")), [IDS["doyoon"], IDS["mujin"]]),
            ("The left corridor ceiling collapses after they pass the bend.", paragraph_of(s2p, s2.find("They were nine meters in")), [IDS["doyoon"], IDS["mujin"]]),
            ("Mu-jin raises Do-yoon's porter share to eighteen percent.", paragraph_of(s2p, s2.find("You carry for eighteen percent")), [IDS["doyoon"], IDS["mujin"]]),
        ]),
    }

    # ---- Evaluators. Chapter 2 needs no revision round: the draft is accepted at r0, which is what makes
    # it a clean continuity proof (the chain does not depend on the revision path chapter 1 exercises).
    contract_check = {
        "criteria": [
            {"criterion_id": "AC-LANG", "passed": True, "evidence_paragraph_ids": ["p1"], "note": "English throughout."},
            {"criterion_id": "AC-MH-1", "passed": True, "evidence_paragraph_ids": [paragraph_of(paras, find_span(assembled, "Park Mu-jin arrived")[0])], "note": "They meet and enter Gate 3."},
        ]
    }
    no_issues = {"issues": []}
    prose = {
        "dimension_scores": {"idiomatic_english": 5, "readability": 5, "register_fidelity": 5, "translation_markers": 5},
        "judge_score": 88,
        "drift_flags": [],
        "issues": [],
    }
    structure = {
        "dimension_scores": {"hook_timing": 5, "dialogue_forwardness": 5, "local_payoff": 5, "ending_pull": 5, "exposition_control": 4},
        "judge_score": 90,
        "hook_sentence_index": 1,
        "local_payoff_present": True,
        "ending_type_detected": "reveal",
        "drift_flags": [],
        "issues": [],
    }

    # ---- Extraction. The items deliberately reach back into chapter 1's canon so the continuity chain is
    # exercised, not merely appended to: a superseded relationship, a transitioned share, a paid promise.
    envelope = {
        "project_id": "{{project}}",
        "chapter_id": "{{chapter.2}}",
        "manuscript_version_id": "{{version.2.approved}}",
        "base_canon_version": "{{int:canon_version}}",
        "stage": "extracted_a",
    }
    delta_items = [
        {"local_id": "ev-gate-run", "type": "event", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(2, 2, "D+1"),
         "payload": {"type": "other", "summary": "Do-yoon and Park Mu-jin enter Mapo Gate 3 at 6 a.m. as hunter and porter.", "location_id": IDS["mapo_gate3"],
                     "participants": [{"entity_id": IDS["doyoon"], "role": "agent"}, {"entity_id": IDS["mujin"], "role": "agent"}], "importance": "core"},
         "evidence": ev("Park Mu-jin arrived at 5:58 with a paper cup in each hand.")},
        {"local_id": "ev-corridor", "type": "event", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(2, 20, "D+1"),
         "payload": {"type": "other", "summary": "Mu-jin takes the right corridor on Do-yoon's word; the left corridor ceiling then collapses.", "location_id": IDS["mapo_gate3"],
                     "participants": [{"entity_id": IDS["mujin"], "role": "agent"}, {"entity_id": IDS["doyoon"], "role": "agent"}], "importance": "core"},
         "evidence": ev("“Right corridor. Eleven minutes won't kill anybody.”")},
        # Transition (ADR-0038): the ch.1 eight-percent share is closed and the new value asserted.
        {"local_id": "f-share", "type": "fact", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(2, 30, "D+1"),
         "payload": {"entity_id": IDS["doyoon"], "attribute": "employment.porter_share", "value": "18%", "value_text": "Eighteen percent of the stones (raised after the Mapo run)",
                     "valid_from": clock(2, 30, "D+1"), "valid_to": None},
         "evidence": ev("“Kang. You carry for eighteen percent.”")},
        {"local_id": "f-cores", "type": "fact", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(2, 40, "D+1"),
         "payload": {"entity_id": IDS["mapo_gate3"], "attribute": "gate.core_grade_anomaly", "value": "B", "value_text": "Nine of eleven cores two grades above a D-gate envelope; gate flagged",
                     "valid_from": clock(2, 40, "D+1"), "valid_to": None},
         "evidence": ev("“Eleven cores, nine of them two grades above envelope. I have to flag the gate.”")},
        # Chapter 1 superseded the bible's Mu-jin → Do-yoon row; chapter 2 supersedes CHAPTER 1's row, so the
        # chain is bible → ch.1 → ch.2 and `supersedes_ref` binds the id chapter 1's own commit created.
        {"local_id": "rel-trust", "type": "relationship_state", "op": "supersede", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(2, 30, "D+1"),
         "supersedes_ref": "{{canon.r-md}}",
         "payload": {"from_entity_id": IDS["mujin"], "to_entity_id": IDS["doyoon"], "type": "superior",
                     "axes": {"trust": 3, "affection": 1, "respect": 2, "hostility": 0, "dependency": 1},
                     "power_dynamic": "from_dominant",
                     "register": {"formality": 1, "deference": 0, "familiarity": 1, "directness": 4, "contractions": "free", "address_terms": ["Kang", "kid"]},
                     "note": "Takes the kid's warnings seriously now; share raised to eighteen percent.",
                     "valid_from": clock(2, 30, "D+1"), "valid_to": None},
         "evidence": ev("“Kang. You carry for eighteen percent.”")},
        # The ch.1 promise (the gate run) is paid off here.
        {"local_id": "pe-gate-run", "type": "promise_event", "op": "pay", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(2, 30, "D+1"),
         "payload": {"promise_id": IDS["promise_gate_run"], "kind": "paid",
                     "note": "The run happens, the corridor is avoided, and Mu-jin walks out unhurt."},
         "evidence": ev("They walked out of Mapo Gate 3 at 7:06 with four people, eleven cores, and an old man's left leg still attached to the rest of him.")},
    ]
    hook_text = "Unless the third chamber had never been holding water at all."
    summary_l1 = (
        "Mapo Gate 3, the next morning. Do-yoon arrives early, is taken on by Park Mu-jin at eight percent, "
        "and asks which corridor he uses. In the gate he talks Mu-jin out of the left corridor by naming an "
        "unsurveyed third chamber holding water; minutes later that ceiling comes down where they would have "
        "been. Mu-jin raises his share to eighteen percent and asks where he got the third chamber. At the "
        "counting window nine of eleven cores read two grades above a D-gate envelope and the gate is flagged."
    )
    extraction = {
        **envelope,
        "items": delta_items,
        "unresolved_questions": [],
        "hypothesis_results": [
            {"hypothesis_ref": "MH-1", "result": "realized", "evidence": ev("Park Mu-jin arrived at 5:58 with a paper cup in each hand.")},
            {"hypothesis_ref": "MH-2", "result": "realized", "evidence": ev("“Right corridor. Eleven minutes won't kill anybody.”")},
        ],
        "summary_l1": summary_l1,
        "ending_hook": hook_text,
    }
    assert len(summary_l1.split()) <= 120, len(summary_l1.split())
    summary = {
        "summary_l1": summary_l1,
        "ending_hook": hook_text,
        "state_changes": [
            "Kang Do-yoon: employment.porter_share = 18%",
            "Mapo Gate 3: flagged for core-grade anomaly",
        ],
        # No knowledge_state is committed: the suspicion Mu-jin voices attaches only to P1, which this
        # chapter's contract guards him against knowing. The line below is summary prose, not canon.
        "knowledge_changes": [],
    }

    A = "activity:"
    recordings = {
        A + "scene_plan:2": rec(scene_plan),
        A + "scene_draft:2:1": rec(drafts[1]),
        A + "scene_draft:2:2": rec(drafts[2]),
        A + "contract_check:2:r0": rec(contract_check),
        A + "continuity:2:r0": rec(no_issues),
        A + "knowledge_leak:2:r0": rec(no_issues),
        A + "prose_judge:2:r0": rec(prose),
        A + "structure_judge:2:r0": rec(structure),
        A + "extract:2": rec(extraction),
        A + "summarize:2": rec(summary),
    }

    expected = {
        "assembled_code_points": len(assembled),
        "assembled_paragraphs": len(paras),
        "words": len(assembled.split()),
        "scene_words": [len(s1.split()), len(s2.split())],
        "ending_hook": hook_text,
        "summary_l1": summary_l1,
        "delta_items": len(delta_items),
        "item_counts": {
            "event": sum(1 for i in delta_items if i["type"] == "event"),
            "fact": sum(1 for i in delta_items if i["type"] == "fact"),
            "relationship_state": sum(1 for i in delta_items if i["type"] == "relationship_state"),
            "promise_event": sum(1 for i in delta_items if i["type"] == "promise_event"),
        },
    }

    os.makedirs(FX, exist_ok=True)
    with open(os.path.join(FX, "replay.ch02.json"), "w", encoding="utf-8") as f:
        json.dump(recordings, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with open(os.path.join(FX, "expected.ch02.json"), "w", encoding="utf-8") as f:
        json.dump(expected, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(expected, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
