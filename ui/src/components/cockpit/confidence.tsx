/**
 * Уверенность — гражданин первого класса (proposal §4.1): доля 0..1 с полосой.
 * Ниже порога значение приглушено и жёлтое — низкую уверенность объясняют
 * человеком, а не цитируют (урок PoC: рубато-темп, одиночный бас).
 */
import { LOW_CONFIDENCE } from "@/lib/xray";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Confidence({
  value,
  className,
  title,
}: {
  value: number;
  className?: string;
  /** Чем объяснить значение; по умолчанию — «уверенность N%». */
  title?: string;
}) {
  const low = value < LOW_CONFIDENCE;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[11px]",
        low ? "text-warning" : "text-muted-foreground",
        className,
      )}
      title={`${title ?? `уверенность ${pct(value)}`}${low ? " — низкая, проверь вручную" : ""}`}
    >
      <span aria-hidden className="bg-foreground/15 h-1 w-12 overflow-hidden rounded-full">
        <span className="bg-current block h-full rounded-full" style={{ width: pct(Math.min(1, Math.max(0, value))) }} />
      </span>
      {pct(value)}
    </span>
  );
}
