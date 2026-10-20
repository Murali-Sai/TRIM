import { describe, expect, it } from 'vitest';
import { nearestIndex } from './nearest';

describe('nearestIndex', () => {
  const has = (values: (number | null)[]) => (i: number) => values[i] != null;

  it('finds the closest point that has a value', () => {
    const v = [1, null, null, 4, null];
    expect(nearestIndex(v.length, 1, has(v))).toBe(0);
    expect(nearestIndex(v.length, 2, has(v))).toBe(3);
    expect(nearestIndex(v.length, 4, has(v))).toBe(3);
  });

  it('is null with no cursor or no values', () => {
    expect(nearestIndex(3, null, () => true)).toBeNull();
    expect(nearestIndex(3, 1, () => false)).toBeNull();
  });
});
