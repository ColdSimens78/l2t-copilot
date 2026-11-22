"""MCP-обертка midi-gen: инструменты генерации партий для агентов.

Транспорт stdio. Поддерживаются оба поколения SDK через шим:
mcp 1.x — FastMCP, mcp 2.x — MCPServer (переименование API).

Запуск:
    l2t-midi-gen              # MCP stdio (для конфига ZCode / Claude / Cursor)
    l2t-midi-gen --cli ...    # оффлайн-отладка без MCP (см. main)
"""

from __future__ import annotations

import json
import sys

try:
    from mcp.server.fastmcp import FastMCP  # mcp SDK 1.x
except ImportError:  # mcp SDK 2.x
    from mcp.server.mcpserver import MCPServer as FastMCP

from mcp_servers.midi_gen import logic as lg

mcp = FastMCP("midi-gen")

SANDBOX_NOTE = ("Note: SoundCraft (ZCode plugin sandbox) only imports files that live "
                "inside the ZCode workspace — write there or copy before importing.")
TEMPO_NOTE = ("Default false — SoundCraft's file.import_midi applies an embedded "
              "tempo to the session tempo map, silently overwriting it; the session "
              "is the source of truth (PRD §3).")


@mcp.tool()
def generate_bassline(bpm: int, key: str, output_path: str,
                      style: str = "basic", embed_tempo: bool = False) -> dict:
    """Generate a one-bar bassline MIDI file in the given key.

    Hand-written patterns (no randomness): 'basic' root-fifth-octave-third
    quarter notes, 'octaves' eighth-note octave bounce, 'syncopated'
    offbeat accents, 'walking' quarter-note walk-up, 'sub' sustained sub
    drone with an octave accent. Always 4/4.

    Args:
        bpm: Tempo in beats per minute, 20..300 (metadata/duration only unless
            `embed_tempo`).
        key: Tonic + mode, e.g. 'A minor', 'Am', 'C# major', 'Bbm'.
        output_path: Absolute .mid/.midi path; parent directories are created.
        style: One of basic|octaves|syncopated|walking|sub.
        embed_tempo: Write a set_tempo event into the file. """ + TEMPO_NOTE + """

    Returns:
        Compact JSON: path, bytes, bpm, key, style, note names, duration. """ + SANDBOX_NOTE
    lg.validate_output(bpm, output_path)
    root_pc, mode = lg.parse_key(key)
    events = lg.bass_events(style, root_pc, mode)
    info = lg.write_bassline(output_path, bpm, events, embed_tempo=embed_tempo)
    return {
        **info,
        "bpm": bpm,
        "embed_tempo": embed_tempo,
        "key": f"{lg.PC_NAMES[root_pc]} {mode}",
        "style": style,
        "notes": [lg.note_name(n) for _, n, _, _ in events],
        "ticks_per_beat": lg.TPB,
        "duration_sec": round(max(t + g for t, _, g, _ in events) / lg.TPB * 60.0 / bpm, 3),
    }


@mcp.tool()
def generate_chord_progression(bpm: int, key: str, output_path: str,
                               bars: int = 4, embed_tempo: bool = False,
                               voicing: str = "voiceled") -> dict:
    """Generate a chord-progression MIDI file, one chord per bar, 4/4.

    Minor key -> i-VI-III-VII (in A minor: Am F C G); major key -> I-V-vi-IV.
    Whole-bar chords, velocity 90. The progression cycles if `bars` exceeds 4.
    Voicing 'voiceled' (default) picks inversions minimizing voice motion
    between adjacent chords (slash-chord names in the result, e.g. 'F/C');
    'block' keeps root-position triads.

    Args:
        bpm: Tempo in beats per minute, 20..300 (metadata/duration only unless
            `embed_tempo`).
        key: Tonic + mode, e.g. 'A minor', 'Am', 'C# major', 'Bbm'.
        output_path: Absolute .mid/.midi path; parent directories are created.
        bars: Number of bars, 1..64 (default 4 = one full progression cycle).
        embed_tempo: Write a set_tempo event. """ + TEMPO_NOTE + """
        voicing: 'voiceled' (default) or 'block'.

    Returns:
        Compact JSON: path, bytes, key, progression names, voicing,
        max_voice_motion (semitones — the Acceptance-Rate proxy metric), bars,
        note count, duration_sec. """ + SANDBOX_NOTE
    if not 1 <= bars <= 64:
        raise ValueError(f"bars должен быть 1..64, получил {bars}")
    if voicing not in ("voiceled", "block"):
        raise ValueError(f"voicing должен быть 'voiceled' или 'block', получил {voicing!r}")
    lg.validate_output(bpm, output_path)
    root_pc, mode = lg.parse_key(key)
    chords = lg.build_progression(root_pc, mode)
    if voicing == "voiceled":
        chords, motion = lg.voice_leading(chords)
    else:
        motion = lg.max_motion([t for _, t in chords])
    info = lg.write_progression(output_path, bpm, chords, bars, embed_tempo=embed_tempo)
    return {
        **info,
        "bpm": bpm,
        "embed_tempo": embed_tempo,
        "key": f"{lg.PC_NAMES[root_pc]} {mode}",
        "progression": [name for name, _ in chords],
        "voicing": voicing,
        "max_voice_motion": motion,
        "bars": bars,
        "notes": bars * 3,
        "duration_sec": round(bars * 4 * 60.0 / bpm, 3),
    }


@mcp.tool()
def generate_drum_pattern(bpm: int, output_path: str, style: str = "basic",
                          bars: int = 1, embed_tempo: bool = False,
                          variation: bool = False) -> dict:
    """Generate a drum-pattern MIDI file on the GM drum channel (channel 10).

    Style 'basic' (4/4 bar): kick on beats 1 & 3 (note 36), snare on 2 & 4
    (note 38), closed hi-hat in eighth notes (note 42). With `variation`
    every 4th bar (bars 4, 8, ...) gets a snare-sixteenth fill on beat 4.
    SoundCraft's import auto-assigns its built-in drum_synth to a channel-10
    track, so the pattern plays as drums immediately.

    Args:
        bpm: Tempo in beats per minute, 20..300 (metadata/duration only unless
            `embed_tempo`).
        output_path: Absolute .mid/.midi path; parent directories are created.
        style: Pattern style; only 'basic' for now.
        bars: Number of bars, 1..64 (default 1 — loopable one-bar pattern).
        embed_tempo: Write a set_tempo event. """ + TEMPO_NOTE + """
        variation: Add a fill on every 4th bar (requires bars >= 4 to hear it).

    Returns:
        Compact JSON: path, bytes, style, variation, pattern summary, bars,
        hit count, duration_sec. """ + SANDBOX_NOTE
    if not 1 <= bars <= 64:
        raise ValueError(f"bars должен быть 1..64, получил {bars}")
    lg.validate_output(bpm, output_path)
    lg.drum_events(style, fill=True)  # ранняя валидация стиля — до создания файла
    info = lg.write_drums(output_path, bpm, bars, style,
                          embed_tempo=embed_tempo, variation=variation)
    return {
        **info,
        "bpm": bpm,
        "embed_tempo": embed_tempo,
        "style": style,
        "variation": variation,
        "pattern": {"kick": [lg.GM_KICK, "beats 1,3"], "snare": [lg.GM_SNARE, "beats 2,4"],
                    "hat": [lg.GM_HAT, "eighths"], "channel": lg.DRUM_CHANNEL + 1},
        "bars": bars,
        "duration_sec": round(bars * 4 * 60.0 / bpm, 3),
    }


def _cli(a: list[str]) -> dict:
    """CLI-диспетчер (те же формы, что прошли все регресс-тесты v3)."""
    if a and a[0] == "chords":
        # chords <bpm> <key> <out> [bars] [embed 0|1] [voicing]
        return generate_chord_progression(
            int(a[1]), a[2], a[3], bars=int(a[4]) if len(a) > 4 else 4,
            embed_tempo=len(a) > 5 and a[5] == "1",
            voicing=a[6] if len(a) > 6 else "voiceled")
    if a and a[0] == "drums":
        # drums <bpm> <out> [style] [bars] [embed 0|1] [variation 0|1]
        return generate_drum_pattern(
            int(a[1]), a[2], a[3] if len(a) > 3 else "basic",
            bars=int(a[4]) if len(a) > 4 else 1,
            embed_tempo=len(a) > 5 and a[5] == "1",
            variation=len(a) > 6 and a[6] == "1")
    # legacy: <bpm> <key> <out> [embed 0|1] [style]
    return generate_bassline(
        int(a[0]), a[1], a[2], embed_tempo=len(a) > 3 and a[3] == "1",
        style=a[4] if len(a) > 4 else "basic")


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else list(argv)
    if argv and argv[0] == "--cli":
        print(json.dumps(_cli(argv[1:]), indent=2, ensure_ascii=False))
    elif argv:
        # Неизвестный первый аргумент — usage-ошибка, а не молчаливый старт
        # stdio-сервера (урок Wave 2: "l2t-midi-gen chords ..." зависал бы).
        print("usage: l2t-midi-gen            # MCP stdio (для конфига клиента)\n"
              "       l2t-midi-gen --cli ... # оффлайн-генерация (см. README)",
              file=sys.stderr)
        sys.exit(2)
    else:
        mcp.run("stdio")


if __name__ == "__main__":
    main()
