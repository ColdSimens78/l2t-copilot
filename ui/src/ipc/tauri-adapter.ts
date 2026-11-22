/**
 * TAURI-адаптер CockpitApi: тот же интерфейс, транспорт = Tauri IPC
 * (invoke команд ядра + listen событий). Заготовка: экраны не меняются,
 * вживление ядра Кодером = раскомментировать invoke-строки и переключить
 * `currentAdapter` в api.ts (ОДНА строка).
 *
 * Имена команд ядра — в точности ipc-contract v0.2:
 * analyze_loop / generate_part / regenerate / accept_part / reject_part /
 * adopt_loop / get_bus_state / run_self_check; события — bus_log /
 * suggestion_updated / host_status.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BusLogEvent,
  BusState,
  HostStatusEvent,
  SelfCheckReport,
  Suggestion,
  SuggestionUpdatedEvent,
  XRayReport,
} from "@/types/contract";
import type { CockpitApi, Unsubscribe } from "@/ipc/api";

// Транспортные события ядра приходят в окно с префиксом контракта.
// TODO(Кодер): сверить имена emit-ов ядра с этим списком (один источник —
// docs/ipc-contract.md v0.2).
const EV = {
  busLog: "bus_log",
  suggestionUpdated: "suggestion_updated",
  hostStatus: "host_status",
} as const;

function wrap<T>(p: Promise<T>): Promise<T> {
  // Ядро отдаёт ошибки как текст JSON-RPC (правило 3) — наверх идёт как есть.
  return p;
}

export const tauriAdapter: CockpitApi = {
  async analyzeLoop(input) {
    return wrap(invoke<XRayReport>("analyze_loop", { input }));
  },
  async generatePart(input) {
    return wrap(invoke<Suggestion>("generate_part", { input }));
  },
  async regenerate(input) {
    return wrap(invoke<Suggestion>("regenerate", { input }));
  },
  async acceptPart(input) {
    return wrap(invoke<{ imported_tracks: string[] }>("accept_part", { input }));
  },
  async rejectPart(input) {
    await wrap(invoke("reject_part", { input }));
  },
  async adoptLoop(input) {
    return wrap(invoke<{ tempo: number; marker: string }>("adopt_loop", { input }));
  },
  async getBusState() {
    return wrap(invoke<BusState>("get_bus_state"));
  },
  async runSelfCheck(input) {
    return wrap(invoke<SelfCheckReport>("run_self_check", { input }));
  },

  onBusLog(handler): Unsubscribe {
    let un: UnlistenFn | null = null;
    listen<BusLogEvent>(EV.busLog, (e) => handler(e.payload)).then((u) => (un = u));
    return () => un?.();
  },
  onSuggestionUpdated(handler): Unsubscribe {
    let un: UnlistenFn | null = null;
    listen<SuggestionUpdatedEvent>(EV.suggestionUpdated, (e) => handler(e.payload)).then(
      (u) => (un = u),
    );
    return () => un?.();
  },
  onHostStatus(handler): Unsubscribe {
    let un: UnlistenFn | null = null;
    listen<HostStatusEvent>(EV.hostStatus, (e) => handler(e.payload)).then((u) => (un = u));
    return () => un?.();
  },
};

// ЗАМЕЧАНИЕ: mock-адаптер — источник поведения до вживления ядра.
