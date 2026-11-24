/**
 * Перетаскивание файла в зону — один мост двух сред (спека S1, S6):
 * - браузер, dropMode «html5»: путь читается из dataTransfer; у реального
 *   File пути нет — приходит только имя;
 * - окно, dropMode «tauri»: нативный DnD перехватывает HTML5-drop, путь
 *   приходит одним событием на всё окно (tauri://drag-drop, позиция курсора
 *   в физических пикселях) — зона срабатывает по попаданию курсора в свой
 *   rect; fallback-зона принимает дроп мимо всех зон.
 */
import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";

import { useApi, type CockpitApi, type FileDropEvent, type Unsubscribe } from "@/ipc/api";

export interface DroppedFile {
  /** Абсолютный путь (окно) либо текст dataTransfer; null, если среда дала только имя. */
  path: string | null;
  name: string | null;
}

interface Zone {
  element: () => HTMLElement | null;
  onDrop: (file: DroppedFile) => void;
  onOver: (over: boolean) => void;
  fallback: boolean;
}

const zones = new Set<Zone>();
let source: CockpitApi | null = null;
let stopNative: Unsubscribe | undefined;

function hits(element: HTMLElement, position: FileDropEvent["position"]): boolean {
  if (!position) return false;
  const rect = element.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const x = position.x / scale;
  const y = position.y / scale;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function dispatch(event: FileDropEvent): void {
  if (event.kind === "leave") {
    zones.forEach((z) => z.onOver(false));
    return;
  }
  if (event.kind === "over") {
    zones.forEach((z) => {
      const el = z.element();
      z.onOver(el !== null && hits(el, event.position));
    });
    return;
  }
  const live = [...zones].filter((z) => z.element() !== null);
  const target = live.find((z) => hits(z.element()!, event.position)) ?? live.find((z) => z.fallback);
  zones.forEach((z) => z.onOver(false));
  if (target && event.path) {
    target.onDrop({ path: event.path, name: event.path.split("/").pop() ?? event.path });
  }
}

/** Один нативный слушатель на адаптер: зоны приходят и уходят, событие — общее. */
function ensureNative(api: CockpitApi): void {
  if (source === api) return;
  stopNative?.();
  source = api;
  stopNative = api.onFileDrop?.(dispatch);
}

export function useFileDrop(
  ref: RefObject<HTMLElement | null>,
  onDrop: (file: DroppedFile) => void,
  { fallback = false }: { fallback?: boolean } = {},
) {
  const api = useApi();
  const [dragOver, setDragOver] = useState(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  useEffect(() => {
    if (api.dropMode !== "tauri" || !api.onFileDrop) return;
    ensureNative(api);
    const zone: Zone = {
      element: () => ref.current,
      onDrop: (file) => dropRef.current(file),
      onOver: setDragOver,
      fallback,
    };
    zones.add(zone);
    return () => {
      zones.delete(zone);
    };
  }, [api, ref, fallback]);

  const html5 =
    api.dropMode === "html5"
      ? {
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            setDragOver(true);
          },
          onDragLeave: () => setDragOver(false),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            const path = e.dataTransfer.getData("text/plain") || null;
            dropRef.current({
              path,
              name: file?.name ?? (path ? path.split("/").pop() ?? path : null),
            });
          },
        }
      : {};

  return { dragOver, html5 };
}
