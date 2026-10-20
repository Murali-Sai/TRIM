/**
 * Geometry for the Progress dashboard's small SVG visuals (SPEC page 4): the 7 calorie bars,
 * the macro bullet bars and the weight sparkline. Pure, so each is unit tested; the cards draw
 * what these return.
 */
import { isOnTarget, ON_TARGET_BAND } from './chart/headlines';
import { dayNumber } from './trend';

const HEADROOM = 1.1;

export interface WeekBar {
  logged: boolean;
  /** Height from the bottom, in the same units as the box height. */
  height: number;
  over: boolean;
  /** y of the target line and the band edges from the top, or null with no target. */
  targetY: number | null;
  bandTop: number | null;
  bandBottom: number | null;
}

/** Bars from zero (honest axes), the target and its band per day. */
export function weekBars(
  days: readonly { value: number | null; target: number | null }[],
  h: number,
) {
  const max =
    Math.max(
      0,
      ...days.map((d) => d.value ?? 0),
      ...days.map((d) => (d.target ?? 0) * (1 + ON_TARGET_BAND)),
    ) * HEADROOM || 1;
  const y = (v: number) => h - (v / max) * h;
  const bars: WeekBar[] = days.map((d) => ({
    logged: d.value !== null,
    height: d.value === null ? 0 : (d.value / max) * h,
    over: d.value !== null && d.target !== null && d.value > d.target * (1 + ON_TARGET_BAND),
    targetY: d.target === null ? null : y(d.target),
    bandTop: d.target === null ? null : y(d.target * (1 + ON_TARGET_BAND)),
    bandBottom: d.target === null ? null : y(d.target * (1 - ON_TARGET_BAND)),
  }));
  return { max, bars };
}

/** A bullet bar in percent of its track: bar to the average, tick at the target, the band. */
export function bullet(average: number, target: number) {
  const scale = Math.max(average, target * (1 + ON_TARGET_BAND)) * HEADROOM || 1;
  const pct = (v: number) => (v / scale) * 100;
  return {
    bar: pct(average),
    tick: pct(target),
    bandFrom: pct(target * (1 - ON_TARGET_BAND)),
    bandTo: pct(target * (1 + ON_TARGET_BAND)),
    onTarget: isOnTarget(average, target),
  };
}

export const SPARK_DAYS = 30;

/** The last 30 days of weigh-ins as faint dots and the trend as a path; the goal line only
 * when it is within twice the data's own range of it, so a far goal never flattens the line. */
export function sparkline(
  points: readonly { day: string; value: number; trend: number | null }[],
  goal: number | null,
  today: string,
  w: number,
  h: number,
) {
  const end = dayNumber(today);
  const start = end - (SPARK_DAYS - 1);
  const recent = points.filter((p) => dayNumber(p.day) >= start && dayNumber(p.day) <= end);
  const values = recent.flatMap((p) => (p.trend === null ? [p.value] : [p.value, p.trend]));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const span = Math.max(hi - lo, 0.5);
  const goalNear = goal !== null && goal >= lo - 2 * span && goal <= hi + 2 * span;
  if (goalNear && goal !== null) {
    lo = Math.min(lo, goal);
    hi = Math.max(hi, goal);
  }
  const pad = Math.max((hi - lo) * 0.1, 0.2);
  lo -= pad;
  hi += pad;
  const x = (day: string) => ((dayNumber(day) - start) / (SPARK_DAYS - 1)) * w;
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
  const withTrend = recent.filter((p) => p.trend !== null);
  const trend = withTrend
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.trend ?? 0).toFixed(1)}`)
    .join(' ');
  return {
    dots: recent.map((p) => ({ x: x(p.day), y: y(p.value) })),
    trend,
    goalY: goalNear && goal !== null ? y(goal) : null,
    last: withTrend.at(-1)
      ? { x: x(withTrend.at(-1)?.day ?? today), y: y(withTrend.at(-1)?.trend ?? 0) }
      : null,
  };
}
