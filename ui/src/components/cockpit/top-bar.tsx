/**
 * TopBar (спека §4): точка engine (up зелёная / waking пульс / down красная,
 * клик → S0), сессия (C6 session_name), BPM + key из get_bus_state
 * (null при спящем движке — примечание 6 контракта), транспорт — read-only
 * с подсказкой (T1: хост — движок).
 */
import { useState } from "react";
import { Pause, Play, Square } from "lucide-react";

import { adapterMode } from "@/ipc/api";
import { useCockpit } from "@/store/cockpit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** «Key: E minor» → «E minor»; всё, что не по конвенции, показываем как есть. */
function markerLabel(marker: string): string {
  return marker.replace(/^Key:\s*/, "");
}

export function TopBar() {
  const { hostStatus, busState, setDrawerOpen, drawerOpen } = useCockpit();
  const [transportHint, setTransportHint] = useState(false);

  const dot =
    hostStatus === "up"
      ? "bg-success"
      : hostStatus === "waking"
        ? "bg-warning animate-pulse"
        : "bg-destructive";
  const engineLabel =
    hostStatus === "up" ? "движок" : hostStatus === "waking" ? "движок: прогрев" : "движок: спит";
  const session = busState?.session_name;
  const tempo = busState?.tempo != null ? `${Math.round(busState.tempo)} BPM` : "— BPM";
  const key = busState?.key_marker ? markerLabel(busState.key_marker) : "—";

  return (
    <header className="bg-card flex items-center gap-3 rounded-2xl border px-3 py-2">
      <button
        aria-label={`${engineLabel} — открыть экран пробуждения`}
        className="flex items-center gap-2 text-sm"
        title={engineLabel}
      >
        <span aria-hidden className={cn("size-2.5 rounded-full", dot)} />
        <span className="text-card-foreground">{engineLabel}</span>
      </button>
      <span className="text-muted-foreground max-w-40 truncate font-mono text-xs" title={session ?? undefined}>
        {session ? `сессия: ${session}` : "сессия: —"}
      </span>
      <span className="text-card-foreground font-mono text-xs">
        {tempo} · {key}
      </span>
      {adapterMode === "mock" ? (
        <Badge className="text-muted-foreground" title="Браузер работает на симуляции ядра; живое ядро — в окне приложения" variant="outline">
          демо
        </Badge>
      ) : null}

      <div className="relative ml-auto flex items-center gap-1">
        <Button
          aria-label="Play — управляет SoundCraft"
          onClick={() => setTransportHint(true)}
          size="icon-sm"
          variant="ghost"
        >
          <Play />
        </Button>
        <Button
          aria-label="Pause — управляет SoundCraft"
          onClick={() => setTransportHint(true)}
          size="icon-sm"
          variant="ghost"
        >
          <Pause />
        </Button>
        <Button
          aria-label="Stop — управляет SoundCraft"
          onClick={() => setTransportHint(true)}
          size="icon-sm"
          variant="ghost"
        >
          <Square />
        </Button>
        {transportHint ? (
          <div
            className="bg-popover text-popover-foreground border-border absolute top-full right-0 z-30 mt-1 w-64 rounded-lg border p-2 text-xs shadow-lg"
            role="status"
          >
            Управляй транспортом в SoundCraft — хост остаётся движком
            (предложение §3.2). Кнопки транспорта — кандидат в контракт v1 (T1).
            <button
              className="text-primary ml-2 underline"
              onClick={() => setTransportHint(false)}
            >
              понял
            </button>
          </div>
        ) : null}
      </div>

      <Button
        aria-expanded={drawerOpen}
        aria-label="Инспектор шины"
        onClick={() => setDrawerOpen(!drawerOpen)}
        size="sm"
        variant={drawerOpen ? "secondary" : "outline"}
      >
        ▤ шина
      </Button>
    </header>
  );
}
