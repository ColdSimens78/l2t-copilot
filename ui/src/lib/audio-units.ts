/**
 * Уровни, как их выражают аудио-движки: гейн — отношение амплитуд,
 * 20 дБ на десяток, 6.02 дБ на октаву удвоения, 0 дБ = полная шкала.
 * Копия формул из audio-ui `engine/analysis/level.ts` (MIT, Ouest Labs) —
 * движок анализа целиком не копируем: никакого DSP в UI-процессе (VISION v2).
 */

/** Отношение амплитуд уровня в дБ: 0 дБ = 1, -6.02 дБ = 0.5. `-Infinity` → 0. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Уровень в дБ отношения амплитуд: 1 = 0 дБ, 0.5 = -6.02 дБ. Меньше нуля → `-Infinity`. */
export function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY;
}
