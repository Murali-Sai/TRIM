import { describe, expect, it } from 'vitest';
import { formatReading, fromDisplay, kindOf, toDisplay, unitLabel } from './measureUnits';

describe('measurement units', () => {
  it('stores cm and kg, shows the metric unit', () => {
    expect(toDisplay(90, 'cm')).toBe(90);
    expect(toDisplay(90, 'in')).toBeCloseTo(35.433, 3);
    expect(fromDisplay(35.5, 'in')).toBeCloseTo(90.17, 2);
    expect(toDisplay(80, 'lb')).toBeCloseTo(176.37, 2);
    expect(fromDisplay(176.37, 'lb')).toBeCloseTo(80, 2);
    expect(toDisplay(18.4, '%')).toBe(18.4);
  });

  it('formats to the metric precision', () => {
    expect(formatReading(90, 'cm', 1)).toBe('90.0 cm');
    expect(formatReading(90, 'in', 1)).toBe('35.4 in');
    expect(formatReading(18.44, '%', 1)).toBe('18.4%');
    expect(formatReading(80, 'kg', 0)).toBe('80 kg');
  });

  it('kinds group units that store the same thing', () => {
    expect(kindOf('cm')).toBe(kindOf('in'));
    expect(kindOf('kg')).toBe(kindOf('lb'));
    expect(kindOf('cm')).not.toBe(kindOf('%'));
    expect(unitLabel('%')).toBe('percent (%)');
  });
});
