import { describe, expect, it } from 'vitest';
import { exportDates } from './exportRange';

describe('exportDates', () => {
  const today = '2026-10-17';
  it('counts today in the last 30 and 90 days', () => {
    expect(exportDates('all', today)).toEqual({ date_from: null, date_to: null });
    expect(exportDates('30', today)).toEqual({ date_from: '2026-09-18', date_to: today });
    expect(exportDates('90', today)).toEqual({ date_from: '2026-07-20', date_to: today });
    expect(exportDates('year', today)).toEqual({ date_from: '2026-01-01', date_to: today });
  });
  it('leaves an empty custom side open', () => {
    expect(exportDates('custom', today, { from: '2026-09-01', to: '' })).toEqual({
      date_from: '2026-09-01',
      date_to: null,
    });
  });
});
