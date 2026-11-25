/**
 * Лампа светофора (спека S6) — показ, а не кнопка: знак дублирован словами
 * для скринридера. LightIcon — в строке показателя, LightDot — метка вкладки.
 */
import type { Light } from "@/lib/xray";
import { LIGHTS } from "@/lib/lights";

export function LightIcon({ light }: { light: Light }) {
  return (
    <span
      aria-label={LIGHTS[light].name}
      className={`w-4 shrink-0 text-center text-sm leading-none font-semibold ${LIGHTS[light].text}`}
      role="img"
    >
      {LIGHTS[light].glyph}
    </span>
  );
}

export function LightDot({ light, label }: { light: Light; label: string }) {
  return (
    <span
      aria-label={label}
      className={`inline-block size-1.5 shrink-0 rounded-full ${LIGHTS[light].dot}`}
      role="img"
    />
  );
}
