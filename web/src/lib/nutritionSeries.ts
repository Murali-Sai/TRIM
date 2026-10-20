/**
 * Day-by-day calories and macros for the charts (SPEC page 4, "Full charts"), from the daily
 * totals the API sums per local day. Pure, so adherence and averages are unit tested.
 *
 * Rules (SPEC page 3): on target is |intake - target| / target at most 0.05; the rolling 7-day
 * average is the mean of logged days in the last 7 calendar days, with at least 4 needed.
 * Days with nothing logged are shown as gaps, never as zero, and are not counted.
 */
import { isOnTarget } from './chart/headlines';
import { dayNumber } from './trend';
import type { RangeKey } from './weightChart';

export interface DayTotal {
  date: string;
  entries: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  fiber_unknown: number;
}

export type Nutrient = 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g';
type TargetLike = { effective_from: string } & Record<Nutrient, number>;

export interface SeriesDay extends Record<Nutrient, number> {
  date: string;
  logged: boolean;
  target: TargetLike | null;
  /** Calories on target that day (logged, with a target). */
  onTarget: boolean;
}

const DAY_MS = 86_400_000;

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The target row in effect on `day` (rows in any order). */
function targetFor<T extends { effective_from: string }>(
  rows: readonly T[],
  day: string,
): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.effective_from <= day && (!best || r.effective_from > best.effective_from)) best = r;
  }
  return best;
}

/** One row per calendar day from `from` to `to`, inclusive. */
export function daySeries(
  days: readonly DayTotal[],
  targets: readonly TargetLike[],
  from: string,
  to: string,
): SeriesDay[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out: SeriesDay[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const d = byDate.get(day);
    const target = targetFor(targets, day);
    const logged = d !== undefined && d.entries > 0;
    out.push({
      date: day,
      logged,
      kcal: d?.kcal ?? 0,
      protein_g: d?.protein_g ?? 0,
      carbs_g: d?.carbs_g ?? 0,
      fat_g: d?.fat_g ?? 0,
      target,
      onTarget: logged && target !== null && isOnTarget(d.kcal, target.kcal),
    });
  }
  return out;
}

/** On target out of logged days that have a target. */
export function adherence(series: readonly SeriesDay[], key: Nutrient = 'kcal') {
  let onTarget = 0;
  let days = 0;
  for (const d of series) {
    if (!d.logged || !d.target) continue;
    days += 1;
    if (isOnTarget(d[key], d.target[key])) onTarget += 1;
  }
  return { onTarget, days };
}

/** Mean of logged days, or null with none. */
export function average(series: readonly SeriesDay[], key: Nutrient = 'kcal'): number | null {
  const logged = series.filter((d) => d.logged);
  if (logged.length === 0) return null;
  return logged.reduce((s, d) => s + d[key], 0) / logged.length;
}

export const ROLLING_DAYS = 7;
export const ROLLING_MIN = 4;

/** The rolling 7-day average at each day, or null where fewer than 4 days were logged. */
export function rollingAverage(
  series: readonly SeriesDay[],
  key: Nutrient = 'kcal',
): (number | null)[] {
  return series.map((_, i) => {
    const window = series.slice(Math.max(0, i - ROLLING_DAYS + 1), i + 1).filter((d) => d.logged);
    return window.length >= ROLLING_MIN
      ? window.reduce((s, d) => s + d[key], 0) / window.length
      : null;
  });
}

export type BucketKind = 'week' | 'month';

export interface Bucket {
  start: string;
  /** The last day of the bucket inside the series. */
  end: string;
  /** Average per logged day, or null with none logged. */
  average: number | null;
  onTarget: number;
  /** Logged days with a target. */
  days: number;
  logged: number;
  /** The mean target over the bucket's days that have one. */
  target: number | null;
}

/** Weeks start on Monday. */
function bucketStart(day: string, by: BucketKind): string {
  if (by === 'month') return `${day.slice(0, 8)}01`;
  const weekday = (dayNumber(day) + 3) % 7; // 0 is Monday (1 Jan 1970 was a Thursday)
  return addDays(day, -weekday);
}

/** Week or month averages per logged day with the adherence count (the Week and Month
 * toggles). */
export function buckets(series: readonly SeriesDay[], by: BucketKind, key: Nutrient = 'kcal') {
  const out: Bucket[] = [];
  let group: SeriesDay[] = [];
  const flush = () => {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) return;
    const a = adherence(group, key);
    const withTarget = group.filter((d) => d.target);
    const target = withTarget.length
      ? withTarget.reduce((sum, d) => sum + (d.target?.[key] ?? 0), 0) / withTarget.length
      : null;
    out.push({
      start: bucketStart(first.date, by),
      end: last.date,
      average: average(group, key),
      onTarget: a.onTarget,
      days: a.days,
      logged: group.filter((d) => d.logged).length,
      target,
    });
    group = [];
  };
  for (const d of series) {
    const first = group[0];
    if (first && bucketStart(first.date, by) !== bucketStart(d.date, by)) flush();
    group.push(d);
  }
  flush();
  return out;
}

/** Energy shares (4/4/9 kcal per gram) in whole percents that add to 100, by largest
 * remainder; null when nothing was eaten. */
export function calorieSplit(m: { protein_g: number; carbs_g: number; fat_g: number }) {
  const energy = { protein: m.protein_g * 4, carbs: m.carbs_g * 4, fat: m.fat_g * 9 };
  const total = energy.protein + energy.carbs + energy.fat;
  if (total <= 0) return null;
  const keys = ['protein', 'carbs', 'fat'] as const;
  const exact = keys.map((k) => (energy[k] / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((s, v) => s + v, 0);
  const order = keys
    .map((_, i) => i)
    .sort((a, b) => (exact[b] ?? 0) - (floors[b] ?? 0) - ((exact[a] ?? 0) - (floors[a] ?? 0)));
  for (const i of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  return { protein: floors[0] ?? 0, carbs: floors[1] ?? 0, fat: floors[2] ?? 0 };
}

const RANGE_DAYS: Record<Exclude<RangeKey, 'All'>, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 91,
  '6M': 182,
  '1Y': 365,
};

/** [from, to] for a range chip ending today; All starts at the first logged day (or a week). */
export function rangeDates(range: RangeKey, today: string, firstLogged: string | null) {
  if (range === 'All') {
    const weekAgo = addDays(today, -6);
    return [firstLogged && firstLogged < weekAgo ? firstLogged : weekAgo, today] as const;
  }
  return [addDays(today, -(RANGE_DAYS[range] - 1)), today] as const;
}
