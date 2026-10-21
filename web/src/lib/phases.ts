import type { UnitSystem } from '../api/auth';
import type { MeasureUnit } from '../api/measurements';
import type { Phase, PhaseKind, PhaseSummary } from '../api/phases';
import { shortDate } from './chart/headlines';
import { toDisplay } from './measureUnits';
import { addDays } from './nutritionSeries';
import { kgToLb } from './tdee';
import { formatNumber } from './units';
import { zonedWallToIso } from './zoned';

/** A phase as a span on a time chart, in unix seconds. */
export interface PhaseBand {
  name: string;
  kind: PhaseKind;
  from: number;
  to: number;
}

/**
 * How a chart places days on its x axis: "zoned" charts plot real instants (weigh-ins and
 * readings), so a day runs from local midnight to the next; "utc-days" charts (the daily bars)
 * plot each date at noon UTC, so a day runs from 00:00 to 24:00 UTC.
 */
export type DayAxis = { kind: 'zoned'; timeZone: string } | { kind: 'utc-days' };

function dayStart(day: string, axis: DayAxis): number {
  const iso =
    axis.kind === 'zoned' ? zonedWallToIso(`${day}T00:00`, axis.timeZone) : `${day}T00:00:00Z`;
  return Date.parse(iso) / 1000;
}

/** Bands from the first day of each phase to the end of its last (today for an ongoing one).
 * An ongoing phase that has not started yet has no band. */
export function phaseBands(
  phases: readonly Pick<Phase, 'name' | 'kind' | 'start_date' | 'end_date'>[],
  axis: DayAxis,
  today: string,
): PhaseBand[] {
  return phases
    .map((p) => ({ p, last: p.end_date ?? today }))
    .filter(({ p, last }) => last >= p.start_date)
    .map(({ p, last }) => ({
      name: p.name,
      kind: p.kind,
      from: dayStart(p.start_date, axis),
      to: dayStart(addDays(last, 1), axis),
    }))
    .sort((a, b) => a.from - b.from);
}

/** Neutral tints (never the nutrient colors): the kind shows as a shade and the name at the
 * top edge, so color is never the only cue. */
export const BAND_ALPHA: Record<PhaseKind, number> = {
  cut: 0.1,
  maintain: 0.05,
  bulk: 0.15,
  custom: 0.08,
};

export const KIND_NAMES: Record<PhaseKind, string> = {
  cut: 'Cut',
  maintain: 'Maintain',
  bulk: 'Bulk',
  custom: 'Your own name',
};

/** "1 Sep to 28 Sep 2026", "1 Oct 2026 to now". */
export function phaseDates(p: Pick<Phase, 'start_date' | 'end_date' | 'status'>): string {
  const year = (d: string) => d.slice(0, 4);
  const start = shortDate(p.start_date);
  if (!p.end_date) {
    return p.status === 'upcoming'
      ? `From ${start} ${year(p.start_date)}`
      : `${start} ${year(p.start_date)} to now`;
  }
  const sameYear = year(p.start_date) === year(p.end_date);
  return `${start}${sameYear ? '' : ` ${year(p.start_date)}`} to ${shortDate(p.end_date)} ${year(p.end_date)}`;
}

function signed(change: number, unit: string, digits = 1): string {
  const shown = Math.abs(change);
  if (Number(shown.toFixed(digits)) === 0) return 'no change';
  return `${change < 0 ? 'down' : 'up'} ${formatNumber(shown, digits)}${unit === '%' ? '%' : ` ${unit}`}`;
}

export interface SummaryLine {
  label: string;
  value: string;
}

/** The phase summary as label and value pairs, in plain words (SPEC page 3, Diet phases). */
export function summaryLines(s: PhaseSummary, units: UnitSystem): SummaryLine[] {
  const lines: SummaryLine[] = [
    {
      label: 'Days',
      value: `${s.days} ${s.days === 1 ? 'day' : 'days'}, food logged on ${s.logged_days}`,
    },
  ];
  if (s.avg_kcal === null) {
    lines.push({ label: 'Calories', value: 'No food logged yet' });
  } else {
    const target =
      s.avg_target_kcal === null ? 'no target set' : `target ${formatNumber(s.avg_target_kcal)}`;
    lines.push({ label: 'Calories', value: `Avg ${formatNumber(s.avg_kcal)} kcal, ${target}` });
    if (s.avg_target_kcal !== null) {
      lines.push({
        label: 'On target',
        value: `${s.days_on_target} of ${s.logged_days} logged ${s.logged_days === 1 ? 'day' : 'days'}`,
      });
    }
  }
  const kg = (v: number) => (units === 'imperial' ? kgToLb(v) : v);
  const wu = units === 'imperial' ? 'lb' : 'kg';
  if (s.weight === null) {
    lines.push({ label: 'Weight trend', value: 'Needs 2 weigh-ins in the phase' });
  } else {
    const weekly = s.weight.weekly_kg === null ? null : kg(s.weight.weekly_kg);
    let value = signed(kg(s.weight.change_kg), wu);
    if (weekly !== null && value !== 'no change') {
      value += `, ${formatNumber(Math.abs(weekly), 2)} ${wu} a week`;
    }
    lines.push({ label: 'Weight trend', value });
  }
  for (const m of s.measurements) {
    const unit = m.unit as MeasureUnit;
    const change = toDisplay(m.end, unit) - toDisplay(m.start, unit);
    lines.push({
      label: m.side ? `${m.name}, ${m.side}` : m.name,
      value: signed(change, unit),
    });
  }
  return lines;
}
