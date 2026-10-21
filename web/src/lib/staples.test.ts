import { describe, expect, it } from 'vitest';
import {
  allowedAmounts,
  amountsError,
  defaultAmounts,
  formatUnits,
  isCountable,
  moveItem,
  stapleAmountLine,
} from './staples';

describe('countable units (same words as the API)', () => {
  it.each([
    ['1 egg', true],
    ['1 large egg', true],
    ['1 bottle (500 ml)', true],
    ['2 slices', true],
    ['100 g', false],
    ['250g', false],
    ['1 cup (240 ml)', false],
    ['2 fl oz', false],
    ['1 serving', false],
    ['1 meal', false],
    ['', false],
  ])('%s countable: %s', (label, countable) => {
    expect(isCountable(label)).toBe(countable);
  });

  it('defaults follow the unit', () => {
    expect(defaultAmounts('1 egg')).toEqual({ min: 1, max: 4, step: 1 });
    expect(defaultAmounts('100 g')).toEqual({ min: 0.5, max: 3, step: 0.5 });
  });

  it('formats amounts without trailing zeros', () => {
    expect([1, 0.5, 1.25, 2.1].map(formatUnits)).toEqual(['1', '0.5', '1.25', '2.1']);
  });
});

describe('allowed amounts (same rules as the API)', () => {
  it('countable defaults: 1 to 4 in steps of 1', () => {
    expect(allowedAmounts(1, 4, 1)).toEqual([1, 2, 3, 4]);
  });

  it('other units: 0.5 to 3 in steps of 0.5', () => {
    expect(allowedAmounts(0.5, 3, 0.5)).toEqual([0.5, 1, 1.5, 2, 2.5, 3]);
  });

  it('quarter steps stay exact', () => {
    expect(allowedAmounts(1, 2, 0.25)).toEqual([1, 1.25, 1.5, 1.75, 2]);
  });

  it('refuses more than 7 amounts, uneven steps and a backwards range', () => {
    expect(amountsError(0.5, 4, 0.5)).toBe(
      'Allow at most 7 amounts. Use a bigger step or a narrower range.',
    );
    expect(amountsError(0.5, 3, 0.7)).toBe(
      'The step must fit evenly between the smallest and largest amounts.',
    );
    expect(amountsError(3, 2, 1)).toBe('The largest amount must be at least the smallest.');
    expect(amountsError(0, 2, 1)).toBe('Amounts must be more than 0.');
    expect(amountsError(Number.NaN, 2, 1)).toBe('Amounts must be more than 0.');
    expect(allowedAmounts(1, 7, 1)).toHaveLength(7);
  });
});

describe('stapleAmountLine', () => {
  it('names the unit and the range', () => {
    expect(stapleAmountLine({ unit_label: '1 egg', min_units: 1, max_units: 4 })).toBe(
      '1 egg · 1 to 4',
    );
    expect(stapleAmountLine({ unit_label: '100 g', min_units: 0.5, max_units: 3 })).toBe(
      '100 g · 0.5 to 3',
    );
    expect(stapleAmountLine({ unit_label: '1 meal', min_units: 1, max_units: 1 })).toBe(
      '1 meal · 1',
    );
  });
});

describe('moveItem', () => {
  it('moves one item and keeps the rest in order', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 1, 5)).toEqual(['a', 'b']);
  });
});
