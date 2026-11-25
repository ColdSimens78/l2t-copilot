"""Смоук-тесты контракта midi-gen v3 (детерминированность и правила шины).

Запуск: pytest tests/ (или `pip install -e '.[dev]'` и pytest).
"""

from __future__ import annotations

import mido

from core.keys import keys_match, parse_key
from mcp_servers.midi_gen import logic as lg


def test_relative_key_equivalence():
    # A minor и C major — «параллельные» (EN relative) — один набор знаков
    assert keys_match("A minor", "C major")
    assert keys_match("C major", "A minor")
    # одноимённые (EN parallel) — НЕ эквивалентны
    assert not keys_match("A minor", "A major")
    assert not keys_match("A minor", "E minor")


def test_bass_basic_is_poc_pattern():
    # Паттерн PoC №3 зафиксирован контрактом: A2 E3 A3 C3 по четвертям
    events = lg.bass_events("basic", *parse_key("A minor"))
    assert [n for _, n, _, _ in events] == [45, 52, 57, 48]


def test_voice_leading_beats_block():
    pc, mode = parse_key("A minor")
    chords = lg.build_progression(pc, mode)
    voiced_chords, voiced_motion = lg.voice_leading(chords)
    block_motion = lg.max_motion([t for _, t in chords])
    assert voiced_motion < block_motion  # измерено: 4 < 7 на Am F C G
    # слэш-бас в именах: тоника аккорда != нижний голос
    assert any("/" in name for name, _ in voiced_chords)


def test_drums_gm_channel(tmp_path):
    path = str(tmp_path / "d.mid")
    info = lg.write_drums(path, 60, 1, "basic")
    ons = [m for m in mido.MidiFile(path).tracks[0] if m.type == "note_on"]
    assert {m.channel for m in ons} == {lg.DRUM_CHANNEL}  # канал 10 (0-indexed 9)
    assert len(ons) == 12
    assert info["hits"] == 12


def test_no_embedded_tempo_by_default(tmp_path):
    path = str(tmp_path / "b.mid")
    lg.write_bassline(path, 60, lg.bass_events("basic", *parse_key("E minor")))
    assert b"\xff\x51" not in open(path, "rb").read()  # нет set_tempo


def test_embedded_tempo_opt_in(tmp_path):
    path = str(tmp_path / "b.mid")
    lg.write_bassline(path, 90, lg.bass_events("basic", *parse_key("E minor")),
                      embed_tempo=True)
    assert b"\xff\x51" in open(path, "rb").read()


def test_drum_variation_fill_count(tmp_path):
    path = str(tmp_path / "d.mid")
    info = lg.write_drums(path, 60, 8, "basic", variation=True)
    # 8 тактов: 96 базовых ударов, филлы на тактах 4 и 8 дают +1 каждый
    assert info["hits"] == 98


# --- generate_melody (lead-партия) -------------------------------------------

_FULL_MINOR = (0, 2, 3, 5, 7, 8, 10)
_FULL_MAJOR = (0, 2, 4, 5, 7, 9, 11)


def test_melody_deterministic_byte_for_byte(tmp_path):
    pc, mode = parse_key("E minor")
    ev1 = lg.melody_events("flow", pc, mode, 4)
    ev2 = lg.melody_events("flow", pc, mode, 4)
    assert ev1 == ev2                       # события совпадают раз-в-раз
    p1, p2 = str(tmp_path / "a.mid"), str(tmp_path / "b.mid")
    lg.write_melody(p1, 120, ev1)
    lg.write_melody(p2, 120, ev1)
    assert open(p1, "rb").read() == open(p2, "rb").read()  # файл байт-в-байт


def test_melody_styles_in_register_and_in_mode():
    pc, mode = parse_key("A minor")
    scale = {(pc + off) % 12 for off in _FULL_MINOR}  # питч-классы лада
    for style in lg.MELODY_STYLES:
        evs = lg.melody_events(style, pc, mode, 4)
        assert evs, style
        assert all(60 <= n <= 76 for _, n, _, _ in evs), style
        assert all(n % 12 in scale for _, n, _, _ in evs), style


def test_melody_major_across_roots_stays_in_register():
    for key in ("C major", "F# major", "Bb major"):
        pc, mode = parse_key(key)
        evs = lg.melody_events("flow", pc, mode, 2)
        assert all(60 <= n <= 76 for _, n, _, _ in evs), key
        scale = {(pc + off) % 12 for off in _FULL_MAJOR}  # питч-классы лада
        assert all(n % 12 in scale for _, n, _, _ in evs), key


def test_melody_resolves_to_root():
    pc, _ = parse_key("A minor")
    for style in lg.MELODY_STYLES:
        evs = lg.melody_events(style, pc, "minor", 4)
        assert evs[-1][1] == 60 + pc  # последняя нота мелодии — тоника
