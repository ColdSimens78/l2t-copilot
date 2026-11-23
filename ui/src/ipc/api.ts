/**
 * CockpitApi — ЕДИНСТВЕННЫЙ интерфейс UI↔ядро (зеркало docs/ipc-contract.md
 * v0.2, раздел Commands/Events). Фронт не знает ни MCP, ни транспорт:
 * переключение mock ↔ Tauri — ОДНА строка в `currentAdapter` ниже.
 *
 * Правила спеки, которые живёт здесь:
 * - pending-строки AI Dock рисует store локально с момента вызова
 *   (bus_log не имеет статуса «start», спека §3);
 * - таймаут ≠ отказ: ядро само делает inspect — UI не ретраит (спека §0.6);
 * - никакого прямого доступа к MCP из компонентов.
 */
import type {
  AcceptPartOutput,
  AdoptLoopInput,
  AdoptLoopOutput,
  AnalyzeLoopInput,
  BusLogEvent,
  BusState,
  GeneratePartInput,
  HostStatusEvent,
  PartVersionInput,
  RegenerateInput,
  RunSelfCheckInput,
  SelfCheckReport,
  Suggestion,
  SuggestionUpdatedEvent,
  XRayReport,
} from "@/types/contract";

export type Unsubscribe = () => void;

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

  // ── Events (ядро → UI) ──
  onBusLog(handler: (event: BusLogEvent) => void): Unsubscribe;
  onSuggestionUpdated(handler: (event: SuggestionUpdatedEvent) => void): Unsubscribe;
  onHostStatus(handler: (event: HostStatusEvent) => void): Unsubscribe;
}

// ─── Переключение адаптеров: ОДНА строка ──────────────────────────────────
// MOCK (v0, весь UI кликабелен на симуляции ядра) ↔ TAURI (после вживления
// ядра ядром — без правок экранов; см. tauri-adapter.ts).
import { mockAdapter } from "@/ipc/mock-adapter";
import { tauriAdapter } from "@/ipc/tauri-adapter";
// tauriAdapter доступен для будущей проверки типов:
void tauriAdapter;

export const currentAdapter: CockpitApi = mockAdapter;
// export const currentAdapter: CockpitApi = tauriAdapter;

/** Контекст для компонентов. Провайдер — в store/cockpit.tsx. */
import { createContext, useContext } from "react";
export const ApiContext = createContext<CockpitApi>(currentAdapter);
export const useApi = () => useContext(ApiContext);
