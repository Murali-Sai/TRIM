import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { WATER_KEY, waterDays, type TrackingSettings } from '../../api/tracking';
import { ChartFrame } from '../../components/chart/ChartFrame';
import { DailyBars } from '../../components/chart/DailyBars';
import { chartLabel, dayTooltip, tooLittleData, weekdayDate } from '../../lib/chart/headlines';
import type { SeriesDay } from '../../lib/nutritionSeries';
import { fiberDefault } from '../../lib/tdee';
import { formatNumber } from '../../lib/units';
import { mlToFlOz } from '../../lib/water';
import type { RangeKey } from '../../lib/weightChart';

const n = (x: number | null) => (x === null ? '' : formatNumber(Math.round(x)));

function mean(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((s, v) => s + v, 0) / known.length : null;
}

interface ChartProps {
  title: string;
  testId: string;
  color: string;
  unit: string;
  range: RangeKey;
  dates: string[];
  values: (number | null)[];
  targets: (number | null)[];
  note?: string | null;
}

function SmallChart({
  title,
  testId,
  color,
  unit,
  range,
  dates,
  values,
  targets,
  note,
}: ChartProps) {
  const avg = mean(values);
  const target = mean(targets);
  const headline =
    avg === null
      ? `${title}: nothing logged`
      : target === null
        ? `${title} ${n(avg)} ${unit} a day`
        : `${title} ${n(avg)} of ${n(target)} ${unit} a day`;
  const label = chartLabel(title, range, headline);
  const tooltip = useMemo(
    () => (i: number) =>
      dayTooltip(
        dates[i] ?? '',
        values[i] ?? 0,
        targets[i] ?? null,
        `${unit} ${title.toLowerCase()}`,
      ),
    [dates, values, targets, unit, title],
  );
  return (
    <section
      className="rounded-xl border border-border bg-surface p-4"
      aria-label={title}
      data-testid={testId}
    >
      <h3 className="eyebrow">{title}</h3>
      <p className="num mt-1 font-semibold" data-testid={`${testId}-headline`}>
        {headline}
      </p>
      {note ? (
        <p className="mt-0.5 text-sm text-text-secondary" data-testid={`${testId}-note`}>
          {note}
        </p>
      ) : null}
      <div className="mt-3">
        <ChartFrame
          tooLittle={avg === null ? tooLittleData('days', 1) : null}
          table={{
            caption: label,
            columns: ['Day', `${title} (${unit})`, `Target (${unit})`],
            numeric: [1, 2],
            rows: dates
              .map((d, i) => [
                weekdayDate(d),
                values[i] == null ? 'Not logged' : n(values[i] ?? null),
                n(targets[i] ?? null),
              ])
              .reverse(),
          }}
        >
          <DailyBars
            dates={dates}
            values={values}
            targets={targets}
            color={color}
            unit={unit}
            label={label}
            tooltip={tooltip}
            testId={`chart-${testId}`}
            size="small"
          />
        </ChartFrame>
      </div>
    </section>
  );
}

/** Water and fiber: daily bars with a target line, when tracked (SPEC page 4, Full charts). */
export function FiberWaterCharts({
  series,
  range,
  settings,
}: {
  series: readonly SeriesDay[];
  range: RangeKey;
  settings: TrackingSettings;
}) {
  const from = series[0]?.date ?? '';
  const to = series.at(-1)?.date ?? '';
  const water = useQuery({
    queryKey: [...WATER_KEY, 'days', from, to],
    queryFn: () => waterDays(from, to),
    enabled: settings.track_water && from !== '',
  });
  const dates = useMemo(() => series.map((d) => d.date), [series]);
  const fiber = useMemo(
    () => ({
      values: series.map((d) => (d.logged ? d.fiber_g : null)),
      targets: series.map((d) =>
        d.target ? (d.target.fiber_g ?? fiberDefault(d.target.kcal)) : null,
      ),
    }),
    [series],
  );
  const unknown = series.reduce((s, d) => s + d.fiberUnknown, 0);
  const fl = settings.water_unit === 'fl_oz';
  const waterView = useMemo(() => {
    const byDate = new Map((water.data ?? []).map((w) => [w.date, w.ml]));
    return {
      values: series.map((d) => {
        const ml = byDate.get(d.date);
        return ml === undefined ? null : fl ? mlToFlOz(ml) : ml;
      }),
      targets: series.map((d) => {
        const ml = d.target?.water_ml ?? null;
        return ml === null ? null : fl ? mlToFlOz(ml) : ml;
      }),
    };
  }, [water.data, series, fl]);

  if (!settings.track_fiber && !settings.track_water) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      {settings.track_fiber ? (
        <SmallChart
          title="Fiber"
          testId="fiber"
          color="fiber"
          unit="g"
          range={range}
          dates={dates}
          values={fiber.values}
          targets={fiber.targets}
          note={
            unknown > 0
              ? `Fiber unknown for ${unknown} ${unknown === 1 ? 'food' : 'foods'} in this range, so the totals may be low.`
              : null
          }
        />
      ) : null}
      {settings.track_water && water.data ? (
        <SmallChart
          title="Water"
          testId="water"
          color="water"
          unit={fl ? 'fl oz' : 'ml'}
          range={range}
          dates={dates}
          values={waterView.values}
          targets={waterView.targets}
        />
      ) : null}
    </div>
  );
}
