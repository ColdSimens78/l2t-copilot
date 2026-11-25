/**
 * Полосы частот: спектр лупа (S2) и прирост микса относительно лупа (S6).
 * Чистая проекция данных анализатора — никакого DSP во фронте: спектр — от
 * самой громкой полосы вниз на 40 дБ; прирост — от нуля на ±12 дБ (вправо —
 * громче, влево — тише). Подписи полные — в подсказках, под осью — короткие.
 */
import type { BandBar, BandDelta } from "@/lib/xray";
import { deltaLevel, spectrumLevel } from "@/lib/xray";
import { fmt, signed } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BandBars({ bars, label }: { bars: BandBar[]; label: string }) {
  return (
    <ul aria-label={label} className="flex h-24 gap-1">
      {bars.map((bar) => (
        <li
          className="flex h-full min-w-0 flex-1 flex-col gap-1"
          key={bar.id}
          title={`${bar.label}: ${bar.db === null ? "тишина" : `${fmt(bar.db)} дБ от максимума`}`}
        >
          <span className="flex flex-1 items-end">
            <span
              className="bg-foreground/55 block w-full rounded-sm"
              style={{ height: `${spectrumLevel(bar.db) * 100}%` }}
            />
          </span>
          <span className="text-muted-foreground truncate text-center font-mono text-[10px] leading-none">
            {bar.short}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function BandDeltaBars({ deltas, label }: { deltas: BandDelta[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-1">
      {deltas.map((delta) => {
        const level = deltaLevel(delta.db);
        const up = (delta.db ?? 0) >= 0;
        return (
          <li
            className="flex items-center gap-2"
            key={delta.id}
            title={`${delta.label}: ${
              delta.db === null ? "полоса была тишиной или стала" : `${signed(delta.db)} дБ к лупу`
            }`}
          >
            <span className="text-muted-foreground w-8 shrink-0 text-right font-mono text-[10px]">
              {delta.short}
            </span>
            <span className="relative h-2.5 flex-1 rounded-sm bg-foreground/8">
              <span aria-hidden className="bg-foreground/30 absolute inset-y-0 left-1/2 w-px" />
              <span
                aria-hidden
                className={cn("absolute inset-y-0 rounded-sm", up ? "bg-success/80" : "bg-chart-4/80")}
                style={
                  up
                    ? { left: "50%", width: `${level * 50}%` }
                    : { right: "50%", width: `${-level * 50}%` }
                }
              />
            </span>
            <span className="text-card-foreground w-13 shrink-0 text-right font-mono text-[11px]">
              {delta.db === null ? "—" : `${signed(delta.db)} дБ`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
