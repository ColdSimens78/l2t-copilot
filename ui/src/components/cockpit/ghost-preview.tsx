/**
 * GhostPreview — мини-превью нот партии (proposal §4.5, паттерн GhostLayer).
 * Формат midi_io без изменений: тики → доля ширины, строки — высоты партии
 * (у бита это lanes бочка/снейра/хэта). Цвет закреплён за каналом и тот же
 * в Piano Roll. Ноты read-only: правка — только в SoundCraft после accept.
 */
import { useMemo } from "react";
import type { Note } from "@/types/contract";
import { TICKS_PER_BAR, previewShape } from "@/lib/piano-roll-notes";
import { cn } from "@/lib/utils";

const MIN_NOTE_PX = 3;

export function GhostPreview({
  notes,
  color,
  className,
}: {
  notes: Note[];
  /** Цвет канала (PARTS[part].color). */
  color: string;
  className?: string;
}) {
  const shape = useMemo(() => previewShape(notes), [notes]);
  if (!shape) {
    return <div aria-hidden className={cn("h-10 rounded-lg bg-muted/40", className)} />;
  }
  const rows = shape.maxPitch - shape.minPitch + 1;
  const rowHeight = 100 / rows;
  const total = shape.bars * TICKS_PER_BAR;
  return (
    <div
      aria-hidden
      className={cn(
        "bg-muted/40 relative h-10 overflow-hidden rounded-lg",
        "animate-in fade-in slide-in-from-bottom-2 duration-500",
        className,
      )}
    >
      {Array.from({ length: shape.bars - 1 }, (_, i) => (
        <span
          className="bg-border absolute inset-y-0 w-px"
          key={i}
          style={{ left: `${((i + 1) / shape.bars) * 100}%` }}
        />
      ))}
      {notes.map((n, i) => {
        const top = (shape.maxPitch - n.note) * rowHeight;
        return (
          <span
            className="absolute rounded-[2px]"
            key={i}
            style={{
              left: `${(n.start / total) * 100}%`,
              width: `max(${MIN_NOTE_PX}px, ${((n.end - n.start) / total) * 100}%)`,
              top: `calc(${top}% + 1px)`,
              height: `max(1px, calc(${rowHeight}% - 2px))`,
              background: color,
              opacity: 0.55 + 0.45 * (n.velocity / 127),
            }}
          />
        );
      })}
    </div>
  );
}
