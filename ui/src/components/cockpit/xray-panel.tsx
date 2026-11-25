/**
 * S2 · Loop X-Ray (спека §2 S2) — «событие доверия»: что за луп. Строки
 * TEMPO / KEY / LOUDNESS / СПЕКТР / РИТМ — проекция XRayReport; уверенность
 * ниже порога — приглушена и жёлтая (низкую объясняют, а не цитируют).
 *
 * Необязательные поля отчёта рисуют контролы, только когда пришли: bpm_alt —
 * выбор гипотезы темпа, key_relative — бейдж параллельной тональности.
 *
 * «Применить к сессии» — единственное, что панель меняет в движке, и только
 * по нажатию: автоприменения нет никогда (правило 4 шины). В сессию уходит
 * выбранная гипотеза темпа.
 */
import type { ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import { useCockpit } from "@/store/cockpit";
import { describeContext, stripKeyMarker } from "@/lib/parts";
import {
  LOW_CONFIDENCE,
  adoptState,
  bandBars,
  platformGap,
  tempoAltHint,
} from "@/lib/xray";
import { fmt, pct, signed } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BandBars } from "@/components/cockpit/band-bars";
import { Confidence } from "@/components/cockpit/confidence";
import { Segmented } from "@/components/cockpit/segmented";
import { PanelSkeleton } from "@/components/cockpit/panel-skeleton";
import { cn } from "@/lib/utils";

/** Плотность событий выше этой считает «плотным» ритмом и упирается в край шкалы. */
const DENSITY_FULL = 8;

const SPOTIFY_LABEL = "Spotify −14";

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-2">
      <h3 className="text-muted-foreground text-[10px] tracking-wider uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Value({ children, low = false }: { children: ReactNode; low?: boolean }) {
  return (
    <span className={cn("font-mono text-xl leading-tight", low && "text-warning/85")}>{children}</span>
  );
}

const unit = "text-muted-foreground text-xs";

const XRAY_ROWS = ["Темп", "Тональность", "Громкость", "Спектр", "Ритм"];

export function XRayPanel() {
  const {
    xray,
    xrayError,
    analyzing,
    loopFile,
    busState,
    hostStatus,
    selectedBpm,
    selectBpm,
    adopting,
    adoptLoop,
    retryAnalyze,
    dismissXrayError,
    requestRackFocus,
  } = useCockpit();

  // правило 1 шины: файл вне песочницы — C5, копия в workspace
  const outsideWorkspace = /вне workspace/.test(xrayError ?? "");
  const errorStrip = xrayError ? (
    <div className="border-destructive/40 mb-2 rounded-lg border p-2 text-xs" role="alert">
      {!xray ? <p className="text-card-foreground mb-0.5 font-medium">Анализ не удался</p> : null}
      <p className="text-destructive break-words">{xrayError}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button
          onClick={() => void retryAnalyze(outsideWorkspace || undefined)}
          size="xs"
          variant="outline"
        >
          {outsideWorkspace ? "Поместить в workspace и анализировать" : "Повторить"}
        </Button>
        <Button onClick={dismissXrayError} size="xs" variant="ghost">
          убрать
        </Button>
      </div>
    </div>
  ) : null;

  if (analyzing && !xray) return <PanelSkeleton label="Слушаю луп" rows={XRAY_ROWS} />;
  if (!xray) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {errorStrip}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <p className="text-card-foreground text-sm">Лупа ещё нет</p>
          <p className="text-muted-foreground text-xs leading-snug">
            Перетащи WAV/FLAC в центр окна — здесь появится разбор: темп, тональность,
            громкость и спектр.
          </p>
        </div>
      </div>
    );
  }

  const chosenBpm = selectedBpm ?? xray.bpm;
  const lowTempo = xray.bpm_confidence < LOW_CONFIDENCE;
  const lowKey = xray.key_confidence < LOW_CONFIDENCE;
  const state = adoptState(busState, chosenBpm, xray.key);
  const engineUp = hostStatus === "up";
  const applied = state === "applied";
  const bars = bandBars(xray.bands);
  const altHint = xray.bpm_alt !== null ? tempoAltHint(xray.bpm, xray.bpm_alt) : null;
  const sessionTempo = busState?.tempo ?? null;
  const sessionLine =
    busState?.key_marker != null
      ? describeContext({
          bpm: sessionTempo,
          key: stripKeyMarker(busState.key_marker),
          source: "session",
        })
      : null;

  // что применит кнопка и почему сессия сейчас другая
  let note: ReactNode = null;
  if (applied) {
    note = (
      <p className="text-success text-[11px] leading-snug">
        ✓ В сессии: {fmt(sessionTempo ?? chosenBpm, 1)} BPM · {xray.key}
      </p>
    );
  } else if (state === "different") {
    note = (
      <p className="text-warning text-[11px] leading-snug">
        В сессии другие настройки ({sessionLine}) — без применения партии лягут по ним.
      </p>
    );
  } else if (sessionTempo !== null && Math.abs(sessionTempo - chosenBpm) >= 0.05) {
    note = (
      <p className="text-muted-foreground text-[11px] leading-snug">
        Сессия на {fmt(sessionTempo, 1)} BPM: примени настройки лупа, иначе партии
        посчитаются по её темпу.
      </p>
    );
  }
  // низкая уверенность темпа — повод проверить до применения; после него не актуальна
  if (lowTempo && !applied) {
    note = (
      <>
        {note}
        <p className="text-warning text-[11px] leading-snug">
          Темп определён на {pct(xray.bpm_confidence)} — перед применением сверь на слух.
        </p>
      </>
    );
  }

  const adoptTitle = applied
    ? "Сессия уже на этих настройках"
    : hostStatus === "waking"
      ? "Движок прогревается"
      : !engineUp
        ? "Движок спит — настройки лупа применить нельзя"
        : `Темп сессии → ${fmt(chosenBpm, 1)} BPM и key-маркер «${xray.key}»`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {errorStrip}
        <p
          className="text-muted-foreground truncate font-mono text-[11px]"
          title={loopFile?.path ?? undefined}
        >
          {loopFile?.name ?? "луп"}
          {analyzing ? (
            <span className="animate-pulse motion-reduce:animate-none"> · слушаю луп…</span>
          ) : null}
        </p>

        <Row title="Темп">
          <div className="mt-1 flex items-center justify-between gap-2">
            <Value low={lowTempo}>
              {fmt(chosenBpm, 1)} <span className={unit}>BPM</span>
            </Value>
            <Confidence value={xray.bpm_confidence} title="уверенность темпа" />
          </div>
          {xray.bpm_alt !== null ? (
            <Segmented
              className="mt-2"
              label="Гипотеза темпа"
              onChange={(bpm) => selectBpm(bpm === xray.bpm ? null : bpm)}
              options={[
                { value: xray.bpm, label: fmt(xray.bpm, 1), title: "основная гипотеза" },
                {
                  value: xray.bpm_alt,
                  label: altHint ? (
                    <span className="flex flex-col leading-tight">
                      <span>{fmt(xray.bpm_alt, 1)}</span>
                      <span className="text-muted-foreground text-[10px]">{altHint}</span>
                    </span>
                  ) : (
                    fmt(xray.bpm_alt, 1)
                  ),
                  title: "альтернативная гипотеза анализатора",
                },
              ]}
              value={chosenBpm}
            />
          ) : null}
        </Row>

        <Row title="Тональность">
          <div className="mt-1 flex items-center justify-between gap-2">
            <Value low={lowKey}>{xray.key}</Value>
            <Confidence value={xray.key_confidence} title="уверенность тональности" />
          </div>
          {xray.key_relative ? (
            <Badge
              className="mt-1.5 gap-1 font-normal"
              title="Параллельная тональность: те же ноты, другой центр — Self-Check засчитывает обе"
              variant="outline"
            >
              ≡ {xray.key_relative} <span className="text-muted-foreground">(отн.)</span>
            </Badge>
          ) : null}
          {lowKey ? (
            <p className="text-warning mt-1 text-[11px] leading-snug">
              Тональность определена на {pct(xray.key_confidence)} — проверь на слух.
            </p>
          ) : null}
        </Row>

        <Row title="Громкость">
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <Value>
              {fmt(xray.lufs, 1)} <span className={unit}>LUFS</span>
            </Value>
            <span className="text-muted-foreground font-mono text-xs">
              пик {fmt(xray.true_peak, 1)} dBTP
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            до {SPOTIFY_LABEL}:{" "}
            <span className="text-card-foreground font-mono">
              {signed(platformGap(xray.lufs, "spotify"))} dB
            </span>
          </p>
        </Row>

        <Row title="Спектр">
          <div className="mt-2">
            <BandBars bars={bars} label="Спектр лупа по полосам" />
          </div>
        </Row>

        <Row title="Ритм">
          {xray.onset_density !== null ? (
            <>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <Value>
                  {fmt(xray.onset_density, 2)} <span className={unit}>событий/с</span>
                </Value>
                <span className="text-muted-foreground text-[11px]">плотность</span>
              </div>
              <div
                aria-hidden
                className="bg-foreground/15 mt-1.5 h-1 overflow-hidden rounded-full"
              >
                <div
                  className="bg-foreground/60 h-full rounded-full"
                  style={{
                    width: pct(Math.min(1, xray.onset_density / DENSITY_FULL)),
                  }}
                />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">
              Плотность событий не измерена
            </p>
          )}
        </Row>
      </div>

      <div className="border-border mt-2 flex shrink-0 flex-col gap-2 border-t pt-2">
        {note ? <div className="flex flex-col gap-0.5">{note}</div> : null}
        {/* подсказка на обёртке: у выключенной кнопки она тоже видна */}
        <span className="inline-flex" title={adoptTitle}>
          <Button
            disabled={applied || !engineUp || adopting}
            onClick={() => void adoptLoop(chosenBpm, xray.key)}
            size="sm"
          >
            <Check />
            {applied ? "Применено к сессии" : adopting ? "Применяю…" : "Применить к сессии"}
          </Button>
        </span>
        <Button
          onClick={requestRackFocus}
          size="sm"
          title="Каналы уже знают темп и тональность лупа"
          variant="outline"
        >
          Сгенерировать партии
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
