import type { UnitSystem } from '../../api/auth';
import { kgToLb, lbToKg } from '../../lib/tdee';
import { projectGoal, type Projection } from '../../lib/projection';
import { computeTrend, weeklyRate, type TrendResult } from '../../lib/trend';
import { formatNumber, parseDecimal } from '../../lib/units';
import type { WeightEntry } from '../../api/weights';

export const WEIGHT_RANGE_KG = [30, 300] as const;
export const WEIGHT_RANGE_MESSAGE = 'Enter a weight from 30 to 300 kg (66 to 661 lb).';

export function unitLabel(units: UnitSystem): 'kg' | 'lb' {
  return units === 'imperial' ? 'lb' : 'kg';
}

/** kg to the user's unit, one decimal, without the unit. */
export function displayNumber(kg: number, units: UnitSystem): string {
  return formatNumber(units === 'imperial' ? kgToLb(kg) : kg, 1);
}

export function displayWeight(kg: number, units: UnitSystem): string {
  return `${displayNumber(kg, units)} ${unitLabel(units)}`;
}

/** What the person typed, in kg, or an error message. */
export function parseWeight(raw: string, units: UnitSystem): { kg: number } | { error: string } {
  const n = parseDecimal(raw);
  if (Number.isNaN(n)) return { error: 'Enter your weight as a number.' };
  const kg = units === 'imperial' ? lbToKg(n) : n;
  // Compare at gram precision, the same rounding the server stores.
  const rounded = Math.round(kg * 1000) / 1000;
  if (rounded < WEIGHT_RANGE_KG[0] || rounded > WEIGHT_RANGE_KG[1]) {
    return { error: WEIGHT_RANGE_MESSAGE };
  }
  return { kg: rounded };
}

export function trendFor(entries: readonly WeightEntry[]): TrendResult {
  return computeTrend(entries.map((e) => ({ day: e.day, at: e.measured_at, value: e.kg })));
}

function plural(n: number, word: string): string {
  return `${n} more ${word}${n === 1 ? '' : 's'}`;
}

/** The answer-first sentence above the weigh-ins (SPEC page 4, Dashboard and charts). */
export function trendSentence(trend: TrendResult, units: UnitSystem): string {
  if (trend.points.length === 0) return 'No weigh-ins yet. Add your first one to get started.';
  if (!trend.visible) {
    return trend.readingsNeeded > 0
      ? `Log ${plural(trend.readingsNeeded, 'weigh-in')} to see your trend.`
      : `Keep weighing in over ${plural(trend.daysNeeded, 'day')} to see your trend.`;
  }
  const latest = [...trend.points].reverse().find((p) => p.trend !== null)?.trend ?? 0;
  const rate = weeklyRate(trend.points);
  const perWeek = rate === null ? 0 : units === 'imperial' ? kgToLb(rate) : rate;
  const shown = Math.abs(Math.round(perWeek * 10) / 10);
  const direction =
    shown === 0
      ? 'steady'
      : `${perWeek < 0 ? 'down' : 'up'} ${formatNumber(shown, 1)} ${unitLabel(units)} a week`;
  return `Trend ${displayWeight(latest, units)}, ${direction}`;
}

/** The goal-date projection for the latest trend, from the user's local today. */
export function projectionFor(
  trend: TrendResult,
  goalKg: number | null,
  today: string,
): Projection {
  const latest = [...trend.points].reverse().find((p) => p.trend !== null)?.trend ?? null;
  if (latest === null) return { kind: 'none' };
  return projectGoal({
    trend_kg: latest,
    goal_kg: goalKg,
    weekly_rate_kg: weeklyRate(trend.points),
    trend_visible: trend.visible,
    today,
  });
}

/** "31 Dec 2026", the SPEC's date style, for a YYYY-MM-DD date. */
export function formatLongDate(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${day}T00:00:00Z`));
}

export const NO_PROJECTION = 'No projection: your trend is flat or moving away from your goal.';

export function projectionSentence(
  projection: Projection,
  goalKg: number | null,
  units: UnitSystem,
): string | null {
  if (projection.kind === 'none' || goalKg === null) return null;
  if (projection.kind === 'no_projection') return NO_PROJECTION;
  return (
    `${displayWeight(goalKg, units)} goal around ${formatLongDate(projection.date)} ` +
    'if your current rate continues.'
  );
}
