/**
 * ParamChips — параметры генератора как чипы (спека S3, словарь midi-gen v3):
 * чип = аргумент MCP-инструмента, и наоборот. Выбор значения = сразу
 * регенерация с diff (клик по чипу — команда, а не редактор). Чипы
 * показывают параметры той версии, что на карточке; key и bpm — не чипы:
 * их даёт сессия (правило 4 шины).
 */
import { ChevronDown } from "lucide-react";
import type { PartId } from "@/types/contract";
import { PARTS, type ChipValues } from "@/lib/parts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const CHIP =
  "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50";

export function ParamChips({
  part,
  chips,
  disabled,
  onChange,
}: {
  part: PartId;
  chips: ChipValues;
  /** Канал генерирует — чипы выключены, чтобы не послать вторую команду. */
  disabled: boolean;
  onChange: (key: string, value: string | number | boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PARTS[part].chips.map((chip) => {
        const current = chips[chip.key];
        if (chip.kind === "enum") {
          const active = chip.values.find((v) => v.value === current);
          return (
            <DropdownMenu key={chip.key}>
              <DropdownMenuTrigger
                className={cn(CHIP, "border-border text-card-foreground hover:bg-muted")}
                disabled={disabled}
                title={active?.hint}
              >
                <span className="text-muted-foreground">{chip.caption}</span>
                {active?.label ?? String(current)}
                <ChevronDown className="size-3 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-44">
                {chip.values.map((v) => (
                  <DropdownMenuItem
                    key={String(v.value)}
                    onClick={() => {
                      if (v.value !== current) onChange(chip.key, v.value);
                    }}
                    title={v.hint}
                  >
                    <span className="w-3 text-success">{v.value === current ? "✓" : ""}</span>
                    {v.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }
        const usable = chip.enabledWhen?.(chips) ?? true;
        const on = Boolean(current);
        return (
          <button
            aria-pressed={on}
            className={cn(
              CHIP,
              on
                ? "border-primary bg-primary/20 text-card-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
            disabled={disabled || !usable}
            key={chip.key}
            onClick={() => onChange(chip.key, !on)}
            title={usable ? chip.hint : chip.disabledHint}
            type="button"
          >
            {chip.label}
          </button>
        );
      })}
      {PARTS[part].fixed ? (
        <span className="text-muted-foreground px-1 text-xs" title={PARTS[part].fixed.hint}>
          {PARTS[part].fixed.label}
        </span>
      ) : null}
    </div>
  );
}
