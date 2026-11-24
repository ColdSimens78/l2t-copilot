/**
 * Проигрывание превью партий — HTML audio (правило: никакого DSP в UI,
 * играет только отрендеренный WAV). Один источник на кокпит: запуск другой
 * партии останавливает предыдущую — всегда слышно, что слушаем сейчас.
 */
import { useSyncExternalStore } from "react";
import type { PartId } from "@/types/contract";

let audio: HTMLAudioElement | null = null;
let current: string | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Ключ превью версии — «bass:v2». */
export function previewKey(part: PartId, version: number): string {
  return `${part}:v${version}`;
}

/** Запустить превью; тот же ключ повторно — остановить. */
export function togglePreview(key: string, url: string | null): void {
  if (current === key) {
    stopPreview();
    return;
  }
  if (!url) return;
  audio ??= new Audio();
  audio.pause();
  audio.src = url;
  audio.onended = () => {
    if (current === key) stopPreview();
  };
  audio.play().catch(stopPreview);
  current = key;
  emit();
}

export function stopPreview(): void {
  if (audio) audio.pause();
  current = null;
  emit();
}

/** Ключ играющего превью («bass:v2») или null. */
export function usePlayingPreview(): string | null {
  return useSyncExternalStore(subscribe, () => current);
}
