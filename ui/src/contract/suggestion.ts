/**
 * Контракты данных кокпита.
 *
 * `MidiNote` — единственный формат нот экосистемы: core/midi_io.load_notes
 * (Python, Rust-ядро отдаёт его же по IPC). Тики 480 TPQ: 1 доля = 480,
 * 1 такт 4/4 = 1920. Унификация v0.4: pitch→note, len→end, + channel.
 *
 * `Suggestion` — «призрачные ноты» как контракт данных (proposal §5.1):
 * любое предложение партии, откуда бы оно ни пришло (кнопка, midi-gen-канал,
 * внешний агент, qwen_bridge), существует экземпляром этого контракта.
 * До accept партия живёт только в UI-слое; accept = материализация в DAW.
 */

/** Каналы-генераторы кокпита (FL Channel Rack: генератор = канал). */
export type PartId = "bass" | "chords" | "drums";

/** Нота в формате core/midi_io: {note,start,end,velocity,channel}, тики. */
export interface MidiNote {
  /** MIDI-высота: 60 = до малой октавы (C4). */
  note: number;
  /** Начало, тики от начала клипа. */
  start: number;
  /** Конец, тики (не длина!). */
  end: number;
  /** 1–127. */
  velocity: number;
  /** 0–15; 9 = GM-ударные. */
  channel: number;
}

/** Предложение партии — «призрачные ноты» (proposal §5.1). */
export interface Suggestion {
  part: PartId;
  /** Ноты предложения в формате midi_io. */
  notes: MidiNote[];
  /** Одна строка человеку: почему такое предложение. */
  rationale: string;
  /** Уверенность генератора/агента, 0..1. */
  confidence: number;
  /** Происхождение обязательно (прозрачность PRD): «midi-gen.generate_bassline v3». */
  source_tool: string;
  /** Параметры MCP-инструмента: регенерация из UI = тот же вызов с другими params. */
  params: Record<string, unknown>;
}

/** Жизненный цикл предложения (proposal §5.2). */
export type SuggestionState = "generated" | "auditioned" | "accepted" | "rejected";

/** Событие manifest.json — инструментация Acceptance Rate (PRD §4, proposal §5.3). */
export interface AcceptanceEvent {
  ts: number;
  part: PartId;
  source_tool: string;
  decision: "accepted" | "rejected";
  mode: "manual" | "agent" | "autopilot";
  params: Record<string, unknown>;
}
