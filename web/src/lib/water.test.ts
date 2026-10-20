import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fiberDefault } from './tdee';
import { ML_PER_FL_OZ, flOzToMl, formatWater, mlToFlOz, parseWater, waterButtons } from './water';

const FIBER = JSON.parse(
  readFileSync(join(process.cwd(), '..', 'shared', 'fiber_vectors.json'), 'utf8'),
) as { cases: { kcal: number; fiber_g: number }[] };

describe('fiber default (SPEC page 3, Fiber)', () => {
  it('AC: 2,759 kcal gives 39 g', () => {
    expect(fiberDefault(2759)).toBe(39);
  });
  it.each(FIBER.cases)('$kcal kcal gives $fiber_g g', ({ kcal, fiber_g }) => {
    expect(fiberDefault(kcal)).toBe(fiber_g);
  });
});

describe('fl oz (1 fl oz = 29.5735 ml)', () => {
  it('AC: converts both ways', () => {
    expect(ML_PER_FL_OZ).toBe(29.5735);
    expect(flOzToMl(8)).toBe(237); // 236.588 ml, stored as whole ml
    expect(flOzToMl(16)).toBe(473); // 473.176
    expect(flOzToMl(1)).toBe(30);
    expect(mlToFlOz(250)).toBeCloseTo(8.4535, 4);
    expect(mlToFlOz(2000)).toBeCloseTo(67.628, 3);
    // A stored add shows as the amount typed.
    expect(Math.round(mlToFlOz(flOzToMl(8)))).toBe(8);
  });

  it('formats in the chosen unit', () => {
    expect(formatWater(1750, 'ml')).toBe('1,750 ml');
    expect(formatWater(2000, 'fl_oz')).toBe('68 fl oz');
    expect(formatWater(237, 'fl_oz')).toBe('8 fl oz');
  });

  it('quick buttons are +250 and +500 ml, or +8 and +16 fl oz', () => {
    expect(waterButtons('ml')).toEqual([
      { label: '+250 ml', ml: 250 },
      { label: '+500 ml', ml: 500 },
    ]);
    expect(waterButtons('fl_oz')).toEqual([
      { label: '+8 fl oz', ml: 237 },
      { label: '+16 fl oz', ml: 473 },
    ]);
  });

  it('reads a custom amount in the chosen unit', () => {
    expect(parseWater('330', 'ml')).toBe(330);
    expect(parseWater('12', 'fl_oz')).toBe(355);
    expect(parseWater('0', 'ml')).toBeNull();
    expect(parseWater('6000', 'ml')).toBeNull();
    expect(parseWater('abc', 'fl_oz')).toBeNull();
  });
});
