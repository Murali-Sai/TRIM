import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../api/auth';
import { ChartFrame, RangeChips } from '../../components/chart/ChartFrame';
import { DailyBars } from '../../components/chart/DailyBars';
import {
  chartLabel,
  dayTooltip,
  macroWeekHeadline,
  tooLittleData,
  weekdayDate,
} from '../../lib/chart/headlines';
import {
  adherence,
  average,
  calorieSplit,
  type Nutrient,
  type SeriesDay,
} from '../../lib/nutritionSeries';
import { formatNumber } from '../../lib/units';
import { RANGES, type RangeKey } from '../../lib/weightChart';
import { usePageTitle } from '../../usePageTitle';
import { Notice } from '../account/Section';
import { getSettings, SETTINGS_KEY } from '../../api/tracking';
import { FiberWaterCharts } from './FiberWaterCharts';
import { useDaySeries, useRange } from './useDaySeries';

export function MacrosPage() {
  usePageTitle('Macros');
  const me = useMe();
  if (!me.data) return null;
  return <Macros timeZone={me.data.timezone} />;
}

const MACROS = [
  { key: 'protein_g', name: 'Protein', color: 'protein' },
  { key: 'fat_g', name: 'Fat', color: 'fat' },
  { key: 'carbs_g', name: 'Carbs', color: 'carbs' },
] as const satisfies readonly { key: Nutrient; name: string; color: string }[];

const n = (x: number | null) => (x === null ? '' : formatNumber(Math.round(x)));

function meanTarget(series: readonly SeriesDay[], key: Nutrient): number | null {
  const withTarget = series.filter((d) => d.target);
  if (withTarget.length === 0) return null;
  return withTarget.reduce((s, d) => s + (d.target?.[key] ?? 0), 0) / withTarget.length;
}

function MacroChart({
  series,
  macro,
  range,
}: {
  series: readonly SeriesDay[];
  macro: (typeof MACROS)[number];
  range: RangeKey;
}) {
  const { key, name, color } = macro;
  const avg = average(series, key);
  const target = meanTarget(series, key);
  const headline =
    avg === null
      ? `${name}: nothing logged`
      : target === null
        ? `${name} ${n(avg)} g a day`
        : macroWeekHeadline(name, avg, target);
  const label = chartLabel(name, range, headline);
  const a = adherence(series, key);
  const v = useMemo(
    () => ({
      dates: series.map((d) => d.date),
      values: series.map((d) => (d.logged ? d[key] : null)),
      targets: series.map((d) => d.target?.[key] ?? null),
      tooltips: series.map((d) =>
        dayTooltip(
          d.date,
          d.logged ? d[key] : 0,
          d.target?.[key] ?? null,
          `g ${name.toLowerCase()}`,
        ),
      ),
    }),
    [series, key, name],
  );
  const tooltip = useMemo(() => (i: number) => v.tooltips[i] ?? '', [v]);
  return (
    <section
      className="rounded-xl border border-border bg-surface p-4"
      aria-labelledby={`macro-${key}`}
      data-testid={`macro-${key}`}
    >
      <h3 id={`macro-${key}`} className="eyebrow">
        {name}
      </h3>
      <p className="num mt-1 font-semibold">{headline}</p>
      {target !== null && a.days > 0 ? (
        <p className="mt-0.5 text-sm text-text-secondary">
          On target {a.onTarget} of {a.days} {a.days === 1 ? 'day' : 'days'}
        </p>
      ) : null}
      <div className="mt-3">
        <ChartFrame
          tooLittle={avg === null ? tooLittleData('days', 1) : null}
          table={{
            caption: label,
            columns: ['Day', `${name} (g)`, 'Target (g)'],
            numeric: [1, 2],
            rows: series
              .map((d) => [
                weekdayDate(d.date),
                d.logged ? n(d[key]) : 'Not logged',
                n(d.target?.[key] ?? null),
              ])
              .reverse(),
          }}
        >
          <DailyBars
            dates={v.dates}
            values={v.values}
            targets={v.targets}
            color={color}
            unit="g"
            label={label}
            tooltip={tooltip}
            testId={`chart-${key}`}
            size="small"
          />
        </ChartFrame>
      </div>
    </section>
  );
}

const SPLIT = [
  { key: 'protein', label: 'Protein', bg: 'bg-protein', text: 'text-protein-text' },
  { key: 'carbs', label: 'Carbs', bg: 'bg-carbs', text: 'text-carbs-text' },
  { key: 'fat', label: 'Fat', bg: 'bg-fat', text: 'text-fat-text' },
] as const;

function SplitBar({
  name,
  split,
}: {
  name: string;
  split: { protein: number; carbs: number; fat: number };
}) {
  const words = SPLIT.map((s) => `${s.label} ${split[s.key]}%`).join(', ');
  return (
    <div data-testid={`split-${name.toLowerCase()}`}>
      <p className="text-sm font-semibold">{name}</p>
      <div
        className="mt-1 flex h-4 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${name}: ${words}`}
      >
        {SPLIT.map((s) => (
          <span key={s.key} className={s.bg} style={{ width: `${split[s.key]}%` }} />
        ))}
      </div>
      <p className="num mt-1 flex flex-wrap gap-x-4 text-sm" aria-hidden="true">
        {SPLIT.map((s) => (
          <span key={s.key} className={s.text}>
            {s.label} {split[s.key]}%
          </span>
        ))}
      </p>
    </div>
  );
}

function Macros({ timeZone }: { timeZone: string }) {
  const [range, setRange] = useRange('trim.chart.macros.range', '1W');
  const { series, isError } = useDaySeries(range, timeZone);
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: getSettings });
  const today = series?.at(-1);
  const eaten = today?.logged ? calorieSplit(today) : null;
  const planned = today?.target ? calorieSplit(today.target) : null;

  return (
    <section>
      <Link to="/charts" className="tap text-sm font-semibold text-accent underline">
        Progress
      </Link>
      <h2 className="mt-2 text-2xl font-bold">Macros</h2>
      {isError ? (
        <Notice kind="error">Could not load your days. Try again in a moment.</Notice>
      ) : null}
      <div className="mt-4">
        <RangeChips value={range} options={RANGES} onChange={setRange} />
      </div>

      <section
        className="mt-4 rounded-xl border border-border bg-surface p-4"
        aria-labelledby="split-heading"
        data-testid="calorie-split"
      >
        <h3 id="split-heading" className="eyebrow">
          Calorie split today
        </h3>
        <p className="mt-1 text-sm text-text-secondary">
          Where today&rsquo;s calories came from, above the split your targets plan.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {eaten ? (
            <SplitBar name="Today" split={eaten} />
          ) : (
            <p className="text-sm text-text-secondary">Log food today to see your split.</p>
          )}
          {planned ? <SplitBar name="Target" split={planned} /> : null}
        </div>
      </section>

      {series ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {MACROS.map((m) => (
            <MacroChart key={m.key} series={series} macro={m} range={range} />
          ))}
        </div>
      ) : (
        <div className="mt-4 min-h-56" aria-busy="true" />
      )}
      {series && settings.data ? (
        <FiberWaterCharts series={series} range={range} settings={settings.data} />
      ) : null}
    </section>
  );
}
