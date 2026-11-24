/**
 * SuggestionActions — жесты канала [▶] [↻] [✓] [✕] (спека S3). Выключенная
 * кнопка говорит причину в подсказке, а не «недоступно»: ▶ — играет только
 * отрендеренный WAV (никакого DSP в UI), ✓/✕ — только для актуальной версии.
 */
import type { ReactNode } from "react";
import { Check, Play, RotateCw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChannelAction {
  enabled: boolean;
  title: string;
  run: () => void;
}

export function SuggestionActions({
  busy,
  playing,
  play,
  regenerate,
  accept,
  reject,
}: {
  busy: boolean;
  /** Играет превью этой версии — кнопка [▶] становится [■]. */
  playing: boolean;
  play: ChannelAction;
  regenerate: ChannelAction;
  accept: ChannelAction;
  reject: ChannelAction;
}) {
  // подсказка висит на обёртке: у выключенной кнопки она тоже видна
  const icon = (action: ChannelAction, glyph: ReactNode, label: string, pressed = false) => (
    <span className="inline-flex" title={action.title}>
      <Button
        aria-label={label}
        aria-pressed={pressed || undefined}
        className={cn(pressed && "border-primary bg-primary/20")}
        disabled={busy || !action.enabled}
        onClick={action.run}
        size="icon-xs"
        variant="outline"
      >
        {glyph}
      </Button>
    </span>
  );
  return (
    <div className="flex items-center gap-1">
      {icon(
        play,
        playing ? <Square /> : <Play />,
        playing ? "Остановить превью" : "Прослушать превью",
        playing,
      )}
      {icon(regenerate, <RotateCw />, "Перегенерировать")}
      {icon(accept, <Check className="text-success" />, "Принять в сессию")}
      {icon(reject, <X className="text-destructive" />, "Отклонить")}
    </div>
  );
}
