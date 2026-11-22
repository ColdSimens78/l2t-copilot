/**
 * IPC-контракт: кокпит ↔ ядро — TS-зеркало docs/ipc-contract.md **v0.2**.
 * Единственное место типов между React-фронтом и Rust-ядром; Rust-сторона —
 * crates/l2t-core/src/contract.rs (serde). Ручная синхронизация до v1:
 * расхождение сторон = баг. Изменения схемы — только bump версии контракта
 * + строка в «ПРЕДЛОЖЕНИЯ ДЕТЕЙ» + согласие Папы.
 *
 * v0.2 (вердикты C1–C6): + adopt_loop (C1), конвенция превью-WAV (C2,
 * константа PREVIEW_WAV), analyze_loop.copy_into_workspace (C5),
 * BusState.session_name (C6); daw.render/cancel/транспорт — отложены (⏸).
 */

// ─── Данные ────────────────────────────────────────────────────────────────

/** Генераторы-каналы: единые UI-алиасы и tool-имена контракта. */
export type PartId = "bass" | "chords" | "drums";

/**
 * Нота — формат core/midi_io.load_notes (единственный: никаких pitch/len,
 * правило 3 контракта). Абсолютные тики (480 TPQ: доля = 480, такт 4/4 =
 * 1920); каналы 0-indexed, 9 = GM-ударные.
 */
export interface Note {
  /** MIDI-высота: 60 = C4. */
  note: number;
  /** Начало, тики. */
  start: number;
  /** Конец, тики (не длина). */
  end: number;
  /** 1–127. */
  velocity: number;
  /** 0–15. */
  channel: number;
}

/** Жизненный цикл предложения (§5.2 proposal). */
export type SuggestionStatus = "generated" | "auditioned" | "accepted" | "rejected";

/** Предложение партии — «призрачные ноты» (§5.1 proposal; пример v0.1). */
export interface Suggestion {
  /** Номер версии партии; регенерация = новая версия. */
  version: number;
  part: PartId;
  /** Вывод core/midi_io.load_notes без изменений. */
  notes: Note[];
  /** Одна строка человеку. */
  rationale: string;
  /** 0..1. */
  confidence: number;
  /** Происхождение обязательно: «midi-gen.generate_bassline v3». */
  source_tool: string;
  /** Параметры MCP-инструмента: регенерация = тот же вызов с другими params. */
  params: Record<string, unknown>;
  status: SuggestionStatus;
}

/** Loop X-Ray — выход analyze_loop. `bpm_alt`/`key_relative` могут быть null. */
export interface XRayReport {
  bpm: number;
  bpm_confidence: number;
  bpm_alt: number | null;
  key: string;
  key_confidence: number;
  key_relative: string | null;
  lufs: number;
  true_peak: number;
  bands: Record<string, number>;
  onset_density: number | null;
}

export type BusEngine = "up" | "waking" | "down";

/** Снимок DAW-сессии — выход get_bus_state (v0.2: + session_name, C6). */
export interface BusState {
  tempo: number;
  key_marker: string;
  tracks: unknown[];
  engine: BusEngine;
  /** Имя открытой сессии хоста для TopBar; null, если движок не поднялся. */
  session_name: string | null;
}

/** Self-Check — выход run_self_check (relative-key и ×2/÷2 решает ядро). */
export interface SelfCheckReport {
  key_match: boolean;
  tempo_match: boolean;
  lufs_delta: number;
  bands_delta: Record<string, number>;
  verdict: "ok" | "fail";
}

// ─── Commands (UI → ядро) ──────────────────────────────────────────────────

export interface AnalyzeLoopInput {
  path: string;
  /** v0.2 (C5): скопировать файл в workspace при drop извне песочницы (правило 1). */
  copy_into_workspace?: boolean;
}
export interface GeneratePartInput {
  tool: PartId;
  params: Record<string, unknown>;
}
export interface RegenerateInput {
  part: PartId;
  params_diff: Record<string, unknown>;
}
export interface PartVersionInput {
  part: PartId;
  version: number;
}
export interface RunSelfCheckInput {
  bounce_path: string;
}
export interface AcceptPartOutput {
  imported_tracks: string[];
}

/** v0.2 (C1): «Применить к сессии» из Loop X-Ray — opt-in adoption (#1702). */
export interface AdoptLoopInput {
  bpm: number;
  key: string;
  source: string;
}
export interface AdoptLoopOutput {
  tempo: number;
  marker: string;
}

/**
 * v0.2 (C2, конвенция): превью-WAV лежит рядом с .mid — UI ищет файл по
 * этому правилу, рендерит сайдкар GM-синт (fluidsynth) на стороне ядра.
 */
export function previewWavPath(stagingDir: string, part: PartId, version: number): string {
  return `${stagingDir}/${part}_v${version}.wav`;
}

/** v0.2 (⏸ C3): optional-команда; до хост-клиента UI показывает инструкцию экспорта. */
export interface DawRenderInput {
  path: string;
  normalize: boolean;
}

// ─── Events (ядро → UI) ────────────────────────────────────────────────────

export type BusLogStatus = "ok" | "timeout" | "error";

/** Строка инспектора шины (§4.4): таймаут ≠ отказ — ядро само делает inspect. */
export interface BusLogEvent {
  ts: number;
  tool: string;
  command: string;
  status: BusLogStatus;
  ms: number;
}

export interface SuggestionUpdatedEvent {
  part: PartId;
  version: number;
  suggestion: Suggestion;
}

export interface HostStatusEvent {
  engine: BusEngine;
}

// ─── UI-local (вНЕ контракта v0.1 — мок до интеграции manifest ядра) ───────

/**
 * Запись локального manifest-лога AI Dock (мок). Ядро пишет в
 * staging/manifest.json минимальную запись {part, version, decision, ts}
 * (Кодер, 49df4a8); витринные поля mode/source_tool/params — из расширенного
 * предложения Исследователя (§5.3), reconciliation — за Папой. После
 * интеграции заменяется чтением manifest ядра.
 */
export interface AcceptanceEvent {
  ts: number;
  part: PartId;
  version: number;
  decision: "accepted" | "rejected";
  mode: "manual" | "agent" | "autopilot";
  source_tool: string;
  params: Record<string, unknown>;
}
