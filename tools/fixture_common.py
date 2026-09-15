"""Shared fixture helpers for the replay fixtures under examples/fixture/ch<NN>/.

Extracted from tools/build-ch01-fixture.py in Checkpoint 6 (B-6-1) so the chapter-2 fixture is built by
the same code that builds chapter 1: paragraph segmentation mirroring @yeonjae/prose, code-point evidence
spans, scene-draft envelopes and StoryClock values. Regenerating chapter 1 with these helpers reproduces
examples/fixture/ch01 byte-for-byte.

Never edit a generated replay.ch<NN>.json by hand: fix the builder and re-run it.
"""
from __future__ import annotations

import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Deterministic fixture ids. Chapter 1 and chapter 2 share one project, so they share this table; the
# ch<NN>/ids.ch<NN>.json files are written from it.
IDS = {

    "project": "0191b2a0-0000-7000-8000-0000000000c1",
    "workspace": "0191b2a0-0000-7000-8000-0000000000c0",
    "identity_version": "0191b2a0-0000-7000-8000-000000060001",
    "doyoon": "0191b2a0-0000-7000-8000-0000000c0001",
    "seoha": "0191b2a0-0000-7000-8000-0000000c0002",
    "mujin": "0191b2a0-0000-7000-8000-0000000c0003",
    "hyunseok": "0191b2a0-0000-7000-8000-0000000c0004",
    "yoon": "0191b2a0-0000-7000-8000-0000000c0007",
    "minjae": "0191b2a0-0000-7000-8000-0000000c0008",
    "hall": "0191b2a0-0000-7000-8000-000000010001",
    "gangnam_gate": "0191b2a0-0000-7000-8000-000000010004",
    "mapo_gate3": "0191b2a0-0000-7000-8000-000000010006",
    "association": "0191b2a0-0000-7000-8000-000000011001",
    "rank_scale": "0191b2a0-0000-7000-8000-000000012001",
    "promise_compass": "0191b2a0-0000-7000-8000-0000000d0001",
    "promise_gate_run": "0191b2a0-0000-7000-8000-0000000d0011",
    "promise_watcher": "0191b2a0-0000-7000-8000-0000000d0003",
    "arc1": "0191b2a0-0000-7000-8000-0000000e0001",
    "season1": "0191b2a0-0000-7000-8000-0000000f0001",
    "contract1": "0191b2a0-0000-7000-8000-000000070001",
    "contract2": "0191b2a0-0000-7000-8000-000000070002",
}


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def read_scene(chapter_no: int, n: int) -> str:
    path = os.path.join(ROOT, "examples", "fixture", f"ch{chapter_no:02d}", "manuscripts", f"ch{chapter_no:02d}.scene{n}.txt")
    with open(path, encoding="utf-8") as f:
        return nfc(f.read())


def paragraphs(text: str) -> list[tuple[str, int, int, str]]:
    """Mirror @yeonjae/prose segmentParagraphs: blank-line separated, code-point offsets, ids p1.."""
    out = []
    cps = list(text)
    # work on utf-16-free python str: python indices are code points already
    start = 0
    for m in re.finditer(r"\n[ \t]*\n+", text):
        end = m.start()
        while end > start and text[end - 1] == "\n":
            end -= 1
        if end > start:
            out.append((f"p{len(out)+1}", start, end, text[start:end]))
        start = m.end()
    end = len(text)
    while end > start and text[end - 1] == "\n":
        end -= 1
    if end > start:
        out.append((f"p{len(out)+1}", start, end, text[start:end]))
    assert len(cps) == len(text)
    return out


def kind_of(p: str) -> str:
    if p.startswith("“") and p.endswith("”") and "\n" not in p:
        return "dialogue"
    if p.startswith("*") and p.endswith("*"):
        return "monologue"
    if p.startswith("[") and p.endswith("]"):
        return "system_block"
    if "“" in p:
        return "mixed"
    return "narration"


def scene_draft(n: int, text: str, speakers: dict[str, str], claims: list[tuple[str, str, list[str]]]):
    paras = paragraphs(text)
    ann = []
    for pid, s, e, body in paras:
        if body.startswith("“"):
            # single utterance paragraphs: first quoted run
            q_end = body.find("”")
            if q_end > 0:
                spk = speakers.get(pid)
                if spk:
                    ann.append({"utterance_start": s, "utterance_end": s + q_end + 1, "speaker_id": spk})
    return {
        "scene_no": n,
        "language": "en",
        "text": text.rstrip("\n"),
        "paragraphs": [{"id": pid, "start": s, "end": e, "kind": kind_of(body)} for pid, s, e, body in paras],
        "speaker_annotations": ann,
        "claims": [
            {"statement": st, "paragraph_id": pid, "entity_ids": ents, "frame": "canonical"}
            for st, pid, ents in claims
        ],
    }


def find_span(text: str, quote: str, start_hint: int = 0) -> tuple[int, int]:
    quote = nfc(quote)
    i = text.find(quote, start_hint)
    if i < 0:
        raise SystemExit(f"quote not found: {quote!r}")
    if text.find(quote, i + 1) >= 0:
        raise SystemExit(f"quote is not unique: {quote!r}")
    return i, i + len(quote)


def paragraph_of(paras, start: int) -> str:
    for pid, s, e, _ in paras:
        if s <= start < e:
            return pid
    raise SystemExit(f"no paragraph at {start}")


def evidence(text: str, paras, quote: str, version_key: str, chapter_no: int = 1):
    s, e = find_span(text, quote)
    return {
        "manuscript_version_id": "{{" + version_key + "}}",
        "chapter_no": chapter_no,
        "paragraph_id": paragraph_of(paras, s),
        "start": s,
        "end": e,
        "quote": nfc(quote),
    }


def clock(ch: int, ordinal: int, world: str | None = None):
    c = {"chapter_no": ch, "ordinal": ordinal, "precision": "exact"}
    if world:
        c["calendar"] = "relative_days"
        c["world_date"] = world
    return c



def rec(json_obj):
    """A ReplayProvider recording: the JSON a provider would have returned, plus fixed usage numbers."""
    return {"json": json_obj, "modelId": "replay-model", "usage": {"input": 1000, "output": 500, "cached": 0}}
