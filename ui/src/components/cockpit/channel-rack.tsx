/**
 * S3 · Channel Rack (StagingPanel, спека §1/S3): 3 генератора = 3 канала +
 * Source Loop как четвёртый, 🔒 референс. Темп и тональность каналов —
 * сессия движка, пока она их не приняла — Loop X-Ray. «Принять всё готовое»
 * — единственная кнопка панели, меняющая DAW-сессию сразу для всех каналов.
 */
import { Download } from "lucide-react";
import type { PartId } from "@/types/contract";
import { useCockpit } from "@/store/cockpit";
import { PART_ORDER, describeContext } from "@/lib/parts";
import { Button } from "@/components/ui/button";
import { PartChannel } from "@/components/cockpit/part-channel";
import { SourceLoopCard } from "@/components/cockpit/source-loop-card";

export function ChannelRack() {
  const { musicContext, rackFocusAt, acceptAllReady, channels } = useCockpit();

  const ready = PART_ORDER.filter((part: PartId) => {
    const last = channels[part].versions.at(-1);
    return last !== undefined && !last.decision;
  }).length;
  const context = musicContext
    ? `${describeContext(musicContext)} · ${musicContext.source === "session" ? "сессия" : "X-Ray"}`
    : "— BPM";

  return (
    <section aria-label="Channel Rack" className="bg-card relative flex min-h-0 flex-col rounded-2xl border p-3">
      {/* навигация из Loop X-Ray («→ Сгенерировать партии»): короткая обводка Rack */}
      {rackFocusAt !== 0 ? (
        <span
          aria-hidden
          className="animate-rack-focus pointer-events-none absolute inset-0 rounded-2xl motion-reduce:hidden"
          key={rackFocusAt}
        />
      ) : null}
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-card-foreground text-sm font-semibold">Channel Rack</h2>
        <span
          className="text-muted-foreground truncate font-mono text-[11px]"
          title={
            musicContext?.source === "session"
              ? "Темп и тональность — из сессии движка (источник истины)"
              : "Темп и тональность — из Loop X-Ray: сессия их ещё не приняла"
          }
        >
          {context}
        </span>
      </header>
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden">
        {PART_ORDER.map((part) => (
          <PartChannel key={part} part={part} />
        ))}
        <SourceLoopCard />
      </div>
      <Button
        className="mt-2 w-full"
        disabled={ready === 0}
        onClick={() => void acceptAllReady()}
        size="sm"
        title={
          ready === 0
            ? "Нечего принимать: актуальные версии либо не созданы, либо уже решены"
            : "По одному accept_part на каждый канал с нерешённой версией"
        }
        variant="secondary"
      >
        <Download />
        Принять всё готовое{ready > 0 ? ` (${ready})` : ""}
      </Button>
    </section>
  );
}
