/**
 * Центральный store кокпита (спека ui-screens-v0.md §0–§3):
 * - источники данных: get_bus_state (pull) + события bus_log/suggestion_updated/
 *   host_status; локальный React-state — только эфемерщина (§0.2);
 * - AI Dock: цикл строки ведёт обёртка команды — pending рисуется локально с
 *   момента вызова (bus_log не имеет «start») и виден после 300 мс, итог —
 *   по завершении. bus_log лишь уточняет (таймаут → ⏱ → inspect), поэтому
 *   порядок «ответ / событие» на проводе не важен — строка не залипает;
 * - параллельные операции считаются каждая (фоновых: N−1), в Dock — последняя;
 * - ошибки = toast + кнопка-фикс из каталога §6; таймаут ядро разбирает само,
 *   UI не ретраит;
 * - [отменить] в Dock v0 = «отменить показ»: скрыть строку. Данные операции
 *   всё равно приходят — ядро её уже выполнило (семантика §3).
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
  AcceptPartOutput,
  BusLogEvent,
  BusState,
  ExportTrackOutput,
  MasterTarget,
  PartId,
  SelfCheckReport,
  SuggestionUpdatedEvent,
  XRayReport,
} from "@/types/contract";
import {
  PARTS,
  PART_ORDER,
  paramDiff,
  resolveMusicContext,
  toolParams,
  type ChipValues,
  type MusicContext,
} from "@/lib/parts";
import { fmt } from "@/lib/format";
import { targetLabel } from "@/lib/xray";
import {
  applySuggestion,
  decideVersion,
  emptyChannel,
  type ChannelState,
} from "@/store/channels";

// ─── Типы состояния ─────────────────────────────────────────────────────────

export type { ChannelState, ChannelError, ChannelVersion } from "@/store/channels";

export interface ToastItem {
  id: number;
  text: string;
  tone?: "error" | "ok";
  /** Главная кнопка-фикс из каталога §6 (или undefined — только закрыть). */
  fixLabel?: string;
  fix?: () => void;
}

export interface DockLine {
  icon: "ok" | "timeout" | "error" | "inspect";
  text: string;
  ts: number;
}

export interface DockPending {
  tool: string;
  command: string;
  sinceTs: number;
  text: string;
}

/** Активная команда: пока идёт — pending-строка Dock. */
interface Op {
  command: string;
  startedAt: number;
  dismissed: boolean;
  pending: DockPending;
}

interface RunOptions<T> {
  /** Ошибку показывает вызывающий (error-state панели) — без toast. */
  quiet?: boolean;
  onError?: (text: string) => void;
  /** Хвост итоговой строки Dock: «→ слой бас v1». */
  effect?: (result: T) => string;
  /** Уточнение фразы pending: «изменено: style». */
  detail?: string;
  /** Кнопка-фикс в toast (без неё toast закрывается, но не чинит). */
  retry?: () => void;
}

// ─── Словарь AI Dock (спека §3) ─────────────────────────────────────────────

const DOCK_TOOL: Record<string, string> = {
  analyze_loop: "audio-analyzer",
  run_self_check: "audio-analyzer",
  generate_part: "midi-gen",
  regenerate: "midi-gen",
  accept_part: "soundcraft",
  reject_part: "soundcraft",
  adopt_loop: "soundcraft",
  export_track: "soundcraft",
};

function dockVerb(command: string, arg?: string, detail?: string): string {
  switch (command) {
    case "analyze_loop":
      return "слушаю луп";
    case "generate_part":
      return `генерирую ${arg ?? "партию"}`;
    case "regenerate":
      return `перегенерирую${arg ? ` ${arg}` : ""}${detail ? ` (изменено: ${detail})` : ""}`;
    case "accept_part":
      return `передаю в сессию: ${arg ?? ""}`;
    case "reject_part":
      return `отклоняю версию: ${arg ?? ""}`;
    case "adopt_loop":
      return "применяю настройки лупа";
    case "run_self_check":
      return "проверяю микс";
    case "export_track":
      return `рендерю микс${detail ? ` (${detail})` : ""}`;
    default:
      return command;
  }
}

/** Ядро отдаёт ошибки текстом JSON-RPC; транспорт может reject-нуть чем угодно. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

const basename = (path: string) => path.split("/").pop() ?? path;
const NO_CONTEXT = "Сначала разбери луп: темп и тональность партий берутся из Loop X-Ray";

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
  dismissXrayError: () => void;
  /** Темп, выбранный в сегменте гипотез (null = bpm отчёта). */
  selectedBpm: number | null;
  selectBpm: (bpm: number | null) => void;
  adopting: boolean;
  // S3
  channels: Record<PartId, ChannelState>;
  /** Темп и тональность партий: сессия движка, пока нет — Loop X-Ray. */
  musicContext: MusicContext | null;
  /** Момент запроса внимания к Rack (обводка) — навигация из X-Ray. */
  rackFocusAt: number;
  requestRackFocus: () => void;
  selectChannelVersion: (part: PartId, version: number | null) => void;
  /** Эфемерно: версию прослушали (статус «прослушано» на карточке). */
  markAuditioned: (part: PartId, version: number) => void;
  // S6
  checking: boolean;
  selfCheck: SelfCheckReport | null;
  selfCheckPath: string | null;
  selfCheckError: string | null;
  dismissSelfCheckError: () => void;
  /** Повтор последнего действия проверки — файла рендера или экспорта. */
  selfCheckRetry: { label: string; run: () => Promise<void> } | null;
  /** Последний экспорт: громкость и блок цели, пока проверен его файл. */
  lastExport: ExportTrackOutput | null;
  exporting: boolean;
  /** Движок поднят и в сессии есть дорожки — есть что рендерить. */
  canExport: boolean;
  // S7
  busLog: BusLogEvent[];
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  // AI Dock
  dockPending: DockPending | null;
  dockLine: DockLine | null;
  dockBackground: number;
  dismissDock: () => void;
  // toasts
  toasts: ToastItem[];
  pushToast: (t: Omit<ToastItem, "id">) => void;
  dismissToast: (id: number) => void;
  // действия (обёртки команд: pending-строка + bus_log + toasts)
  analyzeLoop: (path: string, copyIntoWorkspace?: boolean) => Promise<void>;
  retryAnalyze: (copyIntoWorkspace?: boolean) => Promise<void>;
  adoptLoop: (bpm: number, key: string) => Promise<void>;
  /** Первая генерация канала → generate_part. */
  generatePart: (part: PartId, chips: ChipValues) => Promise<void>;
  /**
   * Новая версия с данными чипами → regenerate (diff только изменений).
   * Без версий у канала — это первая генерация (generate_part).
   */
  regenerate: (part: PartId, chips: ChipValues) => Promise<void>;
  /** [Повторить] в error-состоянии канала: та же генерация, accept или reject. */
  retryChannel: (part: PartId) => Promise<void>;
  /** ⚙-мутатор: актуальную версию можно принять, любую показанную — нет. */
  acceptPart: (part: PartId, version: number) => Promise<void>;
  rejectPart: (part: PartId, version: number) => Promise<void>;
  /** ⤓ Принять всё готовое: по одному accept_part на канал с нерешённой версией. */
  acceptAllReady: () => Promise<void>;
  runSelfCheck: (bouncePath: string) => Promise<void>;
  /** Рендер микса движком → Self-Check (export_track, контракт v0.2.1). */
  exportAndCheck: (target: MasterTarget) => Promise<void>;
  refreshBusState: () => Promise<void>;
}

const StoreContext = createContext<CockpitStore | null>(null);

export function useCockpit(): CockpitStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useCockpit вне CockpitProvider");
  return store;
}

let toastSeq = 1;

export function CockpitProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [hostStatus, setHostStatus] = useState<BusState["engine"]>("waking");
  const [busState, setBusState] = useState<BusState | null>(null);
  const [loopFile, setLoopFile] = useState<{ name: string; path: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [xray, setXray] = useState<XRayReport | null>(null);
  const [xrayError, setXrayError] = useState<string | null>(null);
  const [selectedBpm, setSelectedBpm] = useState<number | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [channels, setChannels] = useState<Record<PartId, ChannelState>>({
    bass: emptyChannel(),
    chords: emptyChannel(),
    drums: emptyChannel(),
  });
  const [checking, setChecking] = useState(false);
  const [selfCheck, setSelfCheck] = useState<SelfCheckReport | null>(null);
  const [selfCheckPath, setSelfCheckPath] = useState<string | null>(null);
  const [selfCheckError, setSelfCheckError] = useState<string | null>(null);
  const [selfCheckRetry, setSelfCheckRetry] = useState<{
    label: string;
    run: () => Promise<void>;
  } | null>(null);
  const [lastExport, setLastExport] = useState<ExportTrackOutput | null>(null);
  const [exporting, setExporting] = useState(false);
  const [busLog, setBusLog] = useState<BusLogEvent[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dockPending, setDockPending] = useState<DockPending | null>(null);
  const [dockLine, setDockLine] = useState<DockLine | null>(null);
  const [dockBackground, setDockBackground] = useState(0);
  const [rackFocusAt, setRackFocusAt] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const inflight = useRef<Op[]>([]);
  const lastAttempt = useRef<{ path: string; copy: boolean } | null>(null);
  // Свежие снимки для колбэков команд — без лишних зависимостей у useCallback
  const live = useRef({ channels, loopFile });
  useEffect(() => {
    live.current = { channels, loopFile };
  });
  const musicContext = useMemo(
    () => resolveMusicContext(busState, xray, selectedBpm),
    [busState, xray, selectedBpm],
  );

  const pushToast = useCallback((t: Omit<ToastItem, "id">) => {
    setToasts((list) => [...list.slice(-2), { ...t, id: toastSeq++ }]);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const refreshBusState = useCallback(async () => {
    try {
      const next = await api.getBusState();
      setBusState(next);
      setHostStatus(next.engine);
    } catch {
      /* шелл ещё поднимается — состояние останется прежним, host_status поправит */
    }
  }, [api]);

  const patchChannel = useCallback((part: PartId, patch: (c: ChannelState) => ChannelState) => {
    setChannels((map) => ({ ...map, [part]: patch(map[part]) }));
  }, []);

  // События ядра → состояние (спека §0.2)
  useEffect(() => {
    const un1 = api.onBusLog((event) => {
      setBusLog((log) => [...log.slice(-199), event]);
      const op = inflight.current.find((o) => o.pending.command === event.command);
      if (op) {
        // таймаут ≠ отказ: ядро само делает inspect — UI ждёт его вердикта
        if (event.status === "timeout" && !op.dismissed) {
          setDockLine({
            icon: "timeout",
            ts: event.ts,
            text: `⏱ ${event.tool}: ${event.command} — таймаут → проверяю состояние…`,
          });
        }
        return;
      }
      if (inflight.current.length === 0 && event.tool === "core" && event.command.startsWith("inspect")) {
        setDockLine({
          icon: "inspect",
          ts: event.ts,
          text: "✓ inspect — операция прошла, ответ потерян",
        });
      }
    });
    const un2 = api.onSuggestionUpdated((event: SuggestionUpdatedEvent) => {
      setChannels((map) => ({ ...map, [event.part]: applySuggestion(map[event.part], event) }));
    });
    const un3 = api.onHostStatus((event) => {
      setHostStatus(event.engine);
      // при спящем движке сессии нет — поля обнуляются (примечание 6 контракта)
      setBusState((prev) =>
        event.engine === "up"
          ? prev
          : prev
            ? { ...prev, engine: event.engine, tempo: null, key_marker: null, session_name: null }
            : prev,
      );
      if (event.engine === "up") void refreshBusState();
    });
    void refreshBusState();
    return () => {
      un1();
      un2();
      un3();
    };
  }, [api, refreshBusState]);

  /** Обёртка команды: pending-строка Dock (видна после 300 мс) + итог + toast на ошибку. */
  const run = useCallback(
    async <T,>(
      command: string,
      arg: string | undefined,
      fn: () => Promise<T>,
      options: RunOptions<T> = {},
    ): Promise<T | undefined> => {
      const tool = DOCK_TOOL[command] ?? "core";
      const title = `${command}${arg ? ` (${arg})` : ""}`;
      const op: Op = {
        command,
        startedAt: performance.now(),
        dismissed: false,
        pending: {
          tool,
          command,
          sinceTs: Date.now(),
          text: `● ${tool}: ${title} — ${dockVerb(command, arg, options.detail)}…`,
        },
      };
      const finish = (line: DockLine | null) => {
        inflight.current = inflight.current.filter((o) => o !== op);
        const rest = inflight.current.at(-1);
        setDockBackground(Math.max(0, inflight.current.length - 1));
        if (rest) {
          setDockPending(rest.pending);
        } else {
          setDockPending(null);
          if (!op.dismissed) setDockLine(line);
        }
      };
      inflight.current.push(op);
      setDockBackground(Math.max(0, inflight.current.length - 1));
      setDockLine(null);
      setDockPending(op.pending);
      try {
        const result = await fn();
        const secs = fmt((performance.now() - op.startedAt) / 1000);
        const tail = options.effect?.(result);
        finish({
          icon: "ok",
          ts: Date.now(),
          text: `✓ ${tool}: ${title} — готово · ${secs} с${tail ? ` ${tail}` : ""}`,
        });
        return result;
      } catch (error) {
        const text = errorText(error);
        finish({ icon: "error", ts: Date.now(), text: `✗ ${tool}: ${title} — ${text}` });
        if (!options.quiet) pushToast({ text, fixLabel: "Повторить", fix: options.retry });
        options.onError?.(text);
        return undefined;
      }
    },
    [pushToast],
  );

  const analyzeLoop = useCallback(
    async (path: string, copyIntoWorkspace = false) => {
      lastAttempt.current = { path, copy: copyIntoWorkspace };
      setAnalyzing(true);
      setXrayError(null);
      const report = await run(
        "analyze_loop",
        undefined,
        () => api.analyzeLoop({ path, copy_into_workspace: copyIntoWorkspace }),
        {
          quiet: true,
          onError: setXrayError,
          effect: (r) => `→ ${fmt(r.bpm)} BPM · ${r.key}`,
        },
      );
      setAnalyzing(false);
      if (report) {
        setXray(report);
        setSelectedBpm(null);
        setLoopFile({ name: basename(path), path });
      }
    },
    [api, run],
  );

  const retryAnalyze = useCallback(
    async (copyIntoWorkspace?: boolean) => {
      const last = lastAttempt.current;
      if (last) await analyzeLoop(last.path, copyIntoWorkspace ?? last.copy);
    },
    [analyzeLoop],
  );

  // Именованные выражения: кнопка [Повторить] в toast перезапускает ту же команду.
  const adoptLoop = useCallback(async function adoptLoop(bpm: number, key: string) {
    setAdopting(true);
    const result = await run(
      "adopt_loop",
      undefined,
      () => api.adoptLoop({ bpm, key, source: live.current.loopFile?.path ?? "loop" }),
      {
        effect: (r) => `→ сессия: ${fmt(r.tempo)} BPM · ${r.marker}`,
        retry: () => void adoptLoop(bpm, key),
      },
    );
    setAdopting(false);
    if (result) await refreshBusState();
  }, [api, refreshBusState, run]);

  const generatePart = useCallback(
    async (part: PartId, chips: ChipValues) => {
      if (!musicContext || musicContext.bpm == null) {
        pushToast({ text: NO_CONTEXT });
        return;
      }
      const name = PARTS[part].accusative;
      patchChannel(part, (c) => ({ ...c, status: "generating", error: null }));
      await run(
        "generate_part",
        name,
        () => api.generatePart({ tool: part, params: toolParams(part, chips, musicContext) }),
        {
          quiet: true,
          onError: (text) =>
            patchChannel(part, (c) => ({
              ...c,
              status: "ready",
              error: { text, retry: { kind: "generate", chips } },
            })),
          effect: (s) => `→ слой ${PARTS[s.part].accusative} v${s.version}`,
        },
      );
      patchChannel(part, (c) => (c.status === "generating" ? { ...c, status: "ready" } : c));
    },
    [api, musicContext, patchChannel, pushToast, run],
  );

  const regenerate = useCallback(
    async (part: PartId, chips: ChipValues) => {
      const last = live.current.channels[part].versions.at(-1)?.suggestion;
      if (!last) {
        await generatePart(part, chips);
        return;
      }
      if (!musicContext || musicContext.bpm == null) {
        pushToast({ text: NO_CONTEXT });
        return;
      }
      const name = PARTS[part].accusative;
      // ядро накладывает diff на параметры последней версии — считаем против неё
      const { diff, keys } = paramDiff(part, last.params, chips, musicContext);
      patchChannel(part, (c) => ({ ...c, status: "generating", error: null }));
      await run(
        "regenerate",
        name,
        () => api.regenerate({ part, params_diff: diff }),
        {
          quiet: true,
          detail: keys.length ? keys.join(", ") : undefined,
          onError: (text) =>
            patchChannel(part, (c) => ({
              ...c,
              status: "ready",
              error: { text, retry: { kind: "generate", chips } },
            })),
          effect: (s) => `→ слой ${PARTS[s.part].accusative} обновлён (v${s.version})`,
        },
      );
      patchChannel(part, (c) => (c.status === "generating" ? { ...c, status: "ready" } : c));
    },
    [api, generatePart, musicContext, patchChannel, pushToast, run],
  );

  const acceptPart = useCallback(
    async (part: PartId, version: number) => {
      const name = PARTS[part].accusative;
      patchChannel(part, (c) => ({ ...c, error: null }));
      const result = await run(
        "accept_part",
        `${name} v${version}`,
        () => api.acceptPart({ part, version }),
        {
          quiet: true,
          onError: (text) =>
            patchChannel(part, (c) => ({
              ...c,
              error: { text, retry: { kind: "accept", version } },
            })),
          effect: (r: AcceptPartOutput) => `→ дорожка ${r.imported_tracks.join(", ") || "создана"}`,
        },
      );
      if (!result) return;
      patchChannel(part, (c) =>
        decideVersion(c, version, "accepted", result.imported_tracks),
      );
      const tracks = result.imported_tracks.join(", ");
      pushToast({ tone: "ok", text: `✓ ${name} v${version} в сессии — ${tracks || "дорожка создана"}` });
      await refreshBusState();
    },
    [api, patchChannel, pushToast, refreshBusState, run],
  );

  const rejectPart = useCallback(
    async (part: PartId, version: number) => {
      const name = PARTS[part].accusative;
      // void не отличить от ошибки — успех маркируем сами
      const ok = await run(
        "reject_part",
        `${name} v${version}`,
        () => api.rejectPart({ part, version }).then(() => true as const),
        {
          quiet: true,
          onError: (text) =>
            patchChannel(part, (c) => ({
              ...c,
              error: { text, retry: { kind: "reject", version } },
            })),
          effect: () => "→ версия отклонена",
        },
      );
      if (ok) patchChannel(part, (c) => decideVersion(c, version, "rejected"));
    },
    [api, patchChannel, run],
  );

  const retryChannel = useCallback(
    async (part: PartId) => {
      const err = live.current.channels[part].error;
      if (!err) return;
      if (err.retry.kind === "generate") await regenerate(part, err.retry.chips);
      else if (err.retry.kind === "accept") await acceptPart(part, err.retry.version);
      else await rejectPart(part, err.retry.version);
    },
    [acceptPart, regenerate, rejectPart],
  );

  const acceptAllReady = useCallback(async () => {
    for (const part of PART_ORDER) {
      const last = live.current.channels[part].versions.at(-1);
      if (last && !last.decision) await acceptPart(part, last.suggestion.version);
    }
  }, [acceptPart]);

  const runSelfCheck = useCallback(
    async function runSelfCheck(bouncePath: string) {
      setChecking(true);
      setSelfCheckError(null);
      setSelfCheck(null);
      setSelfCheckRetry({ label: "Повторить проверку", run: () => runSelfCheck(bouncePath) });
      const report = await run(
        "run_self_check",
        undefined,
        () => api.runSelfCheck({ bounce_path: bouncePath }),
        {
          quiet: true,
          onError: setSelfCheckError,
          effect: (r) => `→ итог: ${r.verdict}`,
        },
      );
      setChecking(false);
      // блок цели показываем, только когда проверен файл последнего экспорта
      setLastExport((prev) => (prev?.path === bouncePath ? prev : null));
      if (report) {
        setSelfCheckRetry(null);
        setSelfCheck(report);
        setSelfCheckPath(bouncePath);
      }
    },
    [api, run],
  );

  const exportAndCheck = useCallback(async function exportAndCheck(target: MasterTarget) {
    setExporting(true);
    setSelfCheckError(null);
    setSelfCheckRetry({ label: "Повторить экспорт", run: () => exportAndCheck(target) });
    const result = await run<ExportTrackOutput>(
      "export_track",
      undefined,
      () => api.exportTrack({ target }),
      {
        // ошибку показывает и вкладка Self-Check, и toast
        onError: setSelfCheckError,
        detail: target === "none" ? undefined : `цель ${targetLabel(target)}`,
        effect: (r) => `→ ${fmt(r.seconds)} с · ${fmt(r.lufs)} LUFS`,
      },
    );
    setExporting(false);
    if (result) {
      setLastExport(result);
      await runSelfCheck(result.path);
    }
  }, [api, run, runSelfCheck]);

  const dismissDock = useCallback(() => {
    // v0: «отменить показ» — строка уходит, операция в ядре продолжается
    inflight.current.forEach((o) => {
      o.dismissed = true;
    });
    setDockPending(null);
    setDockLine(null);
  }, []);

  const dismissXrayError = useCallback(() => setXrayError(null), []);
  const dismissSelfCheckError = useCallback(() => {
    setSelfCheckError(null);
    setSelfCheckRetry(null);
  }, []);

  const requestRackFocus = useCallback(() => setRackFocusAt(Date.now()), []);

  const selectChannelVersion = useCallback((part: PartId, version: number | null) => {
    patchChannel(part, (c) => ({ ...c, selectedVersion: version }));
  }, [patchChannel]);

  const markAuditioned = useCallback((part: PartId, version: number) => {
    setChannels((map) => ({
      ...map,
      [part]: {
        ...map[part],
        versions: map[part].versions.map((v) =>
          v.suggestion.version === version ? { ...v, auditioned: true } : v,
        ),
      },
    }));
  }, []);

  const value = useMemo<CockpitStore>(
    () => ({
      hostStatus,
      busState,
      loopFile,
      analyzing,
      xray,
      xrayError,
      dismissXrayError,
      selectedBpm,
      selectBpm: setSelectedBpm,
      adopting,
      channels,
      musicContext,
      rackFocusAt,
      requestRackFocus,
      selectChannelVersion,
      markAuditioned,
      checking,
      selfCheck,
      selfCheckPath,
      selfCheckError,
      dismissSelfCheckError,
      selfCheckRetry,
      lastExport,
      exporting,
      canExport: busState?.engine === "up" && (busState.tracks?.length ?? 0) > 0,
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
      retryAnalyze,
      adoptLoop,
      generatePart,
      regenerate,
      retryChannel,
      acceptPart,
      rejectPart,
      acceptAllReady,
      runSelfCheck,
      exportAndCheck,
      refreshBusState,
    }),
    [
      hostStatus, busState, loopFile, analyzing, xray, xrayError, dismissXrayError,
      selectedBpm, adopting, channels, musicContext, rackFocusAt, requestRackFocus,
      selectChannelVersion, markAuditioned, checking, selfCheck, selfCheckPath,
      selfCheckError, dismissSelfCheckError, selfCheckRetry, lastExport, exporting, busLog, drawerOpen,
      dockPending, dockLine, dockBackground, dismissDock, toasts, pushToast, dismissToast,
      analyzeLoop, retryAnalyze, adoptLoop, generatePart, regenerate, retryChannel,
      acceptPart, rejectPart, acceptAllReady, runSelfCheck, exportAndCheck, refreshBusState,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
