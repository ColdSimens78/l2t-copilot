/**
 * Лампа светофора (спека S6): знак, название и классы тона для ✓ / ⚠ / ✗.
 * Знак и слова дублируют цвет — читается и без цветового зрения.
 */
import type { Light } from "@/lib/xray";

export const LIGHTS: Record<
  Light,
  { glyph: string; name: string; text: string; border: string; dot: string }
> = {
  ok: {
    glyph: "✓",
    name: "в порядке",
    text: "text-success",
    border: "border-success/40",
    dot: "bg-success",
  },
  warn: {
    glyph: "⚠",
    name: "замечание",
    text: "text-warning",
    border: "border-warning/50",
    dot: "bg-warning",
  },
  fail: {
    glyph: "✗",
    name: "расхождение",
    text: "text-destructive",
    border: "border-destructive/50",
    dot: "bg-destructive",
  },
};

export const LIGHT_LABEL: Record<Light, string> = {
  ok: "микс в порядке",
  warn: "есть замечания",
  fail: "расхождение с лупом",
};
