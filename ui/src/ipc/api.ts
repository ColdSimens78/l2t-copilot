/**
 * CockpitApi — ЕДИНСТВЕННЫЙ интерфейс UI↔ядро (зеркало docs/ipc-contract.md
 * v0.2.1, раздел Commands/Events). Фронт не знает ни MCP, ни транспорт:
 * переключение mock ↔ Tauri — ОДНА строка в `currentAdapter` ниже.
 *
 * Правила спеки, которые живёт здесь:
 * - pending-строки AI Dock рисует store локально с момента вызова
 *   (bus_log не имеет статуса «start», спека §3);
 * - таймаут ≠ отказ: ядро само делает inspect — UI не ретраит (спека §0.6);
 * - рендер микса — только контрактный export_track (v0.2.1): он же путь
 *   «normalize до цели» в Self-Check (C3 закрыт);
 * - никакого прямого доступа к MCP из компонентов.
 */
import type {
  AcceptPartOutput,
  AdoptLoopInput,
  AdoptLoopOutput,
  AnalyzeLoopInput,
  BusLogEvent,
  BusState,
  ExportTrackInput,
  ExportTrackOutput,
  GeneratePartInput,
  HostStatusEvent,
  PartId,
  PartVersionInput,
  RegenerateInput,
  RunSelfCheckInput,
  SelfCheckReport,
  Suggestion,
  SuggestionUpdatedEvent,
  XRayReport,
} from "@/types/contract";

export type Unsubscribe = () => void;

/** Как окно получает перетаскиваемые файлы (мост двух сред — lib/use-file-drop.ts). */
export type DropMode = "html5" | "tauri";

/** Событие нативного drag-and-drop окна: курсор + путь первого файла (для drop). */
export interface FileDropEvent {
  kind: "over" | "leave" | "drop";
  /** Физические пиксели относительно окна; null, если среда позицию не дала. */
  position: { x: number; y: number } | null;
  path: string | null;
}

export interface CockpitApi {
  // ── Commands (UI → ядро) ──
  analyzeLoop(input: AnalyzeLoopInput): Promise<XRayReport>;
  generatePart(input: GeneratePartInput): Promise<Suggestion>;
  regenerate(input: RegenerateInput): Promise<Suggestion>;
  acceptPart(input: PartVersionInput): Promise<AcceptPartOutput>;
  rejectPart(input: PartVersionInput): Promise<void>;
  adoptLoop(input: AdoptLoopInput): Promise<AdoptLoopOutput>;
  getBusState(): Promise<BusState>;
  runSelfCheck(input: RunSelfCheckInput): Promise<SelfCheckReport>;
  /** v0.2.1: рендер микса движком в WAV внутри песочницы — с целью громкости или без. */
  exportTrack(input: ExportTrackInput): Promise<ExportTrackOutput>;

  // ── Events (ядро → UI) ──
  onBusLog(handler: (event: BusLogEvent) => void): Unsubscribe;
  onSuggestionUpdated(handler: (event: SuggestionUpdatedEvent) => void): Unsubscribe;
  onHostStatus(handler: (event: HostStatusEvent) => void): Unsubscribe;

  // ── Среда ──
  readonly dropMode: DropMode;
  /** Только при dropMode «tauri»: нативное событие tauri://drag-drop всего окна. */
  onFileDrop?(handler: (event: FileDropEvent) => void): Unsubscribe;
  /**
   * C2 (конвенция staging/<part>_v<N>.wav): превью партии как URL для HTML
   * audio. null — рендер ещё не готов; undefined — среда не отдаёт файлы
   * наружу (окно без доступа к файловой системе): кнопка [▶] выключена.
   */
  previewUrl?(part: PartId, version: number): string | null;
}

// ─── Переключение адаптеров: авто-детект среды ────────────────────────────
// MOCK (весь UI кликабелен на симуляции ядра) ↔ TAURI (живое ядро).
// `window.__TAURI_INTERNALS__` существует только внутри Tauri-окна; в обычном
// браузере его нет — и это НЕ ошибка: браузер = дев-харнесс, работает mock.
import { mockAdapter } from "@/ipc/mock-adapter";
import { tauriAdapter } from "@/ipc/tauri-adapter";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** «mock» в браузере/дев-харнессе, «tauri» в десктоп-окне. Для индикатора TopBar. */
export const adapterMode: "mock" | "tauri" = isTauri ? "tauri" : "mock";

export const currentAdapter: CockpitApi = isTauri ? tauriAdapter : mockAdapter;

// Дев-харнесс: симулятор сбоев мока доступен из консоли тем же экземпляром,
// что работает в приложении (после hot-reload у модуля новый URL — прямой
// import из консоли дал бы второй экземпляр). В окне Tauri переменной нет.
if (!isTauri) {
  (window as { __l2tMock?: typeof mockAdapter }).__l2tMock = mockAdapter;
}

/** Контекст для компонентов. Провайдер — в store/cockpit.tsx. */
import { createContext, useContext } from "react";
export const ApiContext = createContext<CockpitApi>(currentAdapter);
export const useApi = () => useContext(ApiContext);
