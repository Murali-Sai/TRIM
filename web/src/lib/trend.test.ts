import vectors from '../../../shared/trend_vectors.json';
import { computeTrend, gapAlpha, weeklyRate, type Reading, type TrendOptions } from './trend';

// The same vectors run in api/tests/test_trend.py, so both implementations agree.

function near(actual: number | null | undefined, want: number | null, tol: number, what: string) {
  if (want === null) {
    expect(actual ?? null, what).toBeNull();
  } else {
    expect(actual, what).not.toBeNull();
    expect(Math.abs((actual ?? NaN) - want), what).toBeLessThanOrEqual(tol);
  }
}

describe('gapAlpha', () => {
  test.each(vectors.gap_alpha.map((v) => [v.name, v] as const))('%s', (_, v) => {
    near(gapAlpha(v.alpha, v.days), v.expect, 0.001, 'a_eff');
  });
});

describe('computeTrend', () => {
  test.each(vectors.trend.map((v) => [v.name, v] as const))('%s', (_, v) => {
    const options: TrendOptions = 'alpha' in v ? { alpha: v.alpha } : {};
    const result = computeTrend(v.readings as Reading[], options);
    expect(result.points).toHaveLength(v.expect.points.length);
    v.expect.points.forEach((want, i) => {
      const got = result.points[i];
      expect({ day: got?.day, outlier: got?.outlier, counted: got?.counted }).toEqual({
        day: want.day,
        outlier: want.outlier,
        counted: want.counted,
      });
      near(got?.trend, want.trend, 0.01, `points[${i}].trend`);
    });
    expect({
      visible: result.visible,
      readingsNeeded: result.readingsNeeded,
      daysNeeded: result.daysNeeded,
    }).toEqual({
      visible: v.expect.visible,
      readingsNeeded: v.expect.readings_needed,
      daysNeeded: v.expect.days_needed,
    });
  });

  test('does not change the caller array', () => {
    const readings: Reading[] = [
      { day: '2026-10-02', at: '2026-10-02T07:00:00Z', value: 79 },
      { day: '2026-10-01', at: '2026-10-01T07:00:00Z', value: 80 },
    ];
    computeTrend(readings);
    expect(readings[0]?.day).toBe('2026-10-02');
  });
});

describe('weeklyRate', () => {
  test.each(vectors.weekly_rate.map((v) => [v.name, v] as const))('%s', (_, v) => {
    near(weeklyRate(v.points), v.expect, 0.01, 'kg per week');
  });

  test('rounds to the SPEC figure of -0.45 kg a week', () => {
    const rate = weeklyRate(vectors.weekly_rate[0]?.points ?? []);
    expect(Math.round((rate ?? 0) * 100) / 100).toBe(-0.45);
  });
});
