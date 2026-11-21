"""Чтение MIDI-файлов в компактный JSON — мост для хостов без file-import.

logic.py пишет файл, midi_io читает его обратно. Формат notes:
[{start, end, note, velocity, channel}] — тики от начала файла, 0-indexed
каналы. Это DAW-агностичное ядро: Ardour-Lua-мост (Wave 2) и будущие
адаптеры берут ноты отсюда, а не парсят MIDI сами.
"""

from __future__ import annotations

import mido


def load_notes(path: str) -> dict:
    """MIDI-файл -> {path, ticks_per_beat, bpm, duration_ticks, notes[]}.

    BPM берётся из первого set_tempo (None, если файл темпа не несёт —
    наш контракт embed_tempo=False). Совпадающие start у одной ноты
    (форшлаг-ретриг) обрабатываются стеком.
    """
    mid = mido.MidiFile(path)
    bpm = None
    notes: list[dict] = []
    for track in mid.tracks:
        t = 0
        active: dict[tuple[int, int], list[tuple[int, int]]] = {}
        for msg in track:
            t += msg.time
            if msg.type == "set_tempo" and bpm is None:
                bpm = round(mido.tempo2bpm(msg.tempo), 2)
            elif msg.type == "note_on" and msg.velocity > 0:
                active.setdefault((msg.channel, msg.note), []).append((t, msg.velocity))
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                starts = active.get((msg.channel, msg.note))
                if starts:
                    s, vel = starts.pop(0)
                    notes.append({"start": s, "end": t, "note": msg.note,
                                  "velocity": vel, "channel": msg.channel})
    notes.sort(key=lambda n: (n["start"], n["note"]))
    return {
        "path": path,
        "ticks_per_beat": mid.ticks_per_beat,
        "bpm": bpm,
        "duration_ticks": max((n["end"] for n in notes), default=0),
        "note_count": len(notes),
        "notes": notes,
    }
