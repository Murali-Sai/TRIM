import ref from '../../../shared/reference_day.json';
import type { LogEntry } from '../api/logs';
import { amountLabel, remainingColumns, stripColumns, sumNutrients, targetOn } from './dayTotals';

const entries = ref.entries as LogEntry[];

describe('reference day (SPEC page 4)', () => {
  test('totals are summed unrounded and rounded once', () => {
    const t = sumNutrients(entries);
    expect(Math.round(t.kcal)).toBe(ref.expect.kcal);
    expect(Math.round(t.protein_g)).toBe(ref.expect.protein_g);
    expect(Math.round(t.fat_g)).toBe(ref.expect.fat_g);
    expect(Math.round(t.carbs_g)).toBe(ref.expect.carbs_g);
    // The six rounded calorie values add to one more than the total shows. Expected.
    expect(entries.reduce((s, e) => s + Math.round(e.kcal), 0)).toBe(ref.expect.rounded_items_kcal);
  });

  test('strip columns: eaten / target and percent, calories 77% and protein 99%', () => {
    const cols = stripColumns(sumNutrients(entries), ref.target);
    expect(cols.map((c) => [c.key, c.eaten, c.target, c.pct, c.over])).toEqual([
      ['kcal', 1774, 2300, 77, 0],
      ['protein_g', 148, 150, 99, 0],
      ['fat_g', 44, 65, 68, 0],
      ['carbs_g', 193, 280, 69, 0],
    ]);
    expect(cols.map((c) => c.label)).toEqual(['Calories', 'Protein', 'Fat', 'Carbs']);
  });
});

describe('stripColumns', () => {
  test('over target: the bar is full and the overage is shown, no alarm', () => {
    const [kcal] = stripColumns(
      { kcal: 2342.4, protein_g: 0, fat_g: 0, carbs_g: 0 },
      { kcal: 2300, protein_g: 150, fat_g: 65, carbs_g: 280 },
    );
    expect(kcal).toMatchObject({ eaten: 2342, pct: 102, fill: 1, over: 42 });
  });

  test('a bar never goes below empty', () => {
    const cols = stripColumns(
      { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
      { kcal: 2300, protein_g: 0, fat_g: 65, carbs_g: 280 },
    );
    expect(cols[0]?.fill).toBe(0);
    // A 0 g target shows no percent rather than dividing by zero.
    expect(cols[1]?.pct).toBeNull();
  });
});

describe('remainingColumns (second page)', () => {
  test('what is left, and how much over', () => {
    const left = remainingColumns(
      { kcal: 2342.4, protein_g: 148, fat_g: 44, carbs_g: 193 },
      { kcal: 2300, protein_g: 150, fat_g: 65, carbs_g: 280 },
    );
    expect(left.map((c) => [c.key, c.left, c.over])).toEqual([
      ['kcal', 0, 42],
      ['protein_g', 2, 0],
      ['fat_g', 21, 0],
      ['carbs_g', 87, 0],
    ]);
  });
});

describe('sumNutrients extras', () => {
  test('fiber, sugar and sodium sum known values and count unknown ones', () => {
    const t = sumNutrients([
      { ...entries[0], fiber_g: 2.4, sugar_g: null, sodium_mg: 120 } as LogEntry,
      { ...entries[1], fiber_g: null, sugar_g: 1.1, sodium_mg: 80.5 } as LogEntry,
    ]);
    expect(t.fiber_g).toBe(2.4);
    expect(t.sugar_g).toBe(1.1);
    expect(t.sodium_mg).toBe(200.5);
    expect(t.unknown).toEqual({ fiber_g: 1, sugar_g: 1, sodium_mg: 0 });
  });
});

describe('targetOn', () => {
  const rows = [
    { effective_from: '2026-10-18', kcal: 2000 },
    { effective_from: '2026-10-10', kcal: 2300 },
  ];
  test('the target in effect on a day (rows are newest first)', () => {
    expect(targetOn(rows, '2026-10-17')?.kcal).toBe(2300);
    expect(targetOn(rows, '2026-10-18')?.kcal).toBe(2000);
    expect(targetOn(rows, '2026-10-01')).toBeNull();
  });
});

describe('amountLabel', () => {
  test('grams, or a quantity of a unit ("2 cup", "4 egg")', () => {
    expect(amountLabel({ grams: 350, quantity: null, unit_label: null })).toBe('350 g');
    expect(amountLabel({ grams: 400, quantity: 2, unit_label: '1 cup' })).toBe('2 cup');
    expect(amountLabel({ grams: 200, quantity: 4, unit_label: 'egg' })).toBe('4 egg');
    expect(amountLabel({ grams: 60, quantity: 0.5, unit_label: '1 bar' })).toBe('0.5 bar');
    expect(amountLabel({ grams: null, quantity: null, unit_label: null })).toBe('');
  });
});
