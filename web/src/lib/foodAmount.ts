/** Amounts and nutrient previews for logging. The server recomputes and stores the values. */
import { formatNumber, parseDecimal } from './units';

export interface Per100 {
  kcal_100: number;
  protein_100: number;
  carbs_100: number;
  fat_100: number;
}

export interface Serving {
  label: string;
  grams: number;
  is_default: boolean;
}

/** Grams as a unit: the amount is typed straight in grams. */
export const GRAMS: Serving = { label: 'g', grams: 1, is_default: false };

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Logged nutrients: grams x per100 / 100 (SPEC page 3). */
export function nutrientsFor(food: Per100, grams: number) {
  return {
    kcal: round2((food.kcal_100 * grams) / 100),
    protein_g: round2((food.protein_100 * grams) / 100),
    carbs_g: round2((food.carbs_100 * grams) / 100),
    fat_g: round2((food.fat_100 * grams) / 100),
  };
}

export function amountOptions(food: { servings: Serving[] }): Serving[] {
  const servings = [...food.servings].sort((a, b) => Number(b.is_default) - Number(a.is_default));
  return [...servings, GRAMS];
}

export function gramsFor(quantity: number, unit: { label: string; grams: number }): number {
  return round2(quantity * unit.grams);
}

/** A positive number, or null. */
export function parseAmount(raw: string): number | null {
  const n = parseDecimal(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "341 kcal · 74P 3F 0C", the macro line on entry cards (SPEC page 4). */
export function macroLine(n: { kcal: number; protein_g: number; fat_g: number; carbs_g: number }) {
  const g = (x: number) => formatNumber(Math.round(x));
  return `${g(n.kcal)} kcal · ${g(n.protein_g)}P ${g(n.fat_g)}F ${g(n.carbs_g)}C`;
}
