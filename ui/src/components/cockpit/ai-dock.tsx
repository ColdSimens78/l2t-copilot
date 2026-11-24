/**
 * AI Dock (спека §3): постоянная нижняя строка, единственное место «подожди».
 * pending виден только после 300 мс (трёхуровневая индикация USER FLOW);
 * дольше 10 с — честная подпись, история — в drawer. [отменить] v0 =
 * «отменить показ». Претендовать на фокус окна НЕ должен (Tauri #11814 —
 * проектируем без no-focus требований).
 */
import { useEffect, useState } from "react";

import { useCockpit } from "@/store/cockpit";
import { cn } from "@/lib/utils";

const PENDING_DELAY = 300;
const LONG_PENDING = 10_000;

export function AiDock() {
  const { dockPending, dockLine, dockBackground, dismissDock } = useCockpit();
  const [now, setNow] = useState(Date.now());

  // перерисовка раз в секунду: pending старше 10 с остаётся в dock до итога
  useEffect(() => {
    if (!dockPending && !dockLine) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [dockPending, dockLine]);

  const pendingVisible = dockPending !== null && now - dockPending.sinceTs >= PENDING_DELAY;
  const longPending = pendingVisible && now - dockPending!.sinceTs > LONG_PENDING;

  const icon = pendingVisible ? "pending" : (dockLine?.icon ?? null);
  const text = pendingVisible
    ? longPending
      ? `${dockPending!.tool}: ${dockPending!.command} — дольше 10 с; история в drawer`
      : dockPending!.text
    : (dockLine?.text ?? "ИИ: ожидание — ручной режим");
  const tone =
    icon === "ok" || icon === "inspect"
      ? "text-success"
      : icon === "timeout" || icon === "pending"
        ? "text-warning"
        : icon === "error"
          ? "text-destructive"
          : "text-card-foreground";

  return (
    <footer
      aria-live="polite"
      className="bg-card flex items-center gap-2 rounded-2xl border px-3 py-2 font-mono text-xs"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          pendingVisible ? "bg-warning animate-pulse" : icon === "ok" || icon === "inspect" ? "bg-success" : "bg-muted-foreground",
        )}
      />
      <span className={cn("min-w-0 flex-1 truncate", tone)} title={text}>
        {text}
      </span>
      {dockBackground > 0 ? (
        <span className="text-muted-foreground">фоновых: {dockBackground}</span>
      ) : null}
      {pendingVisible || dockLine ? (
        <button className="text-muted-foreground underline" onClick={dismissDock}>
          отменить показ
        </button>
      ) : null}
    </footer>
  );
}
