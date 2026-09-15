#!/usr/bin/env python3
"""
Builds the Checkpoint 5 replay fixture (examples/fixture/ch01/) from the authored scene texts:

  * story-bible.ch01.json   — registry entities, propositions, promises and the bible seed delta
  * replay.ch01.json        — ReplayProvider recordings keyed by workflow activity id
                              (`activity:<id>`), with {{placeholders}} bound at replay time
  * expected.ch01.json      — code-point offsets the tests assert against (evidence spans)

Everything is deterministic and derived from the scene files, so evidence offsets are exact Unicode
code points into the NFC text the workflow assembles (scenes joined by a blank line). Re-run after editing
a scene. Never edit replay.ch01.json by hand.
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
    kind_of,
    nfc,
    paragraph_of,
    paragraphs,
    read_scene,
    rec,
    scene_draft,
)

FX = os.path.join(ROOT, "examples", "fixture", "ch01")

def main() -> None:
    s1, s2, s3 = read_scene(1, 1), read_scene(1, 2), read_scene(1, 3)
    # The assembler joins trimmed scenes with a blank line, then NFC-normalizes.
    assembled = nfc("\n\n".join(t.strip() for t in (s1, s2, s3)))
    paras = paragraphs(assembled)

    # ---- the revised (round 1) text: the one translation-like sentence in scene 3 is fixed by the reviser.
    bad = "It was exactly same feeling with ten years ago."
    good = "It felt exactly the way it had ten years ago."
    assert assembled.count(bad) == 1
    revised = assembled.replace(bad, good)
    rparas = paragraphs(revised)
    bad_s, bad_e = find_span(assembled, bad)

    bible = {
        "version": 1,
        "entities": [
            {"id": IDS["doyoon"], "type": "character", "display_name": "Kang Do-yoon", "short_forms": ["Do-yoon"], "aliases": ["Kang"], "description": "27. Ten years an F-rank porter before dying in the Collapse; wakes on measurement morning with the future in his head and no proof."},
            {"id": IDS["seoha"], "type": "character", "display_name": "Lee Seo-ha", "short_forms": ["Seo-ha"], "description": "24, B-rank healer. Hides that she is a conglomerate chairman's illegitimate daughter."},
            {"id": IDS["mujin"], "type": "character", "display_name": "Park Mu-jin", "short_forms": ["Mu-jin"], "aliases": ["Mister Park", "old man"], "description": "45, C-rank veteran hunter. Died shielding Do-yoon in the previous life."},
            {"id": IDS["hyunseok"], "type": "character", "display_name": "Choi Hyun-seok", "short_forms": ["Hyun-seok"], "description": "31, A-rank, Vice-Guildmaster of White Night."},
            {"id": IDS["yoon"], "type": "character", "display_name": "Yoon Jae-kyung", "aliases": ["the Chairman", "the Watcher"], "description": "58, Hunter Association Chairman."},
            {"id": IDS["minjae"], "type": "character", "display_name": "Jung Min-jae", "short_forms": ["Min-jae"], "description": "Association measurement officer."},
            {"id": IDS["hall"], "type": "location", "display_name": "Association measurement hall", "aliases": ["the measurement hall"], "description": "Third floor of a glass tower in Mapo."},
            {"id": IDS["mapo_gate3"], "type": "location", "display_name": "Mapo Gate 3", "aliases": ["Gate 3, Mapo"], "description": "D-grade gate in Mapo."},
            {"id": IDS["gangnam_gate"], "type": "location", "display_name": "Gangnam gate", "description": "The gate that breaks in the original history."},
            {"id": IDS["association"], "type": "organization", "display_name": "Hunter Association", "short_forms": ["the Association"]},
            {"id": IDS["rank_scale"], "type": "term", "display_name": "Association rank scale", "description": "Ranks F through S read from measurement devices; no status windows."},
        ],
        "propositions": [
            {"local_id": "P1", "statement": "Kang Do-yoon is a regressor.", "kind": "secret", "entity_ids": [IDS["doyoon"]], "secret": {"owner_ids": [IDS["doyoon"]], "allowed_knower_ids": [], "reader_may_know": True, "reveal_not_before_chapter": 58}, "truth": "true"},
            {"local_id": "P2", "statement": "Lee Seo-ha is Chairman Lee Tae-san's illegitimate daughter.", "kind": "secret", "entity_ids": [IDS["seoha"]], "secret": {"owner_ids": [IDS["seoha"]], "allowed_knower_ids": [], "reader_may_know": True, "reveal_not_before_chapter": 72}, "truth": "true"},
            {"local_id": "P4", "statement": "Chairman Yoon Jae-kyung is the Watcher.", "kind": "secret", "entity_ids": [IDS["yoon"]], "secret": {"owner_ids": [IDS["yoon"]], "allowed_knower_ids": [], "reader_may_know": False, "reveal_not_before_chapter": 120}, "truth": "true"},
        ],
        "promises": [
            {"id": IDS["promise_gate_run"], "type": "threat", "statement": "The Mapo gate run: last time Mu-jin went in without a porter and came out on a stretcher.", "importance": "core", "due_min_chapter": 2, "due_max_chapter": 3, "related_entity_ids": [IDS["doyoon"], IDS["mujin"], IDS["mapo_gate3"]]},
            {"id": IDS["promise_compass"], "type": "chekhov", "statement": "The old compass will lead to a hidden gate.", "importance": "core", "due_min_chapter": 55, "due_max_chapter": 70, "related_entity_ids": [IDS["doyoon"]]},
            {"id": IDS["promise_watcher"], "type": "mystery", "statement": "Who is the Watcher?", "importance": "core", "due_min_chapter": 100, "due_max_chapter": 120, "related_entity_ids": [IDS["yoon"]]},
        ],
        "commits": [[
            {"local_id": "rule-ranks", "type": "fact", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "evidence": [],
             "payload": {"entity_id": IDS["rank_scale"], "attribute": "rule.scale", "value": "F-S", "value_text": "Ranks run F through S and are read from measurement devices; no status windows", "valid_from": clock(0, 0), "valid_to": None, "locked": True}},
            {"local_id": "seoha-rank", "type": "fact", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "major", "evidence": [],
             "payload": {"entity_id": IDS["seoha"], "attribute": "power.rank", "value": "B", "value_text": "B-rank healer", "valid_from": clock(0, 0), "valid_to": None}},
            {"local_id": "mujin-rank", "type": "fact", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "major", "evidence": [],
             "payload": {"entity_id": IDS["mujin"], "attribute": "power.rank", "value": "C", "value_text": "C-rank veteran", "valid_from": clock(0, 0), "valid_to": None}},
            {"local_id": "r-mujin-doyoon", "type": "relationship_state", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "major", "evidence": [],
             "payload": {"from_entity_id": IDS["mujin"], "to_entity_id": IDS["doyoon"], "type": "stranger", "axes": {"trust": 0, "affection": 0, "respect": 0, "hostility": 0, "dependency": 0}, "power_dynamic": "from_dominant", "register": {"formality": 1, "deference": 0, "familiarity": 0, "directness": 4, "contractions": "free", "address_terms": ["kid"]}, "valid_from": clock(0, 0), "valid_to": None}},
            {"local_id": "r-doyoon-mujin", "type": "relationship_state", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "major", "evidence": [],
             "payload": {"from_entity_id": IDS["doyoon"], "to_entity_id": IDS["mujin"], "type": "stranger", "axes": {"trust": 3, "affection": 2, "respect": 3, "hostility": 0, "dependency": 0}, "power_dynamic": "to_dominant", "register": {"formality": 3, "deference": 3, "familiarity": 0, "directness": 2, "contractions": "neutral", "address_terms": ["Mister Park", "sir"]}, "valid_from": clock(0, 0), "valid_to": None}},
        ], [
            {"local_id": "k-doyoon-p1", "type": "knowledge_state", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "evidence": [],
             "payload": {"knower": {"kind": "character", "entity_id": IDS["doyoon"]}, "proposition_id": "{{proposition.P1}}", "stance": "knows", "source": {"kind": "prior_loop_memory", "chapter_id": "{{chapter.1}}"}, "valid_from": clock(0, 0), "valid_to": None}},
            {"local_id": "k-doyoon-p4", "type": "knowledge_state", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "evidence": [],
             "payload": {"knower": {"kind": "character", "entity_id": IDS["doyoon"]}, "proposition_id": "{{proposition.P4}}", "stance": "knows", "source": {"kind": "prior_loop_memory", "chapter_id": "{{chapter.1}}"}, "valid_from": clock(0, 0), "valid_to": None}},
            {"local_id": "k-mujin-p1", "type": "knowledge_state", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "evidence": [],
             "payload": {"knower": {"kind": "character", "entity_id": IDS["mujin"]}, "proposition_id": "{{proposition.P1}}", "stance": "unaware", "source": {"kind": "narration", "chapter_id": "{{chapter.1}}"}, "valid_from": clock(0, 0), "valid_to": None}},
            {"local_id": "k-seoha-p2", "type": "knowledge_state", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "evidence": [],
             "payload": {"knower": {"kind": "character", "entity_id": IDS["seoha"]}, "proposition_id": "{{proposition.P2}}", "stance": "knows", "source": {"kind": "remembered", "chapter_id": "{{chapter.1}}"}, "valid_from": clock(0, 0), "valid_to": None}},
        ]],
    }
    intake_src = os.path.join(ROOT, "examples", "fixture", "story-intake.json")
    with open(intake_src, encoding="utf-8") as f:
        intake = json.load(f)

    # ---- Story Spec (requirement_interpreter output)
    ser = {"level": "series"}
    spec_items = [
        {"id": "REQ-001", "kind": "hard", "category": "premise", "text": intake["premise"], "language": "en", "provenance": "user", "confirmed_by_user": True, "scope": ser},
        {"id": "REQ-002", "kind": "hard", "category": "genre", "text": "Primary genre hunter-gate with a regression overlay; English manuscript in the Korean serialized-webnovel tradition.", "language": "en", "provenance": "user", "confirmed_by_user": True, "scope": ser},
        {"id": "REQ-003", "kind": "hard", "category": "content_restriction", "text": "Violence within a 15+ rating; no sexual content.", "language": "en", "provenance": "user", "confirmed_by_user": True, "scope": ser},
        {"id": "REQ-004", "kind": "hard", "category": "length", "text": "Target 180 chapters of about 2,500 words each.", "language": "en", "provenance": "user", "confirmed_by_user": True, "scope": ser, "structured": {"chapter_count": 180, "words_per_chapter": 2500}},
        {"id": "REQ-005", "kind": "hard", "category": "mandatory_scene", "text": "Chapter 1 opens on the measurement device showing F.", "language": "en", "provenance": "user", "confirmed_by_user": True, "scope": {"level": "chapter_range", "chapter_from": 1, "chapter_to": 1}},
        {"id": "REQ-021", "kind": "hard", "category": "forbidden_development", "text": "Do-yoon tells no one about the regression before ch.58.", "language": "en", "provenance": "user", "confirmed_by_user": True, "scope": {"level": "chapter_range", "chapter_from": 1, "chapter_to": 57}},
        {"id": "REQ-022", "kind": "hard", "category": "forbidden_development", "text": "Park Mu-jin does not die in Season 1.", "language": "en", "provenance": "user", "confirmed_by_user": True, "scope": {"level": "season", "season_ids": [IDS["season1"]]}},
        {"id": "REQ-025", "kind": "hard", "category": "forbidden_development", "text": "The Watcher's identity is not revealed before ch.120.", "language": "en", "provenance": "user", "confirmed_by_user": True, "scope": {"level": "chapter_range", "chapter_from": 1, "chapter_to": 119}},
        {"id": "REQ-024", "kind": "hard", "category": "romance", "text": "Romance is slow-burn: no confession and no physical intimacy before ch.87.", "language": "en", "provenance": "user", "confirmed_by_user": True, "scope": {"level": "chapter_range", "chapter_from": 1, "chapter_to": 86}},
        {"id": "REQ-041", "kind": "soft", "category": "tone", "text": "Cold, tense tone with intermittent humor; fast pace.", "language": "en", "provenance": "user", "scope": ser},
        {"id": "REQ-042", "kind": "soft", "category": "style", "text": "Short sentences; exposition through action and dialogue; hindsight monologue at most 20% of a chapter.", "language": "en", "provenance": "user", "scope": ser},
        {"id": "REQ-043", "kind": "soft", "category": "structure", "text": "Occasional forum interludes as a device.", "language": "en", "provenance": "user", "scope": ser},
        {"id": "REQ-051", "kind": "assumption", "category": "world", "text": "Awakened ranks run F through S and are read from measurement devices; there are no status windows.", "language": "en", "provenance": "model_inferred", "confidence": 0.9, "scope": ser},
        {"id": "REQ-052", "kind": "assumption", "category": "world", "text": "Mana stones are the currency of the hunter economy.", "language": "en", "provenance": "model_inferred", "confidence": 0.8, "scope": ser},
    ]
    explanations = [
        {"assumption_id": "REQ-051", "rationale": "The intake says 'no status windows—only measurement-device readings' and an F–S scale, so the world rule is stated explicitly rather than left implicit."},
        {"assumption_id": "REQ-052", "rationale": "The intake mentions a 'mana-stone economy' without defining it; treating mana stones as the hunter currency is the minimal reading."},
    ]

    # ---- Arc plan
    arc_plan = {
        "id": IDS["arc1"],
        "project_id": "{{project}}",
        "season_id": IDS["season1"],
        "kind": "major",
        "ordinal": 1,
        "version": 1,
        "title": "The Second Awakening",
        "objective": "Do-yoon re-enters the hunter world as an F-rank porter with ten years of future knowledge, attaches himself to Park Mu-jin, and starts the quiet work of changing the first death he remembers.",
        "conflict": "He knows everything and can prove nothing; every intervention risks moving the future he relies on.",
        "antagonistic_force": "The original history itself, and the Association's indifference to F-ranks.",
        "stakes": "Mu-jin's life on the first gate run; Do-yoon's cover.",
        "entry_state": "Measurement morning, day zero. Do-yoon is F-rank and unknown.",
        "exit_state_assertions": ["Do-yoon is registered as an F-rank porter.", "Do-yoon is attached to Park Mu-jin's gate run.", "Mu-jin survives the Mapo gate run."],
        "participants": [IDS["doyoon"], IDS["mujin"], IDS["minjae"]],
        "locations": [IDS["hall"], IDS["mapo_gate3"]],
        "story_time_window": {"start": clock(1, 0, "D+0"), "end": clock(3, 999, "D+2")},
        "chapter_range_est": {"from": 1, "to": 3},
        "beats": [
            {"id": "arc1.beat.01", "type": "setup", "description": "The device reads F again; Do-yoon does not flinch (opening mandatory scene).", "target_chapter_offset": 0, "participants": [IDS["doyoon"], IDS["minjae"]]},
            {"id": "arc1.beat.02", "type": "relationship", "description": "Do-yoon approaches Park Mu-jin at the porter board and is taken on for tomorrow's Mapo gate run.", "target_chapter_offset": 0, "participants": [IDS["doyoon"], IDS["mujin"]], "promise_refs": [IDS["promise_gate_run"]]},
            {"id": "arc1.beat.03", "type": "cider", "description": "On the steps Do-yoon writes his three-item list and deletes the third; Mu-jin's message arrives — the same words as last time.", "target_chapter_offset": 0, "participants": [IDS["doyoon"], IDS["mujin"]]},
            {"id": "arc1.beat.04", "type": "escalation", "description": "The Mapo gate run: the left corridor.", "target_chapter_offset": 1, "participants": [IDS["doyoon"], IDS["mujin"]], "promise_refs": [IDS["promise_gate_run"]]},
        ],
        "promises_opened": [IDS["promise_gate_run"]],
        "promises_advanced": [],
        "promises_paid": [],
        "cadence_check": {"cider_interval_ok": True, "progression_interval_ok": True, "frustration_streak_ok": True, "notes": []},
        "risks": ["Hindsight monologue overrunning 20% of the chapter."],
        "must_not": ["Do-yoon stating the regression aloud.", "Mu-jin dying."],
        "status": "validated",
    }

    # ---- Chapter 1 contract (chapter_planner output; the workflow fills id/project/pins/status/timeline)
    def contract_envelope(chapter_no: int, contract_id: str) -> dict:
        # What a real chapter_planner copies from its prompt: ids and pins the workflow re-asserts anyway.
        return {
            "id": contract_id,
            "project_id": "{{project}}",
            "chapter_number": chapter_no,
            "arc_id": IDS["arc1"],
            "season_id": IDS["season1"],
            "timeline_id": "{{main_timeline}}",
            "status": "draft",
            "pinned": {
                "spec_version": "{{int:spec_version}}",
                "bible_version": 1,
                "narrative_identity_version_id": IDS["identity_version"],
                "canon_version": "{{int:canon_version}}",
                "template_version": "pack.chapter_planner@1.0.0",
            },
            "narrative_identity_version_id": IDS["identity_version"],
            "active_constraints_ref": {
                "id": "{{acs.%d.id}}" % chapter_no,
                "content_hash": "{{acs.%d.hash}}" % chapter_no,
                "token_count": "{{int:acs.%d.tokens}}" % chapter_no,
            },
        }

    contract1 = {
        **contract_envelope(1, IDS["contract1"]),
        "version": 1,
        "beat_refs": ["arc1.beat.01", "arc1.beat.02", "arc1.beat.03"],
        "purpose": "Open the series on the F reading Do-yoon has seen before, put him beside Park Mu-jin on purpose this time, and plant the gate-run threat he intends to defuse.",
        "reader_experience": "A cold, quiet certainty: this man has done this before.",
        "arc_objective_contribution": "Registers Do-yoon as a porter and attaches him to Mu-jin's run.",
        "must_happen": [
            {"id": "MH-1", "kind": "required_scene", "description": "The measurement device shows F for Kang Do-yoon.", "entity_ids": [IDS["doyoon"]], "requirement_id": "REQ-005", "verifiable_by": "extraction"},
            {"id": "MH-2", "kind": "event", "description": "Do-yoon registers as an F-class porter with the Association.", "entity_ids": [IDS["doyoon"], IDS["association"]], "verifiable_by": "extraction"},
            {"id": "MH-3", "kind": "relationship", "description": "Do-yoon approaches Park Mu-jin and is taken on as porter for tomorrow's Mapo gate run.", "entity_ids": [IDS["doyoon"], IDS["mujin"]], "verifiable_by": "extraction"},
        ],
        "must_not_happen": [
            {"id": "MN-1", "description": "Do-yoon stating or implicitly admitting the regression to anyone.", "source": "spec", "requirement_id": "REQ-021", "lexical_patterns": ["I came back from the future", "I'm a regressor"]},
            {"id": "MN-2", "description": "Naming Chairman Yoon Jae-kyung as the Watcher on the page.", "source": "spec", "requirement_id": "REQ-025"},
            {"id": "MN-3", "description": "Any status window or system message.", "source": "arc"},
        ],
        "pov": {"character_id": IDS["doyoon"], "person": "third_limited"},
        "participants": [
            {"character_id": IDS["doyoon"], "role_in_chapter": "protagonist", "on_page": True},
            {"character_id": IDS["mujin"], "role_in_chapter": "mentor", "on_page": True},
            {"character_id": IDS["minjae"], "role_in_chapter": "cameo", "on_page": True},
        ],
        "mentioned_only": [IDS["yoon"]],
        "locations": [IDS["hall"], IDS["mapo_gate3"]],
        "story_time": {"start": clock(1, 0, "D+0"), "end": clock(1, 99, "D+0")},
        "knowledge_deltas": [
            {"knower": {"kind": "reader"}, "proposition_id": "{{proposition.P1}}", "from_stance": "unaware", "to_stance": "knows", "how": "Narration makes the regression explicit to the reader (never to a character)", "channel_kind": "witnessed"}
        ],
        "state_deltas": [
            {"entity_id": IDS["doyoon"], "attribute": "power.rank", "from": None, "to": "F", "when_in_chapter": "early", "description": "Measurement reading"},
            {"entity_id": IDS["doyoon"], "attribute": "affiliation.party", "from": None, "to": "Park Mu-jin's gate run", "when_in_chapter": "middle", "description": "Taken on as porter"},
        ],
        "relationship_deltas": [
            {"from_id": IDS["mujin"], "to_id": IDS["doyoon"], "axis": "type", "direction": "change", "new_type": "superior", "address_term_change": ["kid"], "description": "First meeting; gruff downward register"}
        ],
        "setups": [{"promise_id": IDS["promise_gate_run"], "how": "Mu-jin's message sets the run for 6 a.m.; last time it ended on a stretcher", "kind": "open"}],
        "payoffs": [],
        "emotional_movement": {"start": "Cold certainty", "peak": "Do-yoon's throat closing when he sees Mu-jin alive", "end": "Quiet resolve"},
        "conflict": {"type": "internal", "description": "Do-yoon must act on what he knows without revealing that he knows it.", "reversal": "The man he came to save calls him 'kid' and does not remember him — because there is nothing to remember."},
        "local_satisfaction": [{"type": "satisfaction", "description": "Do-yoon reads the porter posting an hour after it went up and gets the job on the spot."}],
        "ending_state": "Registered porter; run set for 6 a.m. tomorrow at Mapo Gate 3; Do-yoon walking home toward a morning he intends to change.",
        "hook": {"type": "quiet_ominous", "description": "Mu-jin's message is word for word the message from last time; last time Do-yoon was late.", "question_raised": "Will the gate run go differently this time?"},
        "opening": {"type": "in_medias_res", "description": "The measurement device screams; the panel reads F."},
        "scene_count": 3,
        "dialogue_density_target": 0.4,
        "monologue_density_target": 0.15,
        "length_target": {"unit": "words", "value": 900, "tolerance_ratio": 0.12},
        "tone_notes": ["short sentences", "hindsight monologue in italics, sparingly"],
        "continuity_risks": [{"description": "Do-yoon must read F, not E (E comes at ch.8).", "mitigation": "Locked by the measurement scene."}],
        "continuity_anchors": [],
        "knowledge_guards": [
            {"character_id": IDS["mujin"], "must_not_know_proposition_ids": ["{{proposition.P1}}"], "note": "Mu-jin does not know Do-yoon is a regressor."},
            {"character_id": IDS["minjae"], "must_not_know_proposition_ids": ["{{proposition.P1}}"]},
        ],
        "acceptance_criteria": [
            {"id": "AC-LANG", "kind": "deterministic", "description": "Manuscript is English (output-language check passes)", "check_ref": "EP-LANG-01", "threshold": 0.99},
            {"id": "AC-LEN", "kind": "deterministic", "description": "Length within tolerance", "check_ref": "LEN-01"},
            {"id": "AC-MH-1", "kind": "judge", "description": "The F reading opens the chapter", "check_ref": "contract_checker:MH-1"},
            {"id": "AC-MH-3", "kind": "judge", "description": "Do-yoon is taken on for the Mapo run", "check_ref": "contract_checker:MH-3"},
        ],
    }

    # ---- Chapter 2 contract (built against accepted ch.1)
    contract2 = {
        **contract_envelope(2, IDS["contract2"]),
        "version": 1,
        "beat_refs": ["arc1.beat.04"],
        "purpose": "The Mapo gate run: Do-yoon keeps Mu-jin out of the left corridor and the first death he remembers does not happen.",
        "must_happen": [
            {"id": "MH-1", "kind": "event", "description": "Do-yoon and Mu-jin enter Mapo Gate 3 at 6 a.m.", "entity_ids": [IDS["doyoon"], IDS["mujin"]], "verifiable_by": "extraction"},
            {"id": "MH-2", "kind": "decision", "description": "Do-yoon steers Mu-jin away from the left corridor.", "entity_ids": [IDS["doyoon"], IDS["mujin"]], "verifiable_by": "judge"},
        ],
        "must_not_happen": [
            {"id": "MN-1", "description": "Do-yoon stating or implicitly admitting the regression.", "source": "spec", "requirement_id": "REQ-021"},
            {"id": "MN-2", "description": "Mu-jin dying or being maimed.", "source": "spec", "requirement_id": "REQ-022"},
        ],
        "pov": {"character_id": IDS["doyoon"], "person": "third_limited"},
        "participants": [
            {"character_id": IDS["doyoon"], "role_in_chapter": "protagonist", "on_page": True},
            {"character_id": IDS["mujin"], "role_in_chapter": "mentor", "on_page": True},
        ],
        "locations": [IDS["mapo_gate3"]],
        "story_time": {"start": clock(2, 0, "D+1"), "end": clock(2, 99, "D+1"), "elapsed_since_previous": "The next morning, 6 a.m."},
        "knowledge_deltas": [],
        "state_deltas": [{"entity_id": IDS["doyoon"], "attribute": "status.location", "from": None, "to": "Mapo Gate 3", "when_in_chapter": "early"}],
        "relationship_deltas": [{"from_id": IDS["mujin"], "to_id": IDS["doyoon"], "axis": "trust", "direction": "up", "magnitude": 1, "description": "The kid was not late."}],
        "setups": [],
        "payoffs": [{"promise_id": IDS["promise_gate_run"], "how": "The run happens; the corridor is avoided.", "kind": "advance"}],
        "emotional_movement": {"start": "Held breath", "end": "First small proof the future can move"},
        "conflict": {"type": "external", "description": "The gate, and Mu-jin's habit of taking the left corridor."},
        "local_satisfaction": [{"type": "growth_confirmed", "description": "Do-yoon's knowledge pays off once, quietly."}],
        "ending_state": "Out of the gate; Mu-jin unhurt.",
        "hook": {"type": "reveal", "description": "The stones they carry out are two grades higher than a D-gate should yield."},
        "opening": {"type": "continue_cliffhanger", "description": "5:52 a.m., Gate 3. Do-yoon is early."},
        "scene_count": 2,
        "dialogue_density_target": 0.45,
        "length_target": {"unit": "words", "value": 900, "tolerance_ratio": 0.12},
        "continuity_risks": [{"description": "Do-yoon's rank is F (ch.1). Mu-jin calls him 'kid'; Do-yoon says 'Mister Park'/'sir'."}],
        "continuity_anchors": [
            {"fact_id": "{{canon.f-rank}}", "statement": "Kang Do-yoon's Association rank is F (ch.1 measurement).", "evidence": [evidence(revised, rparas, "“F-rank. Porter registration is the window on your left.”", "version.1.approved")]}
        ],
        "knowledge_guards": [{"character_id": IDS["mujin"], "must_not_know_proposition_ids": ["{{proposition.P1}}"]}],
        "acceptance_criteria": [
            {"id": "AC-LANG", "kind": "deterministic", "description": "Manuscript is English", "check_ref": "EP-LANG-01", "threshold": 0.99},
            {"id": "AC-MH-1", "kind": "judge", "description": "They enter the gate", "check_ref": "contract_checker:MH-1"},
        ],
    }

    # ---- Scene plan
    def sp(no, objective, participants, location, beats, words, pairs, opening=None, ending=None):
        d = {
            "scene_no": no,
            "objective": objective,
            "pov": {"character_id": IDS["doyoon"], "person": "third_limited"},
            "participants": participants,
            "location_id": location,
            "beats": beats,
            "length_target": {"unit": "words", "value": words},
            "speaker_pairs": pairs,
        }
        if opening:
            d["opening_beat_type"] = opening
        if ending:
            d["ending_beat_type"] = ending
        return d

    reg_dm = {"formality": 3, "deference": 3, "familiarity": 0, "directness": 2, "contractions": "neutral", "address_terms": ["Mister Park", "sir"]}
    reg_md = {"formality": 1, "deference": 0, "familiarity": 0, "directness": 4, "contractions": "free", "address_terms": ["kid"]}
    scene_plan = {
        "scenes": [
            sp(1, "The device reads F; Do-yoon does not flinch; he walks to the porter window.", [IDS["doyoon"], IDS["minjae"]], IDS["hall"],
               [{"type": "action", "description": "The device screams; red F.", "tags": ["tension"]}, {"type": "dialogue", "description": "Officer Jung Min-jae sends him left."}, {"type": "emotional", "description": "His hand is not shaking; March twelfth.", "tags": ["emotion"]}],
               260, [{"speaker_id": IDS["minjae"], "addressee_id": IDS["doyoon"], "register": {"formality": 2, "deference": 1, "familiarity": 0, "directness": 4, "contractions": "neutral", "address_terms": []}}], opening="in_medias_res"),
            sp(2, "Porter registration; Do-yoon approaches Park Mu-jin and is taken on.", [IDS["doyoon"], IDS["mujin"]], IDS["hall"],
               [{"type": "dialogue", "description": "Registration clerk; the card.", "tags": ["information"]}, {"type": "revelation", "description": "Mu-jin on the bench, alive.", "tags": ["emotion"]}, {"type": "dialogue", "description": "'Mister Park.' The job, eight percent, six a.m.", "tags": ["satisfaction"]}],
               320, [{"speaker_id": IDS["doyoon"], "addressee_id": IDS["mujin"], "register": reg_dm}, {"speaker_id": IDS["mujin"], "addressee_id": IDS["doyoon"], "register": reg_md}]),
            sp(3, "On the steps: the list of three, the third deleted; Mu-jin's message, the same words as last time.", [IDS["doyoon"], IDS["mujin"]], IDS["hall"],
               [{"type": "emotional", "description": "Cold on the steps; day zero.", "tags": ["emotion"]}, {"type": "decision", "description": "Three lines; the Chairman deleted.", "tags": ["tension"]}, {"type": "cliffhanger", "description": "Mu-jin's text: last time he was late.", "tags": ["tension"]}],
               320, [{"speaker_id": IDS["mujin"], "addressee_id": IDS["doyoon"], "register": reg_md}], ending="quiet_ominous"),
        ]
    }

    # ---- Scene drafts (writer output)
    s1p = paragraphs(s1)
    s2p = paragraphs(s2)
    s3p = paragraphs(s3)
    speakers1 = {pid: IDS["minjae"] for pid, _, _, body in s1p if body.startswith("“F-rank") or body.startswith("“Next")}
    speakers1.update({pid: IDS["doyoon"] for pid, _, _, body in s1p if body.startswith("“Yes, sir")})
    speakers2 = {}
    for pid, _, _, body in s2p:
        if body.startswith("“"):
            if body.startswith(("“Mister Park.”", "“No, sir", "“I carry", "“Yes, sir", "“Kang Do-yoon", "“Twenty-seven", "“I know")):
                speakers2[pid] = IDS["doyoon"]
            elif body.startswith(("“Do I know", "“I posted", "“Pay is", "“Six a.m", "“Mister Park,” Mu-jin")):
                speakers2[pid] = IDS["mujin"]
    drafts = {
        1: scene_draft(1, s1, speakers1, [
            ("The measurement device reads F for Kang Do-yoon.", paragraph_of(s1p, s1.find("[F]")), [IDS["doyoon"]]),
            ("Jung Min-jae is the measurement officer.", paragraph_of(s1p, s1.find("Jung Min-jae")), [IDS["minjae"]]),
        ]),
        2: scene_draft(2, s2, speakers2, [
            ("Do-yoon registers as a Class F porter, registry number 88-0412.", paragraph_of(s2p, s2.find("PORTER")), [IDS["doyoon"]]),
            ("Park Mu-jin takes Do-yoon on as porter for the Mapo D-gate run at 6 a.m. tomorrow, eight percent of the stones.", paragraph_of(s2p, s2.find("“Pay is")), [IDS["doyoon"], IDS["mujin"]]),
        ]),
        3: scene_draft(3, s3, {}, [
            ("Mu-jin messages Do-yoon: Gate 3, Mapo, 6 a.m.", paragraph_of(s3p, s3.find("Park Mu-jin: Tomorrow")), [IDS["doyoon"], IDS["mujin"]]),
        ]),
    }

    # ---- Evaluations. Round 0: prose judge flags the translation-like sentence (major) → revision.
    bad_para = paragraph_of(paras, bad_s)
    prose_r0 = {
        "dimension_scores": {"idiomatic_english": 3, "readability": 4, "register_fidelity": 4, "translation_markers": 2},
        "judge_score": 74,
        "drift_flags": ["translation_like"],
        "issues": [{
            "kind": "translation_like_english", "severity": "major", "confidence": 0.92,
            "claim": "“It was exactly same feeling with ten years ago” is calqued English (missing article, wrong preposition).",
            "chapter_span": {"paragraph_ids": [bad_para], "start": bad_s, "end": bad_e, "quote": bad},
            "repair": {"scope": "sentence", "suggestion": "Rewrite as natural English: 'It felt exactly the way it had ten years ago.'", "must_preserve_fact_ids": []},
        }],
    }
    prose_r1 = {"dimension_scores": {"idiomatic_english": 4, "readability": 4, "register_fidelity": 4, "translation_markers": 5}, "judge_score": 86, "drift_flags": [], "issues": []}
    structure = {
        "dimension_scores": {"hook_timing": 5, "dialogue_forwardness": 4, "local_payoff": 4, "ending_pull": 5, "exposition_control": 4},
        "judge_score": 88, "hook_sentence_index": 1, "local_payoff_present": True, "ending_type_detected": "quiet_ominous", "drift_flags": [], "issues": [],
    }
    contract_check = {"criteria": [
        {"criterion_id": "AC-MH-1", "passed": True, "evidence_paragraph_ids": ["p1", "p2"], "note": "Opens on the device and the F."},
        {"criterion_id": "AC-MH-3", "passed": True, "evidence_paragraph_ids": [paragraph_of(paras, assembled.find("“Pay is"))], "note": "Eight percent, six a.m."},
    ]}
    no_issues = {"issues": []}

    # ---- Reviser patch (round 1)
    patch = {
        "id": "{{patch.1.r1}}",
        "from_version_id": "{{version.1.current}}",
        "issue_ids": ["{{issue.prose.0}}"],
        "scope": "sentence",
        "span": {"start": bad_s, "end": bad_e, "paragraph_ids": [bad_para], "original_quote": bad},
        "new_text": good,
        "changed_claims": [],
        "preserved_facts_ack": [],
    }

    # ---- Extraction from the APPROVED (revised) text
    V = "version.1.approved"
    ev = lambda q: [evidence(revised, rparas, q, V)]  # noqa: E731
    delta_items = [
        {"local_id": "ev-measure", "type": "event", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(1, 2, "D+0"),
         "payload": {"type": "rank_change", "summary": "The Association measurement device reads F for Kang Do-yoon; officer Jung Min-jae sends him to porter registration.", "location_id": IDS["hall"], "participants": [{"entity_id": IDS["doyoon"], "role": "patient"}, {"entity_id": IDS["minjae"], "role": "agent"}], "importance": "core"},
         "evidence": ev("“F-rank. Porter registration is the window on your left.”")},
        {"local_id": "f-rank", "type": "fact", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(1, 2, "D+0"),
         "payload": {"entity_id": IDS["doyoon"], "attribute": "power.rank", "value": "F", "value_text": "F-rank (ch.1 measurement)", "valid_from": clock(1, 2, "D+0"), "valid_to": None},
         "evidence": ev("Red letters. The same red letters as ten years ago.")},
        {"local_id": "f-location", "type": "fact", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "minor", "story_clock": clock(1, 1, "D+0"),
         "payload": {"entity_id": IDS["doyoon"], "attribute": "status.location", "value": "measurement_hall", "value_text": "Association measurement hall, Mapo", "valid_from": clock(1, 1, "D+0"), "valid_to": None},
         "evidence": ev("Do-yoon stood on the steps of the measurement hall")},
        {"local_id": "ev-register", "type": "event", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "major", "story_clock": clock(1, 10, "D+0"),
         "payload": {"type": "transaction", "summary": "Do-yoon registers with the Association as a Class F porter, registry number 88-0412.", "location_id": IDS["hall"], "participants": [{"entity_id": IDS["doyoon"], "role": "agent"}], "importance": "major"},
         "evidence": ev("PORTER — CLASS F. Association Registry No. 88-0412.")},
        {"local_id": "f-porter", "type": "fact", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "major", "story_clock": clock(1, 10, "D+0"),
         "payload": {"entity_id": IDS["doyoon"], "attribute": "affiliation.registration", "key": "porter", "value": {"class": "F", "registry_no": "88-0412"}, "value_text": "Registered Association porter, Class F, No. 88-0412", "valid_from": clock(1, 10, "D+0"), "valid_to": None},
         "evidence": ev("PORTER — CLASS F. Association Registry No. 88-0412.")},
        {"local_id": "ev-hired", "type": "event", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(1, 20, "D+0"),
         "payload": {"type": "meeting", "summary": "Do-yoon approaches Park Mu-jin at the porter board and is taken on as porter for the Mapo D-gate run at 6 a.m. the next day, for eight percent of the stones.", "location_id": IDS["hall"], "participants": [{"entity_id": IDS["doyoon"], "role": "agent"}, {"entity_id": IDS["mujin"], "role": "agent"}], "importance": "core"},
         "evidence": ev("“Pay is eight percent of the stones. You carry what I tell you and you run when I tell you.”")},
        {"local_id": "f-party", "type": "fact", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(1, 20, "D+0"),
         "payload": {"entity_id": IDS["doyoon"], "attribute": "affiliation.party", "value": "mujin_run", "value_text": "Porter on Park Mu-jin's Mapo Gate 3 run (6 a.m., D+1)", "valid_from": clock(1, 20, "D+0"), "valid_to": None},
         "evidence": ev("“Six a.m. Don’t be late.”")},
        {"local_id": "r-md", "type": "relationship_state", "op": "supersede", "frame": "canonical", "confidence": 0.95, "importance": "major", "story_clock": clock(1, 21, "D+0"), "supersedes_ref": "{{bible.r-mujin-doyoon}}",
         "payload": {"from_entity_id": IDS["mujin"], "to_entity_id": IDS["doyoon"], "type": "superior", "axes": {"trust": 1, "affection": 0, "respect": 0, "hostility": 0, "dependency": 0}, "power_dynamic": "from_dominant", "register": {"formality": 1, "deference": 0, "familiarity": 1, "directness": 4, "contractions": "free", "address_terms": ["kid"]}, "note": "Hired him on the spot; 'Fine. Kid.'", "valid_from": clock(1, 21, "D+0"), "valid_to": None},
         "evidence": ev("“Mister Park,” Mu-jin repeated, tasting it, and snorted. “Nobody’s called me that in twenty years. Fine. Kid.”")},
        {"local_id": "r-dm", "type": "relationship_state", "op": "supersede", "frame": "canonical", "confidence": 0.95, "importance": "major", "story_clock": clock(1, 21, "D+0"), "supersedes_ref": "{{bible.r-doyoon-mujin}}",
         "payload": {"from_entity_id": IDS["doyoon"], "to_entity_id": IDS["mujin"], "type": "subordinate", "axes": {"trust": 3, "affection": 2, "respect": 3, "hostility": 0, "dependency": 1}, "power_dynamic": "to_dominant", "register": {"formality": 3, "deference": 3, "familiarity": 0, "directness": 2, "contractions": "neutral", "address_terms": ["Mister Park", "sir"]}, "valid_from": clock(1, 21, "D+0"), "valid_to": None},
         "evidence": ev("Mu-jin looked up. “Do I know you, kid?”")},
        {"local_id": "k-reader-p1", "type": "knowledge_state", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(1, 3, "D+0"),
         "payload": {"knower": {"kind": "reader"}, "proposition_id": "{{proposition.P1}}", "stance": "knows", "source": {"kind": "narration", "chapter_id": "{{chapter.1}}"}, "valid_from": clock(1, 3, "D+0"), "valid_to": None},
         "evidence": ev("In this whole room, he was the only one who knew how far this hand could go.")},
        {"local_id": "pr-run", "type": "promise_event", "op": "open", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(1, 40, "D+0"),
         "payload": {"promise_id": IDS["promise_gate_run"], "kind": "opened", "note": "Mu-jin's message: same words as last time; last time Do-yoon was late and Mu-jin came out on a stretcher."},
         "evidence": ev("Last time, Do-yoon had been late, and Mu-jin had gone in without a porter, and had come out on a stretcher with the left leg of his trousers cut away.")},
    ]
    hook_text = "The first thing on the list was tomorrow."
    assert revised.rstrip().endswith(hook_text)
    envelope = {
        "project_id": "{{project}}",
        "chapter_id": "{{chapter.1}}",
        "manuscript_version_id": "{{version.1.approved}}",
        "base_canon_version": "{{int:canon_version}}",
        "stage": "extracted_a",
    }
    extraction = {
        **envelope,
        "items": delta_items,
        "unresolved_questions": [],
        "hypothesis_results": [
            {"hypothesis_ref": "MH-1", "result": "realized", "evidence": ev("[F]")},
            {"hypothesis_ref": "MH-2", "result": "realized", "evidence": ev("PORTER — CLASS F. Association Registry No. 88-0412.")},
            {"hypothesis_ref": "MH-3", "result": "realized", "evidence": ev("“Pay is eight percent of the stones. You carry what I tell you and you run when I tell you.”")},
            {"hypothesis_ref": "state:affiliation.party", "result": "realized"},
        ],
        "summary_l1": "Measurement morning, day zero. The device reads F for Kang Do-yoon, as it did ten years ago; he does not flinch. He registers as a Class F porter (No. 88-0412), finds Park Mu-jin at the porter board and is taken on for tomorrow's Mapo Gate 3 run at 6 a.m. for eight percent of the stones. On the steps he writes a three-item list and deletes the third. Mu-jin's message arrives with the same words as last time — when Do-yoon was late and Mu-jin came out on a stretcher.",
        "ending_hook": hook_text,
    }
    summary = {
        "summary_l1": extraction["summary_l1"],
        "ending_hook": hook_text,
        "state_changes": ["Kang Do-yoon: power.rank = F", "Kang Do-yoon: registered Class F porter No. 88-0412", "Kang Do-yoon: porter on Park Mu-jin's Mapo Gate 3 run"],
        "knowledge_changes": ["reader knows Kang Do-yoon is a regressor"],
    }
    assert len(extraction["summary_l1"].split()) <= 120

    # ---- Unsupported-claim variant (tests): a quote that is not in the text.
    bad_delta = {
        **envelope,
        "items": [dict(delta_items[1], local_id="f-rank-bad", evidence=[{"manuscript_version_id": "{{version.1.approved}}", "chapter_no": 1, "paragraph_id": "p1", "start": 0, "end": 27, "quote": "The measurement device sang."}])],
        "unresolved_questions": [],
        "hypothesis_results": [],
        "summary_l1": "x",
    }
    # ---- Planned-frame variant (T11): plans never become realized canon. Two separate smuggling attempts
    # in one delta — a plan-framed event, and a canonical fact dated after this chapter's story time — so
    # the test proves the frame rule and the future-validity rule independently (ADR-0039, FR-7.6).
    plan_evidence = ev("Red letters. The same red letters as ten years ago.")
    plan_delta = {
        **envelope,
        "items": [
            {"local_id": "f-plan", "type": "event", "op": "assert", "frame": "plan", "confidence": 1, "importance": "core", "story_clock": clock(1, 2, "D+0"),
             "payload": {"type": "revelation", "summary": "Do-yoon plans to reach E-rank by ch.8 (a plan, not yet happened).", "location_id": IDS["hall"],
                         "participants": [{"entity_id": IDS["doyoon"], "role": "agent"}], "importance": "core"},
             "evidence": plan_evidence},
            {"local_id": "f-future", "type": "fact", "op": "assert", "frame": "canonical", "confidence": 1, "importance": "core", "story_clock": clock(1, 2, "D+0"),
             "payload": {"entity_id": IDS["doyoon"], "attribute": "power.rank", "value": "E", "value_text": "E-rank (dated after this chapter's story time)",
                         "valid_from": clock(1, 100, "D+0"), "valid_to": None},
             "evidence": plan_evidence},
        ],
        "unresolved_questions": [],
        "hypothesis_results": [],
        "summary_l1": "x",
    }

    def verdict(a_id: str, b_id: str, order: str, overall: str) -> dict:
        """A comparison-verdict.schema.json instance: evidence first, then a per-dimension preference.

        `overall` is 'a', 'b' or 'tie' in the CURRENT presentation order, which is what the judge returns
        and what the workflow maps back to candidate ids. english_prose_quality and serialized_structure
        deliberately disagree so the fixture also exercises EVAL-SEPARATION-001: one candidate can win the
        English prose dimension while losing the serialized-structure dimension.
        """
        pro = "a" if overall == "a" else ("b" if overall == "b" else "tie")
        anti = "b" if pro == "a" else ("a" if pro == "b" else "tie")
        return {
            "candidate_a_id": a_id,
            "candidate_b_id": b_id,
            "presentation_order": order,
            "dimensions": [
                {"dimension": "contract_fit", "evidence_a": "[p1] opens on the F reading, as the contract requires.", "evidence_b": "[p1] opens on the same beat.", "preference": "tie"},
                {"dimension": "hook", "evidence_a": "[p1] first line is the device screaming.", "evidence_b": "[p2] the hook arrives a paragraph later.", "preference": pro, "margin": "clear"},
                {"dimension": "english_prose_quality", "evidence_a": "[p12] 'It felt exactly the way it had ten years ago.' reads as natural English.", "evidence_b": "[p12] the same sentence keeps a transfer-grammar shape.", "preference": pro, "margin": "clear"},
                {"dimension": "serialized_structure", "evidence_a": "[p20] ending turns outward but softly.", "evidence_b": "[p20] ending lands the forward pull harder.", "preference": anti, "margin": "slight"},
            ],
            "overall_preference": overall,
            "confidence": 0.8,
            "rationale": "Hook timing and English prose decide it; the structure dimension goes the other way and is reported as such.",
        }

    A = "activity:"
    recordings = {
        A + "story_spec:v1": rec({"project_id": "{{project}}", "version": "{{int:spec_version}}", "items": spec_items, "conflicts": []}),
        A + "assumptions:v1": rec({"explanations": explanations}),
        A + "arc_plan:1": rec(arc_plan),
        A + "chapter_contract:1": rec(contract1),
        A + "scene_plan:1": rec(scene_plan),
        A + "scene_draft:1:1": rec(drafts[1]),
        A + "scene_draft:1:2": rec(drafts[2]),
        A + "scene_draft:1:3": rec(drafts[3]),
        A + "contract_check:1:r0": rec(contract_check),
        A + "continuity:1:r0": rec(no_issues),
        A + "knowledge_leak:1:r0": rec(no_issues),
        A + "prose_judge:1:r0": rec(prose_r0),
        A + "structure_judge:1:r0": rec(structure),
        A + "revise:1:prose:r1": rec(patch),
        A + "contract_check:1:r1": rec(contract_check),
        A + "continuity:1:r1": rec(no_issues),
        A + "knowledge_leak:1:r1": rec(no_issues),
        A + "prose_judge:1:r1": rec(prose_r1),
        A + "structure_judge:1:r1": rec(structure),
        A + "extract:1": rec(extraction),
        A + "summarize:1": rec(summary),
        A + "chapter_contract:2": rec(contract2),
        # ---- B-6-4 candidate comparison (ADR-0015). Slots 1 and 2 of chapter 1; the comparator sees the
        # candidates as A/B by presentation order only, so each order has its own recording. The ids are
        # bound at replay time from the run's manuscript version ids.
        A + "compare:1:s1s2:ab": rec(verdict("{{candidate.1}}", "{{candidate.2}}", "ab", "a")),
        A + "compare:1:s1s2:ba": rec(verdict("{{candidate.2}}", "{{candidate.1}}", "ba", "b")),
        # test-only variants (selected by tests through ReplayProvider.override)
        # Position bias: both orders prefer whichever text is shown first. The shuffled-rubric third run
        # decides; here it picks candidate 1.
        "variant:compare:1:s1s2:ab:biased": rec(verdict("{{candidate.1}}", "{{candidate.2}}", "ab", "a")),
        "variant:compare:1:s1s2:ba:biased": rec(verdict("{{candidate.2}}", "{{candidate.1}}", "ba", "a")),
        "variant:compare:1:s1s2:shuffled:decides_1": rec(verdict("{{candidate.1}}", "{{candidate.2}}", "ab", "a")),
        "variant:compare:1:s1s2:shuffled:tie": rec(verdict("{{candidate.1}}", "{{candidate.2}}", "ab", "tie")),
        # Both orders tie: no position bias, straight to the deterministic ladder.
        "variant:compare:1:s1s2:ab:tie": rec(verdict("{{candidate.1}}", "{{candidate.2}}", "ab", "tie")),
        "variant:compare:1:s1s2:ba:tie": rec(verdict("{{candidate.2}}", "{{candidate.1}}", "ba", "tie")),
        # A judge that renames the pair must fail closed rather than have its verdict accepted.
        "variant:compare:1:s1s2:ab:wrong_ids": rec(verdict(IDS["doyoon"], "{{candidate.2}}", "ab", "a")),
        "variant:extract:1:unsupported": rec(bad_delta),
        "variant:extract:1:planned": rec(plan_delta),
        "variant:prose_judge:1:r1:still_failing": rec(prose_r0),
        "variant:scene_draft:1:3:korean": rec(dict(drafts[3], text=drafts[3]["text"].replace("Two lines.", "두 줄."))),
    }

    expected = {
        "assembled_code_points": len(assembled),
        "revised_code_points": len(revised),
        "assembled_paragraphs": len(paras),
        "bad_sentence": {"quote": bad, "start": bad_s, "end": bad_e, "paragraph_id": bad_para},
        "revised_sentence": good,
        "ending_hook": hook_text,
        "words": {"assembled": len(assembled.split()), "revised": len(revised.split())},
        "scene_words": [len(s1.split()), len(s2.split()), len(s3.split())],
        "delta_items": len(delta_items),
    }

    os.makedirs(FX, exist_ok=True)
    with open(os.path.join(FX, "story-bible.ch01.json"), "w", encoding="utf-8") as f:
        json.dump(bible, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(os.path.join(FX, "replay.ch01.json"), "w", encoding="utf-8") as f:
        json.dump(recordings, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with open(os.path.join(FX, "expected.ch01.json"), "w", encoding="utf-8") as f:
        json.dump(expected, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(os.path.join(FX, "ids.ch01.json"), "w", encoding="utf-8") as f:
        json.dump(IDS, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(expected, indent=1))


if __name__ == "__main__":
    main()
