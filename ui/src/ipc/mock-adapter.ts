/**
 * MOCK-адаптер CockpitApi: симуляция ядра по контрактной семантике (v0.2.1).
 * Работает в браузере — дев-харнессе; в окне его сменяет tauri-адаптер,
 * экраны не меняются. Поведение и ФОРМЫ ДАННЫХ сняты с живого ядра
 * (прогоны спайка и e2e), чтобы браузер показывал то же, что окно:
 * - X-Ray: 7 полос анализатора с линейной энергией (sub_bass…brilliance,
 *   значения в диапазоне ~1e-3…1e-7), LUFS, true peak;
 * - анализ ~55–91 мс (имитируем 350 мс, чтобы увидеть AI Dock),
 *   генерация 0.3–0.9 с, рендер микса ~1 с;
 * - на партию одна актуальная версия: accept/reject только текущей,
 *   повторный accept той же версии — ошибка (иначе плодились бы дубль-треки);
 * - Self-Check: lufs_delta = микс − луп, bands_delta = прирост по полосам
 *   от принятых партий; verdict ok ⇔ тональность и темп совпали;
 * - export_track: рендер движком в <workspace>/export, с целью громкости —
 *   normalize по пику (цель не гарантирована: как правило, чуть ниже);
 * - превью-WAV появляется асинхронно после generate (конвенция C2);
 * - таймаут ≠ отказ: bus_log timeout → затем inspect ok (правило 2 шины);
 * - прогрев движка ~8 с при wake (урок PoC — имитируем 3 с).
 *
 * Симулятор сбоев (faults) — тестовый инструмент дев-харнесса: включается
 * из консоли браузера (`window.__l2tMock.setFault(...)` — тот же экземпляр,
 * что и у приложения, в т.ч. после hot-reload), на живое ядро не влияет.
 */
import type {
  BusLogEvent,
  BusState,
  ExportTrackInput,
  ExportTrackOutput,
  HostStatusEvent,
  PartId,
  SelfCheckReport,
  Suggestion,
  SuggestionUpdatedEvent,
  XRayReport,
} from "@/types/contract";
import type { CockpitApi, Unsubscribe } from "@/ipc/api";
import { GENERATIONS } from "@/mock/generations";
import { TARGETS } from "@/lib/xray";

const WORKSPACE = "/home/ilmir/music-workspace/";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round2 = (v: number) => Math.round(v * 100) / 100;

// ─── Внутреннее состояние «ядра» ───────────────────────────────────────────

export type FaultKind =
  | "none"
  | "engine_down"
  | "timeout_on_next"
  | "error_on_next"
  | "selfcheck_key_fail"
  | "selfcheck_loud_warn";

/** Актуальная версия партии — как в ядре: одна на канал, история в manifest. */
interface CurrentPart {
  version: number;
  params: Record<string, unknown>;
  status: Suggestion["status"];
}

const state = {
  engine: "up" as BusState["engine"],
  sessionName: "poc-v0.scraftz",
  /** Новая сессия движка стартует с 120 BPM и без key-маркера (паритет с ядром). */
  tempo: 120,
  keyMarker: null as string | null,
  /** Дорожки сессии — та же проекция, что отдаёт ядро: клипы с границами в сэмплах. */
  tracks: [] as {
    id: string;
    name: string;
    part: string;
    kind: string;
    clips: { start: number; end: number; notes: number }[];
  }[],
  fault: "none" as FaultKind,
  nextTrackId: 7,
  current: {} as Record<string, CurrentPart>,
  /** Превью-готовность: "part:vN" → timestamp готовности WAV. */
  previews: new Map<string, number>(),
  /** Был ли анализ лупа — эталон Self-Check (как в ядре). */
  loopAnalyzed: false,
  /** Громкость экспортов по пути: Self-Check меряет тот же файл. */
  exportLufs: new Map<string, number>(),
};

/** Громкость и полосы «лупа» мока — то же, что отдаёт analyzeLoop. */
const LOOP_LUFS = -12.0;
const LOOP_BANDS: Record<string, number> = {
  sub_bass: 0.00021,
  bass: 0.00412,
  low_mid: 0.00261,
  mid: 0.00038,
  upper_mid: 0.000026,
  presence: 0.000006,
  brilliance: 0.0000004,
};
/** Что добавляет каждая принятая партия (линейная энергия полос). */
const LAYER_BANDS: Record<string, Record<string, number>> = {
  bass: { sub_bass: 0.00031, bass: 0.00052 },
  chords: { low_mid: 0.00019, mid: 0.00007 },
  drums: { bass: 0.00011, upper_mid: 0.0000041, presence: 0.0000022 },
};
/** Слои уводят микс вниз относительно лупа (прогон PoC: 3 слоя ≈ −4 LU). */
const LUFS_PER_LAYER = -1.4;
/** Демо «громкости до цели»: микс на 9.3 LU тише лупа — до Spotify −14 ровно +7.3 dB. */
const LOUD_WARN_LUFS = -21.3;

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
  if (
    command.startsWith("accept") ||
    command.startsWith("reject") ||
    command === "adopt_loop" ||
    command === "export_track"
  )
    return "soundcraft";
  return "midi-gen";
}

/** Прогон «вызова шины»: fault снимается с очереди первым же вызовом. */
async function runCommand<T>(command: string, work: (fault: FaultKind) => Promise<T>): Promise<T> {
  const fault = state.fault;
  state.fault = "none";
  const t0 = Date.now();
  if (fault === "timeout_on_next") {
    emitTimeoutThenInspect(command);
    await delay(1000); // ядро «потеряло ответ», но операция прошла
    return work("none");
  }
  if (fault === "error_on_next") {
    // сервер упал до того, что-либо сделал: состояние ядра не меняется
    await delay(300);
    emitBusLog(toolOf(command), command, "error", Date.now() - t0);
    throw new Error("JSON-RPC error: симуляция сбоя сервера (mockAdapter.setFault)");
  }
  const result = await work(fault);
  emitBusLog(toolOf(command), command, "ok", Date.now() - t0);
  return result;
}

// ─── Генерации (словарь чипов midi-gen v3, спека S3) ───────────────────────

const RATIONALE: Record<string, { text: string; conf: number }> = {
  "bass:basic": { text: "корень на сильных долях — прочный фундамент", conf: 0.78 },
  "bass:octaves": { text: "октавный ход: драйв для роста плотности (onset 2.1/долю)", conf: 0.62 },
  "bass:syncopated": { text: "синкопа в духе ритма лупа — off-beats 1.5/3.5", conf: 0.84 },
  "bass:walking": { text: "ходовая линия по квинто-кварцевому кругу", conf: 0.66 },
  "bass:sub": { text: "суб-бас: минимум нот, максимум низа", conf: 0.71 },
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

function buildSuggestion(
  tool: string,
  params: Record<string, unknown>,
  version: number,
  status: Suggestion["status"],
): Suggestion {
  const meta = RATIONALE[chipKey(tool, params)];
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
    // как ядро: эффективные параметры инструмента (+ путь стейджинга)
    params: {
      bpm: Math.round(Number(params.bpm ?? state.tempo)),
      ...(tool === "drums" ? {} : { key: String(params.key ?? "A minor") }),
      ...params,
      output_path: `${WORKSPACE}staging/${tool}_v${version}.mid`,
    },
    status,
  };
}

/** Новая версия партии: превью рендерится, событие уходит в окно. */
function newVersion(tool: string, params: Record<string, unknown>): Suggestion {
  const version = (state.current[tool]?.version ?? 0) + 1;
  state.current[tool] = { version, params: { ...params }, status: "generated" };
  state.previews.set(`${tool}:v${version}`, Date.now() + PREVIEW_DELAY);
  return emitSuggestion(tool)!;
}

/** Событие suggestion_updated для актуальной версии (как emit_suggestion в шелле). */
function emitSuggestion(tool: string): Suggestion | undefined {
  const cur = state.current[tool];
  if (!cur) return undefined;
  const suggestion = buildSuggestion(tool, cur.params, cur.version, cur.status);
  suggestionHandlers.forEach((h) => h({ part: tool as PartId, version: cur.version, suggestion }));
  return suggestion;
}

/** Актуальная версия партии — или ошибка ядра «не текущая». */
function requireCurrent(tool: string, version: number): CurrentPart {
  const cur = state.current[tool];
  if (!cur) {
    throw new Error(`нет предложения для партии ${tool}`);
  }
  if (cur.version !== version) {
    throw new Error(`версия ${version} не текущая (текущая ${cur.version})`);
  }
  return cur;
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

// ─── Self-Check / export (семантика ядра) ──────────────────────────────────

function mixLufsDelta(): number {
  return round2(LUFS_PER_LAYER * state.tracks.length);
}

function selfCheckReport(bouncePath: string, fault: FaultKind): SelfCheckReport {
  if (!state.loopAnalyzed) {
    throw new Error("нет эталона — сначала analyze_loop(loop.wav)");
  }
  // как ядро: дельта на каждую полосу лупа, встречающуюся и в миксе
  const bands_delta: Record<string, number> = {};
  for (const band of Object.keys(LOOP_BANDS)) bands_delta[band] = 0;
  for (const t of state.tracks) {
    for (const [band, v] of Object.entries(LAYER_BANDS[t.part] ?? {})) {
      bands_delta[band] += v;
    }
  }
  // линейная энергия — 1e-4…1e-7: округлять до 2 знаков нельзя, останутся нули
  for (const band of Object.keys(bands_delta)) {
    bands_delta[band] = Math.round(bands_delta[band] * 1e7) / 1e7;
  }
  const bounceLufs =
    fault === "selfcheck_loud_warn"
      ? LOUD_WARN_LUFS
      : (state.exportLufs.get(bouncePath) ?? LOOP_LUFS + mixLufsDelta());
  const key_match = fault !== "selfcheck_key_fail";
  return {
    key_match,
    tempo_match: true,
    lufs_delta: round2(bounceLufs - LOOP_LUFS),
    bands_delta,
    verdict: key_match ? "ok" : "fail",
  };
}

// ─── Адаптер ───────────────────────────────────────────────────────────────

export const mockAdapter: CockpitApi & {
  /** MOCK-only: включить следующий сбой. */
  setFault: (f: FaultKind) => void;
  /** MOCK-only: wake-цикл ядра (правило 5 шины; UI видит только host_status). */
  wakeEngine: () => void;
  /** MOCK-only: путь «внутри workspace» по имени файла (у File из браузера пути нет). */
  demoPath: (name: string) => string;
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
      state.loopAnalyzed = true;
      return {
        bpm: 90.1,
        // рубато-темп — честная низкая уверенность, как у живого анализатора
        bpm_confidence: 0.42,
        bpm_alt: 180.2,
        key: "A minor",
        key_confidence: 0.91,
        key_relative: "C major",
        lufs: LOOP_LUFS,
        true_peak: -2.4,
        bands: { ...LOOP_BANDS },
        onset_density: 2.1908,
      } satisfies XRayReport;
    });
  },

  async generatePart({ tool, params }) {
    return runCommand("generate_part", async () => {
      await delay(350 + Math.random() * 550);
      return newVersion(tool, params);
    });
  },

  async regenerate({ part, params_diff }) {
    return runCommand("regenerate", async () => {
      await delay(300 + Math.random() * 500);
      if (!state.current[part]) {
        throw new Error("нет предыдущей версии — сначала generate_part");
      }
      // diff накладывается на параметры предыдущей версии (как в ядре)
      return newVersion(part, { ...state.current[part].params, ...params_diff });
    });
  },

  async acceptPart({ part, version }) {
    return runCommand("accept_part", async () => {
      await delay(600);
      if (state.engine !== "up") {
        throw new Error("движок SoundCraft не подключён (см. get_mcp_slots / Screen 0)");
      }
      const cur = requireCurrent(part, version);
      // идемпотентность: повторный accept не плодит дубль-трек
      if (cur.status === "accepted") {
        throw new Error(`партия ${part} v${version} уже принята в сессию; для новой версии жми Regenerate`);
      }
      const trackId = state.nextTrackId++;
      const name = `MIDI ${trackId - 6}`;
      // импорт ложится с начала сессии; длина клипа — по нотам и темпу партии
      const suggestion = buildSuggestion(part, cur.params, version, "accepted");
      const beats = suggestion.notes.reduce((max, n) => Math.max(max, n.end), 0) / 480;
      const end = Math.round(((beats * 60) / Number(suggestion.params.bpm)) * 44100);
      state.tracks.push({
        id: `track-${trackId}`,
        name,
        part,
        kind: "midi",
        clips: [{ start: 0, end, notes: suggestion.notes.length }],
      });
      cur.status = "accepted";
      emitSuggestion(part);
      // imported_tracks — имена дорожек движка (как в ядре)
      return { imported_tracks: [name] };
    });
  },

  async rejectPart({ part, version }) {
    return runCommand("reject_part", async () => {
      await delay(150);
      requireCurrent(part, version).status = "rejected";
      emitSuggestion(part);
    });
  },

  async adoptLoop({ bpm, key }) {
    return runCommand("adopt_loop", async () => {
      await delay(400);
      state.tempo = Math.round(bpm * 10) / 10;
      state.keyMarker = key;
      // как ядро: ответ отдаёт имя маркера «Key: …», сессия — тональность без префикса
      return { tempo: state.tempo, marker: `Key: ${key}` };
    });
  },

  async getBusState() {
    await delay(60);
    const up = state.engine === "up";
    return {
      tempo: up ? state.tempo : null,
      key_marker: up ? state.keyMarker : null,
      tracks: state.tracks.map((t) => ({ ...t })),
      engine: state.engine,
      session_name: up ? state.sessionName : null,
    } satisfies BusState;
  },

  async runSelfCheck({ bounce_path }) {
    return runCommand("run_self_check", async (fault) => {
      await delay(650);
      if (!bounce_path.startsWith(WORKSPACE)) {
        throw new Error(`Bounce вне workspace (${bounce_path}) — правило 1 шины`);
      }
      return selfCheckReport(bounce_path, fault);
    });
  },

  async exportTrack({ output_path, target }: ExportTrackInput): Promise<ExportTrackOutput> {
    return runCommand("export_track", async () => {
      await delay(1100);
      if (state.engine !== "up") {
        throw new Error("движок SoundCraft не подключён");
      }
      const name = target && target !== "none" ? target : null;
      const goal = name ? TARGETS[name] : null;
      const path = output_path ?? `${WORKSPACE}export/l2t-export-${name ? `${name}-` : ""}${Date.now()}.wav`;
      // v0.2.2: при достаточном запасе по пику точный гейн сходится с целью
      const lufs = goal ? goal.lufs : round2(LOOP_LUFS + mixLufsDelta());
      state.exportLufs.set(path, lufs);
      return {
        path,
        seconds: 8,
        lufs,
        peak_db: goal ? -1.2 : -3.1,
        true_peak_db: goal ? -1.1 : -2.9,
        target: name ?? "none",
        mastering: goal
          ? {
              target_lufs: goal.lufs,
              applied: "gain",
              achieved_lufs: lufs,
              delta: 0,
              verdict: "on_target",
              measured_by: "analyzer",
            }
          : null,
      };
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

  dropMode: "html5",

  previewUrl(part, version) {
    const at = state.previews.get(`${part}:v${version}`);
    if (at === undefined || Date.now() < at) return null;
    return previewTone(PREVIEW_FREQ[part] ?? 110, 5.3);
  },

  // ── MOCK-only расширения (тестовое управление) ──

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

  demoPath(name) {
    return `${WORKSPACE}${name}`;
  },
};

export type MockAdapter = typeof mockAdapter;
