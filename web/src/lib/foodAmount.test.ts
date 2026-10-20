import { amountOptions, gramsFor, macroLine, nutrientsFor, parseAmount } from './foodAmount';

const RICE = {
  kcal_100: 130,
  protein_100: 2.7,
  carbs_100: 28.2,
  fat_100: 0.3,
  servings: [
    { label: '1 cup', grams: 158, is_default: true },
    { label: '1 bowl', grams: 250, is_default: false },
  ],
};

describe('nutrientsFor', () => {
  test('grams x per100 / 100 (SPEC: rice 150 g at 130 kcal/100 g is 195 kcal)', () => {
    expect(nutrientsFor(RICE, 150)).toEqual({
      kcal: 195,
      protein_g: 4.05,
      carbs_g: 42.3,
      fat_g: 0.45,
    });
  });
});

describe('amounts', () => {
  test('servings first, default first, then grams', () => {
    expect(amountOptions(RICE)).toEqual([
      { label: '1 cup', grams: 158, is_default: true },
      { label: '1 bowl', grams: 250, is_default: false },
      { label: 'g', grams: 1, is_default: false },
    ]);
    expect(amountOptions({ ...RICE, servings: [] })).toEqual([
      { label: 'g', grams: 1, is_default: false },
    ]);
  });

  test('grams for a quantity of a unit', () => {
    expect(gramsFor(2, { label: '1 cup', grams: 158 })).toBe(316);
    expect(gramsFor(150, { label: 'g', grams: 1 })).toBe(150);
  });

  test('parseAmount accepts decimals and refuses nonsense', () => {
    expect(parseAmount('1.5')).toBe(1.5);
    expect(parseAmount('0,5')).toBe(0.5);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

test('macroLine', () => {
  expect(macroLine(nutrientsFor(RICE, 150))).toBe('195 kcal · 4P 0F 42C');
});
