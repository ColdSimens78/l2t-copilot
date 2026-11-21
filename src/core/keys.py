"""Общие контракты тональностей (shared core для всех модулей L2T).

Здесь живут:
  * единый парсер тональностей ("A minor", "Am", "C#", "Bbm" -> (питч-класс, лад));
  * правило relative-key equivalence для Self-Check (PRD §4):
    A minor и C major имеют один набор ключевых знаков (по-русски
    «параллельные» тональности, англ. "relative keys") и считаются
    совпадением, а не ошибкой. Одноимённые (EN "parallel": A minor vs
    A major) эквивалентны НЕ являются.
"""

from __future__ import annotations

import re

PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_TO_SHARP = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}


def parse_key(key: str) -> tuple[int, str]:
    """'A minor' | 'Am' | 'C#' | 'Bbm' -> (питч-класс тоники, 'minor'|'major')."""
    m = re.match(r"^\s*([A-G])([#b♯♭]?)(.*)$", key.strip(), re.IGNORECASE)
    if not m:
        raise ValueError(f"Не разобрал тональность {key!r}; примеры: 'A minor', 'C# major', 'Ebm'")
    letter, accidental, rest = m.groups()
    name = letter.upper() + {"#": "#", "♯": "#", "b": "b", "♭": "b", "": ""}[accidental]
    name = FLAT_TO_SHARP.get(name, name)
    r = rest.strip().lower()
    if r in ("m", "min", "minor"):
        mode = "minor"
    elif r in ("", "maj", "major"):
        mode = "major"
    else:
        raise ValueError(f"Неизвестный лад {rest!r} в {key!r}")
    return PC_NAMES.index(name), mode


def note_name(midi: int) -> str:
    return f"{PC_NAMES[midi % 12]}{midi // 12 - 1}"


def signature_pc(pc: int, mode: str) -> int:
    """Идентификатор ключевых знаков: питч-класс тоники относительного мажора."""
    return pc if mode == "major" else (pc + 3) % 12


def keys_match(key_a: str, key_b: str) -> bool:
    """Relative-key equivalence для Self-Check: один набор ключевых знаков.

    keys_match('A minor', 'C major') -> True   (relative / «параллельные»)
    keys_match('A minor', 'A major') -> False  (parallel / «одноимённые»)
    """
    pc_a, mode_a = parse_key(key_a)
    pc_b, mode_b = parse_key(key_b)
    return signature_pc(pc_a, mode_a) == signature_pc(pc_b, mode_b)
