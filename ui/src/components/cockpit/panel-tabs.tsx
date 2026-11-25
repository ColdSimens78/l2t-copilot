/**
 * Вкладки зоны: AI Panel (Loop X-Ray / Self-Check), центр (Слои / Playlist).
 * Роль tablist с клавиатурой: ← → переносят выбор по кругу, Home и End —
 * к краям; панель связывается с вкладкой через tabPanelProps (lib/tab-panel).
 */
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PanelTab<ID extends string> {
  id: ID;
  label: string;
  /** Метка при вкладке: число, лампа статуса. */
  badge?: ReactNode;
}

export function PanelTabs<ID extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
}: {
  /** Имя группы для скринридера. */
  label: string;
  tabs: PanelTab<ID>[];
  value: ID;
  onChange: (id: ID) => void;
  /** Префикс id: связывает вкладку с панелью (aria-controls / aria-labelledby). */
  idPrefix: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((tab) => tab.id === value);
    let next = at;
    if (event.key === "ArrowRight") next = (at + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onChange(tabs[next].id);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };

  return (
    <div aria-label={label} className="bg-muted/50 flex shrink-0 rounded-lg p-0.5" onKeyDown={onKeyDown} role="tablist">
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            aria-controls={`${idPrefix}-${tab.id}`}
            aria-selected={selected}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none",
              "focus-visible:ring-ring/50 focus-visible:ring-2",
              selected
                ? "bg-card text-card-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            id={`${idPrefix}-tab-${tab.id}`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            <span className="truncate">{tab.label}</span>
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}
