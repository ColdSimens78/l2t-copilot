"""Общие контракты и утилиты L2T — без привязки к транспортам и DAW.

Правило экосистемы: всё, что должно совпадать между модулями (нотация
тональностей, equivalence-правила Self-Check, будущие контракты DawBackend),
живёт здесь — единственный источник истины.
"""

from core.keys import keys_match, note_name, parse_key

__all__ = ["keys_match", "note_name", "parse_key"]
