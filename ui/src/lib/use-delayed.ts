/**
 * Флаг включается с задержкой — трёхуровневая индикация ИИ (USER FLOW): что
 * короче 300 мс, проходит без индикации; дольше — «дышит» (пульс), и только
 * после 10 с строка уходит в AI Dock. Никаких модальных спиннеров.
 */
import { useEffect, useState } from "react";

export const PULSE_DELAY = 300;

export function useDelayed(active: boolean, ms: number = PULSE_DELAY): boolean {
  const [armed, setArmed] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  // сброс при выключении — во время рендера (React: adjust state on change)
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setArmed(false);
  }
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setArmed(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return active && armed;
}
