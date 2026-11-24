/**
 * Состояние канала партии (спека S3): версии, выбор в истории, ошибка.
 * Чистые переходы — зеркало событий ядра (suggestion_updated), без React:
 * проверяются тестами без окна.
 */
import type { Suggestion, SuggestionUpdatedEvent } from "@/types/contract";
import type { ChipValues } from "@/lib/parts";

export interface ChannelVersion {
  suggestion: Suggestion;
  /** Решение по версии: ответ accept/reject или событие suggestion_updated. */
  decision?: "accepted" | "rejected";
  /** Дорожки хоста после accept (imported_tracks — имена дорожек движка). */
  tracks?: string[];
  /** Эфемерно: версию прослушали (▶). Команды в контракте нет — до перезапуска. */
  auditioned?: boolean;
}

/**
 * Ошибка канала: причина текстом + что повторит кнопка [Повторить].
 * Ядро принимает и отклоняет только актуальную версию — поэтому повтор
 * всегда адресован конкретной версии.
 */
export interface ChannelError {
  text: string;
  retry:
    | { kind: "generate"; chips: ChipValues }
    | { kind: "accept"; version: number }
    | { kind: "reject"; version: number };
}

export interface ChannelState {
  /** idle → generating → ready; ошибки и решения живут в error и версиях. */
  status: "idle" | "generating" | "ready";
  versions: ChannelVersion[];
  /** Версия, выбранная в истории; null = последняя. */
  selectedVersion: number | null;
  error: ChannelError | null;
}

export const emptyChannel = (): ChannelState => ({
  status: "idle",
  versions: [],
  selectedVersion: null,
  error: null,
});

/** Версия, которую показывает канал: выбранную в истории либо последнюю. */
export function displayedVersion(channel: ChannelState): ChannelVersion | undefined {
  const last = channel.versions.at(-1);
  if (channel.selectedVersion === null) return last;
  return channel.versions.find((v) => v.suggestion.version === channel.selectedVersion) ?? last;
}

/** Событие suggestion_updated → новое состояние канала. */
export function applySuggestion(
  channel: ChannelState,
  event: SuggestionUpdatedEvent,
): ChannelState {
  const { suggestion, version } = event;
  const decision =
    suggestion.status === "accepted" || suggestion.status === "rejected"
      ? suggestion.status
      : undefined;
  const versions = [...channel.versions];
  const at = versions.findIndex((v) => v.suggestion.version === version);
  if (at >= 0) {
    versions[at] = {
      ...versions[at],
      suggestion,
      decision: decision ?? versions[at].decision,
    };
  } else {
    versions.push({ suggestion, decision });
  }
  return {
    versions,
    // новая версия приходит последней — карточка показывает её
    selectedVersion: at < 0 ? null : channel.selectedVersion,
    status: "ready",
    error: null,
  };
}

/** Решение по версии — ответ accept/reject (после события или вместо него). */
export function decideVersion(
  channel: ChannelState,
  version: number,
  decision: "accepted" | "rejected",
  tracks?: string[],
): ChannelState {
  return {
    ...channel,
    versions: channel.versions.map((v) =>
      v.suggestion.version === version
        ? { ...v, decision, tracks: tracks ?? v.tracks }
        : v,
    ),
  };
}
