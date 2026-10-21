import type { Staple } from '../api/staples';
import { formatNumber } from './units';

/** Mirrors api/app/staples.py: at most 7 amounts a staple can be suggested in. */
export const MAX_AMOUNTS = 7;
export const MAX_UNITS = 99;

/** Amounts are kept to 2 decimals, so compare in hundredths. */
const hundredths = (v: number) => Math.round(v * 100);

/** Every allowed amount from min to max in steps of step, or null when they do not work. */
export function allowedAmounts(min: number, max: number, step: number): number[] | null {
  return amountsError(min, max, step) ? null : range(min, max, step);
}

function range(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = hundredths(min); v <= hundredths(max); v += hundredths(step)) out.push(v / 100);
  return out;
}

/** Why these amounts cannot be used, in the same words as the API; null when they can. */
export function amountsError(min: number, max: number, step: number): string | null {
  if (![min, max, step].every(Number.isFinite) || step <= 0 || min <= 0) {
    return 'Amounts must be more than 0.';
  }
  if (max < min) return 'The largest amount must be at least the smallest.';
  if (max > MAX_UNITS) return `The largest amount can be at most ${MAX_UNITS}.`;
  const span = hundredths(max) - hundredths(min);
  if (span % hundredths(step) !== 0) {
    return 'The step must fit evenly between the smallest and largest amounts.';
  }
  if (span / hundredths(step) + 1 > MAX_AMOUNTS) {
    return `Allow at most ${MAX_AMOUNTS} amounts. Use a bigger step or a narrower range.`;
  }
  return null;
}

/** "1", "0.5" or "1.25": no trailing zeros. */
export const formatUnits = (v: number) =>
  formatNumber(v, v % 1 === 0 ? 0 : hundredths(v) % 10 === 0 ? 1 : 2);
const amount = formatUnits;

// The same measure words as api/app/staples.py.
const MEASURES = new Set(
  (
    'g gram grams kg mg oz ounce ounces lb lbs pound pounds ml l litre litres liter liters dl ' +
    'cl fl floz cup cups tbsp tablespoon tablespoons tsp teaspoon teaspoons pint pints quart ' +
    'quarts serving servings portion portions meal meals'
  ).split(' '),
);

/** "1 egg" or "1 bottle (500 ml)" count; "100 g", "1 cup (240 ml)" and "1 serving" measure. */
export function isCountable(unitLabel: string): boolean {
  const words =
    unitLabel
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .match(/[a-z]+/g) ?? [];
  return words.length > 0 && !words.some((w) => MEASURES.has(w));
}

/** The amounts the API gives a staple when its unit changes. */
export function defaultAmounts(unitLabel: string): { min: number; max: number; step: number } {
  return isCountable(unitLabel) ? { min: 1, max: 4, step: 1 } : { min: 0.5, max: 3, step: 0.5 };
}

/** "1 egg · 1 to 4" or "100 g · 0.5 to 3". */
export function stapleAmountLine(s: Pick<Staple, 'unit_label' | 'min_units' | 'max_units'>) {
  const span =
    s.min_units === s.max_units
      ? amount(s.min_units)
      : `${amount(s.min_units)} to ${amount(s.max_units)}`;
  return `${s.unit_label} · ${span}`;
}

/** The list with the item at `from` moved to `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}
