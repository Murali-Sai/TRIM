import { useQuery } from '@tanstack/react-query';
import { useMe, type UnitSystem } from '../../api/auth';
import { listLogs, LOGS_KEY } from '../../api/logs';
import { BODY_STATS_KEY, getBodyStats } from '../../api/setup';
import { listWeights, WEIGHTS_KEY } from '../../api/weights';
import {
  caloriesWeekHeadline,
  chartLabel,
  macroWeekHeadline,
  todayHeadline,
  tooLittleData,
  weightHeadline,
} from '../../lib/chart/headlines';
import { bullet, sparkline, weekBars } from '../../lib/dashboard';
import { sumNutrients } from '../../lib/dayTotals';
import { adherence, average, type Nutrient, type SeriesDay } from '../../lib/nutritionSeries';
import { kgToLb } from '../../lib/tdee';
import { weeklyRate } from '../../lib/trend';
import { formatNumber } from '../../lib/units';
import { usePageTitle } from '../../usePageTitle';
import { trendFor, trendSentence, unitLabel } from '../body/weightFormat';
import { useDaySeries } from '../charts/useDaySeries';
import { TargetStrip } from '../today/TargetStrip';
import { DashCard } from './DashCard';
import { MeasurementsCard } from './MeasurementsCard';
import { StreakCard } from './StreakCard';

export function ProgressPage() {
  usePageTitle('Progress');
  const me = useMe();
  if (!me.data) return null;
  return <Progress timeZone={me.data.timezone} units={me.data.unit_system} />;
}

const MACROS = [
  { key: 'protein_g', name: 'Protein', color: 'protein', text: 'text-protein-text' },
  { key: 'fat_g', name: 'Fat', color: 'fat', text: 'text-fat-text' },
  { key: 'carbs_g', name: 'Carbs', color: 'carbs', text: 'text-carbs-text' },
] as const satisfies readonly { key: Nutrient; name: string; color: string; text: string }[];

function meanTarget(series: readonly SeriesDay[], key: Nutrient): number | null {
  const withTarget = series.filter((d) => d.target);
  if (withTarget.length === 0) return null;
  return withTarget.reduce((s, d) => s + (d.target?.[key] ?? 0), 0) / withTarget.length;
}

const weekday = (day: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'narrow' }).format(
    new Date(`${day}T12:00:00Z`),
  );

function TodayCard({ timeZone, today }: { timeZone: string; today: string }) {
  const logs = useQuery({ queryKey: [...LOGS_KEY, today], queryFn: () => listLogs(today) });
  const { series } = useDaySeries('1W', timeZone);
  const target = series?.at(-1)?.target ?? null;
  if (!logs.data || !series) return <DashCard title="Today" headline=" " testId="card-today" />;
  const totals = sumNutrients(logs.data);
  if (!target) {
    return (
      <DashCard
        title="Today"
        headline="Set targets to see what is left"
        to="/targets"
        testId="card-today"
      />
    );
  }
  return (
    <DashCard title="Today" headline={todayHeadline(totals, target)} to="/" testId="card-today">
      <TargetStrip totals={totals} target={{ ...target, fiber_g: null }} compact />
    </DashCard>
  );
}

const BAR_H = 96;
const SLOT = 40;

function CaloriesWeekCard({ series }: { series: readonly SeriesDay[] }) {
  const a = adherence(series);
  const avg = average(series);
  const headline =
    avg === null
      ? tooLittleData('days', 1)
      : caloriesWeekHeadline({ average: avg, onTarget: a.onTarget, days: a.days });
  const w = weekBars(
    series.map((d) => ({ value: d.logged ? d.kcal : null, target: d.target?.kcal ?? null })),
    BAR_H,
  );
  const lastTarget = series.at(-1)?.target?.kcal ?? null;
  return (
    <DashCard
      title="Calories this week"
      headline={headline}
      to="/charts/calories"
      testId="card-calories"
    >
      {avg === null ? null : (
        <div>
          <svg
            viewBox={`0 0 ${SLOT * series.length} ${BAR_H}`}
            className="h-24 w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={chartLabel('Calories this week', null, headline)}
          >
            {w.bars.map((b, i) => {
              const x = i * SLOT;
              return (
                <g key={series[i]?.date}>
                  {b.bandTop !== null && b.bandBottom !== null ? (
                    <rect
                      x={x}
                      width={SLOT}
                      y={b.bandTop}
                      height={b.bandBottom - b.bandTop}
                      fill="var(--color-text-secondary)"
                      opacity={0.14}
                    />
                  ) : null}
                  {b.logged ? (
                    <rect
                      x={x + 8}
                      width={SLOT - 16}
                      y={BAR_H - b.height}
                      height={b.height}
                      rx={3}
                      fill="var(--color-kcal)"
                      opacity={b.over ? 0.5 : 1}
                      stroke={b.over ? 'var(--color-kcal)' : 'none'}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                  {b.targetY !== null ? (
                    <line
                      x1={x}
                      x2={x + SLOT}
                      y1={b.targetY}
                      y2={b.targetY}
                      stroke="var(--color-text)"
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
          <div
            className="num mt-1 grid text-center text-xs text-text-secondary"
            style={{ gridTemplateColumns: `repeat(${series.length}, 1fr)` }}
            aria-hidden="true"
          >
            {series.map((d) => (
              <span key={d.date}>{weekday(d.date)}</span>
            ))}
          </div>
          {lastTarget !== null ? (
            <p className="mt-1 text-xs text-text-secondary">
              Dashed line: target {formatNumber(lastTarget)} kcal
            </p>
          ) : null}
        </div>
      )}
    </DashCard>
  );
}

function MacrosWeekCard({ series }: { series: readonly SeriesDay[] }) {
  const rows = MACROS.map((m) => ({
    ...m,
    avg: average(series, m.key),
    target: meanTarget(series, m.key),
  }));
  const protein = rows[0];
  const headline =
    !protein || protein.avg === null
      ? tooLittleData('days', 1)
      : protein.target === null
        ? `Protein ${formatNumber(Math.round(protein.avg))} g a day`
        : macroWeekHeadline('Protein', protein.avg, protein.target);
  return (
    <DashCard title="Macros this week" headline={headline} to="/charts/macros" testId="card-macros">
      {protein?.avg === null ? null : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            if (r.avg === null) return null;
            const b = r.target === null ? null : bullet(r.avg, r.target);
            return (
              <li key={r.key} data-testid={`bullet-${r.key}`}>
                <p className="flex items-baseline gap-2 text-sm">
                  <span className={`font-semibold ${r.text}`}>{r.name}</span>
                  <span className="num ml-auto">
                    {formatNumber(Math.round(r.avg))}
                    {r.target !== null ? (
                      <span className="text-text-secondary">
                        {' '}
                        / {formatNumber(Math.round(r.target))} g
                      </span>
                    ) : (
                      ' g'
                    )}
                  </span>
                </p>
                <div className="relative mt-1 h-3 rounded-full bg-surface-2" aria-hidden="true">
                  {b ? (
                    <span
                      className="absolute inset-y-0 bg-text-secondary opacity-25"
                      style={{ left: `${b.bandFrom}%`, width: `${b.bandTo - b.bandFrom}%` }}
                    />
                  ) : null}
                  <span
                    className="absolute inset-y-0.5 left-0 rounded-full"
                    style={{
                      width: `${b ? b.bar : 100}%`,
                      background: `var(--color-${r.color})`,
                    }}
                  />
                  {b ? (
                    <span
                      className="absolute -inset-y-1 w-0.5 bg-text"
                      style={{ left: `calc(${b.tick}% - 1px)` }}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashCard>
  );
}

const SPARK_W = 300;
const SPARK_H = 64;

function WeightCard({ today, units }: { today: string; units: UnitSystem }) {
  const weights = useQuery({ queryKey: WEIGHTS_KEY, queryFn: listWeights });
  const stats = useQuery({ queryKey: BODY_STATS_KEY, queryFn: getBodyStats });
  if (!weights.data) return <DashCard title="Weight" headline=" " testId="card-weight" />;
  const trend = trendFor(weights.data);
  const unit = unitLabel(units);
  const convert = (kg: number) => (units === 'imperial' ? kgToLb(kg) : kg);
  const latest = [...trend.points].reverse().find((p) => p.trend !== null)?.trend ?? null;
  const rate = weeklyRate(trend.points);
  const headline =
    trend.visible && latest !== null
      ? weightHeadline({ trend: convert(latest), perWeek: rate === null ? 0 : convert(rate), unit })
      : trendSentence(trend, units).replace(/\.$/, '');
  const goalKg = stats.data?.goal_weight_kg ?? null;
  const s = trend.visible
    ? sparkline(
        trend.points.map((p) => ({
          day: p.day,
          value: convert(p.value),
          trend: p.trend === null ? null : convert(p.trend),
        })),
        goalKg === null ? null : convert(goalKg),
        today,
        SPARK_W,
        SPARK_H,
      )
    : null;
  return (
    <DashCard title="Weight" headline={headline} to="/body" testId="card-weight">
      {s ? (
        <div>
          <svg
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            className="w-full overflow-visible"
            role="img"
            aria-label={`Weight, last 30 days. ${headline.replaceAll(' · ', ', ')}.`}
          >
            {s.goalY !== null ? (
              <line
                x1={0}
                x2={SPARK_W}
                y1={s.goalY}
                y2={s.goalY}
                stroke="var(--color-text-secondary)"
                strokeWidth={1.5}
                strokeDasharray="6 5"
              />
            ) : null}
            {s.dots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r={2.5} fill="var(--color-weight)" opacity={0.35} />
            ))}
            <path
              d={s.trend}
              fill="none"
              stroke="var(--color-weight)"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          </svg>
          {goalKg !== null ? (
            <p className="mt-1 text-xs text-text-secondary">
              {s.goalY !== null ? 'Dashed line: goal' : 'Goal'} {formatNumber(convert(goalKg), 1)}{' '}
              {unit}
            </p>
          ) : null}
        </div>
      ) : null}
    </DashCard>
  );
}

function Progress({ timeZone, units }: { timeZone: string; units: UnitSystem }) {
  const { series, today } = useDaySeries('1W', timeZone);
  return (
    <section>
      <h2 className="text-2xl font-bold">Progress</h2>
      {/* Phone: one column. Desktop: a three-column grid. */}
      <div
        className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
        data-testid="dashboard"
      >
        <TodayCard timeZone={timeZone} today={today} />
        {series ? (
          <>
            <CaloriesWeekCard series={series} />
            <MacrosWeekCard series={series} />
          </>
        ) : (
          <>
            <DashCard title="Calories this week" headline=" " testId="card-calories" />
            <DashCard title="Macros this week" headline=" " testId="card-macros" />
          </>
        )}
        <WeightCard today={today} units={units} />
        <MeasurementsCard timeZone={timeZone} />
        <StreakCard />
        <DashCard
          title="This week's check-in"
          headline="Your first check-in comes after a week of logging"
          testId="card-checkin"
        >
          <p className="text-sm text-text-secondary">
            Each week, a short summary of how the week went: average calories and days on target.
          </p>
        </DashCard>
      </div>
    </section>
  );
}
