/**
 * S1 · Пустой проект / Drop лупа (спека §2 S1): empty / analyzing / error.
 * Drop абсолютного пути → analyze_loop {path}; файл вне workspace → C5
 * copy_into_workspace (флаг включён контрактом v0.2).
 *
 * [Выбрать файл]: диалог ОС — с плагином dialog (пока не подключён);
 * в браузере кнопка подставляет демо-путь мока, в окне её нет — там файл
 * несут из менеджера перетаскиванием (lib/use-file-drop.ts).
 */
import { useCallback, useRef } from "react";

import { adapterMode } from "@/ipc/api";
import { mockAdapter } from "@/ipc/mock-adapter";
import { useCockpit } from "@/store/cockpit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFileDrop, type DroppedFile } from "@/lib/use-file-drop";

const DEMO_LOOP = "/home/ilmir/music-workspace/loop_am90.wav";
const OUTSIDE_LOOP = "/home/ilmir/Downloads/loop_am90.wav";

/** Путь из drop: в окне он абсолютный; в браузере у File пути нет — мок строит его по имени. */
function resolvePath(file: DroppedFile): string | null {
  if (file.path) return file.path;
  if (file.name && adapterMode === "mock") return mockAdapter.demoPath(file.name);
  return null;
}

export function DropZone() {
  const { analyzing, xrayError, analyzeLoop, retryAnalyze, dismissXrayError } = useCockpit();
  const zoneRef = useRef<HTMLDivElement>(null);

  const drop = useCallback(
    (file: DroppedFile) => {
      const path = resolvePath(file);
      if (path) void analyzeLoop(path);
    },
    [analyzeLoop],
  );
  // fallback: дроп мимо всех зон окна считается дропом лупа
  const { dragOver, html5 } = useFileDrop(zoneRef, drop, { fallback: true });

  // правило 1 шины: файл вне песочницы → C5, копия в workspace
  const outsideWorkspace = /вне workspace/.test(xrayError ?? "");

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div
        {...html5}
        aria-label="Зона перетаскивания лупа"
        className={cn(
          "rounded-3xl border-2 border-dashed p-10 text-center transition-colors",
          dragOver ? "border-primary bg-primary/10" : "border-border",
          analyzing && "animate-pulse",
        )}
        ref={zoneRef}
      >
        {analyzing ? (
          <p className="text-card-foreground text-lg">Слушаю луп…</p>
        ) : xrayError ? (
          <div className="flex flex-col gap-3">
            <p className="text-destructive mx-auto max-w-md text-sm" role="alert">
              {xrayError}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {outsideWorkspace ? (
                <Button onClick={() => void retryAnalyze(true)} size="sm">
                  Поместить в workspace и анализировать
                </Button>
              ) : (
                <Button onClick={() => void retryAnalyze()} size="sm">
                  Повторить
                </Button>
              )}
              <Button onClick={dismissXrayError} size="sm" variant="ghost">
                убрать
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-card-foreground text-lg">📥 Перетащи WAV/FLAC сюда</p>
            <p className="text-muted-foreground text-xs">
              Loop X-Ray расскажет: темп, тональность, чего лупу не хватает.
            </p>
            {adapterMode === "mock" ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => void analyzeLoop(DEMO_LOOP)} size="sm">
                  Выбрать файл
                </Button>
                <Button onClick={() => void analyzeLoop(OUTSIDE_LOOP)} size="sm" variant="ghost">
                  пример: вне workspace (C5)
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground/70 text-[11px]">
                файл — из менеджера файлов; диалог выбора появится с плагином dialog
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
