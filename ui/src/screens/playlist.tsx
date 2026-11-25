/**
 * S5 · Playlist (спека §2 S5), read-only: дорожки сессии движка — куда
 * прилетают принятые партии и что уже лежит в сессии. Источник — get_bus_state:
 * pull при открытии вкладки, а после каждого accept_part store переспрашивает
 * состояние сам — проекция и TopBar обновляются одной командой. Принятые
 * партии подсвечены палитрой канала. Правок нет: аранжировку правят в DAW.
 */
import { useEffect, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useCockpit } from "@/store/cockpit";
import { PARTS, stripKeyMarker } from "@/lib/parts";
import { fmt, plural } from "@/lib/format";
import {
  SESSION_SAMPLE_RATE,
  acceptedTrackIndex,
  clipSpan,
  projectTracks,
  sessionEnd,
  type PlaylistTrack,
} from "@/lib/playlist";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** При длинной сессии подписываем каждый 4-й такт, чтобы цифры не слипались. */
const BAR_LABEL_LIMIT = 16;
/** Такт 4/4: четыре доли. */
const BEATS_PER_BAR = 4;

export function PlaylistView() {
  const { busState, hostStatus, channels, refreshBusState, requestRackFocus } = useCockpit();

  // спека S5: открытие тумблера → get_bus_state (pull)
  useEffect(() => {
    void refreshBusState();
  }, [refreshBusState]);

  if (hostStatus !== "up" || busState?.engine !== "up") {
    return (
      <Centered>
        <p className="text-card-foreground text-sm">Нет данных: движок спит</p>
        <p className="text-muted-foreground text-xs">Сессии нет — подними движок и открой Playlist снова.</p>
      </Centered>
    );
  }

  const tracks = projectTracks(busState.tracks, acceptedTrackIndex(channels));
  const end = sessionEnd(tracks);
  const seconds = end / SESSION_SAMPLE_RATE;
  const barSeconds = busState.tempo ? (BEATS_PER_BAR * 60) / busState.tempo : null;
  const boundaries =
    barSeconds && end > 0
      ? Array.from(
          { length: Math.floor(seconds / barSeconds + 1e-6) + 1 },
          (_, i) => (i * barSeconds) / seconds,
        )
      : [];
  const labelEvery = boundaries.length > BAR_LABEL_LIMIT ? 4 : 1;

  return (
    <section aria-label="Playlist — сессия" className="flex min-h-0 flex-1 flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-card-foreground text-sm font-semibold">
          {plural(tracks.length, "дорожка", "дорожки", "дорожек")} · {fmt(seconds)} с
        </h3>
        <span className="text-muted-foreground truncate font-mono text-[11px]">
          {busState.tempo !== null ? `${Math.round(busState.tempo)} BPM` : "— BPM"} ·{" "}
          {busState.key_marker ? stripKeyMarker(busState.key_marker) : "—"}
        </span>
      </header>

      {tracks.length === 0 ? (
        <Centered>
          <p className="text-card-foreground text-sm">Сессия пуста</p>
          <p className="text-muted-foreground text-xs">
            Прими партию в Channel Rack — она ляжет сюда дорожкой.
          </p>
          <Button onClick={requestRackFocus} size="sm" variant="ghost">
            <ArrowLeft />к Channel Rack
          </Button>
        </Centered>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {/* линейка: колонки имени и подписи — той же ширины, что у дорожек */}
          <div aria-hidden className="flex items-center gap-2">
            <span className="w-28 shrink-0" />
            <div className="relative h-4 flex-1">
              {/* key-маркер ядра (adopt_loop) стоит в начале сессии — флажок там же */}
              {busState.key_marker ? (
                <span
                  className="absolute top-0 left-0 z-10 flex items-center gap-0.5 font-mono text-[10px] leading-none"
                  title={`key-маркер сессии: ${busState.key_marker}`}
                >
                  <span aria-hidden className="text-warning">
                    ⚑
                  </span>
                  <span className="text-card-foreground max-w-24 truncate">
                    {stripKeyMarker(busState.key_marker)}
                  </span>
                </span>
              ) : null}
              {boundaries.map((at, i) =>
                (i > 0 || !busState.key_marker) &&
                (i % labelEvery === 0 || i === boundaries.length - 1) ? (
                  <span
                    className="text-muted-foreground absolute top-0 -translate-x-px font-mono text-[10px] leading-none"
                    key={i}
                    style={{ left: `${at * 100}%` }}
                  >
                    {i + 1}
                  </span>
                ) : null,
              )}
            </div>
            <span className="w-20 shrink-0" />
          </div>
          <div className="relative mt-1">
            {/* тактовые линии — одна сетка за всеми дорожками */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-[5.5rem] left-[7.5rem]"
            >
              {boundaries.map((at, i) => (
                <span
                  className="bg-foreground/12 absolute inset-y-0 w-px"
                  key={i}
                  style={{ left: `${at * 100}%` }}
                />
              ))}
            </div>
            <ul className="flex flex-col gap-1">
              {tracks.map((track) => (
                <TrackRow key={track.id || track.name} span={end} track={track} />
              ))}
            </ul>
          </div>
        </div>
      )}
      <p className="text-muted-foreground shrink-0 text-[11px]">
        Только просмотр: аранжировку правят в DAW.
      </p>
    </section>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      {children}
    </div>
  );
}

function TrackRow({ track, span }: { track: PlaylistTrack; span: number }) {
  const color = track.part ? PARTS[track.part].color : null;
  const notes = track.clips.reduce(
    (sum, clip) => (clip.notes === null ? sum : sum === null ? clip.notes : sum + clip.notes),
    null as number | null,
  );
  return (
    <li className="flex items-center gap-2">
      <span
        className="text-muted-foreground flex w-28 min-w-0 shrink-0 items-center gap-1.5 font-mono text-[11px]"
        title={[track.name, track.kind, track.instrument].filter(Boolean).join(" · ")}
      >
        {track.part ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: PARTS[track.part].color }}
          />
        ) : null}
        <span className={cn("truncate", track.part ? "text-card-foreground" : "")}>
          {track.name}
        </span>
      </span>
      <span className="bg-foreground/6 relative h-6 min-w-0 flex-1 rounded">
        {track.clips.length === 0 ? (
          <span className="text-muted-foreground absolute inset-0 flex items-center px-2 text-[10px]">
            без клипов
          </span>
        ) : (
          track.clips.map((clip, i) => {
            const { left, width } = clipSpan(clip, span);
            const from = fmt(clip.start / SESSION_SAMPLE_RATE);
            const to = fmt(clip.end / SESSION_SAMPLE_RATE);
            return (
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-1 rounded-sm border",
                  !color && "opacity-60",
                )}
                key={i}
                style={{
                  left: `${left * 100}%`,
                  width: `${width * 100}%`,
                  ...(color
                    ? {
                        background: `color-mix(in oklab, ${color} 55%, transparent)`,
                        borderColor: color,
                      }
                    : undefined),
                }}
                title={`клип ${from}–${to} с${clip.notes !== null ? ` · ${clip.notes} нот` : ""}`}
              />
            );
          })
        )}
      </span>
      <span className="text-muted-foreground w-20 shrink-0 text-right font-mono text-[10px]">
        {plural(track.clips.length, "клип", "клипа", "клипов")}
        {notes !== null ? ` · ${notes}` : ""}
      </span>
    </li>
  );
}
