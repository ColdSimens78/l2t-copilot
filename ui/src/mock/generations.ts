/**
 * Мок-генерации: полный словарь чипов midi-gen v3 (спека S3), сгенерирован
 * l2t-midi-gen v3 CLI (90 BPM, A minor, bars=4, embed_tempo=false), спарсен
 * core/midi_io.load_notes — формат контракта. Используется mock-адаптером IPC
 * как содержимое suggestion.notes; удаляется при вживлении ядра.
 */
import type { Note } from "@/types/contract";

const bass_basic: Note[] = [
  { note: 45, start: 0, end: 240, velocity: 100, channel: 0 },
  { note: 52, start: 480, end: 720, velocity: 100, channel: 0 },
  { note: 57, start: 960, end: 1200, velocity: 100, channel: 0 },
  { note: 48, start: 1440, end: 1680, velocity: 100, channel: 0 },
];

const bass_octaves: Note[] = [
  { note: 45, start: 0, end: 240, velocity: 100, channel: 0 },
  { note: 57, start: 240, end: 480, velocity: 80, channel: 0 },
  { note: 45, start: 480, end: 720, velocity: 100, channel: 0 },
  { note: 57, start: 720, end: 960, velocity: 80, channel: 0 },
  { note: 45, start: 960, end: 1200, velocity: 100, channel: 0 },
  { note: 57, start: 1200, end: 1440, velocity: 80, channel: 0 },
  { note: 45, start: 1440, end: 1680, velocity: 100, channel: 0 },
  { note: 57, start: 1680, end: 1920, velocity: 80, channel: 0 },
];

const bass_syncopated: Note[] = [
  { note: 45, start: 0, end: 360, velocity: 100, channel: 0 },
  { note: 45, start: 720, end: 1200, velocity: 90, channel: 0 },
  { note: 52, start: 1200, end: 1440, velocity: 95, channel: 0 },
  { note: 52, start: 1440, end: 1680, velocity: 90, channel: 0 },
  { note: 48, start: 1680, end: 1920, velocity: 100, channel: 0 },
];

const bass_walking: Note[] = [
  { note: 45, start: 0, end: 420, velocity: 90, channel: 0 },
  { note: 48, start: 480, end: 900, velocity: 90, channel: 0 },
  { note: 52, start: 960, end: 1380, velocity: 90, channel: 0 },
  { note: 57, start: 1440, end: 1860, velocity: 90, channel: 0 },
];

const bass_sub: Note[] = [
  { note: 33, start: 0, end: 1910, velocity: 100, channel: 0 },
  { note: 45, start: 960, end: 1440, velocity: 95, channel: 0 },
];

const chords_voiceled: Note[] = [
  { note: 48, start: 0, end: 1920, velocity: 90, channel: 0 },
  { note: 52, start: 0, end: 1920, velocity: 90, channel: 0 },
  { note: 57, start: 0, end: 1920, velocity: 90, channel: 0 },
  { note: 48, start: 1920, end: 3840, velocity: 90, channel: 0 },
  { note: 53, start: 1920, end: 3840, velocity: 90, channel: 0 },
  { note: 57, start: 1920, end: 3840, velocity: 90, channel: 0 },
  { note: 48, start: 3840, end: 5760, velocity: 90, channel: 0 },
  { note: 52, start: 3840, end: 5760, velocity: 90, channel: 0 },
  { note: 55, start: 3840, end: 5760, velocity: 90, channel: 0 },
  { note: 50, start: 5760, end: 7680, velocity: 90, channel: 0 },
  { note: 55, start: 5760, end: 7680, velocity: 90, channel: 0 },
  { note: 59, start: 5760, end: 7680, velocity: 90, channel: 0 },
];

const chords_block: Note[] = [
  { note: 57, start: 0, end: 1920, velocity: 90, channel: 0 },
  { note: 60, start: 0, end: 1920, velocity: 90, channel: 0 },
  { note: 64, start: 0, end: 1920, velocity: 90, channel: 0 },
  { note: 53, start: 1920, end: 3840, velocity: 90, channel: 0 },
  { note: 57, start: 1920, end: 3840, velocity: 90, channel: 0 },
  { note: 60, start: 1920, end: 3840, velocity: 90, channel: 0 },
  { note: 48, start: 3840, end: 5760, velocity: 90, channel: 0 },
  { note: 52, start: 3840, end: 5760, velocity: 90, channel: 0 },
  { note: 55, start: 3840, end: 5760, velocity: 90, channel: 0 },
  { note: 55, start: 5760, end: 7680, velocity: 90, channel: 0 },
  { note: 59, start: 5760, end: 7680, velocity: 90, channel: 0 },
  { note: 62, start: 5760, end: 7680, velocity: 90, channel: 0 },
];

const drums_basic: Note[] = [
  { note: 36, start: 0, end: 60, velocity: 105, channel: 9 },
  { note: 42, start: 0, end: 60, velocity: 75, channel: 9 },
  { note: 42, start: 240, end: 300, velocity: 55, channel: 9 },
  { note: 38, start: 480, end: 540, velocity: 95, channel: 9 },
  { note: 42, start: 480, end: 540, velocity: 75, channel: 9 },
  { note: 42, start: 720, end: 780, velocity: 55, channel: 9 },
  { note: 36, start: 960, end: 1020, velocity: 105, channel: 9 },
  { note: 42, start: 960, end: 1020, velocity: 75, channel: 9 },
  { note: 42, start: 1200, end: 1260, velocity: 55, channel: 9 },
  { note: 38, start: 1440, end: 1500, velocity: 95, channel: 9 },
  { note: 42, start: 1440, end: 1500, velocity: 75, channel: 9 },
  { note: 42, start: 1680, end: 1740, velocity: 55, channel: 9 },
  { note: 36, start: 1920, end: 1980, velocity: 105, channel: 9 },
  { note: 42, start: 1920, end: 1980, velocity: 75, channel: 9 },
  { note: 42, start: 2160, end: 2220, velocity: 55, channel: 9 },
  { note: 38, start: 2400, end: 2460, velocity: 95, channel: 9 },
  { note: 42, start: 2400, end: 2460, velocity: 75, channel: 9 },
  { note: 42, start: 2640, end: 2700, velocity: 55, channel: 9 },
  { note: 36, start: 2880, end: 2940, velocity: 105, channel: 9 },
  { note: 42, start: 2880, end: 2940, velocity: 75, channel: 9 },
  { note: 42, start: 3120, end: 3180, velocity: 55, channel: 9 },
  { note: 38, start: 3360, end: 3420, velocity: 95, channel: 9 },
  { note: 42, start: 3360, end: 3420, velocity: 75, channel: 9 },
  { note: 42, start: 3600, end: 3660, velocity: 55, channel: 9 },
  { note: 36, start: 3840, end: 3900, velocity: 105, channel: 9 },
  { note: 42, start: 3840, end: 3900, velocity: 75, channel: 9 },
  { note: 42, start: 4080, end: 4140, velocity: 55, channel: 9 },
  { note: 38, start: 4320, end: 4380, velocity: 95, channel: 9 },
  { note: 42, start: 4320, end: 4380, velocity: 75, channel: 9 },
  { note: 42, start: 4560, end: 4620, velocity: 55, channel: 9 },
  { note: 36, start: 4800, end: 4860, velocity: 105, channel: 9 },
  { note: 42, start: 4800, end: 4860, velocity: 75, channel: 9 },
  { note: 42, start: 5040, end: 5100, velocity: 55, channel: 9 },
  { note: 38, start: 5280, end: 5340, velocity: 95, channel: 9 },
  { note: 42, start: 5280, end: 5340, velocity: 75, channel: 9 },
  { note: 42, start: 5520, end: 5580, velocity: 55, channel: 9 },
  { note: 36, start: 5760, end: 5820, velocity: 105, channel: 9 },
  { note: 42, start: 5760, end: 5820, velocity: 75, channel: 9 },
  { note: 42, start: 6000, end: 6060, velocity: 55, channel: 9 },
  { note: 38, start: 6240, end: 6300, velocity: 95, channel: 9 },
  { note: 42, start: 6240, end: 6300, velocity: 75, channel: 9 },
  { note: 42, start: 6480, end: 6540, velocity: 55, channel: 9 },
  { note: 36, start: 6720, end: 6780, velocity: 105, channel: 9 },
  { note: 42, start: 6720, end: 6780, velocity: 75, channel: 9 },
  { note: 42, start: 6960, end: 7020, velocity: 55, channel: 9 },
  { note: 38, start: 7200, end: 7260, velocity: 95, channel: 9 },
  { note: 42, start: 7200, end: 7260, velocity: 75, channel: 9 },
  { note: 42, start: 7440, end: 7500, velocity: 55, channel: 9 },
];

const drums_variation: Note[] = [
  { note: 36, start: 0, end: 60, velocity: 105, channel: 9 },
  { note: 42, start: 0, end: 60, velocity: 75, channel: 9 },
  { note: 42, start: 240, end: 300, velocity: 55, channel: 9 },
  { note: 38, start: 480, end: 540, velocity: 95, channel: 9 },
  { note: 42, start: 480, end: 540, velocity: 75, channel: 9 },
  { note: 42, start: 720, end: 780, velocity: 55, channel: 9 },
  { note: 36, start: 960, end: 1020, velocity: 105, channel: 9 },
  { note: 42, start: 960, end: 1020, velocity: 75, channel: 9 },
  { note: 42, start: 1200, end: 1260, velocity: 55, channel: 9 },
  { note: 38, start: 1440, end: 1500, velocity: 95, channel: 9 },
  { note: 42, start: 1440, end: 1500, velocity: 75, channel: 9 },
  { note: 42, start: 1680, end: 1740, velocity: 55, channel: 9 },
  { note: 36, start: 1920, end: 1980, velocity: 105, channel: 9 },
  { note: 42, start: 1920, end: 1980, velocity: 75, channel: 9 },
  { note: 42, start: 2160, end: 2220, velocity: 55, channel: 9 },
  { note: 38, start: 2400, end: 2460, velocity: 95, channel: 9 },
  { note: 42, start: 2400, end: 2460, velocity: 75, channel: 9 },
  { note: 42, start: 2640, end: 2700, velocity: 55, channel: 9 },
  { note: 36, start: 2880, end: 2940, velocity: 105, channel: 9 },
  { note: 42, start: 2880, end: 2940, velocity: 75, channel: 9 },
  { note: 42, start: 3120, end: 3180, velocity: 55, channel: 9 },
  { note: 38, start: 3360, end: 3420, velocity: 95, channel: 9 },
  { note: 42, start: 3360, end: 3420, velocity: 75, channel: 9 },
  { note: 42, start: 3600, end: 3660, velocity: 55, channel: 9 },
  { note: 36, start: 3840, end: 3900, velocity: 105, channel: 9 },
  { note: 42, start: 3840, end: 3900, velocity: 75, channel: 9 },
  { note: 42, start: 4080, end: 4140, velocity: 55, channel: 9 },
  { note: 38, start: 4320, end: 4380, velocity: 95, channel: 9 },
  { note: 42, start: 4320, end: 4380, velocity: 75, channel: 9 },
  { note: 42, start: 4560, end: 4620, velocity: 55, channel: 9 },
  { note: 36, start: 4800, end: 4860, velocity: 105, channel: 9 },
  { note: 42, start: 4800, end: 4860, velocity: 75, channel: 9 },
  { note: 42, start: 5040, end: 5100, velocity: 55, channel: 9 },
  { note: 38, start: 5280, end: 5340, velocity: 95, channel: 9 },
  { note: 42, start: 5280, end: 5340, velocity: 75, channel: 9 },
  { note: 42, start: 5520, end: 5580, velocity: 55, channel: 9 },
  { note: 36, start: 5760, end: 5820, velocity: 105, channel: 9 },
  { note: 42, start: 5760, end: 5820, velocity: 75, channel: 9 },
  { note: 42, start: 6000, end: 6060, velocity: 55, channel: 9 },
  { note: 38, start: 6240, end: 6300, velocity: 95, channel: 9 },
  { note: 42, start: 6240, end: 6300, velocity: 75, channel: 9 },
  { note: 42, start: 6480, end: 6540, velocity: 55, channel: 9 },
  { note: 36, start: 6720, end: 6780, velocity: 105, channel: 9 },
  { note: 42, start: 6720, end: 6780, velocity: 75, channel: 9 },
  { note: 42, start: 6960, end: 7020, velocity: 55, channel: 9 },
  { note: 38, start: 7200, end: 7260, velocity: 95, channel: 9 },
  { note: 42, start: 7200, end: 7260, velocity: 75, channel: 9 },
  { note: 42, start: 7440, end: 7500, velocity: 55, channel: 9 },
];

export const GENERATIONS = {
  bass_basic,
  bass_octaves,
  bass_syncopated,
  bass_walking,
  bass_sub,
  chords_voiceled,
  chords_block,
  drums_basic,
  drums_variation,
} as const;
