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
import type { MidiNote, Suggestion } from "@/contract/suggestion";

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
