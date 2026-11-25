/**
 * S6 · Self-Check (спека §2 S6): светофор «луп → микс». Проверяется файл
 * рендера — принесённый перетаскиванием или сделанный здесь же командой
 * export_track (контракт v0.2.1). Критерии строк UI считает из полей отчёта
 * (тональность, темп, громкость), общий свет — из строк; контрактный verdict
 * показан рядом с ним.
 *
 * Панель ничего не чинит сама: показывает, что разошлось, и ведёт к
 * кандидатам на перегенерацию. Эталон — последний разобранный луп.
 */
import { useCallback, useRef, useState } from "react";
import { ArrowRight, Download, Save } from "lucide-react";
import type { MasterTarget } from "@/types/contract";
import { useCockpit } from "@/store/cockpit";
import { PARTS, PART_ORDER } from "@/lib/parts";
import { resolveDropPath, useFileDrop, type DroppedFile } from "@/lib/use-file-drop";
import { useDelayed } from "@/lib/use-delayed";
import { LIGHTS, LIGHT_LABEL } from "@/lib/lights";
import {
  TARGET_TOLERANCE_LU,
  MASTERING_VERDICTS,
  bandDeltas,
  bandsFlat,
  masteringLight,
  mixLufs,
  overallLight,
  platformGap,
  selfCheckRows,
  targetLabel,
} from "@/lib/xray";
import { fmt, signed } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { BandDeltaBars } from "@/components/cockpit/band-bars";
import { LightDot, LightIcon } from "@/components/cockpit/light";
import { PanelSkeleton } from "@/components/cockpit/panel-skeleton";
import { Segmented } from "@/components/cockpit/segmented";
import { cn } from "@/lib/utils";

const AUDIO_FILE = /\.(wav|flac|aiff?|aif|mp3|ogg)$/i;
const CHECK_ROWS = ["Тональность", "Темп", "Громкость", "Полосы"];
const TARGET_OPTIONS: { value: MasterTarget; label: string; title: string }[] = [
  { value: "none", label: "без цели", title: "Рендер как есть" },
  {
    value: "spotify",
    label: "Spotify −14",
    title: "Точный гейн до −14 LUFS; если пикового запаса не хватает — normalize-потолок −0.1 dBFS",
  },
  {
    value: "apple",
    label: "Apple −16",
    title: "Точный гейн до −16 LUFS; если пикового запаса не хватает — normalize-потолок −0.1 dBFS",
  },
  {
    value: "loop",
    label: "как луп",
    title: "Reference-matching: громкость исходного лупа — цель ядро возьмёт из эталона Loop X-Ray",
  },
];

const fileName = (path: string | null) => (path ? path.split("/").pop() ?? path : "—");

export function SelfCheckPanel() {
  const {
    checking,
    exporting,
    selfCheck,
    selfCheckPath,
    selfCheckError,
    selfCheckRetry,
    dismissSelfCheckError,
    runSelfCheck,
    lastExport,
    canExport,
    hostStatus,
    busState,
    xray,
    channels,
    exportAndCheck,
    exportWav,
    requestRackFocus,
    pushToast,
  } = useCockpit();
  const [target, setTarget] = useState<MasterTarget>("none");
  const zoneRef = useRef<HTMLElement>(null);

  const onDrop = useCallback(
    (file: DroppedFile) => {
      const path = resolveDropPath(file);
      const name = file.name ?? path?.split("/").pop();
      if (!path) return;
      // лишний вызов ядра не нужен: не-аудио анализатор всё равно не прочитает
      if (name && !AUDIO_FILE.test(name)) {
        pushToast({ text: `«${name}» — не аудио: жду файл рендера микса (WAV)` });
        return;
      }
      void runSelfCheck(path);
    },
    [pushToast, runSelfCheck],
  );
  const { dragOver, html5 } = useFileDrop(zoneRef, onDrop);

  const busy = checking || exporting;
  // трёхуровневая индикация: <300 мс — без неё, дальше — панель «дышит»
  const pulsing = useDelayed(busy);
  const engineUp = hostStatus === "up";
  const exportTitle = !engineUp
    ? "Движок спит — рендерить нечего"
    : (busState?.tracks?.length ?? 0) === 0
      ? "Сначала прими партию в Channel Rack — сессия пуста"
      : "Рендер сессии движком в WAV и проверка файла";

  const report = selfCheck;
  const measured =
    report && lastExport?.path === selfCheckPath ? lastExport.lufs : null;
  const rows = report ? selfCheckRows(report, xray, measured) : [];
  const light = report ? overallLight(rows) : null;
  const deltas = report ? bandDeltas(xray, report) : [];
  const mix = report ? mixLufs(report, xray, measured) : null;
  // блок цели — только когда проверен файл последнего экспорта
  const mastering =
    report && lastExport?.path === selfCheckPath ? lastExport.mastering : null;
  const accepted = PART_ORDER.filter((part) =>
    channels[part].versions.some((v) => v.decision === "accepted"),
  );
  const clash = rows.some((r) => r.light === "fail");
  const loud = rows.some((r) => r.metric === "loudness" && r.light === "warn");
  const offTarget =
    mix !== null && Math.abs(platformGap(mix, "spotify")) > TARGET_TOLERANCE_LU;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {busy ? (
          <div className={cn("flex flex-1 flex-col", pulsing && "animate-pulse motion-reduce:animate-none")}>
            <PanelSkeleton
              label={exporting ? "Рендерю микс" : "Слушаю микс"}
              rows={CHECK_ROWS}
            />
          </div>
        ) : selfCheckError ? (
          <div className="border-destructive/40 rounded-lg border p-2 text-xs" role="alert">
            <p className="text-card-foreground mb-0.5 font-medium">Проверка не удалась</p>
            <p className="text-destructive break-words">{selfCheckError}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {selfCheckRetry ? (
                <Button onClick={() => void selfCheckRetry.run()} size="xs" variant="outline">
                  {selfCheckRetry.label}
                </Button>
              ) : null}
              <Button onClick={dismissSelfCheckError} size="xs" variant="ghost">
                убрать
              </Button>
            </div>
          </div>
        ) : report && light ? (
          <div className="flex flex-col gap-2">
            <section
              aria-label="Итог проверки"
              className={cn("rounded-xl border p-2", LIGHTS[light].border)}
            >
              <header className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-card-foreground text-sm font-semibold">Микс против лупа</h3>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap font-mono text-xs",
                      LIGHTS[light].text,
                    )}
                  >
                    <LightDot label={LIGHT_LABEL[light]} light={light} />
                    {LIGHT_LABEL[light]}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p
                    className="text-muted-foreground min-w-0 truncate font-mono text-[11px]"
                    title={selfCheckPath ?? undefined}
                  >
                    {fileName(selfCheckPath)}
                  </p>
                  <span
                    className="text-muted-foreground shrink-0 font-mono text-[10px]"
                    title="Вердикт ядра из SelfCheckReport"
                  >
                    verdict: {report.verdict}
                  </span>
                </div>
              </header>
              <ul className="mt-1">
                {rows.map((row) => (
                  <li className="border-border border-b py-1.5 last:border-b-0" key={row.metric}>
                    <div className="flex items-center gap-2">
                      <LightIcon light={row.light} />
                      <span className="text-card-foreground flex-1 text-xs">{row.label}</span>
                      <span className="text-card-foreground font-mono text-xs">{row.value}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 pl-6 text-[11px] leading-snug">
                      {row.note}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            {mastering ? (
              <section
                aria-label="Цель громкости"
                className={cn("rounded-lg border p-2 text-xs", LIGHTS[masteringLight(mastering.verdict)].border)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-card-foreground font-medium">
                    Цель: {targetLabel(lastExport?.target ?? "none")}
                  </span>
                  <span className={cn("text-right font-mono", LIGHTS[masteringLight(mastering.verdict)].text)}>
                    {MASTERING_VERDICTS[mastering.verdict]}
                  </span>
                </div>
                <p className="text-card-foreground mt-1 font-mono">
                  {fmt(mastering.achieved_lufs, 1)} LUFS · Δ {signed(mastering.delta)} LU
                </p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  {mastering.applied === "gain"
                    ? "точный гейн до цели (служебная scratch-сессия движка)"
                    : mastering.applied === "normalize"
                      ? "normalize-потолок −0.1 dBFS: пикового запаса до цели не хватило"
                      : "файл без изменений"}{" "}
                  · {mastering.measured_by === "analyzer" ? "замер анализатором по файлу" : "замер движком"}
                </p>
                {mastering.verdict !== "on_target" ? (
                  <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
                    Точный гейн сходится с целью, когда хватает запаса по пику; иначе нормализация
                    упирается в потолок −0.1 dBFS — остаток закрывается лимитером в DAW.
                  </p>
                ) : null}
              </section>
            ) : null}

            <section>
              <h3 className="text-muted-foreground text-[10px] tracking-wider uppercase">
                Полосы · что добавили слои
              </h3>
              {Object.keys(report.bands_delta).length === 0 ? (
                <p className="text-muted-foreground mt-1 text-xs">Отчёт без полос</p>
              ) : bandsFlat(deltas) ? (
                <p className="text-muted-foreground mt-1 text-xs leading-snug">
                  Дельты полос равны нулю: прироста нет либо он меньше точности отчёта
                </p>
              ) : (
                <div className="mt-1.5">
                  <BandDeltaBars deltas={deltas} label="Прирост полос микса относительно лупа" />
                </div>
              )}
            </section>

            {clash || (loud && offTarget) ? (
              <section aria-label="Что делать" className="bg-muted/40 flex flex-col gap-1.5 rounded-lg p-2 text-xs">
                {clash ? (
                  <>
                    <p className="text-card-foreground font-medium">Кандидаты на перегенерацию</p>
                    {accepted.length > 0 ? (
                      <ul className="flex flex-wrap gap-x-3 gap-y-1">
                        {accepted.map((part) => (
                          <li className="flex items-center gap-1.5" key={part}>
                            <span
                              aria-hidden
                              className="size-2 rounded-full"
                              style={{ background: PARTS[part].color }}
                            />
                            {PARTS[part].label}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">
                        В сессии нет принятых партий — расходится сам файл или темп сессии.
                      </p>
                    )}
                    <p className="text-muted-foreground text-[11px] leading-snug">
                      Тональность или темп задаёт один из слоёв — перегенерируй его с другими
                      чипами.
                    </p>
                    <div>
                      <Button onClick={requestRackFocus} size="xs" variant="outline">
                        К каналам
                        <ArrowRight />
                      </Button>
                    </div>
                  </>
                ) : null}
                {loud && offTarget && mix !== null ? (
                  <>
                    <p className="text-card-foreground font-medium">Громкость</p>
                    <p className="text-muted-foreground text-[11px] leading-snug">
                      До Spotify −14: {signed(platformGap(mix, "spotify"))} dB — экспорт с целью
                      нормализует файл по пику.
                    </p>
                    {canExport ? (
                      <div>
                        <span
                          className="inline-flex"
                          title="Движок нормализует по пику до −0.1 dBFS; до цели LUFS может не хватить — отчёт покажет остаток"
                        >
                          <Button onClick={() => void exportAndCheck("spotify")} size="xs" variant="outline">
                            Экспорт под Spotify −14
                          </Button>
                        </span>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-card-foreground text-sm">Отчёта ещё нет</p>
            <p className="text-muted-foreground text-xs leading-snug">
              Проверка сверяет микс с лупом: тональность, темп и громкость. Принеси файл
              рендера — или сделай его кнопкой ниже.
            </p>
            {!xray ? (
              <p className="text-warning text-[11px] leading-snug">
                Эталона нет: сначала разбери луп в Loop X-Ray
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="border-border mt-2 flex shrink-0 flex-col gap-2 border-t pt-2">
        <section
          {...html5}
          aria-label="Зона перетаскивания рендера микса"
          className={cn(
            "rounded-lg border border-dashed p-2 text-center text-[11px] transition-colors",
            dragOver ? "border-primary bg-primary/10" : "text-muted-foreground border-border",
          )}
          ref={zoneRef}
          title="Файл рендера микса (WAV), сделанный в DAW или экспортом ниже"
        >
          Перетащи bounce-WAV сюда
        </section>
        <Segmented
          label="Цель громкости экспорта"
          onChange={setTarget}
          options={TARGET_OPTIONS}
          value={target}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-w-0 flex-1" title={exportTitle}>
            <Button
              className="w-full justify-center"
              disabled={!canExport || busy}
              onClick={() => void exportAndCheck(target)}
              size="sm"
            >
              <Download />
              Сделать bounce и проверить
            </Button>
          </span>
          <span
            className="inline-flex"
            title={
              !engineUp
                ? "Движок спит — рендерить нечего"
                : "Рендер без цели громкости: файл уходит из приложения как есть"
            }
          >
            <Button
              disabled={!canExport || busy}
              onClick={() => void exportWav()}
              size="sm"
              variant="outline"
            >
              <Save />
              Save WAV
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
