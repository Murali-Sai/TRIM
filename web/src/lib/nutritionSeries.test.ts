import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adherence,
  average,
  buckets,
  calorieSplit,
  daySeries,
  rangeDates,
  rollingAverage,
  type DayTotal,
} from './nutritionSeries';

interface Fixture {
  targets: {
    effective_from: string;
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  }[];
  days: DayTotal[];
  expected: {
    logged_days: number;
    on_target_days: number;
    on_target_dates: string[];
    weeks_monday_start: { start: string; on_target: number; logged: number }[];
    rolling_7_day: Record<string, number | null>;
    average_kcal: number;
  };
}

const MONTH = JSON.parse(
  readFileSync(join(process.cwd(), '..', 'shared', 'fixture_month.json'), 'utf8'),
) as Fixture;
const series = daySeries(MONTH.days, MONTH.targets, '2026-10-01', '2026-10-31');

describe('the fixture month (shared/fixture_month.json)', () => {
  it('has one row per calendar day, with the target in effect that day', () => {
    expect(series).toHaveLength(31);
    expect(series[5]).toMatchObject({ date: '2026-10-06', logged: false, kcal: 0 });
    expect(series[14]?.target?.kcal).toBe(2300);
    expect(series[15]?.target?.kcal).toBe(2200);
  });

  it('AC: adherence equals the hand count', () => {
    const a = adherence(series);
    expect(a).toEqual({
      onTarget: MONTH.expected.on_target_days,
      days: MONTH.expected.logged_days,
    });
    expect(series.filter((d) => d.onTarget).map((d) => d.date)).toEqual(
      MONTH.expected.on_target_dates,
    );
  });

  it('weeks start on Monday and count their own days', () => {
    const weeks = buckets(series, 'week');
    expect(weeks.map((w) => ({ start: w.start, on_target: w.onTarget, logged: w.days }))).toEqual(
      MONTH.expected.weeks_monday_start,
    );
    // The first week only holds 1 to 4 Oct of this month.
    expect(weeks[0]?.end).toBe('2026-10-04');
  });

  it('the month is one bucket with the whole count', () => {
    const [month] = buckets(series, 'month');
    expect(month).toMatchObject({ start: '2026-10-01', onTarget: 16, days: 27 });
    expect(month?.average).toBeCloseTo(MONTH.expected.average_kcal, 2);
    // 15 days at 2,300 and 16 at 2,200.
    expect(month?.target).toBeCloseTo((15 * 2300 + 16 * 2200) / 31, 6);
  });

  it('averages use logged days only', () => {
    expect(average(series)).toBeCloseTo(MONTH.expected.average_kcal, 2);
  });

  it('the 7-day average needs at least 4 logged days in the window', () => {
    const rolling = rollingAverage(series);
    for (const [date, want] of Object.entries(MONTH.expected.rolling_7_day)) {
      const got = rolling[series.findIndex((d) => d.date === date)];
      if (want === null) expect(got).toBeNull();
      else expect(got).toBeCloseTo(want, 2);
    }
  });
});

describe('edges', () => {
  it('a day with no target is never on target and not counted', () => {
    const s = daySeries(
      [
        {
          date: '2026-10-01',
          entries: 1,
          kcal: 2000,
          protein_g: 0,
          carbs_g: 0,
          fat_g: 0,
          fiber_g: 0,
          fiber_unknown: 0,
        },
      ],
      [],
      '2026-10-01',
      '2026-10-02',
    );
    expect(adherence(s)).toEqual({ onTarget: 0, days: 0 });
    expect(average(s)).toBe(2000);
  });

  it('nothing logged has no average', () => {
    expect(average(daySeries([], [], '2026-10-01', '2026-10-07'))).toBeNull();
  });

  it('macros use their own target', () => {
    const a = adherence(series, 'protein_g');
    expect(a.days).toBe(27);
  });
});

describe('calorie split', () => {
  it('energy shares at 4/4/9 kcal per gram, whole percents adding to 100', () => {
    // 150 P, 250 C, 70 F: 600 + 1000 + 630 = 2230 kcal: 26.9%, 44.8%, 28.3%.
    expect(calorieSplit({ protein_g: 150, carbs_g: 250, fat_g: 70 })).toEqual({
      protein: 27,
      carbs: 45,
      fat: 28,
    });
    // Thirds round to 34, 33, 33 by largest remainder (protein first on a tie).
    expect(calorieSplit({ protein_g: 9, carbs_g: 9, fat_g: 4 })).toEqual({
      protein: 34,
      carbs: 33,
      fat: 33,
    });
  });
  it('nothing eaten has no split', () => {
    expect(calorieSplit({ protein_g: 0, carbs_g: 0, fat_g: 0 })).toBeNull();
  });
});

describe('range dates', () => {
  it('ends today and goes back the range, or to the first logged day for All', () => {
    expect(rangeDates('1W', '2026-10-17', null)).toEqual(['2026-10-11', '2026-10-17']);
    expect(rangeDates('1M', '2026-10-17', null)).toEqual(['2026-09-18', '2026-10-17']);
    expect(rangeDates('All', '2026-10-17', '2025-03-02')).toEqual(['2025-03-02', '2026-10-17']);
    expect(rangeDates('All', '2026-10-17', null)).toEqual(['2026-10-11', '2026-10-17']);
  });
});
