/**
 * Центральный store кокпита (спека ui-screens-v0.md §0–§3):
 * - источники данных: get_bus_state (pull) + события bus_log/suggestion_updated/
 *   host_status; локальный React-state — только эфемерщина (§0.2);
 * - AI Dock: pending-строка рисуется локально с момента вызова (спека §3,
 *   bus_log не имеет «start»), показывает себя только после 300 мс
 *   (трёхуровневая индикация), никогда не модальные спиннеры;
 * - ошибки = toast + кнопка-фикс из каталога §6; таймаут ядро разбирает сам
 *   (⏱ → inspect → ✓), UI не ретраит;
 * - [отменить] в Dock v0 = «отменить показ»: скрыть строку и игнорировать
 *   последующий suggestion_updated этой операции (семантика §3).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useApi } from "@/ipc/api";
import type {
  BusLogEvent,
  BusState,
  PartId,
  Suggestion,
  SuggestionUpdatedEvent,
  XRayReport,
  SelfCheckReport,
} from "@/types/contract";

// ─── Типы состояния ─────────────────────────────────────────────────────────

export interface ChannelVersion {
  suggestion: Suggestion;
  decision?: "accepted" | "rejected";
  /** Номер дорожки хоста после accept (ответ accept_part). */
  trackId?: string;
}

export interface ChannelState {
  /** idle → generating → ready (+ error); accepted выводится из версий. */
  status: "idle" | "generating" | "ready" | "error";
  versions: ChannelVersion[];
  /** Версия, выбранная в VersionHistory (null = последняя). */
  selectedVersion: number | null;
  error: string | null;
  /** Текущие чипы канала (словарь midi-gen v3, спека S3). */
  params: Record<string, unknown>;
  /** Видимый diff регенерации: «style: basic → syncopated». */
  chipDiff: string | null;
}

export interface ToastItem {
  id: number;
  text: string;
  /** Главная кнопка-фикс из каталога §6 (или undefined — только закрыть). */
  fixLabel?: string;
  fix?: () => void;
}

export interface DockLine {
  icon: "pending" | "ok" | "timeout" | "error" | "inspect";
  text: string;
  ts: number;
}

const emptyChannel = (): ChannelState => ({
  status: "idle",
  versions: [],
  selectedVersion: null,
  error: null,
  params: {},
  chipDiff: null,
});

// ─── Словарь AI Dock (спека §3) ─────────────────────────────────────────────

const DOCK_VERB: Record<string, string> = {
  analyze_loop: "слушаю луп",
  generate_part: "генерирую партию",
  regenerate: "перегенерирую",
  accept_part: "передаю в сессию",
  reject_part: "отклоняю версию",
  run_self_check: "проверяю микс",
  adopt_loop: "применяю настройки лупа",
};

const DOCK_TOOL: Record<string, string> = {
  analyze_loop: "audio-analyzer",
  run_self_check: "audio-analyzer",
  generate_part: "midi-gen",
  regenerate: "midi-gen",
  accept_part: "soundcraft",
  reject_part: "soundcraft",
  adopt_loop: "soundcraft",
};

function dockVerb(command: string, arg?: string): string {
  if (command === "generate_part" && arg) return `генерирую ${arg}`;
  if (command === "regenerate" && arg) return `перегенерирую (изменено: ${arg})`;
  return DOCK_VERB[command] ?? command;
}

/** Эффект в итоговой строке ✓ (спека §3: «→ слой bass v1» и т.п.). */
function dockEffect(command: string, arg?: string): string | undefined {
  if (command.startsWith("generate_part") && arg) return `→ слой ${arg}`;
  if (command.startsWith("regenerate") && arg) return `→ слой ${arg} обновлён`;
  if (command.startsWith("accept_part") && arg) return `→ дорожка ${arg}`;
  if (command === "adopt_loop") return "→ сессия обновлена";
  return undefined;
}

// ─── Контекст ───────────────────────────────────────────────────────────────

export interface CockpitStore {
  // шина
  hostStatus: BusState["engine"];
  busState: BusState | null;
  // S1/S2
  loopFile: { name: string; path: string } | null;
  analyzing: boolean;
  xray: XRayReport | null;
  xrayError: string | null;
  // S3
  channels: Record<PartId, ChannelState>;
  // S6
  checking: boolean;
  selfCheck: SelfCheckReport | null;
  selfCheckError: string | null;
  // S7
  busLog: BusLogEvent[];
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  // AI Dock
  dockPending: { tool: string; command: string; sinceTs: number } | null;
  dockLine: DockLine | null;
  dockBackground: number;
  dismissDock: () => void;
  // toasts
  toasts: ToastItem[];
  pushToast: (t: Omit<ToastItem, "id">) => void;
  dismissToast: (id: number) => void;
  // действия (обёртки команд: pending-строка + bus_log + toasts)
  analyzeLoop: (path: string, copyIntoWorkspace?: boolean) => Promise<void>;
  adoptLoop: (bpm: number, key: string) => Promise<void>;
  generatePart: (tool: PartId, params: Record<string, unknown>) => Promise<void>;
  regenerate: (part: PartId, diff: Record<string, unknown>, label: string) => Promise<void>;
  acceptPart: (part: PartId, version: number) => Promise<void>;
  rejectPart: (part: PartId, version: number) => Promise<void>;
  runSelfCheck: (bouncePath: string) => Promise<void>;
  refreshBusState: () => Promise<void>;
  selectChannelVersion: (part: PartId, version: number | null) => void;
}

const StoreContext = createContext<CockpitStore | null>(null);

export function useCockpit(): CockpitStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useCockpit вне CockpitProvider");
  return store;
}

let toastSeq = 1;
let opSeq = 1;

export function CockpitProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [hostStatus, setHostStatus] = useState<BusState["engine"]>("up");
  const [busState, setBusState] = useState<BusState | null>(null);
  const [loopFile, setLoopFile] = useState<{ name: string; path: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [xray, setXray] = useState<XRayReport | null>(null);
  const [xrayError, setXrayError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Record<PartId, ChannelState>>({
    bass: emptyChannel(),
    chords: emptyChannel(),
    drums: emptyChannel(),
  });
  const [checking, setChecking] = useState(false);
  const [selfCheck, setSelfCheck] = useState<SelfCheckReport | null>(null);
  const [selfCheckError, setSelfCheckError] = useState<string | null>(null);
  const [busLog, setBusLog] = useState<BusLogEvent[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dockPending, setDockPending] = useState<CockpitStore["dockPending"]>(null);
  const [dockLine, setDockLine] = useState<DockLine | null>(null);
  const [dockBackground, setDockBackground] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pendingRef = useRef<{ id: number; command: string; part?: PartId } | null>(null);
  const ignoredOps = useRef<Set<number>>(new Set());
  const pendingTimer = useRef<number | undefined>(undefined);

  const pushToast = useCallback((t: Omit<ToastItem, "id">) => {
    setToasts((list) => [...list.slice(-2), { ...t, id: toastSeq++ }]);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  // События ядра → состояние (спека §0.2)
  useEffect(() => {
    const un1 = api.onBusLog((event) => {
      setBusLog((log) => [...log.slice(-199), event]);
      setDockBackground((n) => Math.max(0, n - 1));
      const pending = pendingRef.current;
      if (pending && event.command.startsWith(pending.command.split(" ")[0])) {
        pendingRef.current = null;
        setDockPending(null);
        window.clearTimeout(pendingTimer.current);
        if (event.status === "ok") {
          setDockLine({
            icon: "ok",
            ts: event.ts,
            text: `✓ ${event.tool}: ${event.command} — готово · ${(event.ms / 1000).toFixed(1)} с`,
          });
        } else if (event.status === "timeout") {
          setDockLine({
            icon: "timeout",
            ts: event.ts,
            text: `⏱ ${event.tool}: ${event.command} — таймаут 30 с → проверяю состояние…`,
          });
        } else {
          setDockLine({
            icon: "error",
            ts: event.ts,
            text: `✗ ${event.tool}: ${event.command} — ошибка · подробнее в drawer`,
          });
        }
      } else if (pendingRef.current === null) {
        // внешний агент или inspect ядра — виден в dock как итоговая строка
        if (event.tool === "core" && event.command.startsWith("inspect")) {
          setDockLine({
            icon: "inspect",
            ts: event.ts,
            text: `✓ inspect — операция прошла, ответ потерян`,
          });
        }
      }
    });
    const un2 = api.onSuggestionUpdated((event: SuggestionUpdatedEvent) => {
      setChannels((map) => {
        const channel = { ...map[event.part] };
        if (channel.status === "generating") channel.status = "ready";
        const at = channel.versions.findIndex(
          (v) => v.suggestion.version === event.version,
        );
        if (at >= 0) {
          channel.versions = [...channel.versions];
          channel.versions[at] = {
            ...channel.versions[at],
            suggestion: event.suggestion,
          };
        } else {
          channel.versions = [...channel.versions, { suggestion: event.suggestion }];
        }
        return { ...map, [event.part]: channel };
      });
    });
    const un3 = api.onHostStatus((event) => {
      setHostStatus(event.engine);
      if (event.engine === "up") void refreshBusState();
    });
    void refreshBusState();
    return () => {
      un1();
      un2();
      un3();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const refreshBusState = useCallback(async () => {
    const state = await api.getBusState();
    setBusState(state);
    setHostStatus(state.engine);
  }, [api]);

  /** Обёртка команды: pending-строка Dock (через 300 мс) + toast на ошибку. */
  const run = useCallback(
    async <T,>(command: string, arg: string | undefined, fn: () => Promise<T>): Promise<T | undefined> => {
      const id = opSeq++;
      const tool = DOCK_TOOL[command] ?? "core";
      pendingRef.current = { id, command };
      setDockBackground((n) => n + 1);
      setDockLine(null);
      pendingTimer.current = window.setTimeout(() => {
        setDockPending({ tool, command, sinceTs: Date.now() });
        setDockLine({
          icon: "pending",
          ts: Date.now(),
          text: `● ${tool}: ${command}${arg ? ` (${arg})` : ""} — ${dockVerb(command, arg)}…`,
        });
      }, 300);
      try {
        const result = await fn();
        return result;
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        pushToast({ text, fixLabel: "Повторить" });
        setDockLine({
          icon: "error",
          ts: Date.now(),
          text: `✗ ${tool}: ${command} — ${text}`,
        });
        return undefined;
      } finally {
        pendingRef.current = null;
        setDockPending(null);
        window.clearTimeout(pendingTimer.current);
      }
    },
    [pushToast],
  );

  const analyzeLoop = useCallback(
    async (path: string, copyIntoWorkspace?: boolean) => {
      setAnalyzing(true);
      setXrayError(null);
      const report = await run("analyze_loop", undefined, () =>
        api.analyzeLoop({ path, copy_into_workspace: copyIntoWorkspace }),
      );
      setAnalyzing(false);
      if (report) {
        setXray(report);
        setLoopFile({ name: path.split("/").pop() ?? "loop", path });
      } else {
        setXrayError("Анализ не удался");
      }
    },
    [api, run],
  );

  const adoptLoop = useCallback(
    async (bpm: number, key: string) => {
      const result = await run("adopt_loop", undefined, () =>
        api.adoptLoop({ bpm, key, source: loopFile?.path ?? "loop" }),
      );
      if (result) await refreshBusState();
    },
    [api, loopFile, refreshBusState, run],
  );

  const generatePart = useCallback(
    async (tool: PartId, params: Record<string, unknown>) => {
      setChannels((map) => ({
        ...map,
        [tool]: { ...map[tool], status: "generating", error: null, params },
      }));
      const suggestion = await run("generate_part", tool, () =>
        api.generatePart({ tool, params }),
      );
      setChannels((map) => {
        const channel = { ...map[tool] };
        if (channel.status === "generating") {
          channel.status = suggestion ? "ready" : "error";
          channel.error = suggestion ? null : "Генерация не удалась";
        }
        return { ...map, [tool]: channel };
      });
    },
    [api, run],
  );

  const regenerate = useCallback(
    async (part: PartId, diff: Record<string, unknown>, label: string) => {
      const channel = channels[part];
      setChannels((map) => ({
        ...map,
        [part]: { ...map[part], status: "generating", error: null, chipDiff: label },
      }));
      const suggestion = await run("regenerate", `${part}, ${label}`, () =>
        api.regenerate({ part, params_diff: diff }),
      );
      setChannels((map) => {
        const next = { ...map[part] };
        if (next.status === "generating") {
          next.status = suggestion ? "ready" : "error";
          next.error = suggestion ? null : "Генерация не удалась";
          next.chipDiff = suggestion ? label : next.chipDiff;
        }
        return { ...map, [part]: next };
      });
      void channel;
    },
    [api, channels, run],
  );

  const acceptPart = useCallback(
    async (part: PartId, version: number) => {
      const result = await run("accept_part", `${part} v${version}`, () =>
        api.acceptPart({ part, version }),
      );
      if (!result) return;
      const trackId = result.imported_tracks[0];
      setChannels((map) => {
        const channel = { ...map[part] };
        channel.versions = channel.versions.map((v) =>
          v.suggestion.version === version
            ? { ...v, decision: "accepted" as const, trackId }
            : v,
        );
        return { ...map, [part]: channel };
      });
      pushToast({
        text: `✓ ${part} v${version} принят — дорожка ${trackId}`,
      });
      await refreshBusState();
    },
    [api, pushToast, refreshBusState, run],
  );

  const rejectPart = useCallback(
    async (part: PartId, version: number) => {
      const ok = await run("reject_part", `${part} v${version}`, () =>
        api.rejectPart({ part, version }),
      );
      if (ok === undefined) return;
      setChannels((map) => {
        const channel = { ...map[part] };
        channel.versions = channel.versions.map((v) =>
          v.suggestion.version === version
            ? { ...v, decision: "rejected" as const }
            : v,
        );
        return { ...map, [part]: channel };
      });
    },
    [api, run],
  );

  const runSelfCheck = useCallback(
    async (bouncePath: string) => {
      setChecking(true);
      setSelfCheckError(null);
      const report = await run("run_self_check", undefined, () =>
        api.runSelfCheck({ bounce_path: bouncePath }),
      );
      setChecking(false);
      if (report) setSelfCheck(report);
      else setSelfCheckError("Проверка не удалась");
    },
    [api, run],
  );

  const dismissDock = useCallback(() => {
    // v0: «отменить показ» — скрываем строку; текущую операцию помечаем
    // игнорируемой (последующий suggestion_updated не отрисуется заново)
    if (pendingRef.current) ignoredOps.current.add(pendingRef.current.id);
    pendingRef.current = null;
    setDockPending(null);
    setDockLine(null);
  }, []);

  const selectChannelVersion = useCallback((part: PartId, version: number | null) => {
    setChannels((map) => ({ ...map, [part]: { ...map[part], selectedVersion: version } }));
  }, []);

  const value = useMemo<CockpitStore>(
    () => ({
      hostStatus,
      busState,
      loopFile,
      analyzing,
      xray,
      xrayError,
      channels,
      checking,
      selfCheck,
      selfCheckError,
      busLog,
      drawerOpen,
      setDrawerOpen,
      dockPending,
      dockLine,
      dockBackground,
      dismissDock,
      toasts,
      pushToast,
      dismissToast,
      analyzeLoop,
      adoptLoop,
      generatePart,
      regenerate,
      acceptPart,
      rejectPart,
      runSelfCheck,
      refreshBusState,
      selectChannelVersion,
    }),
    [
      hostStatus, busState, loopFile, analyzing, xray, xrayError, channels, checking,
      selfCheck, selfCheckError, busLog, drawerOpen, dockPending, dockLine,
      dockBackground, dismissDock, toasts, pushToast, dismissToast, analyzeLoop,
      adoptLoop, generatePart, regenerate, acceptPart, rejectPart, runSelfCheck,
      refreshBusState, selectChannelVersion,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export { dockEffect };
