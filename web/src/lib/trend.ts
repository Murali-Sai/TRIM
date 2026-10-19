/**
 * Weight and measurement trend math, exactly as in SPEC page 3 (Algorithms). Display only.
 * Mirrors api/app/trend.py; both pass shared/trend_vectors.json.
 */

/** One weigh-in or measurement. `day` is the user's local date (YYYY-MM-DD). */
export interface Reading {
  day: string;
  at: string;
  value: number;
}

export interface TrendPoint extends Reading {
  /** The trend after this reading; null when it was not counted. */
  trend: number | null;
  /** Too far from the trend: shown hollow and left out of it. */
  outlier: boolean;
  /** The first reading of its day and not an outlier, so it moved the trend. */
  counted: boolean;
}

export interface TrendResult {
  points: TrendPoint[];
  visible: boolean;
  /** More counted readings needed before the trend shows. */
  readingsNeeded: number;
  /** More days of span needed before the trend shows. */
  daysNeeded: number;
}

export interface TrendOptions {
  /** Daily smoothing factor: 0.1 for weight, 0.25 for measurements. */
  alpha?: number;
  /** Outlier when |x - trend| is above the larger of these two. */
  outlierAbs?: number;
  outlierPct?: number;
}

export const WEIGHT_ALPHA = 0.1;
export const MEASUREMENT_ALPHA = 0.25;
export const MIN_READINGS = 5;
export const MIN_SPAN_DAYS = 7;
export const RATE_WINDOW_DAYS = 14;
// Exactly 3% must stay in even when floating point lands a hair above it.
const EPSILON = 1e-9;
const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a YYYY-MM-DD date. */
export function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

/** Smoothing for a gap of `days` days: 1 - (1 - a)^d. */
export function gapAlpha(alpha: number, days: number): number {
  return 1 - (1 - alpha) ** days;
}

export function computeTrend(
  readings: readonly Reading[],
  options: TrendOptions = {},
): TrendResult {
  const alpha = options.alpha ?? WEIGHT_ALPHA;
  const outlierAbs = options.outlierAbs ?? 2.0;
  const outlierPct = options.outlierPct ?? 0.03;

  const sorted = [...readings].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const seenDays = new Set<string>();
  const points: TrendPoint[] = [];
  let trend: number | null = null;
  let lastDay = 0;
  let firstDay = 0;
  let counted = 0;

  for (const r of sorted) {
    const point: TrendPoint = { ...r, trend: null, outlier: false, counted: false };
    points.push(point);
    if (seenDays.has(r.day)) continue; // Only the earliest reading of the day counts.
    seenDays.add(r.day);

    const d = dayNumber(r.day);
    if (trend === null) {
      trend = r.value;
      firstDay = d;
    } else {
      const limit = Math.max(outlierAbs, outlierPct * trend);
      if (Math.abs(r.value - trend) > limit + EPSILON) {
        point.outlier = true;
        continue;
      }
      trend += gapAlpha(alpha, d - lastDay) * (r.value - trend);
    }
    lastDay = d;
    counted += 1;
    point.trend = trend;
    point.counted = true;
  }

  const span = counted === 0 ? 0 : lastDay - firstDay + 1;
  const readingsNeeded = Math.max(0, MIN_READINGS - counted);
  const daysNeeded = Math.max(0, MIN_SPAN_DAYS - span);
  return { points, visible: readingsNeeded === 0 && daysNeeded === 0, readingsNeeded, daysNeeded };
}

/**
 * Least-squares slope of the trend over the last 14 days (ending on the latest point), times 7.
 * Null with fewer than two days of trend.
 */
export function weeklyRate(
  points: readonly { day: string; trend: number | null }[],
  windowDays: number = RATE_WINDOW_DAYS,
): number | null {
  const withTrend = points.flatMap((p) =>
    p.trend === null ? [] : [{ x: dayNumber(p.day), y: p.trend }],
  );
  if (withTrend.length === 0) return null;
  const end = Math.max(...withTrend.map((p) => p.x));
  const recent = withTrend.filter((p) => p.x > end - windowDays);
  const n = recent.length;
  const meanX = recent.reduce((s, p) => s + p.x, 0) / n;
  const meanY = recent.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of recent) {
    sxx += (p.x - meanX) ** 2;
    sxy += (p.x - meanX) * (p.y - meanY);
  }
  return sxx === 0 ? null : (sxy / sxx) * 7;
}
