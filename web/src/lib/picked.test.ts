import type { QuickFood } from '../api/foods';
import {
  amountText,
  fromLastServing,
  pickedNutrients,
  readCustomFood,
  readQuickAdd,
  toItem,
  totalsOf,
  type Picked,
} from './picked';

const RICE: QuickFood = {
  id: 'rice',
  name: 'White rice, cooked',
  brand: null,
  source: 'fdc',
  tier: 'personal',
  kcal_100: 130,
  protein_100: 2.7,
  carbs_100: 28.2,
  fat_100: 0.3,
  fiber_100: null,
  sugar_100: null,
  sodium_mg_100: null,
  density_g_ml: null,
  kcal_mismatch: false,
  servings: [{ label: '1 cup', grams: 158, is_default: true }],
  last: { grams: 316, quantity: 2, unit_label: '1 cup' },
  is_favourite: false,
  times_logged: 3,
};

describe('picked items', () => {
  test('a recent food comes back at its last serving, marked as recent', () => {
    const p = fromLastServing(RICE, 'recent');
    expect(p).toMatchObject({
      kind: 'food',
      quantity: 2,
      unit: '1 cup',
      grams: 316,
      source: 'recent',
    });
    expect(toItem(p)).toEqual({
      food_id: 'rice',
      quantity: 2,
      unit_label: '1 cup',
      source: 'recent',
    });
    expect(amountText(p)).toBe('2 x 1 cup');
  });

  test('a food never logged starts at its default serving, or 100 g', () => {
    expect(fromLastServing({ ...RICE, last: null }, 'search')).toMatchObject({
      quantity: 1,
      unit: '1 cup',
      grams: 158,
    });
    const plain = fromLastServing({ ...RICE, last: null, servings: [] }, 'search');
    expect(plain).toMatchObject({ quantity: 100, unit: 'g', grams: 100 });
    expect(toItem(plain)).toEqual({ food_id: 'rice', grams: 100, source: 'search' });
  });

  test('a last serving in grams stays in grams', () => {
    const p = fromLastServing(
      { ...RICE, last: { grams: 150, quantity: null, unit_label: null } },
      'recent',
    );
    expect(toItem(p)).toEqual({ food_id: 'rice', grams: 150, source: 'recent' });
    expect(pickedNutrients(p).kcal).toBe(195);
  });

  test('quick adds carry their own nutrients', () => {
    const q: Picked = {
      kind: 'quick',
      quick: { name: 'Office cake', kcal: 320, protein_g: 4, carbs_g: 41, fat_g: 15 },
    };
    expect(toItem(q)).toEqual({ quick: q.quick });
    expect(amountText(q)).toBe('Quick add');
    const t = totalsOf([
      q,
      fromLastServing(
        { ...RICE, last: { grams: 150, quantity: null, unit_label: null } },
        'recent',
      ),
    ]);
    expect(t).toEqual({ kcal: 515, protein_g: 8.05, fat_g: 15.45, carbs_g: 83.3 });
  });
});

describe('readQuickAdd', () => {
  test('calories are required; macros default to 0', () => {
    expect(readQuickAdd({ name: '', kcal: '250', protein: '', fat: '', carbs: '' })).toEqual({
      value: { name: null, kcal: 250, protein_g: 0, carbs_g: 0, fat_g: 0 },
      errors: {},
    });
    expect(readQuickAdd({ name: 'x', kcal: '', protein: '1', fat: '', carbs: '' }).errors).toEqual({
      kcal: 'Enter calories.',
    });
    expect(
      readQuickAdd({ name: '', kcal: '100', protein: 'abc', fat: '', carbs: '' }).errors,
    ).toEqual({
      protein: 'Enter a number, or leave it empty.',
    });
  });
});

describe('readCustomFood', () => {
  const draft = {
    name: 'Protein bar',
    brand: 'Corner Shop',
    per: 'serving' as const,
    servingLabel: '1 bar',
    servingGrams: '60',
    kcal: '210',
    protein: '20',
    carbs: '22',
    fat: '6',
    fiber: '3',
    sugar: '',
    sodium: '',
  };

  test('a label per serving', () => {
    const r = readCustomFood(draft);
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({
      name: 'Protein bar',
      brand: 'Corner Shop',
      per: 'serving',
      serving_label: '1 bar',
      serving_grams: 60,
      kcal: 210,
      protein_g: 20,
      carbs_g: 22,
      fat_g: 6,
      fiber_g: 3,
      sugar_g: null,
      sodium_mg: null,
    });
    // The same per 100 g, as the server will store it.
    expect(r.per100?.kcal).toBe(350);
  });

  test('per serving needs the serving; empty optional fields stay unknown', () => {
    expect(readCustomFood({ ...draft, servingGrams: '' }).errors).toEqual({
      servingGrams: 'Enter what one serving weighs.',
    });
    expect(readCustomFood({ ...draft, name: ' ' }).errors).toEqual({ name: 'Enter a name.' });
    expect(readCustomFood({ ...draft, kcal: '' }).errors).toEqual({ kcal: 'Enter calories.' });
  });

  test('flags a label whose calories do not match its macros', () => {
    expect(readCustomFood(draft).mismatch).toBe(false);
    expect(readCustomFood({ ...draft, kcal: '500' }).mismatch).toBe(true);
  });
});
