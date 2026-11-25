"""Чистая музыкальная логика midi-gen: только mido, без MCP.

Всё детерминировано (никакого рандома) — единица проверки файл, поэтому
регрессию можно ловить байт-в-байт. Контракт темпа (PRD §3): set_tempo
вшивается только по явному embed_tempo=True — SoundCraft file.import_midi
применяет темп файла к темп-карте сессии, поэтому в пайплайне сессия —
источник истины.
"""

from __future__ import annotations

import os

import mido
from mido import Message, MetaMessage, MidiFile, MidiTrack

from core.keys import PC_NAMES, note_name, parse_key  # noqa: F401  (re-export)

TPB = 480                  # тиков на четверть
BAR_TICKS = 4 * TPB
BASS_OCTAVE_ROOT = 36      # C2 — корень басового регистра
CHORD_OCTAVE_ROOT = 48     # C3 — регистр аккордов над басом

# --- Бас ------------------------------------------------------------------

BASS_STYLES = ("basic", "octaves", "syncopated", "walking", "sub")


def bass_events(style: str, root_pc: int, mode: str) -> list[tuple[int, int, int, int]]:
    """Один такт баса: (тик, нота, гейт, velocity). Паттерны рукописные, не случайные."""
    if style not in BASS_STYLES:
        raise ValueError(f"Неизвестный стиль {style!r}; доступны: {', '.join(BASS_STYLES)}")
    root = BASS_OCTAVE_ROOT + root_pc
    third = 3 if mode == "minor" else 4
    q, e = TPB, TPB // 2  # четверть, восьмая
    if style == "basic":  # тоника-квинта-октава-терция по четвертям (паттерн PoC №3)
        return [(0, root, e, 100), (q, root + 7, e, 100),
                (2 * q, root + 12, e, 100), (3 * q, root + third, e, 100)]
    if style == "octaves":  # октавный баунс восьмыми
        return [(i * e, root if i % 2 == 0 else root + 12, e,
                 100 if i % 2 == 0 else 80) for i in range(8)]
    if style == "syncopated":  # акценты на слабые восьмые
        return [(0, root, 3 * e // 2, 100), (3 * e, root, q, 90),
                (3 * e + q, root + 7, e, 95), (3 * q, root + 7, e, 90),
                (3 * q + e, root + third, e, 100)]
    if style == "walking":  # четверти: тоника-терция-квинта-октава
        return [(0, root, q - 60, 90), (q, root + third, q - 60, 90),
                (2 * q, root + 7, q - 60, 90), (3 * q, root + 12, q - 60, 90)]
    return [(0, root - 12, BAR_TICKS - 10, 100), (2 * q, root, q, 95)]  # sub: дрон + акцент


def _abs_to_track(track: MidiTrack, abs_events: list[tuple[int, int, int, int]],
                  channel: int = 0) -> None:
    """Абсолютные события (тик, on/off, нота, velocity) -> сортировка -> дельты.

    Сортировка по (тик, is_on) ставит note_off ПЕРЕД note_on в тот же тик —
    иначе ретриг одной ноты даёт отрицательные дельты (урок PoC №3).
    """
    abs_events.sort(key=lambda ev: (ev[0], ev[1]))
    prev = 0
    for t, is_on, note, vel in abs_events:
        track.append(Message("note_on" if is_on else "note_off",
                             channel=channel, note=note, velocity=vel,
                             time=t - prev))
        prev = t


def write_bassline(path: str, bpm: int, events: list[tuple[int, int, int, int]],
                   embed_tempo: bool = False) -> dict:
    """set_tempo вшиваем только по явному запросу: SoundCraft file.import_midi
    применяет темп из файла к темп-карте сессии, молча перезаписывая её."""
    mid = MidiFile(ticks_per_beat=TPB)
    track = MidiTrack()
    mid.tracks.append(track)
    if embed_tempo:
        track.append(MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm)))
    track.append(MetaMessage("time_signature", numerator=4, denominator=4))
    abs_events: list[tuple[int, int, int, int]] = []
    for t, note, gate, vel in events:
        abs_events.append((t, 1, note, vel))
        abs_events.append((t + gate, 0, note, 0))
    _abs_to_track(track, abs_events)
    mid.save(path)
    return {"path": path, "bytes": os.path.getsize(path)}


# --- Аккордовые прогрессии -------------------------------------------------

# Ступени натурального лада: имя -> (полутонов от тоники, качество)
MINOR_DEGREES = {"i": (0, "m"), "III": (3, "M"), "iv": (5, "m"),
                 "v": (7, "m"), "VI": (8, "M"), "VII": (10, "M")}
MAJOR_DEGREES = {"I": (0, "M"), "IV": (5, "M"), "V": (7, "M"), "vi": (9, "m")}
MINOR_PROG = ["i", "VI", "III", "VII"]   # Am F C G
MAJOR_PROG = ["I", "V", "vi", "IV"]      # C G Am F


def build_progression(root_pc: int, mode: str) -> list[tuple[str, list[int]]]:
    """Прогрессия как [(имя, триада)]; i-VI-III-VII для минора, I-V-vi-IV для мажора."""
    degrees = MINOR_DEGREES if mode == "minor" else MAJOR_DEGREES
    prog = MINOR_PROG if mode == "minor" else MAJOR_PROG
    out = []
    for deg in prog:
        off, quality = degrees[deg]
        pc = (root_pc + off) % 12
        root = CHORD_OCTAVE_ROOT + pc
        triad = [root, root + 4, root + 7] if quality == "M" else [root, root + 3, root + 7]
        out.append((PC_NAMES[pc] + ("" if quality == "M" else "m"), triad))
    return out


def _close_voicings(triad_pcs: list[int]) -> list[list[int]]:
    """Close-position вуизинги (все инверсии) в полосе C3..E5, по возрастанию."""
    pcs = sorted(p % 12 for p in triad_pcs)
    cands: list[list[int]] = []
    seen: set[tuple[int, int, int]] = set()
    for rot in range(3):
        order = pcs[rot:] + pcs[:rot]
        for low in range(48, 61):
            p1 = low + ((order[0] - low) % 12)
            if p1 > 60:
                continue
            p2 = p1 + ((order[1] - p1) % 12)
            p3 = p2 + ((order[2] - p2) % 12)
            if p3 <= 76 and (p1, p2, p3) not in seen:
                seen.add((p1, p2, p3))
                cands.append([p1, p2, p3])
    return cands


def max_motion(voicings: list[list[int]]) -> int:
    """Максимальное движение одного голоса между соседними аккордами (в полутонах).

    Публичный proxy-показатель Acceptance Rate (PRD §4): чем меньше прыжки
    голосов, тем больше шансов, что профессионал оставит партию.
    """
    return max((max(abs(a - b) for a, b in zip(v2, v1))
                for v1, v2 in zip(voicings, voicings[1:])), default=0)


def voice_leading(chords: list[tuple[str, list[int]]]) -> tuple[list[tuple[str, list[int]]], int]:
    """Жадное голосоведение: каждый следующий аккорд — инверсия с минимальным
    суммарным движением голосов от предыдущего. Имена получают слэш-бас."""
    out: list[tuple[str, list[int]]] = []
    prev: list[int] | None = None
    for name, triad in chords:
        cands = _close_voicings(triad)
        if prev is None:
            best = min(cands, key=sum)  # компактнейший старт
        else:
            best = min(cands, key=lambda v: (sum(abs(a - b) for a, b in zip(v, prev)), sum(v)))
        root_pc = triad[0] % 12
        slash = name if best[0] % 12 == root_pc else f"{name}/{PC_NAMES[best[0] % 12]}"
        out.append((slash, best))
        prev = best
    return out, max_motion([v for _, v in out])


def write_progression(path: str, bpm: int, chords, bars: int,
                      embed_tempo: bool = False) -> dict:
    """Блок-аккорды по такту (chords = [(имя, питчи)] — block или voiceled)."""
    mid = MidiFile(ticks_per_beat=TPB)
    track = MidiTrack()
    mid.tracks.append(track)
    if embed_tempo:
        track.append(MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm)))
    track.append(MetaMessage("time_signature", numerator=4, denominator=4))
    for bar in range(bars):
        _, triad = chords[bar % len(chords)]
        for note in triad:                       # три ноты одновременно
            track.append(Message("note_on", note=note, velocity=90, time=0))
        for i, note in enumerate(triad):         # снятие всем аккордом в конце такта
            track.append(Message("note_off", note=note, velocity=0,
                                 time=BAR_TICKS if i == 0 else 0))
    mid.save(path)
    return {"path": path, "bytes": os.path.getsize(path)}


# --- Ударные (GM channel 10) -----------------------------------------------

GM_KICK, GM_SNARE, GM_HAT = 36, 38, 42
DRUM_CHANNEL = 9          # 0-indexed, GM drum map
HAT_GATE = TPB // 8       # длительность удара в тиках


def drum_events(style: str, fill: bool = False) -> list[tuple[int, int, int]]:
    """Удары одного такта: (тик, нота, velocity). fill=True добавляет филл на 4-ю долю."""
    if style != "basic":
        raise ValueError(f"Неизвестный стиль {style!r}; доступен: 'basic'")
    events = []
    for beat in (0, 2):
        events.append((beat * TPB, GM_KICK, 105))       # бочка 1 и 3
    for beat in (1, 3):
        events.append((beat * TPB, GM_SNARE, 95))       # снейр 2 и 4
    for i in range(8):                                   # хэты восьмыми
        events.append((i * TPB // 2, GM_HAT, 75 if i % 2 == 0 else 55))
    if fill:
        # филл: снейр шестнадцатыми с нарастающей velocity, хэты 4-й доли убираем
        b4, s16 = 3 * TPB, TPB // 4
        events = [ev for ev in events
                  if not (ev[0] >= b4 and ev[1] in (GM_SNARE, GM_HAT))]
        events += [(b4 + i * s16, GM_SNARE, 70 + i * 10) for i in range(4)]
    return sorted(events)


def write_drums(path: str, bpm: int, bars: int, style: str,
                embed_tempo: bool = False, variation: bool = False) -> dict:
    mid = MidiFile(ticks_per_beat=TPB)
    track = MidiTrack()
    mid.tracks.append(track)
    if embed_tempo:
        track.append(MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm)))
    track.append(MetaMessage("time_signature", numerator=4, denominator=4))
    abs_events: list[tuple[int, int, int, int]] = []
    hits = 0
    for bar in range(bars):
        bar_fill = variation and bar % 4 == 3  # филл на каждом 4-м такте
        for tick, note, vel in drum_events(style, fill=bar_fill):
            t = bar * BAR_TICKS + tick
            abs_events.append((t, 1, note, vel))
            abs_events.append((t + HAT_GATE, 0, note, 0))
            hits += 1
    _abs_to_track(track, abs_events, channel=DRUM_CHANNEL)
    mid.save(path)
    return {"path": path, "bytes": os.path.getsize(path), "hits": hits}


# --- Мелодия (lead-партия над аккордами) -----------------------------------

MELODY_STYLES = ("sparse", "flow", "syncopated")
MELODY_LOW, MELODY_HIGH = 60, 76      # регистр мелодии над аккордами (C4..E5)

# Материал — пентатоника лада; проходящие — остальные ступени полного лада.
MINOR_PENTA, MAJOR_PENTA = (0, 3, 5, 7, 10), (0, 2, 4, 7, 9)
MINOR_FULL, MAJOR_FULL = (0, 2, 3, 5, 7, 8, 10), (0, 2, 4, 5, 7, 9, 11)

# Контуры по ступеням пентатоники: sparse — ротация трёх фигур по четвертям,
# flow — восьмые с проходящими на слабых восьмых (3-й и 7-й), syncopated —
# три сетки в восьмых внутри такта, ротация по тактам.
_SPARSE_DEGS = ((0, 2, 4, 2), (4, 3, 2, 0), (2, 4, 6, 4))
_FLOW_DEGS = (0, 1, 2, 4, 3, 2, 4, 6)
_SYNC_GRIDS = ((0, 1, 3, 4, 6, 7), (0, 2, 3, 5, 6), (1, 2, 4, 5, 7))
_SYNC_DEGS = ((0, 2, 4, 5, 4, 2), (4, 5, 6, 4, 2), (0, 4, 5, 4, 2))


def _deg_note(root_pitch: int, degree: int, intervals) -> int:
    """Питч ступени пентатоники с клампом в регистр 60..76."""
    note = root_pitch + 12 * (degree // len(intervals)) + intervals[degree % len(intervals)]
    while note > MELODY_HIGH:
        note -= 12
    while note < MELODY_LOW:
        note += 12
    return note


def _passing_between(root_pc: int, intervals, lo: int, hi: int, fallback: int) -> int:
    """Проходящая нота полного лада строго между lo и hi (ближе к середине);
    между соседями нет ступени лада — возвращаем fallback (повтор предыдущей)."""
    lo_c, hi_c = (lo, hi) if lo < hi else (hi, lo)
    full = set(intervals)
    cands = [p for p in range(lo_c + 1, hi_c) if (p - root_pc) % 12 in full]
    if not cands:
        return fallback
    return min(cands, key=lambda p: (abs(p - (lo_c + hi_c) / 2), p))


def melody_events(style: str, root_pc: int, mode: str,
                  bars: int = 4) -> list[tuple[int, int, int, int]]:
    """Мелодия на bars тактов: (тик, нота, гейт, velocity), регистр 60..76.

    Детерминировано, без рандома: материал — пентатоника лада (для минора
    Am-пентатоника A C D E G), проходящие — ступени полного лада на слабых
    восьмых стиля flow; каждая мелодия завершается на тонике. Ритм-стили:
    'sparse' — четверти, 'flow' — восьмые, 'syncopated' — три синкопированные
    сетки с ротацией по тактам.
    """
    if style not in MELODY_STYLES:
        raise ValueError(f"Неизвестный стиль {style!r}; доступны: {', '.join(MELODY_STYLES)}")
    if not 1 <= bars <= 64:
        raise ValueError(f"bars должен быть 1..64, получил {bars}")
    penta = MINOR_PENTA if mode == "minor" else MAJOR_PENTA
    full = MINOR_FULL if mode == "minor" else MAJOR_FULL
    root_pitch = MELODY_LOW + root_pc            # тоника в регистре 60..71
    q, e = TPB, TPB // 2
    events: list[tuple[int, int, int, int]] = []
    for bar in range(bars):
        final = bar == bars - 1
        bar_events: list[tuple[int, int, int, int]] = []
        if style == "sparse":
            degs = _SPARSE_DEGS[bar % len(_SPARSE_DEGS)]
            if final:
                degs = degs[:3] + (0,)           # разрешение в тонику
            for i, deg in enumerate(degs):
                bar_events.append((i * q, _deg_note(root_pitch, deg, penta), q - 10,
                                   100 if i == 0 else 90))
        elif style == "flow":
            for i, deg in enumerate(_FLOW_DEGS):
                note = _deg_note(root_pitch, deg, penta)
                if i in (3, 7):                  # слабые восьмые — проходящая
                    nxt = _deg_note(root_pitch, _FLOW_DEGS[(i + 1) % len(_FLOW_DEGS)], penta)
                    prev = bar_events[-1][1] if bar_events else note
                    note = _passing_between(root_pc, full, prev, nxt, fallback=note)
                bar_events.append((i * e, note, e - 10, 100 if i == 0 else 90))
            if final:                            # разрешение в тонику
                t, _, g, v = bar_events[-1]
                bar_events[-1] = (t, root_pitch, g, v)
        else:  # syncopated
            grid = _SYNC_GRIDS[bar % len(_SYNC_GRIDS)]
            degs = _SYNC_DEGS[bar % len(_SYNC_DEGS)]
            if final:
                degs = degs[:-1] + (0,)          # разрешение в тонику
            for i, (pos, deg) in enumerate(zip(grid, degs)):
                nxt_pos = grid[i + 1] if i + 1 < len(grid) else 8
                bar_events.append((pos * e, _deg_note(root_pitch, deg, penta),
                                   nxt_pos * e - 10,
                                   100 if pos == 0 else 95 if pos % 2 else 90))
        events.extend((bar * BAR_TICKS + t, n, g, v) for t, n, g, v in bar_events)
    return events


def write_melody(path: str, bpm: int, events, embed_tempo: bool = False) -> dict:
    """Тот же writer, что у баса: абсолютные события + контракт темпа."""
    return write_bassline(path, bpm, events, embed_tempo=embed_tempo)


# --- Общая валидация --------------------------------------------------------

def validate_output(bpm: int, output_path: str) -> None:
    """Bounded-валидация: ошибки сразу и с внятным текстом, никаких зависаний."""
    if not 20 <= bpm <= 300:
        raise ValueError(f"bpm должен быть 20..300, получил {bpm}")
    if not output_path.lower().endswith((".mid", ".midi")):
        raise ValueError("output_path должен заканчиваться на .mid или .midi")
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
