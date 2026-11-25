/**
 * S3 · PartChannel — канал партии (bass | chords | drums), состояния спеки:
 * idle → generating → карточка предложения; error и accepted — надстройки
 * над ними. Карточка — проекция версии из store: превью нот, rationale,
 * уверенность, source_tool, чипы, история, жесты. Локально — только hover.
 */
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { PartId } from "@/types/contract";
import { useApi } from "@/ipc/api";
import { useCockpit } from "@/store/cockpit";
import { displayedVersion } from "@/store/channels";
import {
  PARTS,
  chipParams,
  defaultChips,
  describeContext,
  versionDiff,
  type ChipValues,
} from "@/lib/parts";
import { previewKey, stopPreview, togglePreview, usePlayingPreview } from "@/lib/preview-player";
import { PULSE_DELAY, useDelayed } from "@/lib/use-delayed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confidence } from "@/components/cockpit/confidence";
import { GhostPreview } from "@/components/cockpit/ghost-preview";
import { ParamChips } from "@/components/cockpit/param-chips";
import { SuggestionActions, type ChannelAction } from "@/components/cockpit/suggestion-actions";
import { VersionHistory } from "@/components/cockpit/version-history";
import { cn } from "@/lib/utils";

const NO_CONTEXT = "Сначала разбери луп: темп и тональность партий берутся из Loop X-Ray";
const PREVIEW_POLL_MS = 500;
const PREVIEW_POLL_TRIES = 30;

/**
 * C2: превью-WAV ищем по конвенции staging/<part>_v<N>.wav, пока файл не
 * появится (события готовности в v0 нет — поллинг, пока карточка открыта).
 * missing — файл так и не появился: сайдкару нечем рендерить.
 */
function usePreviewUrl(
  part: PartId,
  version: number,
  enabled: boolean,
): { url: string | null; missing: boolean } {
  const lookup = useApi().previewUrl;
  const key = previewKey(part, version);
  const [ready, setReady] = useState<{ key: string; url: string } | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !lookup) return;
    let timer = 0;
    let tries = 0;
    const poll = () => {
      const next = lookup(part, version);
      if (next) {
        setReady({ key, url: next });
      } else if (tries < PREVIEW_POLL_TRIES) {
        tries += 1;
        timer = window.setTimeout(poll, PREVIEW_POLL_MS);
      } else {
        setMissing(key);
      }
    };
    poll();
    return () => window.clearTimeout(timer);
  }, [enabled, key, lookup, part, version]);
  if (ready?.key === key) return { url: ready.url, missing: false };
  return { url: null, missing: missing !== null && missing === key };
}

export function PartChannel({ part }: { part: PartId }) {
  const api = useApi();
  const {
    channels,
    musicContext,
    regenerate,
    acceptPart,
    rejectPart,
    retryChannel,
    selectChannelVersion,
    markAuditioned,
  } = useCockpit();
  const spec = PARTS[part];
  const channel = channels[part];
  const shown = displayedVersion(channel);
  const latest = channel.versions.at(-1);
  const chips: ChipValues = shown
    ? chipParams(part, shown.suggestion.params)
    : defaultChips(part);
  const busy = channel.status === "generating";
  // трёхуровневая индикация: <300 мс — без индикации, дальше — канал «дышит»
  const pulsing = useDelayed(busy, PULSE_DELAY);
  const hasContext = musicContext !== null && musicContext.bpm !== null;
  const canPreview = api.previewUrl !== undefined;
  const version = shown?.suggestion.version ?? 0;
  const key = previewKey(part, version);
  const playing = usePlayingPreview() === key;
  const { url, missing } = usePreviewUrl(part, version, canPreview && shown !== undefined);

  const changeChip = (k: string, v: string | number | boolean) =>
    void regenerate(part, { ...chips, [k]: v });
  const onPlay = () => {
    if (playing) {
      stopPreview();
    } else if (url) {
      togglePreview(key, url);
      markAuditioned(part, version);
    }
  };

  const play: ChannelAction = {
    enabled: playing || url !== null,
    title: playing
      ? "Остановить превью"
      : !canPreview
        ? "Превью появится после настройки рендера"
        : url
          ? `Прослушать превью v${version}`
          : missing
            ? "Превью не отрендерилось — проверь soundfont"
            : "Рендер превью…",
    run: onPlay,
  };
  const again: ChannelAction = {
    enabled: hasContext && !busy,
    title: hasContext ? "Перегенерировать с теми же чипами — новая версия" : NO_CONTEXT,
    run: () => void regenerate(part, chips),
  };

  // ✓ и ✕ — только для актуальной версии: прошлая ядром не принимается
  const decision = shown?.decision;
  const isLatest = shown !== undefined && shown === latest;
  const stale = "Ядро принимает только актуальную версию — «↻» пересоздаст партию с этими чипами";
  const decided = decision === "accepted" ? "Версия уже в сессии" : "Версия отклонена";
  const acceptedBefore = channel.versions.filter((v) => v.decision === "accepted");
  const canDecide = isLatest && !decision && !busy;
  const accept: ChannelAction = {
    enabled: canDecide,
    title: !isLatest
      ? stale
      : decision
        ? decided
        : `Принять v${version} в сессию${
            acceptedBefore.length ? " — добавит дорожку, принятые раньше останутся" : ""
          }`,
    run: () => {
      if (shown) void acceptPart(part, version);
    },
  };
  const reject: ChannelAction = {
    enabled: canDecide,
    title: !isLatest ? stale : decision ? decided : `Отклонить v${version}`,
    run: () => {
      if (shown) void rejectPart(part, version);
    },
  };

  // что изменилось относительно предыдущей версии — только не для первой
  const shownAt = shown ? channel.versions.indexOf(shown) : -1;
  const diff =
    shown && shownAt > 0
      ? versionDiff(part, channel.versions[shownAt - 1].suggestion.params, shown.suggestion.params)
      : "";
  // в сессии уже есть другая версия партии — карточка напоминает
  const acceptedAside = acceptedBefore.filter((v) => v !== shown);
  const error = channel.error;
  const errorHeadline =
    error?.retry.kind === "generate"
      ? "Генерация не удалась"
      : error?.retry.kind === "accept"
        ? "Не удалось передать в сессию"
        : "Не удалось отклонить";

  return (
    <section
      aria-busy={busy}
      className={cn("rounded-xl border p-2 transition-colors", pulsing && "border-warning/60")}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: spec.color }} />
        <h3 className="text-card-foreground text-sm leading-none font-semibold">{spec.label}</h3>
        {shown ? <span className="text-muted-foreground font-mono text-[11px]">v{version}</span> : null}
        {decision === "accepted" ? (
          <Badge className="border-success/40 bg-success/15 text-success max-w-36 truncate" variant="outline">
            в сессии{shown?.tracks ? ` · ${shown.tracks}` : ""}
          </Badge>
        ) : decision === "rejected" ? (
          <Badge className="text-muted-foreground" variant="outline">
            отклонено
          </Badge>
        ) : null}
        <span
          className="text-muted-foreground ml-auto shrink-0 font-mono text-[11px]"
          title="Темп и тональность партий: сессия движка, пока её нет — Loop X-Ray"
        >
          {musicContext ? describeContext(musicContext) : "— BPM"}
        </span>
      </header>

      {acceptedAside.length > 0 ? (
        <p className="text-muted-foreground mt-1 text-[11px]">
          в сессии:{" "}
          {acceptedAside
            .map((v) => `v${v.suggestion.version}${v.tracks ? ` · ${v.tracks}` : ""}`)
            .join(", ")}
        </p>
      ) : null}

      {error ? (
        <div className="border-destructive/40 bg-destructive/10 mt-2 rounded-lg p-2 text-xs" role="alert">
          <p className="text-destructive">
            {errorHeadline}: <span className="break-words">{error.text}</span>
          </p>
          <Button className="mt-1.5" onClick={() => void retryChannel(part)} size="xs" variant="outline">
            Повторить
          </Button>
        </div>
      ) : null}

      {shown ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <GhostPreview
            className={pulsing ? "animate-pulse" : undefined}
            color={spec.color}
            key={version}
            notes={shown.suggestion.notes}
          />
          <p
            className="text-card-foreground line-clamp-1 text-xs leading-snug"
            title={shown.suggestion.rationale}
          >
            {shown.suggestion.rationale}
          </p>
          <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-[11px]">
            <Confidence className="shrink-0" value={shown.suggestion.confidence} />
            <span className="min-w-0 truncate font-mono" title={shown.suggestion.source_tool}>
              {shown.suggestion.source_tool}
            </span>
          </div>
          {diff ? <p className="text-muted-foreground text-[11px]">изменено: {diff}</p> : null}
          <ParamChips chips={chips} disabled={busy || !hasContext} onChange={changeChip} part={part} />
          <VersionHistory
            active={version}
            onSelect={(v) => selectChannelVersion(part, v)}
            pinned={channel.selectedVersion !== null}
            versions={channel.versions}
          />
          <SuggestionActions
            accept={accept}
            busy={busy}
            play={play}
            playing={playing}
            regenerate={again}
            reject={reject}
          />
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <Button
            className={cn("w-full justify-start", pulsing && "animate-pulse")}
            disabled={!hasContext || busy}
            onClick={() => void regenerate(part, chips)}
            size="sm"
            title={hasContext ? undefined : NO_CONTEXT}
          >
            <Sparkles />
            {busy ? `Генерирую ${spec.accusative}…` : `Сгенерировать ${spec.label.toLowerCase()}`}
          </Button>
          <p className="text-muted-foreground text-xs leading-snug">{spec.hint}</p>
          <ParamChips chips={chips} disabled={busy || !hasContext} onChange={changeChip} part={part} />
        </div>
      )}
    </section>
  );
}
