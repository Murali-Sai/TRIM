import { describe, expect, it } from 'vitest';
import type { PhaseSummary } from '../api/phases';
import { phaseBands, phaseDates, summaryLines } from './phases';

const cut = { name: 'Cut', kind: 'cut' as const, start_date: '2026-09-01', end_date: '2026-09-28' };

describe('phaseBands', () => {
  it('runs from the first local midnight to the end of the last day', () => {
    const [b] = phaseBands([cut], { kind: 'zoned', timeZone: 'America/New_York' }, '2026-10-17');
    // New York is UTC-4 in September.
    expect(b?.from).toBe(Date.parse('2026-09-01T04:00:00Z') / 1000);
    expect(b?.to).toBe(Date.parse('2026-09-29T04:00:00Z') / 1000);
  });

  it('uses whole UTC days for the daily bars', () => {
    const [b] = phaseBands([cut], { kind: 'utc-days' }, '2026-10-17');
    expect(b?.from).toBe(Date.parse('2026-09-01T00:00:00Z') / 1000);
    expect(b?.to).toBe(Date.parse('2026-09-29T00:00:00Z') / 1000);
  });

  it('ends an ongoing phase today, skips one not started, and sorts by start', () => {
    const bands = phaseBands(
      [
        { name: 'Bulk', kind: 'bulk', start_date: '2026-10-01', end_date: null },
        { name: 'Later', kind: 'custom', start_date: '2026-11-01', end_date: null },
        cut,
      ],
      { kind: 'utc-days' },
      '2026-10-17',
    );
    expect(bands.map((b) => b.name)).toEqual(['Cut', 'Bulk']);
    expect(bands[1]?.to).toBe(Date.parse('2026-10-18T00:00:00Z') / 1000);
  });

  it('keeps a DST change inside a phase', () => {
    const [b] = phaseBands(
      [{ name: 'Cut', kind: 'cut', start_date: '2026-10-31', end_date: '2026-11-01' }],
      { kind: 'zoned', timeZone: 'America/New_York' },
      '2026-11-10',
    );
    // 31 Oct starts at UTC-4, 2 Nov at UTC-5: 49 hours.
    expect(((b?.to ?? 0) - (b?.from ?? 0)) / 3600).toBe(49);
  });
});

describe('phaseDates', () => {
  it('says the dates in plain words', () => {
    expect(phaseDates({ ...cut, status: 'ended' })).toBe('1 Sep to 28 Sep 2026');
    expect(phaseDates({ start_date: '2025-12-01', end_date: '2026-01-31', status: 'ended' })).toBe(
      '1 Dec 2025 to 31 Jan 2026',
    );
    expect(phaseDates({ start_date: '2026-10-01', end_date: null, status: 'ongoing' })).toBe(
      '1 Oct 2026 to now',
    );
    expect(phaseDates({ start_date: '2026-11-02', end_date: null, status: 'upcoming' })).toBe(
      'From 2 Nov 2026',
    );
  });
});

describe('summaryLines', () => {
  const summary: PhaseSummary = {
    days: 30,
    logged_days: 24,
    avg_kcal: 1948,
    avg_target_kcal: 2000,
    days_on_target: 18,
    weight: { start_kg: 80, end_kg: 78.8, change_kg: -1.2, weekly_kg: -0.31 },
    measurements: [
      { type_id: 'w', name: 'Waist', side: null, unit: 'cm', start: 90, end: 87.3, change: -2.7 },
      { type_id: 't', name: 'Thigh', side: 'left', unit: 'in', start: 56, end: 56, change: 0 },
    ],
  };

  it('reads like the cards', () => {
    expect(summaryLines(summary, 'metric')).toEqual([
      { label: 'Days', value: '30 days, food logged on 24' },
      { label: 'Calories', value: 'Avg 1,948 kcal, target 2,000' },
      { label: 'On target', value: '18 of 24 logged days' },
      { label: 'Weight trend', value: 'down 1.2 kg, 0.31 kg a week' },
      { label: 'Waist', value: 'down 2.7 cm' },
      { label: 'Thigh, left', value: 'no change' },
    ]);
  });

  it('converts weight for imperial accounts and says what is missing', () => {
    const lines = summaryLines(
      { ...summary, avg_kcal: null, avg_target_kcal: null, logged_days: 0, measurements: [] },
      'imperial',
    );
    expect(lines).toContainEqual({ label: 'Calories', value: 'No food logged yet' });
    expect(lines).toContainEqual({ label: 'Weight trend', value: 'down 2.6 lb, 0.68 lb a week' });
    const none = summaryLines({ ...summary, weight: null }, 'metric');
    expect(none).toContainEqual({
      label: 'Weight trend',
      value: 'Needs 2 weigh-ins in the phase',
    });
  });

  it('never judges the numbers', () => {
    const words = summaryLines(summary, 'metric')
      .map((l) => l.value)
      .join(' ')
      .toLowerCase();
    for (const w of ['great', 'good', 'bad', 'only', 'failed', 'should']) {
      expect(words).not.toContain(w);
    }
  });
});
