import { CM_PER_IN, kgToLb, lbToKg } from './tdee';

/** Stored values are kg and cm; these convert only for display and input. */
export { kgToLb, lbToKg };

export function cmToFtIn(cm: number): { ft: number; in: number } {
  const totalIn = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(totalIn / 12), in: totalIn % 12 };
}

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Parses what a person typed in a number field; accepts a comma as the decimal mark. */
export function parseDecimal(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned)) return NaN;
  return Number(cleaned);
}
