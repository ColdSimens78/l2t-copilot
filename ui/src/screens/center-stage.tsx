/**
 * Центр окна после Loop X-Ray. Экраны S4 (призраки в Piano Roll) и S5
 * (Playlist) — отдельная работа; пока центр делает то, что спека требует уже
 * сейчас: показывает empty-состояние S4 с указанием на Rack, перечисляет
 * слои и принимает другой луп (дроп мимо зон окна считается дропом лупа).
 */
import { useCallback, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import type { PartId } from "@/types/contract";
import { useCockpit } from "@/store/cockpit";
import { displayedVersion, type ChannelVersion } from "@/store/channels";
import { PARTS, PART_ORDER } from "@/lib/parts";
import { plural } from "@/lib/format";
import { resolveDropPath, useFileDrop, type DroppedFile } from "@/lib/use-file-drop";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CenterStage() {
  const { analyzeLoop, channels, requestRackFocus } = useCockpit();
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

  const layers = PART_ORDER.flatMap((part: PartId) => {
    const version = displayedVersion(channels[part]);
    return version ? [{ part, version }] : [];
  });

  return (
    <section
      {...html5}
      aria-label="Слои"
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center transition-colors",
        dragOver && "bg-primary/10",
      )}
      ref={ref}
    >
      <h2 className="text-card-foreground text-sm font-semibold">Слои поверх лупа</h2>
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
        Наложение нот в Piano Roll и Playlist — следующие экраны; ноты партий пока видны в
        мини-превью каналов.
      </p>
      <Button onClick={requestRackFocus} size="sm" variant="ghost">
        <ArrowLeft />
        к Channel Rack
      </Button>
      <p className="text-muted-foreground/70 text-[11px]">Другой луп — перетащи сюда</p>
    </section>
  );
}

function Decision({ version }: { version: ChannelVersion }) {
  if (version.decision === "accepted") {
    return <span className="text-success text-xs">в сессии{version.tracks ? ` · ${version.tracks}` : ""}</span>;
  }
  if (version.decision === "rejected") return <span className="text-muted-foreground text-xs">отклонено</span>;
  return null;
}
