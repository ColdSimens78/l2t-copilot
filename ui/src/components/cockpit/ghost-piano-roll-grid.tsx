/**
 * Сетка piano-roll с призрачным слоем — копия audio-ui PianoRollGrid (MIT,
 * Ouest Labs) с расширением: ноты с id «ghost:*» рендерятся полупрозрачным
 * пунктиром и без ручек правки — предложение партии read-only до accept
 * (proposal §3.1, §5.1). Реальные ноты рисуются как в оригинале.
 */
import { cva } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { gridLines } from "@/components/audio-ui/piano-roll";
import { PianoRoll as PianoRollPrimitive } from "@/components/audio-ui/piano-roll/react";
import type { Note as NoteValue } from "@/components/audio-ui/piano-roll/edits";
import { isGhost } from "@/lib/piano-roll-notes";
import { cn } from "@/lib/utils";

const pianoRollVariants = cva("", {
  defaultVariants: {
    size: "default",
  },
  variants: {
    size: {
      default: "min-h-[calc(var(--piano-roll-rows)*0.75rem)]",
      lg: "min-h-[calc(var(--piano-roll-rows)*1rem)]",
      sm: "min-h-[calc(var(--piano-roll-rows)*0.5rem)]",
    },
  },
});

type GhostPianoRollGridProps = ComponentProps<typeof PianoRollPrimitive.Grid> & {
  /** Расстояние между линиями, в единицах таймлайна (у нас 16-я = 1). */
  gridStep?: number;
  /** Акцентная линия каждые N единиц (четверть = 4). */
  accentStep?: number;
  /** Высота ряда: sm 0.5rem, default 0.75rem, lg 1rem. */
  size?: "default" | "lg" | "sm";
  children?: ReactNode;
};

export function GhostPianoRollGrid({
  accentStep,
  children,
  className,
  gridStep,
  size,
  style,
  ...props
}: GhostPianoRollGridProps) {
  return (
    <PianoRollPrimitive.Grid
      className={cn(
        "focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 flex-1 touch-none select-none outline-none",
        pianoRollVariants({ size }),
        className
      )}
      data-slot="piano-roll-grid"
      style={{ ...gridLines(gridStep, accentStep), ...style }}
      {...props}
    >
      <PianoRollPrimitive.Rows>
        {(pitch) => (
          <PianoRollPrimitive.Row
            className="data-[color=black]:bg-foreground/13 data-folded:border-t data-folded:border-foreground/25 data-octave:border-t data-octave:border-foreground/25 data-active:bg-primary/10 data-out-of-scale:bg-foreground/13 data-in-scale:data-[color=black]:bg-transparent"
            key={pitch}
            pitch={pitch}
          />
        )}
      </PianoRollPrimitive.Rows>
      <PianoRollPrimitive.Notes>
        {(note: NoteValue) =>
          isGhost(note) ? (
            <PianoRollPrimitive.Note
              className="rounded-[min(var(--radius-sm),3px)] pointer-events-none border border-dashed border-primary/70 bg-primary/25 opacity-60"
              key={note.id}
              note={note}
            />
          ) : (
            <PianoRollPrimitive.Note
              className="rounded-[min(var(--radius-sm),3px)] transition-[border-color,background-color] duration-100 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:pointer-events-none motion-reduce:transition-none cursor-grab touch-none select-none border border-primary bg-[color-mix(in_oklab,var(--primary)_calc(30%_+_var(--piano-roll-velocity)_*_60%),transparent)] opacity-[calc(0.4+var(--piano-roll-chance)*0.6)] outline-none active:cursor-grabbing data-muted:border-muted-foreground data-muted:bg-muted data-[selected]:border-foreground data-[selected]:bg-primary data-[selected]:ring-1 data-[selected]:ring-foreground data-muted:data-[selected]:bg-muted-foreground/40"
              key={note.id}
              note={note}
            >
              <PianoRollPrimitive.NoteHandle
                className="transition-colors hover:bg-foreground/30 motion-reduce:transition-none absolute inset-y-0 w-[min(0.375rem,25%)] cursor-ew-resize data-[edge=end]:right-0 data-[edge=start]:left-0"
                edge="start"
                note={note}
              />
              <PianoRollPrimitive.NoteHandle
                className="transition-colors hover:bg-foreground/30 motion-reduce:transition-none absolute inset-y-0 w-[min(0.375rem,25%)] cursor-ew-resize data-[edge=end]:right-0 data-[edge=start]:left-0"
                edge="end"
                note={note}
              />
            </PianoRollPrimitive.Note>
          )
        }
      </PianoRollPrimitive.Notes>
      {children}
    </PianoRollPrimitive.Grid>
  );
}
