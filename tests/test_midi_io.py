"""Тесты midi_io: файл, написанный logic.py, читается обратно без потерь."""

from __future__ import annotations

from core.keys import parse_key
from core.midi_io import load_notes
from mcp_servers.midi_gen import logic as lg


def test_bassline_roundtrip(tmp_path):
    path = str(tmp_path / "b.mid")
    lg.write_bassline(path, 60, lg.bass_events("basic", *parse_key("A minor")))
    d = load_notes(path)
    assert d["note_count"] == 4
    assert [n["note"] for n in d["notes"]] == [45, 52, 57, 48]  # A2 E3 A3 C3
    assert d["ticks_per_beat"] == 480
    assert d["duration_ticks"] == 1680  # последняя нота: 1440 + 240


def test_bpm_extracted_only_when_embedded(tmp_path):
    p1 = str(tmp_path / "no_tempo.mid")
    lg.write_bassline(p1, 60, lg.bass_events("basic", *parse_key("A minor")))
    assert load_notes(p1)["bpm"] is None          # контракт: set_tempo нет

    p2 = str(tmp_path / "with_tempo.mid")
    lg.write_bassline(p2, 90, lg.bass_events("basic", *parse_key("A minor")),
                      embed_tempo=True)
    assert load_notes(p2)["bpm"] == 90.0          # opt-in темп виден


def test_drums_channel_preserved(tmp_path):
    path = str(tmp_path / "d.mid")
    lg.write_drums(path, 60, 1, "basic")
    d = load_notes(path)
    assert d["note_count"] == 12
    assert {n["channel"] for n in d["notes"]} == {9}  # GM drum channel (0-indexed)
