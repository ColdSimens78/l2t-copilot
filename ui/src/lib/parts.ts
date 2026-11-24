/**
 * Словарь партий — модель Channel Rack (спека S3, словарь midi-gen v3).
 *
 * Единственное место, где UI знает имена параметров генератора. Чип =
 * аргумент MCP-инструмента, и наоборот: чего генератор не принимает, здесь
 * нет. У баса нет `bars` — генератор пишет один такт, лишний аргумент он
 * молча игнорирует, поэтому вместо мёртвого чипа честная подпись.
 *
 * key и bpm — не чипы: их даёт сессия движка (после «Применить к сессии»)
 * или, пока сессия их не приняла, выбранный темп в Loop X-Ray.
 */
import type { BusState, PartId, XRayReport } from "@/types/contract";

export type ChipValues = Record<string, unknown>;

interface EnumChip {
  kind: "enum";
  /** Аргумент инструмента: style / voicing / bars. */
  key: string;
  /** Заголовок группы. */
  caption: string;
  values: { value: string | number; label: string; hint: string }[];
  default?: string | number;
}

interface ToggleChip {
  kind: "toggle";
  /** Аргумент инструмента: variation. */
  key: string;
  label: string;
  hint: string;
  /** Чип имеет смысл только при условии (филл слышен от 4 тактов). */
  enabledWhen?: (chips: ChipValues) => boolean;
  disabledHint?: string;
}

export type ChipSpec = EnumChip | ToggleChip;

export interface PartSpec {
  /** Имя канала — «Бас». */
  label: string;
  /** Винительный падеж для фраз — «генерирую бас». */
  accusative: string;
  /** Что сделает канал: подсказка пустого состояния. */
  hint: string;
  /** Цвет канала: один для карточки, мини-превью и слоя нот. */
  color: string;
  chips: ChipSpec[];
  /** Подпись вместо параметра, которого у генератора нет. */
  fixed?: { label: string; hint: string };
}

const BAR_VALUES: EnumChip["values"] = [
  { value: 1, label: "1", hint: "bars: 1 — один такт" },
  { value: 2, label: "2", hint: "bars: 2 — два такта" },
  { value: 4, label: "4", hint: "bars: 4 — четыре такта" },
  { value: 8, label: "8", hint: "bars: 8 — восемь тактов" },
];

export const PART_ORDER: PartId[] = ["bass", "chords", "drums"];

export const PARTS: Record<PartId, PartSpec> = {
  bass: {
    label: "Бас",
    accusative: "бас",
    hint: "линия баса в тональности лупа — фундамент",
    color: "oklch(0.7 0.16 255)",
    chips: [
      {
        kind: "enum",
        key: "style",
        caption: "стиль",
        values: [
          { value: "basic", label: "база", hint: "style: basic — корень на сильных долях" },
          { value: "octaves", label: "октавы", hint: "style: octaves — октавные ходы восьмыми" },
          { value: "syncopated", label: "синкопа", hint: "style: syncopated — синкопированные офф-биты" },
          { value: "walking", label: "ход", hint: "style: walking — ходовая линия четвертями" },
          { value: "sub", label: "суб", hint: "style: sub — выдержанный суб-бас" },
        ],
      },
    ],
    fixed: { label: "1 такт", hint: "генератор баса пишет один такт" },
  },
  chords: {
    label: "Аккорды",
    accusative: "аккорды",
    hint: "прогрессия из четырёх аккордов — гармоническая опора",
    color: "oklch(0.8 0.15 80)",
    chips: [
      {
        kind: "enum",
        key: "voicing",
        caption: "изложение",
        values: [
          {
            value: "voiceled",
            label: "плавно",
            hint: "voicing: voiceled — инверсии с минимальным движением голосов",
          },
          { value: "block", label: "блок", hint: "voicing: block — трезвучия в корневой позиции" },
        ],
      },
      { kind: "enum", key: "bars", caption: "такты", values: BAR_VALUES, default: 4 },
    ],
  },
  drums: {
    label: "Бит",
    accusative: "бит",
    hint: "бочка на 1 и 3, снейр на 2 и 4, хэты восьмыми — сетка под луп",
    color: "oklch(0.7 0.19 22)",
    chips: [
      { kind: "enum", key: "bars", caption: "такты", values: BAR_VALUES, default: 4 },
      {
        kind: "toggle",
        key: "variation",
        label: "филл",
        hint: "variation: снейр-филл шестнадцатыми в каждом 4-м такте",
        enabledWhen: (chips) => Number(chips.bars ?? 1) >= 4,
        disabledHint: "филл слышен от 4 тактов",
      },
    ],
  },
};

/** Чипы по умолчанию — с ними канал делает первую генерацию. */
export function defaultChips(part: PartId): ChipValues {
  const out: ChipValues = {};
  for (const chip of PARTS[part].chips) {
    out[chip.key] = chip.kind === "enum" ? (chip.default ?? chip.values[0].value) : false;
  }
  return out;
}

/** Чипы канала из параметров генератора (остальное — bpm, пути — не чипы). */
export function chipParams(part: PartId, params: ChipValues | undefined): ChipValues {
  const out = defaultChips(part);
  if (params) {
    for (const chip of PARTS[part].chips) {
      if (params[chip.key] !== undefined) out[chip.key] = params[chip.key];
    }
  }
  return out;
}

export interface MusicContext {
  bpm: number | null;
  /** Формат генератора — «E minor», без конвенции имени маркера. */
  key: string | null;
  /** Сессия движка (после adopt) либо выбранный темп в Loop X-Ray. */
  source: "session" | "xray";
}

/** «Key: E minor» → «E minor»; вне конвенции — как есть. */
export function stripKeyMarker(marker: string): string {
  return marker.replace(/^Key:\s*/, "");
}

/**
 * Откуда каналы берут темп и тональность (спека S3): сессия — источник
 * истины, пока в ней есть key-маркер; иначе — отчёт Loop X-Ray.
 */
export function resolveMusicContext(
  busState: BusState | null,
  xray: XRayReport | null,
  selectedBpm: number | null,
): MusicContext | null {
  if (busState?.engine === "up" && busState.key_marker !== null) {
    return {
      bpm: busState.tempo,
      key: stripKeyMarker(busState.key_marker),
      source: "session",
    };
  }
  if (xray) return { bpm: selectedBpm ?? xray.bpm, key: xray.key, source: "xray" };
  return null;
}

export function describeContext(ctx: MusicContext): string {
  const bpm = ctx.bpm != null ? `${Math.round(ctx.bpm)} BPM` : "— BPM";
  return `${ctx.key ?? "—"} · ${bpm}`;
}

/** Точные аргументы инструмента генератора — только те, что он принимает. */
export function toolParams(
  part: PartId,
  chips: ChipValues,
  ctx: MusicContext,
): Record<string, unknown> {
  const c = chipParams(part, chips);
  const bpm = Math.round(ctx.bpm ?? 0);
  if (part === "bass") return { bpm, key: ctx.key, style: c.style };
  if (part === "chords") return { bpm, key: ctx.key, bars: c.bars, voicing: c.voicing };
  return { bpm, bars: c.bars, variation: Boolean(c.variation) };
}

/**
 * Регенерация = тот же вызов с другими параметрами: diff только изменённых
 * чипов; темп и тональность входят в diff, если контекст сменился с прошлой
 * версии (например, применили другой X-Ray).
 */
export function paramDiff(
  part: PartId,
  applied: Record<string, unknown> | undefined,
  nextChips: ChipValues,
  ctx: MusicContext,
): { diff: Record<string, unknown>; label: string; keys: string[] } {
  const before = chipParams(part, applied);
  const after = chipParams(part, nextChips);
  const diff: Record<string, unknown> = {};
  const label: string[] = [];
  const keys: string[] = [];
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      diff[key] = after[key];
      label.push(`${key}: ${String(before[key])} → ${String(after[key])}`);
      keys.push(key);
    }
  }
  const bpm = Math.round(ctx.bpm ?? 0);
  if (applied === undefined || Math.round(Number(applied.bpm)) !== bpm) {
    diff.bpm = bpm;
    label.push(`bpm: ${applied === undefined ? "—" : Math.round(Number(applied.bpm))} → ${bpm}`);
    keys.push("bpm");
  }
  if (part !== "drums" && applied?.key !== ctx.key) {
    diff.key = ctx.key;
    label.push(`key: ${String(applied?.key ?? "—")} → ${String(ctx.key)}`);
    keys.push("key");
  }
  return { diff, label: label.join(", "), keys };
}

/**
 * Видимый diff двух версий партии — «style: basic → syncopated»: что
 * изменилось в чипах и контексте (bpm/key) между соседними версиями.
 */
export function versionDiff(
  part: PartId,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string {
  const b = chipParams(part, before);
  const a = chipParams(part, after);
  const label: string[] = [];
  for (const key of Object.keys(a)) {
    if (b[key] !== a[key]) label.push(`${key}: ${String(b[key])} → ${String(a[key])}`);
  }
  for (const key of part === "drums" ? ["bpm"] : ["bpm", "key"]) {
    if (String(before?.[key]) !== String(after?.[key])) {
      label.push(`${key}: ${before?.[key] ?? "—"} → ${after?.[key] ?? "—"}`);
    }
  }
  return label.join(", ");
}
