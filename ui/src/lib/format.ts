/**
 * Число к показу: типографский минус (U+2212), без лишних нулей на конце —
 * «−14.3», «90», «2.19». Нечисло (NaN, ∞) → прочерк.
 */
export function fmt(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return fixed.replace("-", "−");
}

/** Со знаком: «+7.3» / «−0.4». */
export function signed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value > 0 ? `+${fmt(value, digits)}` : fmt(value, digits);
}

/** Доля 0..1 → «84%». */
export function pct(part: number): string {
  return `${Math.round(part * 100)}%`;
}

/** Русское число с существительным: «1 нота», «2 ноты», «5 нот», «21 нота». */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  const word = abs > 10 && abs < 20 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${n} ${word}`;
}
