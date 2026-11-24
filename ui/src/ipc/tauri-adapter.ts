/**
 * TAURI-адаптер CockpitApi: тот же интерфейс, транспорт = Tauri IPC
 * (invoke команд ядра + listen событий). Экраны не меняются при переходе
 * на мок и обратно.
 *
 * Имена команд ядра — в точности ipc-contract v0.2.1:
 * analyze_loop / generate_part / regenerate / accept_part / reject_part /
 * adopt_loop / get_bus_state / run_self_check / export_track; события —
 * bus_log / suggestion_updated / host_status (сверено с шеллом).
 *
 * Провод: вход команды уходит одним объектом `input`, поля внутри —
 * snake_case, 1:1 с `*Input` зеркала контракта. Стороны сходятся на этой
 * форме: ядро читает вход из `input`, а не из отдельных аргументов.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BusLogEvent,
  BusState,
  ExportTrackOutput,
  HostStatusEvent,
  SelfCheckReport,
  Suggestion,
  SuggestionUpdatedEvent,
  XRayReport,
} from "@/types/contract";
import type { CockpitApi, Unsubscribe } from "@/ipc/api";

// Транспортные события ядра приходят в окно с префиксом контракта.
const EV = {
  busLog: "bus_log",
  suggestionUpdated: "suggestion_updated",
  hostStatus: "host_status",
} as const;

// Нативный drag-and-drop окна (WebKitGTK при dragDropEnabled перехватывает
// HTML5-drop — путь файла приходит только сюда). Позиция — физические
// пиксели от левого верхнего угла webview.
const DND = {
  enter: "tauri://drag-enter",
  over: "tauri://drag-over",
  drop: "tauri://drag-drop",
  leave: "tauri://drag-leave",
} as const;

interface DragDropPayload {
  paths?: unknown;
  position?: { x?: number; y?: number } | null;
}

/**
 * Подписка с отложенной регистрацией: listen асинхронен, а cleanup эффекта
 * может прийти раньше (StrictMode) — закрытый флаг не даёт слушателю
 * пережить свою подписку.
 */
function subscribe<T>(name: string, handler: (payload: T) => void): Unsubscribe {
  let un: UnlistenFn | null = null;
  let closed = false;
  listen<T>(name, (e) => handler(e.payload)).then(
    (u) => {
      if (closed) u();
      else un = u;
    },
    () => {
      /* ядро ещё не поднялось — событие всё равно не пришло бы */
    },
  );
  return () => {
    closed = true;
    un?.();
  };
}

export const tauriAdapter: CockpitApi = {
  async analyzeLoop(input) {
    // Ядро отдаёт ошибки текстом JSON-RPC (правило 3) — наверх идёт как есть.
    return invoke<XRayReport>("analyze_loop", { input });
  },
  async generatePart(input) {
    return invoke<Suggestion>("generate_part", { input });
  },
  async regenerate(input) {
    return invoke<Suggestion>("regenerate", { input });
  },
  async acceptPart(input) {
    return invoke<{ imported_tracks: string[] }>("accept_part", { input });
  },
  async rejectPart(input) {
    await invoke("reject_part", { input });
  },
  async adoptLoop(input) {
    return invoke<{ tempo: number; marker: string }>("adopt_loop", { input });
  },
  async getBusState() {
    return invoke<BusState>("get_bus_state");
  },
  async runSelfCheck(input) {
    return invoke<SelfCheckReport>("run_self_check", { input });
  },
  // v0.2.1: тот же вход одним объектом `input`, что и остальные команды.
  async exportTrack(input) {
    return invoke<ExportTrackOutput>("export_track", { input });
  },
  // previewUrl не реализован: окно пока не умеет читать файлы песочницы
  // (ни asset-протокола, ни команды чтения) — [▶] честно выключен.

  onBusLog(handler): Unsubscribe {
    return subscribe<BusLogEvent>(EV.busLog, handler);
  },
  onSuggestionUpdated(handler): Unsubscribe {
    return subscribe<SuggestionUpdatedEvent>(EV.suggestionUpdated, handler);
  },
  onHostStatus(handler): Unsubscribe {
    return subscribe<HostStatusEvent>(EV.hostStatus, handler);
  },

  dropMode: "tauri",
  onFileDrop(handler): Unsubscribe {
    const position = (p: DragDropPayload["position"]) =>
      p && typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : null;
    const firstPath = (p: DragDropPayload) =>
      Array.isArray(p.paths) && typeof p.paths[0] === "string" ? p.paths[0] : null;
    const offs = [
      subscribe<DragDropPayload>(DND.over, (p) => handler({ kind: "over", position: position(p.position), path: null })),
      subscribe<DragDropPayload>(DND.leave, () => handler({ kind: "leave", position: null, path: null })),
      subscribe<DragDropPayload>(DND.drop, (p) =>
        handler({ kind: "drop", position: position(p.position), path: firstPath(p) }),
      ),
    ];
    return () => offs.forEach((off) => off());
  },
};
