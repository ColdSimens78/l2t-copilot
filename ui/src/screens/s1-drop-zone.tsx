/**
 * S1 · Пустой проект / Drop лупа (спека §2 S1): empty / analyzing / error.
 * Drop абсолютного пути → analyze_loop {path}; файл вне workspace → C5
 * copy_into_workspace (флаг включён контрактом v0.2). Кнопка [Выбрать файл]
 * в моке подставляет демо-путь (файловый диалог ОС — с Tauri-адаптером,
 * dialog-плагин).
 */
import { useCallback, useState } from "react";

import { useCockpit } from "@/store/cockpit";
import { Button } from "@/components/ui/button";

const DEMO_LOOP = "/home/ilmir/music-workspace/loop_am90.wav";
const OUTSIDE_LOOP = "/home/ilmir/Downloads/loop_am90.wav";

export function DropZone() {
  const { analyzing, xrayError, analyzeLoop } = useCockpit();
  const [dragOver, setDragOver] = useState(false);

  const drop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const path = e.dataTransfer.getData("text/plain") || DEMO_LOOP;
      void analyzeLoop(path);
    },
    [analyzeLoop],
  );

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div
        className={`border-dashed p-10 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/10" : "border-border"
        } ${analyzing ? "animate-pulse rounded-3xl border-2" : "rounded-3xl border-2"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={drop}
        aria-label="Зона перетаскивания лупа"
      >
        {analyzing ? (
          <p className="text-card-foreground text-lg">Слушаю луп…</p>
        ) : xrayError ? (
          <div className="flex flex-col gap-3">
            <p className="text-destructive text-sm">{xrayError}</p>
            <div className="flex justify-center gap-2">
              <Button onClick={() => void analyzeLoop(DEMO_LOOP)} size="sm">
                Повторить
              </Button>
              <Button onClick={() => void analyzeLoop(OUTSIDE_LOOP)} size="sm" variant="ghost">
                пример: файл вне workspace
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-card-foreground text-lg">
              📥 Перетащи WAV/FLAC сюда
            </p>
            <p className="text-muted-foreground text-xs">
              Loop X-Ray расскажет: темп, тональность, чего лупу не хватает.
            </p>
            <div className="flex justify-center gap-2">
              <Button onClick={() => void analyzeLoop(DEMO_LOOP)} size="sm">
                Выбрать файл
              </Button>
              <Button onClick={() => void analyzeLoop(OUTSIDE_LOOP)} size="sm" variant="ghost">
                пример: вне workspace (C5)
              </Button>
            </div>
            <p className="text-muted-foreground/70 font-mono text-[10px]">
              мок: кнопки подставляют демо-пути (в т.ч. сбой правила 1 шины)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
