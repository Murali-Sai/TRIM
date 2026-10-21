import type { MeasurementType, Metric } from '../../api/measurements';
import { changeSince } from '../../lib/measureSeries';
import { formatReading, toDisplay } from '../../lib/measureUnits';
import type { Reading } from '../../lib/trend';
import { formatNumber } from '../../lib/units';

/** "Thigh, left" for one side of a pair, else the metric's name. */
export function sideName(t: MeasurementType): string {
  return t.side ? `${t.name}, ${t.side}` : t.name;
}

export interface ChangeRow {
  key: string;
  name: string;
  latest: string;
  /** "down 2.7 cm" or "up 0.4%" in the metric's unit; "unchanged"; or "first reading". */
  change: string;
  dir: 'up' | 'down' | 'flat';
  pct: number | null;
  since: string | null;
  values: number[];
  color: string;
}

/** One row per side of each number metric with readings: latest, change since start. */
export function changeRows(
  metrics: readonly Metric[],
  readings: Map<string, Reading[]>,
  from: string | null = null,
): ChangeRow[] {
  const rows: ChangeRow[] = [];
  metrics.forEach((m, k) => {
    for (const t of m.types) {
      if (t.unit === 'text') continue;
      const rs = (readings.get(t.id) ?? []).filter((r) => from === null || r.day >= from);
      const last = rs.at(-1);
      if (!last) continue;
      const c = changeSince(rs);
      const shown = c ? toDisplay(c.latest.value, t.unit) - toDisplay(c.start.value, t.unit) : 0;
      const rounded = Math.round(shown * 10 ** t.precision) / 10 ** t.precision;
      const unit = t.unit === '%' ? '%' : ` ${t.unit}`;
      rows.push({
        key: t.id,
        name: sideName(t),
        latest: formatReading(last.value, t.unit, t.precision),
        change: !c
          ? 'first reading'
          : rounded === 0
            ? 'unchanged'
            : `${rounded < 0 ? 'down' : 'up'} ${formatNumber(Math.abs(rounded), t.precision)}${unit}`,
        dir: !c || rounded === 0 ? 'flat' : rounded < 0 ? 'down' : 'up',
        pct: c ? c.pct : null,
        since: c ? c.start.day : null,
        values: rs.map((r) => toDisplay(r.value, t.unit)),
        color: `var(--color-series-${(k % 6) + 1})`,
      });
    }
  });
  return rows;
}

/** Before the smoothed trend shows: fewer than 5 days with a reading, or under 7 days. */
export function fewReadings(rs: readonly Reading[]): boolean {
  const days = [...new Set(rs.map((r) => r.day))].sort();
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return true;
  const span = (Date.parse(last) - Date.parse(first)) / 86_400_000 + 1;
  return days.length < 5 || span < 7;
}

/** The key under a metric's chart, in words. */
export function chartNote(m: Metric, readings: Map<string, Reading[]>): string | null {
  const notes = [
    m.types.length === 2 ? 'Solid line is left, dashed is right.' : null,
    m.types.some((t) => fewReadings(readings.get(t.id) ?? []))
      ? 'The line joins your readings; the smoothed trend shows after 5 readings over a week or more.'
      : null,
  ].filter(Boolean);
  return notes.length ? notes.join(' ') : null;
}
