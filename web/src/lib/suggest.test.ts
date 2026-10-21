import { describe, expect, it } from 'vitest';
import type { SuggestedItem } from '../api/suggestions';
import { barFill, contextFor, itemAmount, leavesLine, plateName } from './suggest';

const item = (over: Partial<SuggestedItem>): SuggestedItem => ({
  staple_id: 's',
  food_id: 'f',
  saved_meal_id: null,
  name: 'Rice',
  unit_label: '100 g',
  units: 3,
  grams: 300,
  kcal: 390,
  protein_g: 8.1,
  carbs_g: 84.6,
  fat_g: 0.9,
  ...over,
});

describe('itemAmount', () => {
  it('shows grams for a 100 g unit and counts for servings', () => {
    expect(itemAmount(item({}))).toBe('300 g');
    expect(itemAmount(item({ unit_label: '1 egg', units: 4, grams: 200 }))).toBe('4 x 1 egg');
    expect(itemAmount(item({ unit_label: '1 cup', units: 1.5, grams: 255 }))).toBe('1.5 x 1 cup');
  });

  it('a saved meal is a portion of the whole meal', () => {
    const meal = { saved_meal_id: 'm', food_id: null, unit_label: '1 meal', grams: null };
    expect(itemAmount(item({ ...meal, units: 1 }))).toBe('1 meal');
    expect(itemAmount(item({ ...meal, units: 1.5 }))).toBe('1.5 x the meal');
  });
});

describe('leavesLine', () => {
  it('matches the SPEC wording', () => {
    expect(leavesLine({ kcal: 72, protein_g: 0.75, carbs_g: 4.65, fat_g: 3.85 })).toBe(
      'Leaves 72 kcal, 1 g protein, 5 g carbs, 4 g fat',
    );
  });

  it('names what goes over separately', () => {
    expect(leavesLine({ kcal: 57, protein_g: -4.3, carbs_g: 13.7, fat_g: -1.8 })).toBe(
      'Leaves 57 kcal, 14 g carbs; 4 g over on protein, 2 g over on fat',
    );
    expect(leavesLine({ kcal: -20, protein_g: 0, carbs_g: 0.2, fat_g: 0 })).toBe(
      'Goes 20 kcal over',
    );
  });
});

describe('barFill', () => {
  it('is the share of the budget, capped at 100%', () => {
    expect(barFill(450, 900)).toEqual({ pct: 50, over: false });
    expect(barFill(940, 900)).toEqual({ pct: 100, over: true });
    expect(barFill(0, 0)).toEqual({ pct: 0, over: false });
    expect(barFill(5, 0)).toEqual({ pct: 100, over: true });
  });
});

describe('plateName', () => {
  it('lists the items for Save as meal', () => {
    expect(plateName(['Rice', 'Egg', 'Greek yogurt'])).toBe('Rice, egg and greek yogurt');
    expect(plateName(['Chicken'])).toBe('Chicken');
    expect(
      plateName(['A very long food name indeed', 'Another long food name', 'Third']),
    ).toHaveLength(60);
  });
});

describe('contextFor', () => {
  it.each([
    ['2026-10-17T10:29', 'breakfast'],
    ['2026-10-17T10:30', 'lunch'],
    ['2026-10-17T14:59', 'lunch'],
    ['2026-10-17T15:00', 'snack'],
    ['2026-10-17T17:29', 'snack'],
    ['2026-10-17T17:30', 'dinner'],
    ['2026-10-17T00:05', 'breakfast'],
  ])('%s is %s', (wall, ctx) => {
    expect(contextFor(wall)).toBe(ctx);
  });
});
