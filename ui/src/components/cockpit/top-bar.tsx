/**
 * TopBar (спека §4): точка engine (up зелёная / waking пульс / down красная,
 * клик → S0), сессия (C6 session_name), BPM + key из get_bus_state,
 * транспорт — read-only с подсказкой (T1: хост — движок).
 */
import { useState } from "react";
import { Pause, Play, Square } from "lucide-react";

import { useCockpit } from "@/store/cockpit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
      <span className="text-muted-foreground font-mono text-xs">
        {busState?.session_name ? `сессия: ${busState.session_name}` : "сессия: —"}
      </span>
      <span className="text-card-foreground font-mono text-xs">
        {busState ? `${Math.round(busState.tempo)} BPM · ${busState.key_marker}` : "— BPM · —"}
      </span>

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
