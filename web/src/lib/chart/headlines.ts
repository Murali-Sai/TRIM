/**
 * Answer-first sentences for every card and chart (SPEC page 4, "Dashboard and charts"): the
 * headline, the sentence tooltip, the too-little-data message and the aria-label built from
 * the headline. Plain words only; over target is "over", never an alarm.
 */
import type { RangeKey } from '../weightChart';
import { formatNumber } from '../units';

/** On target: within 5% either side (the shaded band). */
export const ON_TARGET_BAND = 0.05;

export function isOnTarget(value: number, target: number): boolean {
  return Math.abs(value - target) <= target * ON_TARGET_BAND;
}

const whole = (x: number) => formatNumber(Math.round(x));
const tenth = (x: number) => formatNumber(Math.round(x * 10) / 10, 1);
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** "526 kcal left · 2 g protein to go" */
export function todayHeadline(
  eaten: { kcal: number; protein_g: number },
  target: { kcal: number; protein_g: number },
): string {
  const kcal = Math.round(target.kcal - eaten.kcal);
  const protein = Math.round(target.protein_g - eaten.protein_g);
  const first =
    kcal > 0
      ? `${whole(kcal)} kcal left`
      : kcal < 0
        ? `${whole(-kcal)} kcal over`
        : 'Calorie target met';
  const second = protein > 0 ? `${whole(protein)} g protein to go` : 'protein target met';
  return `${first} · ${second}`;
}

/** "Avg 2,150 a day · on target 5 of 7 days" */
export function caloriesWeekHeadline(w: { average: number; onTarget: number; days: number }) {
  return `Avg ${whole(w.average)} a day · on target ${w.onTarget} of ${days(w.days)}`;
}

/** "Protein 142 of 150 g a day" */
export function macroWeekHeadline(name: string, average: number, target: number): string {
  return `${name} ${whole(average)} of ${whole(target)} g a day`;
}

/** "79.8 kg trend · down 0.4 kg a week"; `trend` and `perWeek` are in `unit`. */
export function weightHeadline(w: { trend: number; perWeek: number; unit: 'kg' | 'lb' }) {
  const shown = Math.round(Math.abs(w.perWeek) * 10) / 10;
  const direction =
    shown === 0 ? 'steady' : `${w.perWeek < 0 ? 'down' : 'up'} ${tenth(shown)} ${w.unit} a week`;
  return `${tenth(w.trend)} ${w.unit} trend · ${direction}`;
}

/** "1 Sep" for a YYYY-MM-DD date. */
export function shortDate(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
    .format(new Date(`${day}T12:00:00Z`))
    .replace('Sept', 'Sep');
}

/** "Tue 14 Oct" for a YYYY-MM-DD date. */
export function weekdayDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(d);
  return `${weekday} ${shortDate(day)}`;
}

/** "Waist down 2.7 cm since 1 Sep"; `change` is in `unit`. */
export function measurementHeadline(m: {
  metric: string;
  change: number;
  unit: string;
  since: string;
}): string {
  const shown = Math.round(Math.abs(m.change) * 10) / 10;
  const what =
    shown === 0 ? 'unchanged' : `${m.change < 0 ? 'down' : 'up'} ${tenth(shown)} ${m.unit}`;
  return `${m.metric} ${what} since ${shortDate(m.since)}`;
}

/** "23-day streak · 2 of 3 goals done" (rewards logging only). */
export function streakHeadline(s: { days: number; goalsDone: number; goals: number }): string {
  const streak = s.days > 0 ? `${s.days}-day streak` : 'Log today to start a streak';
  return s.goals > 0 ? `${streak} · ${s.goalsDone} of ${s.goals} goals done` : streak;
}

/** "Avg 2,310 kcal, on target 5 of 7 days" */
export function checkInHeadline(w: { average: number; onTarget: number; days: number }): string {
  return `Avg ${whole(w.average)} kcal, on target ${w.onTarget} of ${days(w.days)}`;
}

/** "Tue 14 Oct: 2,180 kcal, 120 under target", with the exact difference. */
export function dayTooltip(
  day: string,
  value: number,
  target: number | null,
  unit = 'kcal',
): string {
  const when = weekdayDate(day);
  if (value <= 0) return `${when}: nothing logged`;
  const amount = `${whole(value)} ${unit === 'kcal' ? 'kcal' : unit}`;
  if (target === null || target <= 0) return `${when}: ${amount}`;
  const diff = Math.round(value - target);
  if (diff === 0) return `${when}: ${amount}, on target`;
  return `${when}: ${amount}, ${whole(Math.abs(diff))} ${diff < 0 ? 'under' : 'over'} target`;
}

type Needed = 'weigh-ins' | 'days' | 'measurements';
const NEEDED: Record<Needed, [string, string, string]> = {
  'weigh-ins': ['weigh-in', 'weigh-ins', 'to see your trend'],
  days: ['day', 'days', 'to see this chart'],
  measurements: ['measurement', 'measurements', 'to see a change'],
};

/** "Log 3 more weigh-ins to see your trend", not an empty chart. */
export function tooLittleData(kind: Needed, more: number): string {
  const [one, many, why] = NEEDED[kind];
  return `Log ${more} more ${more === 1 ? one : many} ${why}`;
}

const RANGE_LABELS: Record<RangeKey, string> = {
  '1W': 'last week',
  '1M': 'last month',
  '3M': 'last 3 months',
  '6M': 'last 6 months',
  '1Y': 'last year',
  All: 'all time',
};

export function rangeLabel(range: RangeKey): string {
  return RANGE_LABELS[range];
}

/** The chart's aria-label: what it is, the range and the headline, read as sentences. */
export function chartLabel(title: string, range: RangeKey | null, headline: string): string {
  const sentence = headline.replaceAll(' · ', ', ').replace(/\.?$/, '.');
  return `${title} chart${range ? `, ${rangeLabel(range)}` : ''}. ${sentence}`;
}
