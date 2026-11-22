/**
 * Карточка канала-генератора (стейджинг, proposal §4.2): один канал
 * Channel Rack = один MCP-инструмент midi-gen. Реальные ноты канала плюс
 * призрачный слой — предложение контракта suggestion с rationale,
 * confidence и source_tool. Accept = материализация призраков в канал
 * (мок: до Tauri-IPC просто перенос нот), Reject = отказ с записью в
 * manifest-лог (Acceptance Rate, PRD §4).
 */
import { useState } from "react";
import { Check, Eye, EyeOff, Music, X } from "lucide-react";

import {
  PianoRoll,
  PianoRollKeys,
  PianoRollStrip,
  PianoRollViewport,
} from "@/components/audio-ui/piano-roll";
import { Timeline } from "@/components/audio-ui/timeline";
import { GhostPianoRollGrid } from "@/components/cockpit/ghost-piano-roll-grid";
import type { AcceptanceEvent, MidiNote, PartId, Suggestion } from "@/contract/suggestion";
import { ghostNotes, realNotes, UNITS_PER_BAR } from "@/lib/piano-roll-notes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface ChannelCardProps {
  part: PartId;
  title: string;
  /** Реальные ноты канала, формат midi_io (тики). */
  notes: MidiNote[];
  /** Предложение поверх канала (призрачный слой). */
  suggestion: Suggestion;
  /** Число тактов ролла. */
  bars?: number;
  maxPitch: number;
  minPitch: number;
  onDecision: (event: AcceptanceEvent) => void;
}

export function ChannelCard({
  part,
  title,
  notes,
  suggestion,
  bars = 4,
  maxPitch,
  minPitch,
  onDecision,
}: ChannelCardProps) {
  const [real, setReal] = useState(() => realNotes(notes));
  const [ghost, setGhost] = useState(() => ghostNotes(suggestion));
  const [ghostVisible, setGhostVisible] = useState(true);
  const [decision, setDecision] = useState<"accepted" | "rejected" | null>(null);

  const decide = (what: "accepted" | "rejected") => {
    if (decision) return;
    setDecision(what);
    if (what === "accepted") {
      // Материализация (§3.3): призраки становятся нотами канала…
      setReal((current) => [
        ...current,
        ...ghost.map((note, i) => ({ ...note, id: `m${i}` })),
      ]);
    }
    setGhost([]);
    onDecision({
      ts: Date.now(),
      part,
      source_tool: suggestion.source_tool,
      decision: what,
      mode: "manual",
      params: suggestion.params,
    });
  };

  return (
    <section className="bg-card border-card-foreground/10 flex flex-col gap-2 rounded-2xl border p-3">
      <header className="flex flex-wrap items-center gap-2">
        <Music aria-hidden className="text-muted-foreground size-4" />
        <h2 className="text-card-foreground text-sm font-semibold">{title}</h2>
        <Badge
          className={
            decision === "accepted"
              ? "border-success/40 text-success"
              : decision === "rejected"
                ? "text-muted-foreground"
                : ""
          }
          variant="outline"
        >
          {decision === "accepted"
            ? "✓ принято"
            : decision === "rejected"
              ? "✕ отклонено"
              : ghostVisible
                ? "⏳ предложение"
                : "нет предложения"}
        </Badge>
        <span className="text-muted-foreground ml-auto font-mono text-[10px]">
          {suggestion.source_tool}
        </span>
      </header>

      <Timeline duration={bars * UNITS_PER_BAR} snapStep={1}>
        <PianoRoll
          className="h-44 border"
          maxPitch={maxPitch}
          minPitch={minPitch}
          value={[...real, ...(ghostVisible ? ghost : [])]}
        >
          <PianoRollViewport>
            <PianoRollStrip className="flex-1" lead={<PianoRollKeys />}>
              <GhostPianoRollGrid accentStep={4} aria-label={`${title} notes`} gridStep={1} />
            </PianoRollStrip>
          </PianoRollViewport>
        </PianoRoll>
      </Timeline>

      {!decision && ghost.length > 0 ? (
        <footer className="flex flex-wrap items-center gap-2 text-xs">
          <Button
            aria-label={ghostVisible ? "Скрыть призрачный слой" : "Показать призрачный слой"}
            onClick={() => setGhostVisible((v) => !v)}
            size="icon-xs"
            variant="ghost"
          >
            {ghostVisible ? <EyeOff /> : <Eye />}
          </Button>
          <p className="text-card-foreground/80 min-w-0 flex-1">
            <span
              className={cn(
                "mr-1 font-mono",
                suggestion.confidence >= 0.7 ? "text-success" : "text-warning",
              )}
            >
              conf {suggestion.confidence.toFixed(2)}
            </span>
            {suggestion.rationale}
          </p>
          <Button onClick={() => decide("accepted")} size="xs" variant="outline">
            <Check /> Принять
          </Button>
          <Button onClick={() => decide("rejected")} size="xs" variant="ghost">
            <X /> Отклонить
          </Button>
        </footer>
      ) : (
        <footer className="text-muted-foreground text-xs">
          {decision === "accepted"
            ? "Призраки материализованы в канал → импорт в DAW сделает Rust-ядро (daw.import_midi)."
            : decision === "rejected"
              ? "Отклонено; версия осталась в manifest-истории."
              : null}
        </footer>
      )}
    </section>
  );
}
