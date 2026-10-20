import { computeTrend, type Reading } from './trend';
import { buildChartData, rangeWindow, yRange } from './weightChart';

const kg = (v: number) => v;

function readings(rows: [string, number][]): Reading[] {
  return rows.map(([day, value]) => ({ day, at: `${day}T11:00:00Z`, value }));
}

describe('buildChartData', () => {
  test('one x per weigh-in, outliers in their own series', () => {
    const { points } = computeTrend(
      readings([
        ['2026-10-01', 80],
        ['2026-10-02', 83],
        ['2026-10-03', 80.2],
      ]),
    );
    const d = buildChartData(points, kg);
    expect(d.xs).toHaveLength(3);
    expect(d.readings).toEqual([80, undefined, 80.2]);
    expect(d.outliers).toEqual([undefined, 83, undefined]);
    // The outlier has no trend value but does not break the line.
    expect(d.trend[1]).toBeUndefined();
    expect(d.trend[2]).toBeCloseTo(80.038, 3);
  });

  test('a gap over 7 days breaks the solid line and is drawn dashed between real points', () => {
    const { points } = computeTrend(
      readings([
        ['2026-10-01', 80],
        ['2026-10-02', 80],
        ['2026-10-12', 79.5],
        ['2026-10-13', 79.5],
      ]),
    );
    const d = buildChartData(points, kg);
    expect(d.xs).toHaveLength(5); // one break marker
    expect(d.source[2]).toBeNull();
    expect(d.trend[2]).toBeNull();
    expect(d.bandHi[2]).toBeNull();
    expect(d.gapTrend.map((v) => typeof v)).toEqual([
      'undefined',
      'number',
      'undefined',
      'number',
      'undefined',
    ]);
    // No invented points: the dashed series only has the two real ends.
    expect(d.gapTrend[1]).toBe(d.trend[1]);
    expect(d.gapTrend[3]).toBe(d.trend[3]);
  });

  test('a 7-day gap is still solid', () => {
    const { points } = computeTrend(
      readings([
        ['2026-10-01', 80],
        ['2026-10-08', 80],
      ]),
    );
    const d = buildChartData(points, kg);
    expect(d.xs).toHaveLength(2);
    expect(d.gapTrend.every((v) => v === undefined)).toBe(true);
  });

  test('the band is trend plus or minus 1 SD of recent swings, once there are 3', () => {
    const { points } = computeTrend(
      readings([
        ['2026-10-01', 80],
        ['2026-10-02', 81],
        ['2026-10-03', 79],
        ['2026-10-04', 80],
      ]),
    );
    const d = buildChartData(points, kg);
    expect(d.bandHi[0]).toBeUndefined();
    expect(d.bandHi[1]).toBeUndefined();
    const t = d.trend[2] as number;
    const hi = d.bandHi[2] as number;
    const lo = d.bandLo[2] as number;
    expect(hi - t).toBeCloseTo(t - lo, 9);
    expect(hi - t).toBeGreaterThan(0.5);
  });

  test('converts for display', () => {
    const { points } = computeTrend(readings([['2026-10-01', 80]]));
    const d = buildChartData(points, (v) => v * 2);
    expect(d.readings[0]).toBe(160);
    expect(d.trend[0]).toBe(160);
  });
});

describe('rangeWindow', () => {
  test('ends now', () => {
    expect(rangeWindow('1W', 1_000_000)).toEqual([1_000_000 - 7 * 86_400, 1_000_000]);
    expect(rangeWindow('All', 1_000_000)).toBeNull();
  });
});

describe('yRange', () => {
  const { points } = computeTrend(
    readings([
      ['2026-10-01', 80],
      ['2026-10-10', 78],
    ]),
  );
  const d = buildChartData(points, kg);

  test('pads the data', () => {
    const [lo, hi] = yRange(d, null, null) ?? [0, 0];
    expect(lo).toBeLessThan(78);
    expect(hi).toBeGreaterThan(80);
  });

  test('always includes the goal', () => {
    const [lo] = yRange(d, null, 70) ?? [0, 0];
    expect(lo).toBeLessThan(70);
  });

  test('only counts values inside the window', () => {
    const x10 = Date.parse('2026-10-10T11:00:00Z') / 1000;
    const [lo, hi] = yRange(d, [x10 - 3600, x10 + 3600], null) ?? [0, 0];
    expect(hi).toBeLessThan(80);
    expect(lo).toBeLessThan(78);
  });

  test('null with nothing to show', () => {
    expect(yRange(buildChartData([], kg), null, null)).toBeNull();
  });
});
