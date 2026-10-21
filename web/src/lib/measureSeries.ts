/**
 * Measurement math for the charts and tables (SPEC page 3, Algorithms; page 4, Full charts).
 * Values are in the stored unit (cm, kg or %). Indexed change mirrors api/app/measure_math.py;
 * both pass shared/measurement_vectors.json.
 */
import type { Reading } from './trend';

/** 100 x (v / v_base - 1): waist 90.0 to 87.3 cm is -3.0%. */
export function indexedChange(value: number, base: number): number {
  return 100 * (value / base - 1);
}

export interface Change {
  start: Reading;
  latest: Reading;
  /** latest - start, in the stored unit. */
  change: number;
  pct: number;
}

function byTime(readings: readonly Reading[]): Reading[] {
  return [...readings].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** From the first reading on or after `from` (or the first of all) to the latest. */
export function changeSince(
  readings: readonly Reading[],
  from: string | null = null,
): Change | null {
  const sorted = byTime(readings).filter((r) => from === null || r.day >= from);
  const start = sorted[0];
  const latest = sorted.at(-1);
  if (!start || !latest || sorted.length < 2) return null;
  return {
    start,
    latest,
    change: latest.value - start.value,
    pct: indexedChange(latest.value, start.value),
  };
}

export interface OverlayPoint {
  day: string;
  at: string;
  pct: number;
}

/** Percent change since the first reading on or after `from`, for the overlay chart. */
export function overlayLine(readings: readonly Reading[], from: string): OverlayPoint[] {
  const sorted = byTime(readings).filter((r) => r.day >= from);
  const base = sorted[0];
  if (!base) return [];
  return sorted.map((r) => ({ day: r.day, at: r.at, pct: indexedChange(r.value, base.value) }));
}

/** The API's readings of one metric, as trend inputs with the user's local day. */
export function readingsOf(
  entries: readonly { value: number | null; measured_at: string }[],
  dayOf: (iso: string) => string,
): Reading[] {
  return entries
    .filter((e): e is { value: number; measured_at: string } => e.value !== null)
    .map((e) => ({ day: dayOf(e.measured_at), at: e.measured_at, value: e.value }));
}

type Value = number | null | undefined;

/** Gaps longer than this break the trend line instead of drawing through them. */
export const LONG_GAP_DAYS = 7;

export interface SideData {
  readings: Value[];
  trend: Value[];
}

/**
 * Aligned arrays for uPlot: one x per reading of any side, each side's readings as points and
 * its trend as a line that breaks (null) across gaps over 7 days. `undefined` keeps a line
 * going past another side's x.
 */
export function alignSides(
  sides: readonly {
    points: readonly { at: string; day: string; value: number; trend: number | null }[];
  }[],
): { xs: number[]; sides: SideData[] } {
  const xs = [
    ...new Set(sides.flatMap((s) => s.points.map((p) => Math.round(Date.parse(p.at) / 1000)))),
  ].sort((a, b) => a - b);
  const index = new Map(xs.map((x, i) => [x, i]));
  const out = sides.map(() => ({
    readings: xs.map((): Value => undefined),
    trend: xs.map((): Value => undefined),
  }));
  sides.forEach((s, k) => {
    const side = out[k];
    if (!side) return;
    let lastDay: string | null = null;
    for (const p of s.points) {
      const i = index.get(Math.round(Date.parse(p.at) / 1000));
      if (i === undefined) continue;
      side.readings[i] = p.value;
      if (p.trend === null) continue;
      if (
        lastDay !== null &&
        (Date.parse(p.day) - Date.parse(lastDay)) / 86_400_000 > LONG_GAP_DAYS
      ) {
        // A null just before this point breaks the line across the long gap.
        if (i > 0 && side.trend[i - 1] === undefined) side.trend[i - 1] = null;
      }
      side.trend[i] = p.trend;
      lastDay = p.day;
    }
  });
  return { xs, sides: out };
}
