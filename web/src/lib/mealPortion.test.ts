import { describe, expect, it } from 'vitest';
import type { MealItem } from '../api/meals';
import {
  amountsChanged,
  itemAmountText,
  itemGrams,
  mealLogBody,
  mealTotals,
  portionLabel,
  updatedItems,
} from './mealPortion';

// SPEC page 4: "Post-workout lunch". Per 100 g: butter 720 kcal 1P 80F 0C, chicken breast
// 120 kcal 25P 1F 0C, rice 230 kcal 2.5P 0.15F 50C, mixed veg 128.4 kcal 0.12P 0.08F 35.6C.
function item(
  id: string,
  grams: number,
  per100: [number, number, number, number],
  extra: Partial<MealItem> = {},
): MealItem {
  const [kcal, p, f, c] = per100;
  const at = (x: number) => Math.round(x * grams) / 100;
  return {
    id,
    food_id: `food-${id}`,
    name: id,
    brand: null,
    grams,
    quantity: null,
    unit_label: null,
    sort_order: 0,
    missing: false,
    kcal: at(kcal),
    protein_g: at(p),
    fat_g: at(f),
    carbs_g: at(c),
    ...extra,
  };
}

const BUTTER = item('butter', 20, [720, 1, 80, 0]);
const CHICKEN = item('chicken', 350, [120, 25, 1, 0]);
const LUNCH = [
  BUTTER,
  CHICKEN,
  item('rice', 200, [230, 2.5, 0.15, 50]),
  item('veg', 250, [128.4, 0.12, 0.08, 35.6]),
];
const AT = '2026-10-17T17:00:00.000Z';

describe('saved meal portions', () => {
  it('AC: 1,345 kcal at 1x and 2,018 kcal at 1.5x', () => {
    expect(mealTotals(LUNCH, 1, {})).toEqual({
      kcal: 1345,
      protein_g: 93,
      fat_g: 20,
      carbs_g: 189,
    });
    const half = mealTotals(LUNCH, 1.5, {});
    expect(half.kcal).toBe(2017.5);
    expect(Math.round(half.kcal)).toBe(2018);
    expect([half.protein_g, half.fat_g, half.carbs_g].map(Math.round)).toEqual([140, 30, 284]);
  });

  it('skipped and missing items are left out of the totals and the body', () => {
    const gone = { ...BUTTER, missing: true, food_id: null, name: null };
    const items = [gone, ...LUNCH.slice(1)];
    const drafts = { rice: { skipped: true, amount: null } };
    expect(mealTotals(items, 1, drafts).kcal).toBe(741);
    expect(mealLogBody(items, 1, drafts, AT)).toEqual({ eaten_at: AT, skipped_item_ids: ['rice'] });
  });

  it('an item with its own amount overrides the portion', () => {
    const drafts = { chicken: { skipped: false, amount: '200' } };
    expect(itemGrams(CHICKEN, 2, drafts.chicken)).toBe(200);
    expect(mealTotals(LUNCH, 2, drafts).kcal).toBe(2 * 1345 - 840 + 240);
    expect(mealLogBody(LUNCH, 2, drafts, AT)).toEqual({
      eaten_at: AT,
      multiplier: 2,
      item_overrides: [{ item_id: 'chicken', grams: 200 }],
    });
    expect(amountsChanged(LUNCH, 2, drafts)).toBe(true);
  });

  it('an amount equal to the portion is not a change', () => {
    const drafts = { chicken: { skipped: false, amount: '525' } };
    expect(amountsChanged(LUNCH, 1.5, drafts)).toBe(false);
    expect(mealLogBody(LUNCH, 1.5, drafts, AT)).toEqual({ eaten_at: AT, multiplier: 1.5 });
    expect(amountsChanged(LUNCH, 1, { rice: { skipped: true, amount: '10' } })).toBe(false);
  });

  it('items saved in a unit count in that unit', () => {
    const jar = item('jar', 250, [150, 6, 4, 24], { quantity: 1, unit_label: '1 jar' });
    expect(itemAmountText(jar, itemGrams(jar, 1.5))).toBe('1.5 x 1 jar');
    const drafts = { jar: { skipped: false, amount: '3' } };
    expect(itemGrams(jar, 1, drafts.jar)).toBe(750);
    expect(mealLogBody([jar], 1, drafts, AT).item_overrides).toEqual([
      { item_id: 'jar', quantity: 3 },
    ]);
    expect(updatedItems([jar], 1, drafts)).toEqual([
      { food_id: 'food-jar', quantity: 3, unit_label: '1 jar' },
    ]);
  });

  it('updating the meal saves the changed amounts and keeps the rest', () => {
    const drafts = { rice: { skipped: false, amount: '150' }, veg: { skipped: true, amount: '1' } };
    expect(updatedItems(LUNCH, 1, drafts)).toEqual([
      { food_id: 'food-butter', grams: 20 },
      { food_id: 'food-chicken', grams: 350 },
      { food_id: 'food-rice', grams: 150 },
      { food_id: 'food-veg', grams: 250 },
    ]);
  });

  it('labels portions', () => {
    expect([0.5, 1, 1.5, 2, 1.25].map(portionLabel)).toEqual(['0.5x', '1x', '1.5x', '2x', '1.25x']);
  });
});
