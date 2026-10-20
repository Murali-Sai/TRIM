/**
 * Turns trend points into the aligned arrays the weight chart draws (SPEC page 4, Full charts).
 * Pure, so the rules are unit tested without a canvas.
 *
 * In these arrays `undefined` means "no value here, keep the line going" and `null` means
 * "break the line": uPlot spans undefined and breaks on null.
 */
import { dayNumber, type TrendPoint } from './trend';

export type RangeKey = '1W' | '1M' | '3M' | '6M' | '1Y' | 'All';
export const RANGES: readonly RangeKey[] = ['1W', '1M', '3M', '6M', '1Y', 'All'];
export const DEFAULT_RANGE: RangeKey = '1M';
const RANGE_DAYS: Record<RangeKey, number | null> = {
  '1W': 7,
  '1M': 30,
  '3M': 91,
  '6M': 182,
  '1Y': 365,
  All: null,
};

/** Gaps longer than this are drawn dashed, with no invented points. */
export const LONG_GAP_DAYS = 7;
/** "Typical daily swing": trend plus or minus 1 SD of the last 14 days of swings. */
export const SWING_WINDOW_DAYS = 14;
const MIN_SWINGS = 3;

type Value = number | null | undefined;

export interface ChartData {
  xs: number[]; // unix seconds
  readings: Value[];
  outliers: Value[];
  trend: Value[];
  gapTrend: Value[];
  bandHi: Value[];
  bandLo: Value[];
  /** The point at each x, or null for the break markers between long gaps. */
  source: (TrendPoint | null)[];
}

function sd(values: readonly number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** `convert` turns kg into the display unit. */
export function buildChartData(
  points: readonly TrendPoint[],
  convert: (kg: number) => number,
): ChartData {
  const data: ChartData = {
    xs: [],
    readings: [],
    outliers: [],
    trend: [],
    gapTrend: [],
    bandHi: [],
    bandLo: [],
    source: [],
  };
  const swings: { day: number; swing: number }[] = [];
  let lastCounted: { day: number; x: number; index: number } | null = null;

  for (const p of points) {
    const x = Date.parse(p.at) / 1000;
    const day = dayNumber(p.day);

    if (p.counted && p.trend !== null && lastCounted && day - lastCounted.day > LONG_GAP_DAYS) {
      // Break the solid trend and band just after the last counted point, and draw the
      // gap as a dashed segment between the two real points.
      data.xs.push(lastCounted.x + 1);
      data.readings.push(undefined);
      data.outliers.push(undefined);
      data.trend.push(null);
      data.gapTrend.push(undefined);
      data.bandHi.push(null);
      data.bandLo.push(null);
      data.source.push(null);
      data.gapTrend[lastCounted.index] = data.trend[lastCounted.index];
    }

    const index = data.xs.length;
    data.xs.push(x);
    data.source.push(p);
    data.readings.push(p.outlier ? undefined : convert(p.value));
    data.outliers.push(p.outlier ? convert(p.value) : undefined);
    data.gapTrend.push(undefined);

    if (p.counted && p.trend !== null) {
      const t = convert(p.trend);
      data.trend.push(t);
      if (lastCounted && day - lastCounted.day > LONG_GAP_DAYS) data.gapTrend[index] = t;

      swings.push({ day, swing: convert(p.value) - t });
      const recent = swings.filter((s) => s.day > day - SWING_WINDOW_DAYS).map((s) => s.swing);
      const width = recent.length >= MIN_SWINGS ? sd(recent) : null;
      data.bandHi.push(width === null ? undefined : t + width);
      data.bandLo.push(width === null ? undefined : t - width);
      lastCounted = { day, x, index };
    } else {
      data.trend.push(undefined);
      data.bandHi.push(undefined);
      data.bandLo.push(undefined);
    }
  }
  return data;
}

/** The x window for a range chip, ending now. Null for All (fit the data). */
export function rangeWindow(range: RangeKey, nowSec: number): [number, number] | null {
  const days = RANGE_DAYS[range];
  return days === null ? null : [nowSec - days * 86_400, nowSec];
}

/** Y limits: the visible values plus the goal, so the goal line is always on the chart. */
export function yRange(
  data: ChartData,
  window: [number, number] | null,
  goal: number | null,
): [number, number] | null {
  const values: number[] = goal === null ? [] : [goal];
  data.xs.forEach((x, i) => {
    if (window && (x < window[0] || x > window[1])) return;
    for (const series of [data.readings, data.outliers, data.bandHi, data.bandLo]) {
      const v = series[i];
      if (typeof v === 'number') values.push(v);
    }
  });
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.08, 0.5);
  return [min - pad, max + pad];
}
