/**
 * Словарь показателей Loop X-Ray и Self-Check (спека S2, S6): порядок полос,
 * пороги уверенности и громкости, строки светофора. Чистые функции — критерии
 * строк UI считает сам из полей отчёта (ядро отдаёт только verdict ok/fail),
 * поэтому словарь проверяется тестами без окна.
 */
import type {
  MasterTarget,
  MasteringVerdict,
  SelfCheckReport,
  XRayReport,
} from "@/types/contract";
import { fmt, signed } from "@/lib/format";

/** Ниже этой уверенности значение рисуется приглушённым и жёлтым (спека S2). */
export const LOW_CONFIDENCE = 0.7;
/** |lufs_delta| больше этого — ⚠-строка «Громкость» (спека S6). */
export const LOUDNESS_DRIFT_LU = 2;
/** Допуск цели громкости on_target ядра (ON_TARGET_LU). */
export const TARGET_TOLERANCE_LU = 1;

/** Цели громкости экспорта — те же константы, что у ядра (SPOTIFY_LUFS/APPLE_LUFS). */
export const TARGETS: Record<Exclude<MasterTarget, "none">, { lufs: number; label: string }> = {
  spotify: { lufs: -14, label: "Spotify" },
  apple: { lufs: -16, label: "Apple Music" },
};

/** Полосы анализатора по частотам. На проводе — алфавитный порядок (BTreeMap ядра). */
const BAND_LABELS: Record<string, string> = {
  sub_bass: "суб-бас",
  bass: "бас",
  low_mid: "низк. середина",
  mid: "середина",
  upper_mid: "верх. середина",
  presence: "презенс",
  brilliance: "воздух",
};

export interface BandBar {
  id: string;
  label: string;
  /** Линейная энергия полосы — как отдал анализатор. */
  value: number;
  /** Уровень относительно самой громкой полосы, дБ; null — тишины или максимума нет. */
  db: number | null;
}

/** Полосы в порядке частот; неизвестные имена — в конце, как есть. */
export function bandBars(bands: Record<string, number>): BandBar[] {
  const known = Object.keys(BAND_LABELS).filter((id) => id in bands);
  const extra = Object.keys(bands)
    .filter((id) => !(id in BAND_LABELS))
    .sort();
  const ids = [...known, ...extra];
  const max = ids.reduce((m, id) => Math.max(m, bands[id]), 0);
  return ids.map((id) => {
    const value = bands[id];
    return {
      id,
      label: BAND_LABELS[id] ?? id,
      value,
      db: value > 0 && max > 0 ? 10 * Math.log10(value / max) : null,
    };
  });
}

export interface BandDelta {
  id: string;
  label: string;
  /** Прирост полосы микса относительно лупа, дБ; null — полоса была тишиной или стала. */
  db: number | null;
}

/** «Что добавили слои»: bands_delta ядра — линейная энергия, показываем в дБ к лупу. */
export function bandDeltas(xray: XRayReport | null, report: SelfCheckReport): BandDelta[] {
  const ids = bandBars({ ...(xray?.bands ?? {}), ...report.bands_delta }).map((b) => b.id);
  return ids.map((id) => {
    const base = xray?.bands[id];
    const delta = report.bands_delta[id];
    return {
      id,
      label: BAND_LABELS[id] ?? id,
      db:
        base !== undefined && delta !== undefined && base > 0 && base + delta > 0
          ? 10 * Math.log10((base + delta) / base)
          : null,
    };
  });
}

// ─── Светофор Self-Check ───────────────────────────────────────────────────

export type Light = "ok" | "warn" | "fail";
export type Metric = "key" | "tempo" | "loudness";

export interface VerdictRow {
  metric: Metric;
  label: string;
  light: Light;
  /** Короткое значение строки. */
  value: string;
  /** Толкование: что вердикт значит на человеческом. */
  note: string;
}

/**
 * Громкость микса: замер экспорта, если проверен его файл, иначе луп + дельта
 * отчёта (lufs_delta = микс − луп).
 */
export function mixLufs(
  report: SelfCheckReport,
  xray: XRayReport | null,
  measured: number | null,
): number | null {
  if (measured !== null) return measured;
  return xray ? xray.lufs + report.lufs_delta : null;
}

/** Сколько не хватает до цели: > 0 — микс тише цели, < 0 — громче. */
export function targetGap(lufs: number, target: MasterTarget): number | null {
  return target === "none" ? null : TARGETS[target].lufs - lufs;
}

export function targetLabel(target: MasterTarget): string {
  return target === "none"
    ? "без цели"
    : `${TARGETS[target].label} ${fmt(TARGETS[target].lufs, 0)} LUFS`;
}

export function loudnessLight(report: SelfCheckReport): Light {
  return Math.abs(report.lufs_delta) > LOUDNESS_DRIFT_LU ? "warn" : "ok";
}

function loudnessNote(report: SelfCheckReport, mix: number | null): string {
  const parts: string[] = [];
  if (Math.abs(report.lufs_delta) > LOUDNESS_DRIFT_LU) {
    parts.push(
      `микс ${report.lufs_delta < 0 ? "тише" : "громче"} лупа на ${fmt(Math.abs(report.lufs_delta), 1)} LU`,
    );
  } else {
    parts.push("микс держится рядом с лупом");
  }
  if (mix !== null) {
    parts.push(
      `до ${TARGETS.spotify.label} ${fmt(TARGETS.spotify.lufs, 0)}: ${signed(TARGETS.spotify.lufs - mix)} dB`,
    );
  }
  return parts.join(" · ");
}

/** Строки светофора: ✓ / ⚠ / ✗ по полям отчёта (критерии спеки S6). */
export function selfCheckRows(
  report: SelfCheckReport,
  xray: XRayReport | null,
  measured: number | null,
): VerdictRow[] {
  return [
    {
      metric: "key",
      label: "Тональность",
      light: report.key_match ? "ok" : "fail",
      value: report.key_match ? "сходится" : "конфликт",
      note: report.key_match
        ? xray?.key_relative
          ? `≡ ${xray.key_relative} — параллельная, тоже зачёт`
          : "параллельные тональности — зачёт"
        : "какой-то слой ушёл в другую тональность — перегенерируй партии",
    },
    {
      metric: "tempo",
      label: "Темп",
      light: report.tempo_match ? "ok" : "fail",
      value: report.tempo_match ? "сходится" : "не сходится",
      note: report.tempo_match
        ? "±1 BPM; вдвое быстрее или медленнее по хэтам — зачёт"
        : "микс ушёл от темпа лупа",
    },
    {
      metric: "loudness",
      label: "Громкость",
      light: loudnessLight(report),
      value: `${signed(report.lufs_delta, 1)} LU`,
      note: loudnessNote(report, mixLufs(report, xray, measured)),
    },
  ];
}

/** Итоговая лампа панели: любая ✗ — fail, иначе любая ⚠ — warn. */
export function overallLight(rows: VerdictRow[]): Light {
  if (rows.some((r) => r.light === "fail")) return "fail";
  if (rows.some((r) => r.light === "warn")) return "warn";
  return "ok";
}

/** Вердикт цели громкости из отчёта экспорта — словами (MasteringVerdict ядра). */
export const MASTERING_VERDICTS: Record<MasteringVerdict, string> = {
  on_target: "в допуске ±1 LU",
  below_target: "ниже цели: пику уже некуда — нужен лимитер",
  above_target: "громче цели: нужно ослабление",
  silent: "громкости нет",
};
