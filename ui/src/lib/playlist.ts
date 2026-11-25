/**
 * S5 · Playlist — read-only проекция сессии движка (спека S5): что уже лежит
 * в сессии и куда прилетают принятые партии. В контракте tracks — unknown[]:
 * ядро отдаёт {id, name, kind, instrument, clips[{start,end,notes}]}, поэтому
 * проекция читает поля осторожно и не падает на незнакомой форме.
 * Аранжировку правят в DAW — кокпит только показывает. Чистые функции.
 */
import type { PartId } from "@/types/contract";
import type { ChannelState } from "@/store/channels";
import { PART_ORDER } from "@/lib/parts";

/** Частота сессии, в которой ядро создаёт проект; границы клипов — в её сэмплах. */
export const SESSION_SAMPLE_RATE = 44100;

export interface PlaylistClip {
  /** Начало и конец клипа, сэмплы. */
  start: number;
  end: number;
  /** Число нот MIDI-клипа; у аудио — null. */
  notes: number | null;
}

export interface PlaylistTrack {
  id: string;
  name: string;
  kind: string | null;
  instrument: string | null;
  clips: PlaylistClip[];
  /** Канал партии, если дорожка — принятая версия; иначе null. */
  part: PartId | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function partId(value: unknown): PartId | null {
  return PART_ORDER.find((part) => part === value) ?? null;
}

/** Имена дорожек принятых версий → канал партии (imported_tracks ответа accept_part). */
export function acceptedTrackIndex(channels: Record<PartId, ChannelState>): Map<string, PartId> {
  const index = new Map<string, PartId>();
  for (const part of PART_ORDER) {
    for (const version of channels[part].versions) {
      if (version.decision !== "accepted") continue;
      for (const name of version.tracks ?? []) index.set(name, part);
    }
  }
  return index;
}

/**
 * Дорожки сессии. Партия дорожки — поле part, если оно есть (мок), иначе
 * имя дорожки среди принятых версий каналов.
 */
export function projectTracks(
  tracks: unknown[],
  accepted: Map<string, PartId>,
): PlaylistTrack[] {
  const out: PlaylistTrack[] = [];
  for (const raw of tracks) {
    if (typeof raw !== "object" || raw === null) continue;
    const track = raw as Record<string, unknown>;
    const id = track.id;
    const clipsRaw = Array.isArray(track.clips) ? track.clips : [];
    const clips: PlaylistClip[] = [];
    for (const clipRaw of clipsRaw) {
      if (typeof clipRaw !== "object" || clipRaw === null) continue;
      const clip = clipRaw as Record<string, unknown>;
      const start = num(clip.start);
      const end = num(clip.end);
      if (start === null || end === null) continue;
      clips.push({ start, end, notes: num(clip.notes) });
    }
    const name = text(track.name) ?? `дорожка ${out.length + 1}`;
    out.push({
      id: typeof id === "string" || typeof id === "number" ? String(id) : "",
      name,
      kind: text(track.kind),
      instrument: text(track.instrument),
      clips,
      part: partId(track.part) ?? accepted.get(name) ?? null,
    });
  }
  return out;
}

/** Конец сессии в сэмплах — правый край самого позднего клипа. */
export function sessionEnd(tracks: PlaylistTrack[]): number {
  return tracks.reduce((end, track) => track.clips.reduce((e, clip) => Math.max(e, clip.end), end), 0);
}

/** Доля отрезка [start, end] внутри [0, span]: левый край и ширина, 0..1. */
export function clipSpan(
  clip: PlaylistClip,
  span: number,
): { left: number; width: number } {
  if (span <= 0) return { left: 0, width: 1 };
  const left = Math.max(0, Math.min(1, clip.start / span));
  const right = Math.max(left, Math.min(1, clip.end / span));
  return { left, width: Math.max(right - left, 0.004) };
}
