/**
 * Toast-хост ошибок (спека §0.6, каталог §6): каждый error-state несёт
 * причину текстом + одну главную кнопку-фикс. Число одновременно — до 3,
 * внизу справа; никогда не блокируют экран.
 */
import { useCockpit } from "@/store/cockpit";
import { Button } from "@/components/ui/button";

export function ToastHost() {
  const { toasts, dismissToast } = useCockpit();
  return (
    <div aria-live="assertive" className="fixed right-4 bottom-14 z-40 flex w-96 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          className="bg-popover text-popover-foreground border-destructive/40 rounded-xl border p-3 text-xs shadow-lg"
          key={toast.id}
          role="alert"
        >
          <p className="whitespace-pre-wrap">{toast.text}</p>
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
