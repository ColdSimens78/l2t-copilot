/**
 * Центр окна после Loop X-Ray: тумблер [Слои] [Playlist]. Слои (S4) — что
 * предложено в Rack; Playlist (S5) — что уже лежит в сессии движка. Сам центр
 * остаётся зоной приёма другого лупа: дроп мимо зон окна считается дропом лупа.
 * Наложение призрачных нот в Piano Roll — отдельная работа.
 */
import { useCallback, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { PartId } from "@/types/contract";
import { useCockpit } from "@/store/cockpit";
import { displayedVersion, type ChannelVersion } from "@/store/channels";
import { PARTS, PART_ORDER } from "@/lib/parts";
import { plural } from "@/lib/format";
import { resolveDropPath, useFileDrop, type DroppedFile } from "@/lib/use-file-drop";
import { tabPanelProps } from "@/lib/tab-panel";
import { PanelTabs } from "@/components/cockpit/panel-tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PlaylistView } from "@/screens/playlist";

type CenterView = "layers" | "playlist";

export function CenterStage() {
  const { analyzeLoop, busState } = useCockpit();
  const [view, setView] = useState<CenterView>("layers");
  const ref = useRef<HTMLElement>(null);

  const onDrop = useCallback(
    (file: DroppedFile) => {
      const path = resolveDropPath(file);
      if (path) void analyzeLoop(path);
    },
    [analyzeLoop],
  );
  // fallback: дроп мимо всех зон окна — это новый луп
  const { dragOver, html5 } = useFileDrop(ref, onDrop, { fallback: true });
  const trackCount = busState?.tracks?.length ?? 0;

  return (
    <section
      {...html5}
      aria-label="Центр"
      className={cn(
        "relative flex min-h-0 flex-1 flex-col gap-2 p-2 transition-colors",
        dragOver && "bg-primary/10",
      )}
      ref={ref}
    >
      <PanelTabs
        idPrefix="center"
        label="Центр"
        onChange={setView}
        tabs={[
          { id: "layers", label: "Слои" },
          {
            id: "playlist",
            label: "Playlist",
            badge:
              trackCount > 0 ? (
                <span className="bg-muted-foreground/30 rounded-full px-1.5 font-mono text-[10px] leading-4 text-card-foreground">
                  {trackCount}
                </span>
              ) : null,
          },
        ]}
        value={view}
      />
      <div {...tabPanelProps("center", view)} className="flex min-h-0 flex-1 flex-col">
        {view === "layers" ? <LayersStage /> : <PlaylistView />}
      </div>
      {dragOver ? (
        <div
          aria-hidden
          className="bg-background/85 text-card-foreground pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm"
        >
          Отпусти — разберу как новый луп
        </div>
      ) : null}
    </section>
  );
}

function LayersStage() {
  const { channels, requestRackFocus } = useCockpit();

  const layers = PART_ORDER.flatMap((part: PartId) => {
    const version = displayedVersion(channels[part]);
    return version ? [{ part, version }] : [];
  });

  return (
    <section
      aria-label="Слои"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <h3 className="text-card-foreground text-sm font-semibold">Слои поверх лупа</h3>
      {layers.length === 0 ? (
        <p className="text-muted-foreground text-sm">Нет предложений — сгенерируй в Rack</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {layers.map(({ part, version }) => (
            <li
              className="text-card-foreground flex items-center gap-2 text-sm"
              key={`${part}:${version.suggestion.version}`}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: PARTS[part].color }}
              />
              {PARTS[part].label}
              <span className="text-muted-foreground font-mono text-xs">
                v{version.suggestion.version} · {plural(version.suggestion.notes.length, "нота", "ноты", "нот")}
              </span>
              <Decision version={version} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">
        Наложение призрачных нот в Piano Roll — следующий экран; ноты партий пока
        видны в мини-превью каналов.
      </p>
      <Button onClick={requestRackFocus} size="sm" variant="ghost">
        <ArrowLeft />
        к Channel Rack
      </Button>
      <p className="text-muted-foreground/70 text-[11px]">Другой луп — перетащи в центр окна</p>
    </section>
  );
}

function Decision({ version }: { version: ChannelVersion }) {
  if (version.decision === "accepted") {
    return <span className="text-success text-xs">в сессии{version.tracks?.length ? ` · ${version.tracks.join(", ")}` : ""}</span>;
  }
  if (version.decision === "rejected") return <span className="text-muted-foreground text-xs">отклонено</span>;
  return null;
}
