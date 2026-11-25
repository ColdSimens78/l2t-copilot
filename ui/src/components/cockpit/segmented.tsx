/**
 * Сегментный выбор — компактная группа взаимоисключающих вариантов: гипотеза
 * темпа в Loop X-Ray, цель громкости экспорта. Роль radiogroup: выбранное
 * состояние читается скринридером, смена — кнопкой.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T> {
  value: T;
  label: ReactNode;
  title?: string;
}

export function Segmented<T>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div aria-label={label} className={cn("bg-muted/50 flex rounded-lg p-0.5", className)} role="radiogroup">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            aria-checked={checked}
            className={cn(
              "min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-xs transition-colors outline-none",
              "focus-visible:ring-ring/50 focus-visible:ring-2",
              checked
                ? "bg-card text-card-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            disabled={disabled}
            key={String(option.value)}
            onClick={() => {
              if (!checked) onChange(option.value);
            }}
            role="radio"
            title={option.title}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
