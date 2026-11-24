/**
 * S3 · SourceLoopCard — четвёртый канал: сам луп, 🔒 референс, не трогаем.
 * Семплов в UI нет (никакого DSP во фронте) — карточка показывает имя файла
 * и сводку Loop X-Ray. Она же принимает другой луп, когда центр занят.
 */
import { useCallback, useRef } from "react";
import { Lock } from "lucide-react";
import { useCockpit } from "@/store/cockpit";
import { fmt } from "@/lib/format";
import { resolveDropPath, useFileDrop, type DroppedFile } from "@/lib/use-file-drop";
import { cn } from "@/lib/utils";

export function SourceLoopCard() {
  const { loopFile, xray, analyzing, analyzeLoop } = useCockpit();
  const ref = useRef<HTMLElement>(null);

  const onDrop = useCallback(
    (file: DroppedFile) => {
      const path = resolveDropPath(file);
      if (path) void analyzeLoop(path);
    },
    [analyzeLoop],
  );
  const { dragOver, html5 } = useFileDrop(ref, onDrop);

  return (
    <section
      {...html5}
      aria-label="Source Loop — референс"
      className={cn(
        "rounded-xl border border-dashed p-2 transition-colors",
        dragOver ? "border-primary bg-primary/10" : "border-border",
      )}
      ref={ref}
      title="Референс: перетащи сюда другой луп — X-Ray пересоберётся"
    >
      <header className="flex items-center gap-2">
        <Lock aria-hidden className="text-muted-foreground size-3.5" />
        <h3 className="text-card-foreground text-sm leading-none font-semibold">Source Loop</h3>
        <span className="text-muted-foreground ml-auto text-[10px] tracking-wider uppercase">
          референс
        </span>
      </header>
      {xray && loopFile ? (
        <>
          <p className="mt-1 truncate font-mono text-[11px]" title={loopFile.path}>
            {loopFile.name}
          </p>
          <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
            {fmt(xray.bpm)} BPM · {xray.key} · {fmt(xray.lufs)} LUFS
          </p>
        </>
      ) : (
        <p className="text-muted-foreground mt-1 text-xs leading-snug">
          {analyzing ? "Слушаю луп…" : "Лупа ещё нет — перетащи WAV/FLAC, появится X-Ray"}
        </p>
      )}
    </section>
  );
}
