/**
 * MOCK-адаптер CockpitApi: полная симуляция ядра l2t-core по контрактной
 * семантике (v0.2). Умирает при переключении на tauriAdapter — экраны не
 * меняются. Поведение снято с реальных прогонов PoC/спайка:
 * - анализ ~55–91 мс (имитируем 350 мс, чтобы увидеть AI Dock),
 * - генерация 0.3–0.9 с,
 * - превью-WAV появляется асинхронно после generate (конвенция C2),
 * - таймаут ≠ отказ: bus_log timeout → затем inspect ok (правило 2 шины),
 * - прогрев движка ~8 с при wake (урок PoC — имитируем 3 с).
 *
 * Симулятор сбоев (faults) — временный тестовый инструмент v0 (управляется
 * из S7 drawer, панель «MOCK»): снимается вместе с адаптером.
 */
import type {
  BusLogEvent,
  BusState,
  HostStatusEvent,
  PartId,
  SuggestionUpdatedEvent,
  SelfCheckReport,
  Suggestion,
  XRayReport,
} from "@/types/contract";
import type { CockpitApi, Unsubscribe } from "@/ipc/api";
import { GENERATIONS } from "@/mock/generations";

const WORKSPACE = "/home/ilmir/music-workspace/";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Внутреннее состояние «ядра» ───────────────────────────────────────────

export type FaultKind =
  | "none"
  | "engine_down"
  | "timeout_on_next"
  | "error_on_next"
  | "selfcheck_key_fail"
  | "selfcheck_loud_warn";

const state = {
  engine: "up" as BusState["engine"],
  sessionName: "poc-v0.scraftz",
  tempo: 90,
  keyMarker: "Am",
  tracks: [] as { id: string; name: string; part: string }[],
  fault: "none" as FaultKind,
  nextTrackId: 7,
  versionSeq: { bass: 0, chords: 0, drums: 0 } as Record<string, number>,
  /** Параметры последней генерации канала (для regenerate = prev + diff). */
  lastParams: {} as Record<string, Record<string, unknown>>,
  /** Превью-готовность: "part:vN" → timestamp готовности WAV. */
  previews: new Map<string, number>(),
};

const logHandlers = new Set<(e: BusLogEvent) => void>();
const suggestionHandlers = new Set<(e: SuggestionUpdatedEvent) => void>();
const hostHandlers = new Set<(e: HostStatusEvent) => void>();

function emitBusLog(tool: string, command: string, status: BusLogEvent["status"], ms: number) {
  logHandlers.forEach((h) => h({ ts: Date.now(), tool, command, status, ms }));
}

function emitHost(engine: BusState["engine"]) {
  state.engine = engine;
  hostHandlers.forEach((h) => h({ engine }));
}

/** Таймаут ≠ отказ (правило 2): bus_log timeout → затем inspect ok. */
function emitTimeoutThenInspect(command: string) {
  emitBusLog(toolOf(command), command, "timeout", 30000);
  setTimeout(() => emitBusLog("core", `inspect после ${command}`, "ok", 120), 800);
}

function toolOf(command: string): string {
  if (command.startsWith("analyze") || command.startsWith("run_self")) return "audio-analyzer";
  if (command.startsWith("accept") || command.startsWith("reject") || command === "adopt_loop")
    return "soundcraft";
  return "midi-gen";
}

async function runCommand<T>(command: string, work: () => Promise<T>): Promise<T> {
  const fault = state.fault;
  state.fault = "none";
  const t0 = Date.now();
  if (fault === "timeout_on_next") {
    emitTimeoutThenInspect(command);
    await delay(1000); // ядро «потеряло ответ», но операция прошла
    return work();
  }
  const result = await work();
  const ms = Date.now() - t0;
  if (fault === "error_on_next") {
    emitBusLog(toolOf(command), command, "error", ms);
    throw new Error(
      `JSON-RPC error: симуляция сбоя сервера (${MOCK_HINT})`,
    );
  }
  emitBusLog(toolOf(command), command, "ok", ms);
  return result;
}

const MOCK_HINT = "симулятор сбоев в S7 drawer";

// ─── Генерации (словарь чипов midi-gen v3, спека S3) ───────────────────────

const RATIONALE: Record<string, { text: string; conf: number }> = {
  "bass:basic": { text: "корень на сильных долях — прочный фундамент", conf: 0.78 },
  "bass:octaves": { text: "октавный ход: драйв для роста плотности (onset 2.1/долю)", conf: 0.62 },
  "bass:syncopated": { text: "синкопа в духе ритма лупа — off-beats 1.5/3.5", conf: 0.84 },
  "bass:walking": { text: "ходовая линия по квинто-кварцевому кругу", conf: 0.66 },
  "bass:sub": { text: "суб-дистанция: минимум нот, максимум низа", conf: 0.71 },
  "chords:voiceled": { text: "инверсии: соседние аккорды ≤4 п/т (block=7)", conf: 0.9 },
  "chords:block": { text: "блок-трезвучия корневой позиции — плотнее фундамент", conf: 0.55 },
  "drums:basic": { text: "прямая бочка 1&3, хэты 8-е — сетка под луп", conf: 0.82 },
  "drums:variation": { text: "филл 16-ми в 4-м такте закрывает цикл (onset-бамп 30.9 с)", conf: 0.71 },
};

function chipKey(tool: string, params: Record<string, unknown>): string {
  if (tool === "bass") return `bass:${params.style ?? "basic"}`;
  if (tool === "chords") return `chords:${params.voicing ?? "voiceled"}`;
  return `drums:${params.variation ? "variation" : "basic"}`;
}

function generationNotes(tool: string, params: Record<string, unknown>) {
  if (tool === "bass") return GENERATIONS[`bass_${params.style ?? "basic"}` as keyof typeof GENERATIONS];
  if (tool === "chords") return GENERATIONS[`chords_${params.voicing ?? "voiceled"}` as keyof typeof GENERATIONS];
  return GENERATIONS[params.variation ? "drums_variation" : "drums_basic"];
}

function buildSuggestion(tool: string, params: Record<string, unknown>, version: number): Suggestion {
  const key = chipKey(tool, params);
  const meta = RATIONALE[key];
  const sourceTool =
    tool === "bass"
      ? "midi-gen.generate_bassline v3"
      : tool === "chords"
        ? "midi-gen.generate_chord_progression v3"
        : "midi-gen.generate_drum_pattern v3";
  return {
    version,
    part: tool as PartId,
    notes: generationNotes(tool, params).map((n) => ({ ...n })),
    rationale: meta.text,
    confidence: meta.conf,
    source_tool: sourceTool,
    params: { bpm: state.tempo, key: "A minor", ...params },
    status: "generated",
  };
}

function markGenerating(tool: string, params: Record<string, unknown>, version: number): Suggestion {
  const suggestion = buildSuggestion(tool as PartId, params, version);
  state.lastParams[tool] = { ...params };
  state.previews.set(`${tool}:v${version}`, Date.now() + PREVIEW_DELAY);
  suggestionHandlers.forEach((h) =>
    h({ part: tool as PartId, version, suggestion }),
  );
  return suggestion;
}

// ─── Превью-WAV (C2: конвенция staging/<part>_v<N>.wav) ────────────────────

const PREVIEW_DELAY = 1500; // «сайдкар GM-синт рендерит» — файл появится позже
const PREVIEW_FREQ: Record<string, number> = { bass: 55, chords: 220, drums: 110 };

function previewTone(freq: number, seconds: number): string {
  const rate = 8000;
  const n = Math.floor(seconds * rate);
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const ws = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  ws(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ws(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
    view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * (i / rate)) * 11000, true);
  const bytes = new Uint8Array(view.buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 32768)
    s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return "data:audio/wav;base64," + btoa(s);
}

// ─── Адаптер ───────────────────────────────────────────────────────────────

export const mockAdapter: CockpitApi & {
  /** MOCK-only: включить следующий сбой (снимается вместе с адаптером). */
  setFault: (f: FaultKind) => void;
  /** MOCK-only: wake-цикл ядра (правило 5 шины; UI видит только host_status). */
  wakeEngine: () => void;
  /** C2: готов ли превью-WAV (в tauri-адаптере — проверка файла на диске). */
  previewReady: (part: string, version: number) => boolean;
  previewUrl: (part: string, version: number) => string | null;
  previewWavPath: (part: string, version: number) => string;
} = {
  async analyzeLoop({ path, copy_into_workspace }) {
    return runCommand("analyze_loop", async () => {
      await delay(350);
      if (!copy_into_workspace && !path.startsWith(WORKSPACE)) {
        throw new Error(
          `Файл вне workspace (${path}) — правило 1 шины: данные ходят через песочницу`,
        );
      }
      if (!/\.(wav|flac|mp3)$/i.test(path)) {
        throw new Error(`Неподдерживаемый формат: ${path} — жду WAV/FLAC/MP3`);
      }
      const name = path.split("/").pop() ?? "loop.wav";
      state.sessionName = name.replace(/\.[^.]+$/, "");
      return {
        bpm: 90.1,
        bpm_confidence: 0.64,
        bpm_alt: 180.2,
        key: "A minor",
        key_confidence: 0.91,
        key_relative: "C major",
        lufs: -12.0,
        true_peak: -2.4,
        bands: { "суб-бас": -28.5, "низкие": -14.2, "средние": -16.8, "верх": -30.1 },
        onset_density: 2.1,
      } satisfies XRayReport;
    });
  },

  async generatePart({ tool, params }) {
    return runCommand(`generate_part (${tool})`, async () => {
      await delay(350 + Math.random() * 550);
      const version = (state.versionSeq[tool] ?? 0) + 1;
      state.versionSeq[tool] = version;
      return markGenerating(tool, params, version);
    });
  },

  async regenerate({ part, params_diff }) {
    return runCommand(`regenerate (${part})`, async () => {
      await delay(300 + Math.random() * 500);
      const version = (state.versionSeq[part] ?? 0) + 1;
      state.versionSeq[part] = version;
      return markGenerating(part, { ...state.lastParams[part], ...params_diff }, version);
    });
  },

  async acceptPart({ part, version }) {
    return runCommand(`accept_part (${part} v${version})`, async () => {
      await delay(600);
      if (state.engine !== "up") {
        throw new Error("Хост не отвечает (engine ≠ up) — accept невозможен, разбуди движок");
      }
      const trackId = state.nextTrackId++;
      state.tracks.push({ id: `track-${trackId}`, name: `${part} v${version}`, part });
      return { imported_tracks: [String(trackId)] };
    });
  },

  async rejectPart({ part, version }) {
    return runCommand(`reject_part (${part} v${version})`, async () => {
      await delay(150);
    });
  },

  async adoptLoop({ bpm, key }) {
    return runCommand("adopt_loop", async () => {
      await delay(400);
      state.tempo = bpm;
      state.keyMarker = key.replace(" minor", "m").replace(" major", "");
      return { tempo: state.tempo, marker: state.keyMarker };
    });
  },

  async getBusState() {
    await delay(60);
    return {
      tempo: state.tempo,
      key_marker: state.keyMarker,
      tracks: state.tracks.map((t) => ({ ...t })),
      engine: state.engine,
      session_name: state.sessionName,
    } satisfies BusState;
  },

  async runSelfCheck({ bounce_path }) {
    return runCommand("run_self_check", async () => {
      await delay(650);
      if (!bounce_path.startsWith(WORKSPACE)) {
        throw new Error(`Bounce вне workspace (${bounce_path}) — правило 1 шины`);
      }
      if (state.fault === "selfcheck_key_fail") {
        return {
          key_match: false,
          tempo_match: true,
          lufs_delta: -0.6,
          bands_delta: { "суб-бас": 5.7, "низкие": 6.7, "средние": 6.5, "верх": 2.1 },
          verdict: "fail",
        } satisfies SelfCheckReport;
      }
      return {
        key_match: true,
        tempo_match: true,
        lufs_delta: state.fault === "selfcheck_loud_warn" ? 7.3 : -0.4,
        bands_delta: { "суб-бас": 5.7, "низкие": 6.7, "средние": 6.5, "верх": 2.1 },
        verdict: "ok",
      } satisfies SelfCheckReport;
    });
  },

  onBusLog(handler): Unsubscribe {
    logHandlers.add(handler);
    return () => logHandlers.delete(handler);
  },
  onSuggestionUpdated(handler): Unsubscribe {
    suggestionHandlers.add(handler);
    return () => suggestionHandlers.delete(handler);
  },
  onHostStatus(handler): Unsubscribe {
    hostHandlers.add(handler);
    return () => hostHandlers.delete(handler);
  },

  // ── MOCK-only расширения (тестовое управление; снимаются с адаптером) ──

  setFault(f) {
    state.fault = f;
    if (f === "engine_down") emitHost("down");
  },

  wakeEngine() {
    if (state.engine === "up") return;
    emitHost("waking");
    // урок PoC: движку нужно ~8 с на прогрев; имитируем 3 с
    setTimeout(() => emitHost("up"), 3000);
  },

  previewReady(part, version) {
    const at = state.previews.get(`${part}:v${version}`);
    return at !== undefined && Date.now() >= at;
  },
  previewUrl(part, version) {
    if (!mockAdapter.previewReady(part, version)) return null;
    return previewTone(PREVIEW_FREQ[part] ?? 110, 5.3);
  },
  previewWavPath(part, version) {
    return `${WORKSPACE}staging/${part}_v${version}.wav`;
  },
};

export type MockAdapter = typeof mockAdapter;
