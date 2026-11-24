/**
 * VersionHistory — история версий партии (спека S3, §5.2 proposal): история
 * не удаляется регенерацией. Клик по версии показывает её на карточке, ещё
 * один клик — возвращает к последней. Марки решений — сырье Acceptance Rate:
 * ✓ принято / ✕ отклонено / ◀ прослушано.
 */
import type { ChannelVersion } from "@/store/channels";
import { cn } from "@/lib/utils";

export function VersionHistory({
  versions,
  active,
  pinned,
  onSelect,
}: {
  versions: ChannelVersion[];
  /** Версия на карточке. */
  active: number;
  /** Выбрана прошлая версия (иначе на карточке последняя). */
  pinned: boolean;
  onSelect: (version: number | null) => void;
}) {
  if (versions.length < 2) return null;
  return (
    <div aria-label="История версий" className="flex flex-wrap items-center gap-1">
      <span className="text-muted-foreground mr-0.5 text-[10px] tracking-wider uppercase">
        история
      </span>
      {versions.map((v) => {
        const n = v.suggestion.version;
        const isActive = active === n;
        const mark =
          v.decision === "accepted" ? " ✓" : v.decision === "rejected" ? " ✕" : v.auditioned ? " ◀" : "";
        const state =
          v.decision === "accepted"
            ? "принято"
            : v.decision === "rejected"
              ? "отклонено"
              : v.auditioned
                ? "прослушано"
                : "не прослушано";
        return (
          <button
            aria-current={isActive ? "true" : undefined}
            aria-pressed={isActive && pinned}
            className={cn(
              "rounded-full border px-1.5 font-mono text-[11px] leading-5 transition-colors",
              isActive && pinned
                ? "border-foreground bg-foreground text-background"
                : isActive
                  ? "border-foreground/40 text-card-foreground"
                  : "text-muted-foreground hover:bg-muted border-transparent",
              v.decision === "rejected" && "line-through",
            )}
            key={n}
            onClick={() => onSelect(isActive && pinned ? null : n)}
            title={`v${n} — ${state}`}
            type="button"
          >
            v{n}
            {mark}
          </button>
        );
      })}
    </div>
  );
}
