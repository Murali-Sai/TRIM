import type { Context, Macros, SuggestedItem } from '../api/suggestions';
import { formatUnits } from './staples';
import { formatNumber } from './units';

/** "300 g", "4 x 1 egg", "1 meal" or "1.5 x the meal". */
export function itemAmount(i: SuggestedItem): string {
  if (i.saved_meal_id) return i.units === 1 ? '1 meal' : `${formatUnits(i.units)} x the meal`;
  if (i.unit_label === '100 g' && i.grams !== null) return `${formatNumber(Math.round(i.grams))} g`;
  return `${formatUnits(i.units)} x ${i.unit_label}`;
}

const NAMES: readonly [keyof Macros, string, string][] = [
  ['kcal', ' kcal', ''],
  ['protein_g', ' g', ' protein'],
  ['carbs_g', ' g', ' carbs'],
  ['fat_g', ' g', ' fat'],
];

/** "Leaves 72 kcal, 1 g protein, 5 g carbs, 4 g fat"; what goes over is named after it. */
export function leavesLine(leaves: Macros): string {
  const left: string[] = [];
  const over: string[] = [];
  for (const [key, unit, name] of NAMES) {
    const v = Math.round(leaves[key]);
    if (v > 0) left.push(`${formatNumber(v)}${unit}${name}`);
    else if (v < 0) {
      over.push(
        key === 'kcal'
          ? `${formatNumber(-v)} kcal over`
          : `${formatNumber(-v)}${unit} over on${name}`,
      );
    }
  }
  if (left.length === 0 && over.length > 0) {
    return `Goes ${over.join(', ')}`;
  }
  const head = left.length ? `Leaves ${left.join(', ')}` : 'Uses all of it';
  return over.length ? `${head}; ${over.join(', ')}` : head;
}

/** How full a nutrient bar is: the share of the budget, capped at 100%. */
export function barFill(total: number, budget: number): { pct: number; over: boolean } {
  if (budget <= 0) return total > 0.5 ? { pct: 100, over: true } : { pct: 0, over: false };
  const share = total / budget;
  return { pct: Math.min(100, Math.round(share * 100)), over: share > 1 };
}

/** A default name for Save as meal: "Rice, egg and greek yogurt", at most 60 characters. */
export function plateName(names: readonly string[]): string {
  const lower = names.map((n, i) => (i === 0 ? n : n.charAt(0).toLowerCase() + n.slice(1)));
  const text =
    lower.length <= 1
      ? (lower[0] ?? '')
      : `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
  return text.length > 60 ? text.slice(0, 60) : text;
}

/** The time chip's context: before 10:30 breakfast, to 15:00 lunch, to 17:30 snack, then dinner. */
export function contextFor(wall: string): Context {
  const hm = wall.slice(11, 16);
  if (hm < '10:30') return 'breakfast';
  if (hm < '15:00') return 'lunch';
  if (hm < '17:30') return 'snack';
  return 'dinner';
}
