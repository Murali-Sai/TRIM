import { lazy, Suspense, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../api/auth';
import { RangeChips } from '../../components/chart/ChartFrame';
import { PhasesToggle } from '../../components/chart/PhasesToggle';
import { chartLabel, measurementHeadline } from '../../lib/chart/headlines';
import { readStored, writeStored } from '../../lib/chart/storage';
import { changeSince, overlayLine } from '../../lib/measureSeries';
import { toDisplay } from '../../lib/measureUnits';
import { DEFAULT_RANGE, RANGES, rangeWindow, type RangeKey } from '../../lib/weightChart';
import { isoToZonedWall } from '../../lib/zoned';
import { usePageTitle } from '../../usePageTitle';
import { Notice, Section } from '../account/Section';
import { ChangeTable } from './ChangeTable';
import { changeRows, chartNote } from './rows';
import type { OverlayLine } from './MeasureChart';

// uPlot loads only when a chart is on screen, not with every page.
const MeasureChart = lazy(() =>
  import('./MeasureChart').then((m) => ({ default: m.MeasureChart })),
);
const OverlayChart = lazy(() =>
  import('./MeasureChart').then((m) => ({ default: m.OverlayChart })),
);
import { sideName, useMeasurementData } from './useMeasurementData';

const RANGE_KEY = 'trim.chart.measure.range';
type View = 'each' | 'compare';

function storedRange(): RangeKey {
  const v = readStored(RANGE_KEY);
  return RANGES.includes(v as RangeKey) ? (v as RangeKey) : DEFAULT_RANGE;
}

/** Measurement charts (SPEC page 4, Full charts): small multiples, overlay, change table. */
export function MeasurementsPage() {
  usePageTitle('Measurements');
  const me = useMe();
  if (!me.data) return null;
  return <Measurements timeZone={me.data.timezone} />;
}

function Measurements({ timeZone }: { timeZone: string }) {
  const data = useMeasurementData(timeZone);
  const [range, setRange] = useState<RangeKey>(storedRange);
  const [view, setView] = useState<View>('each');
  const [start, setStart] = useState<string | null>(null);
  const startId = useId();
  const window = rangeWindow(range, Date.now() / 1000);
  const dayOf = (sec: number) =>
    isoToZonedWall(new Date(sec * 1000).toISOString(), timeZone).slice(0, 10);
  const numeric = data.metrics.filter((m) => m.types[0]?.unit !== 'text');
  const withData = numeric.filter((m) =>
    m.types.some((t) => (data.readings.get(t.id) ?? []).length > 0),
  );
  const firstDay = withData
    .flatMap((m) => m.types.map((t) => data.readings.get(t.id)?.[0]?.day))
    .filter((d): d is string => !!d)
    .sort()[0];
  const windowStart = window ? dayOf(window[0]) : (firstDay ?? null);
  const from = start ?? windowStart ?? firstDay ?? '';

  const lines: OverlayLine[] = useMemo(
    () =>
      withData.flatMap((m, k) =>
        m.types.map((t) => ({
          name: sideName(t),
          color: `var(--color-series-${(k % 6) + 1})`,
          dashed: t.side === 'right',
          points: overlayLine(data.readings.get(t.id) ?? [], from),
        })),
      ),
    [withData, data.readings, from],
  );
  const rows = changeRows(withData, data.readings, windowStart);

  const tabClass = (v: View) =>
    `tap flex-1 cursor-pointer rounded-md px-3 py-2 font-semibold transition-colors duration-200 ${
      view === v ? 'bg-surface text-text shadow-sm' : 'text-text-secondary'
    }`;

  return (
    <section>
      <Link to="/charts" className="tap text-sm font-semibold text-accent underline">
        Charts
      </Link>
      <h2 className="mt-2 text-2xl font-bold">Measurements</h2>
      {data.isError ? (
        <Notice kind="error">Could not load your measurements. Try again in a moment.</Notice>
      ) : null}
      {!data.isPending && numeric.length === 0 ? (
        <div
          className="mt-4 rounded-xl border border-dashed border-border p-6 text-center"
          data-testid="measure-empty"
        >
          <p className="text-text-secondary">Switch on a measurement to chart it.</p>
          <Link
            to="/body/metrics"
            className="tap mt-2 inline-block font-semibold text-accent underline"
          >
            Manage metrics
          </Link>
        </div>
      ) : !data.isPending && withData.length === 0 ? (
        <div
          className="mt-4 rounded-xl border border-dashed border-border p-6 text-center"
          data-testid="measure-empty"
        >
          <p className="text-text-secondary">Log a measurement on the Body page to see it here.</p>
          <Link to="/body" className="tap mt-2 inline-block font-semibold text-accent underline">
            Body
          </Link>
        </div>
      ) : withData.length > 0 ? (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <RangeChips
              value={range}
              options={RANGES}
              onChange={(r) => {
                setRange(r);
                setStart(null);
                writeStored(RANGE_KEY, r);
              }}
            />
            <div
              role="tablist"
              aria-label="Chart view"
              className="flex min-w-60 flex-1 gap-1 rounded-lg bg-surface-2 p-1 sm:max-w-80"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view === 'each'}
                onClick={() => setView('each')}
                className={tabClass('each')}
              >
                Each metric
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'compare'}
                onClick={() => setView('compare')}
                className={tabClass('compare')}
              >
                Compare
              </button>
            </div>
            <PhasesToggle />
          </div>

          {view === 'each' ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="small-multiples">
              {withData.map((m, k) => {
                const t = m.types[0];
                if (!t) return null;
                const c = changeSince(
                  (data.readings.get(t.id) ?? []).filter(
                    (r) => !windowStart || r.day >= windowStart,
                  ),
                );
                const headline = c
                  ? measurementHeadline({
                      metric: m.types.length === 2 ? sideName(t) : m.name,
                      change: toDisplay(c.latest.value, t.unit) - toDisplay(c.start.value, t.unit),
                      unit: t.unit,
                      since: c.start.day,
                    })
                  : `${m.name}: one reading so far`;
                return (
                  <Section
                    key={m.key}
                    title={m.types.length === 2 ? `${m.name} (left and right)` : m.name}
                    testId="metric-chart"
                  >
                    <p className="mb-2 font-semibold" data-testid="metric-headline">
                      {headline}
                    </p>
                    <Suspense fallback={<div className="min-h-48" aria-busy="true" />}>
                      <MeasureChart
                        metric={m}
                        readings={data.readings}
                        window={window}
                        timeZone={timeZone}
                        color={`var(--color-series-${(k % 6) + 1})`}
                        label={chartLabel(m.name, range, headline)}
                      />
                    </Suspense>
                    {chartNote(m, data.readings) ? (
                      <p className="mt-2 text-xs text-text-secondary">
                        {chartNote(m, data.readings)}
                      </p>
                    ) : null}
                  </Section>
                );
              })}
            </div>
          ) : (
            <Section title="Change since a date">
              <div className="mb-3">
                <label htmlFor={startId} className="block text-sm font-semibold">
                  Change since
                </label>
                <input
                  id={startId}
                  type="date"
                  value={from}
                  max={isoToZonedWall(new Date().toISOString(), timeZone).slice(0, 10)}
                  onChange={(e) => e.target.value && setStart(e.target.value)}
                  className="tap mt-1 rounded-lg border border-border bg-surface px-3 py-2"
                />
              </div>
              <Suspense fallback={<div className="min-h-60" aria-busy="true" />}>
                <OverlayChart
                  lines={lines}
                  window={window}
                  label={`Measurements compared: percent change since ${from}. ${lines
                    .map((l) => {
                      const last = l.points.at(-1);
                      return last
                        ? `${l.name} ${last.pct >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(last.pct * 10) / 10)}%`
                        : `${l.name} no readings`;
                    })
                    .join('; ')}.`}
                />
              </Suspense>
              <p className="mt-2 text-xs text-text-secondary">
                Each line starts at 0% on its first reading on or after that date.
              </p>
            </Section>
          )}

          <Section title="Change since start">
            <ChangeTable
              rows={rows}
              caption="Latest reading and change since the start of the range"
            />
          </Section>
        </div>
      ) : null}
    </section>
  );
}
