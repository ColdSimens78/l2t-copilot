/**
 * Toast-хост (спека §0.6, каталог §6): каждая ошибка — причина текстом + одна
 * главная кнопка-фикс, если ей есть чем чинить. Подтверждения (принято в
 * сессию) — тем же канналом в зелёном тоне. Одновременно до 3, внизу справа;
 * никогда не блокируют экран.
 */
import { useCockpit } from "@/store/cockpit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ToastHost() {
  const { toasts, dismissToast } = useCockpit();
  return (
    <div aria-live="assertive" className="fixed right-4 bottom-14 z-40 flex w-96 flex-col gap-2">
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
