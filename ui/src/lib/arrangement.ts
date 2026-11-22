/**
 * Минимальные типы аранжировки для timeline (read-only проекция в кокпите).
 * Полный arrangement-движок audio-ui не копируем: правка аранжировки живёт
 * в SoundCraft — кокпит лишь показывает сессию (proposal §3).
 * Типы совместимы с audio-ui `lib/arrangement.ts` (MIT, Ouest Labs).
 */

/** Цвет дорожки: индекс палитры timeline или CSS-хекс вроде `#3e63dd`. */
export type TrackColor = number | string;

/** Что задаёт заголовок дорожки: громкость, пан, mute/solo. */
export interface Mix {
  /** Индекс цвета дорожки либо CSS-хекс. */
  color: TrackColor;
  gain: number;
  muted: boolean;
  /** От -1 (лево) до 1 (право). */
  pan: number;
  soloed: boolean;
}

export const UNITY_MIX: Mix = {
  color: 0,
  gain: 1,
  muted: false,
  pan: 0,
  soloed: false,
};
