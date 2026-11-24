/**
 * Мост форматов: midi_io (тики, {note,start,end,velocity,channel}) →
 * audio-ui piano-roll Note ({pitch,start,length,velocity 0..1}).
 *
 * Единица таймлайна кокпита — шестнадцатая (тик/120 @480 TPQ): такт 4/4 = 16
 * единиц, сетка PianoRollGrid — gridStep 1 / accentStep 4 без пересчёта долей.
 * Ghost-ноты получают id с префиксом «ghost:» — по нему рендер-ветка
 * GhostPianoRollGrid рисует их призрачно и без ручек правки (read-only до
 * accept, proposal §3.1).
 */
import type { Note } from "@/components/audio-ui/piano-roll/edits";
import type { Note as MidiNote, Suggestion } from "@/types/contract";

export const TICKS_PER_UNIT = 120; // 480 TPQ / 120 = 16-я нота
export const UNITS_PER_BAR = 16;

export function ticksToUnits(ticks: number): number {
  return ticks / TICKS_PER_UNIT;
}

export function realNotes(notes: MidiNote[]): Note[] {
  return notes.map((n, i) => ({
    id: `r${i}`,
    pitch: n.note,
    start: ticksToUnits(n.start),
    length: ticksToUnits(n.end - n.start),
    velocity: n.velocity / 127,
  }));
}

export function ghostNotes(s: Suggestion): Note[] {
  return s.notes.map((n, i) => ({
    id: `ghost:${i}`,
    pitch: n.note,
    start: ticksToUnits(n.start),
    length: ticksToUnits(n.end - n.start),
    velocity: n.velocity / 127,
  }));
}

export function isGhost(note: Note): boolean {
  return typeof note.id === "string" && note.id.startsWith("ghost:");
}

/** Такт 4/4 в тиках (16 шестнадцатых по 120). */
export const TICKS_PER_BAR = UNITS_PER_BAR * TICKS_PER_UNIT;

export interface PreviewShape {
  /** Диапазон высот партии — строки мини-превью. */
  minPitch: number;
  maxPitch: number;
  /** Длина превью в тактах: целый ряд, чтобы сетка была ровной. */
  bars: number;
}

/** Геометрия мини-превью (GhostPreview): высоты и длина в тактах; null — нот нет. */
export function previewShape(notes: MidiNote[]): PreviewShape | null {
  if (notes.length === 0) return null;
  let minPitch = Infinity;
  let maxPitch = -Infinity;
  let end = 0;
  for (const n of notes) {
    if (n.note < minPitch) minPitch = n.note;
    if (n.note > maxPitch) maxPitch = n.note;
    if (n.end > end) end = n.end;
  }
  return { minPitch, maxPitch, bars: Math.max(1, Math.ceil(end / TICKS_PER_BAR)) };
}
