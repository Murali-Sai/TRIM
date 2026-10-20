import { shortDate, weekdayDate } from '../../lib/chart/headlines';
import type { Bucket, BucketKind } from '../../lib/nutritionSeries';
import { formatNumber } from '../../lib/units';

export type Grouping = 'day' | BucketKind;

/** "Week of 12 Oct", "Oct 2026" */
export function bucketName(b: Bucket, by: BucketKind): string {
  if (by === 'week') return `Week of ${shortDate(b.start)}`;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' })
    .format(new Date(`${b.start}T12:00:00Z`))
    .replace('Sept', 'Sep');
}

/** "Week of 12 Oct: avg 2,180 kcal a day, on target 5 of 7 days" */
export function bucketTooltip(b: Bucket, by: BucketKind, unit: string, withAdherence: boolean) {
  const name = bucketName(b, by);
  if (b.average === null) return `${name}: nothing logged`;
  const avg = `avg ${formatNumber(Math.round(b.average))} ${unit} a day`;
  return withAdherence
    ? `${name}: ${avg}, on target ${b.onTarget} of ${b.days} ${b.days === 1 ? 'day' : 'days'}`
    : `${name}: ${avg}`;
}

export { weekdayDate };
