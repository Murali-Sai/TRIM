import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../api/auth';
import { ChartFrame } from '../../components/chart/ChartFrame';
import { DailyBars } from '../../components/chart/DailyBars';
import {
  caloriesWeekHeadline,
  chartLabel,
  dayTooltip,
  tooLittleData,
  weekdayDate,
} from '../../lib/chart/headlines';
import {
  adherence,
  average,
  buckets,
  rollingAverage,
  type SeriesDay,
} from '../../lib/nutritionSeries';
import { formatNumber } from '../../lib/units';
import { RANGES } from '../../lib/weightChart';
import { usePageTitle } from '../../usePageTitle';
import { Notice } from '../account/Section';
import { bucketName, bucketTooltip, type Grouping } from './format';
import { GroupToggle } from './GroupToggle';
import { useDaySeries, useRange } from './useDaySeries';

export function CaloriesPage() {
  usePageTitle('Calories');
  const me = useMe();
  if (!me.data) return null;
  return <Calories timeZone={me.data.timezone} />;
}

const n = (x: number | null) => (x === null ? '' : formatNumber(Math.round(x)));

/** Bars, targets, the 7-day average, tooltips and table rows for one grouping. */
function view(series: readonly SeriesDay[], by: Grouping) {
  if (by === 'day') {
    const avg = rollingAverage(series);
    return {
      dates: series.map((d) => d.date),
      values: series.map((d) => (d.logged ? d.kcal : null)),
      targets: series.map((d) => d.target?.kcal ?? null),
      average: avg,
      tooltips: series.map((d) =>
        dayTooltip(d.date, d.logged ? d.kcal : 0, d.target?.kcal ?? null),
      ),
      columns: ['Day', 'kcal', 'Target', 'On target', '7-day avg'],
      rows: series
        .map((d, i) => [
          weekdayDate(d.date),
          d.logged ? n(d.kcal) : 'Not logged',
          n(d.target?.kcal ?? null),
          d.logged && d.target ? (d.onTarget ? 'Yes' : 'No') : '',
          n(avg[i] ?? null),
        ])
        .reverse(),
    };
  }
  const bs = buckets(series, by);
  return {
    dates: bs.map((b) => b.start),
    values: bs.map((b) => b.average),
    targets: bs.map((b) => b.target),
    average: undefined,
    tooltips: bs.map((b) => bucketTooltip(b, by, 'kcal', true)),
    columns: [by === 'week' ? 'Week' : 'Month', 'Avg kcal a day', 'Target', 'On target'],
    rows: bs
      .map((b) => [
        bucketName(b, by),
        b.average === null ? 'Not logged' : n(b.average),
        n(b.target),
        b.days ? `${b.onTarget} of ${b.days} days` : '',
      ])
      .reverse(),
  };
}

function Calories({ timeZone }: { timeZone: string }) {
  const [range, setRange] = useRange('trim.chart.calories.range', '1W');
  const [group, setGroup] = useState<Grouping>('day');
  const { series, isError } = useDaySeries(range, timeZone);
  const by: Grouping = range === '1W' ? 'day' : group;
  const v = useMemo(() => (series ? view(series, by) : null), [series, by]);
  const tooltip = useMemo(() => (i: number) => v?.tooltips[i] ?? '', [v]);

  const a = series ? adherence(series) : null;
  const avg = series ? average(series) : null;
  const headline =
    avg === null || !a
      ? null
      : caloriesWeekHeadline({ average: avg, onTarget: a.onTarget, days: a.days });
  const label = chartLabel('Calories', range, headline ?? 'Nothing logged in this range');

  return (
    <section>
      <Link to="/charts" className="tap text-sm font-semibold text-accent underline">
        Charts
      </Link>
      <h2 className="mt-2 text-2xl font-bold">Calories</h2>
      {isError ? (
        <Notice kind="error">Could not load your days. Try again in a moment.</Notice>
      ) : null}
      <div className="mt-4 rounded-xl border border-border bg-surface p-4">
        <p className="num text-lg font-semibold" data-testid="calories-headline">
          {series ? (headline ?? 'Nothing logged in this range yet') : ' '}
        </p>
        {range !== '1W' ? (
          <div className="mt-3">
            <GroupToggle value={group} onChange={setGroup} />
          </div>
        ) : null}
        <div className="mt-3">
          {v ? (
            <ChartFrame
              range={{ value: range, options: RANGES, onChange: setRange }}
              tooLittle={avg === null ? tooLittleData('days', 1) : null}
              note={
                by === 'day'
                  ? 'Bars are calories each day. The dashed line is your target and the shaded band is on target (within 5%). The line is your 7-day average. Lighter bars are over the band.'
                  : 'Bars are the average per logged day. The dashed line is your target and the shaded band is on target (within 5%).'
              }
              table={{ caption: label, columns: v.columns, rows: v.rows, numeric: [1, 2, 4] }}
            >
              <DailyBars
                dates={v.dates}
                values={v.values}
                targets={v.targets}
                {...(v.average ? { average: v.average } : {})}
                color="kcal"
                unit="kcal"
                label={label}
                tooltip={tooltip}
                testId="calories-chart"
              />
            </ChartFrame>
          ) : (
            <div className="min-h-56" aria-busy="true" />
          )}
        </div>
      </div>
    </section>
  );
}
