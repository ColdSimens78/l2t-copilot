/**
 * Toast-хост (спека §0.6, каталог §6): каждая ошибка — причина текстом + одна
 * главная кнопка-фикс, если ей есть чем чинить; ошибки остаются до закрытия.
 * Подтверждения (принято в сессию) — тем же каналом в зелёном тоне и уходят
 * сами. Одновременно до 3, внизу по центру — над центром окна, а не над
 * кнопками боковых панелей; никогда не блокируют экран.
 */
import { useEffect } from "react";
import { useCockpit } from "@/store/cockpit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const OK_TTL_MS = 5000;

export function ToastHost() {
  const { toasts, dismissToast } = useCockpit();

  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.tone === "ok")
      .map((toast) => window.setTimeout(() => dismissToast(toast.id), OK_TTL_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [toasts, dismissToast]);

  return (
    <div
      aria-live="assertive"
      className="fixed bottom-14 left-1/2 z-40 flex w-96 -translate-x-1/2 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          className={cn(
            "bg-popover text-popover-foreground rounded-xl border p-3 text-xs shadow-lg",
            toast.tone === "ok" ? "border-success/40" : "border-destructive/40",
          )}
          key={toast.id}
          role={toast.tone === "ok" ? "status" : "alert"}
        >
          <p className="whitespace-pre-wrap break-words">{toast.text}</p>
          <div className="mt-2 flex gap-2">
            {toast.fix ? (
              <Button
                onClick={() => {
                  toast.fix?.();
                  dismissToast(toast.id);
                }}
                size="xs"
                variant="outline"
              >
                {toast.fixLabel ?? "Починить за меня"}
              </Button>
            ) : null}
            <Button onClick={() => dismissToast(toast.id)} size="xs" variant="ghost">
              закрыть
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
