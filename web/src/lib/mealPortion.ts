/**
 * The saved meal sheet: portion chips scale every item, an item can be skipped this time, or
 * given its own amount. Previews only; the server recomputes from each food's current values.
 */
import type { ItemOverride, MealItem, MealItemInput, MealLog } from '../api/meals';
import { parseAmount } from './foodAmount';
import { formatNumber } from './units';

export const PORTIONS = [0.5, 1, 1.5, 2] as const;

export interface ItemDraft {
  skipped: boolean;
  /** This item's own amount (a quantity of its unit, or grams), as typed; null follows the
   * portion. */
  amount: string | null;
}

export type Drafts = Readonly<Record<string, ItemDraft>>;

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Counted in the item's unit when it has one, else in grams. */
export function byUnit(item: MealItem): boolean {
  return item.quantity !== null && item.unit_label !== null;
}

/** The amount as counted (quantity or grams) at a portion, before any override. */
export function scaledAmount(item: MealItem, multiplier: number): number {
  return byUnit(item) ? r3((item.quantity ?? 0) * multiplier) : r2(item.grams * multiplier);
}

/** Grams for this item at a portion, or its own amount when one is set and valid. */
export function itemGrams(item: MealItem, multiplier: number, draft?: ItemDraft): number {
  const own = draft?.amount != null ? parseAmount(draft.amount) : null;
  if (own === null) return r2(item.grams * multiplier);
  return byUnit(item) ? r2((item.grams / (item.quantity ?? 1)) * own) : r2(own);
}

/** "2 x 1 jar" or "350 g" */
export function itemAmountText(item: MealItem, grams: number): string {
  if (byUnit(item)) {
    const q = r3((grams / item.grams) * (item.quantity ?? 1));
    return `${formatNumber(q, q % 1 ? 1 : 0)} x ${item.unit_label}`;
  }
  return `${formatNumber(grams)} g`;
}

/** Nutrients scale with grams from the saved amount's values. */
export function itemNutrients(item: MealItem, grams: number) {
  const f = item.grams > 0 ? grams / item.grams : 0;
  return {
    kcal: r2(item.kcal * f),
    protein_g: r2(item.protein_g * f),
    carbs_g: r2(item.carbs_g * f),
    fat_g: r2(item.fat_g * f),
  };
}

/** What will be logged: included items that still have a food. */
export function mealTotals(items: readonly MealItem[], multiplier: number, drafts: Drafts) {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const item of items) {
    const d = drafts[item.id];
    if (item.missing || d?.skipped) continue;
    const n = itemNutrients(item, itemGrams(item, multiplier, d));
    t.kcal += n.kcal;
    t.protein_g += n.protein_g;
    t.carbs_g += n.carbs_g;
    t.fat_g += n.fat_g;
  }
  return {
    kcal: r2(t.kcal),
    protein_g: r2(t.protein_g),
    carbs_g: r2(t.carbs_g),
    fat_g: r2(t.fat_g),
  };
}

function own(d: ItemDraft | undefined): number | null {
  return d?.amount != null ? parseAmount(d.amount) : null;
}

/** An item has its own amount that is not just the portion's. */
function overridden(item: MealItem, multiplier: number, d: ItemDraft | undefined): boolean {
  const value = own(d);
  return value !== null && value !== scaledAmount(item, multiplier);
}

/** The body for logging the meal at `eaten_at`. */
export function mealLogBody(
  items: readonly MealItem[],
  multiplier: number,
  drafts: Drafts,
  eaten_at: string,
): MealLog {
  const skipped = items.filter((i) => !i.missing && drafts[i.id]?.skipped).map((i) => i.id);
  const overrides: ItemOverride[] = [];
  for (const item of items) {
    const d = drafts[item.id];
    const value = own(d);
    if (item.missing || d?.skipped || value === null || !overridden(item, multiplier, d)) continue;
    overrides.push(
      byUnit(item) ? { item_id: item.id, quantity: value } : { item_id: item.id, grams: value },
    );
  }
  return {
    eaten_at,
    ...(multiplier !== 1 ? { multiplier } : {}),
    ...(skipped.length ? { skipped_item_ids: skipped } : {}),
    ...(overrides.length ? { item_overrides: overrides } : {}),
  };
}

/** Amounts were changed in the sheet (worth offering to update the meal). Skipping an item or
 * picking a portion is "just this time". */
export function amountsChanged(items: readonly MealItem[], multiplier: number, drafts: Drafts) {
  return items.some(
    (i) => !i.missing && !drafts[i.id]?.skipped && overridden(i, multiplier, drafts[i.id]),
  );
}

/** The meal's items with this time's own amounts saved in; the others keep their saved amount.
 * Items whose food is gone are dropped. */
export function updatedItems(items: readonly MealItem[], multiplier: number, drafts: Drafts) {
  const out: MealItemInput[] = [];
  for (const item of items) {
    if (item.missing || item.food_id === null) continue;
    const d = drafts[item.id];
    const value = !d?.skipped && overridden(item, multiplier, d) ? own(d) : null;
    if (byUnit(item) && item.unit_label) {
      out.push({
        food_id: item.food_id,
        quantity: value ?? item.quantity ?? 1,
        unit_label: item.unit_label,
      });
    } else {
      out.push({ food_id: item.food_id, grams: value ?? item.grams });
    }
  }
  return out;
}

/** "1.5x", "0.75x" */
export function portionLabel(m: number): string {
  const digits = Number.isInteger(m) ? 0 : Number.isInteger(m * 10) ? 1 : 2;
  return `${formatNumber(m, digits)}x`;
}
