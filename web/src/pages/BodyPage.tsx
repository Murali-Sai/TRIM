import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { useMe } from '../api/auth';
import { ApiError } from '../api/client';
import { BODY_STATS_KEY, getBodyStats, setGoalWeight } from '../api/setup';
import {
  addWeight,
  deleteWeight,
  editWeight,
  listWeights,
  restoreWeight,
  WEIGHTS_KEY,
  type WeightEntry,
  type WeightInput,
} from '../api/weights';
import { usePageTitle } from '../usePageTitle';
import { Notice, secondaryButton, Section } from './account/Section';
import { GoalWeight } from './body/GoalWeight';
import { MeasurementsSection } from './body/MeasurementsSection';
import { WeightEntryForm } from './body/WeightEntryForm';
import { WeightHistory } from './body/WeightHistory';
import {
  displayNumber,
  displayWeight,
  projectionFor,
  projectionSentence,
  trendFor,
  trendSentence,
} from './body/weightFormat';
import { isoToZonedWall } from '../lib/zoned';

// uPlot loads only when a chart is on screen, not with every page.
const WeightChart = lazy(() =>
  import('./body/WeightChart').then((m) => ({ default: m.WeightChart })),
);

type LastAction = { kind: 'added' | 'deleted'; entry: WeightEntry } | null;

function message(e: unknown): string {
  return (
    (e instanceof ApiError && e.userMessage) ||
    'Could not save. Check your connection and try again.'
  );
}

export function BodyPage() {
  usePageTitle('Body');
  const me = useMe();
  const queryClient = useQueryClient();
  const weights = useQuery({ queryKey: WEIGHTS_KEY, queryFn: listWeights });
  const stats = useQuery({ queryKey: BODY_STATS_KEY, queryFn: getBodyStats });
  const [last, setLast] = useState<LastAction>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: WEIGHTS_KEY }),
      queryClient.invalidateQueries({ queryKey: BODY_STATS_KEY }),
    ]);
  const onError = (e: unknown) => setError(message(e));

  const add = useMutation({
    mutationFn: addWeight,
    onSuccess: (entry) => {
      setError(null);
      setLast({ kind: 'added', entry });
      return refresh();
    },
    onError,
  });
  const edit = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<WeightInput> }) =>
      editWeight(id, input),
    onSuccess: () => {
      setError(null);
      setLast(null);
      return refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (entry: WeightEntry) => deleteWeight(entry.id),
    onSuccess: (_, entry) => {
      setError(null);
      setLast({ kind: 'deleted', entry });
      return refresh();
    },
    onError,
  });
  const goal = useMutation({
    mutationFn: setGoalWeight,
    onSuccess: () => {
      setError(null);
      return refresh();
    },
    onError,
  });
  const undo = useMutation({
    mutationFn: (action: NonNullable<LastAction>) =>
      action.kind === 'added' ? deleteWeight(action.entry.id) : restoreWeight(action.entry.id),
    onSuccess: () => {
      setLast(null);
      return refresh();
    },
    onError,
  });

  if (!me.data) return null;
  const units = me.data.unit_system;
  const timeZone = me.data.timezone;
  const entries = weights.data ?? [];
  const trend = trendFor(entries);
  const latest = entries.at(-1);
  const headline = trendSentence(trend, units);
  const goalKg = stats.data?.goal_weight_kg ?? null;
  const today = isoToZonedWall(new Date().toISOString(), timeZone).slice(0, 10);
  const projection = projectionFor(trend, goalKg, today);
  const projectionText = projectionSentence(projection, goalKg, units);

  return (
    <section>
      <h2 className="text-2xl font-bold">Body</h2>
      {/* Phone: entry, chart, list. Desktop: entry and list beside the chart. */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-6">
        <div className="lg:col-start-1 lg:row-start-1">
          <Section title="Weight">
            {weights.isSuccess ? (
              <p className="mb-4 text-lg font-semibold" data-testid="trend-sentence">
                {headline}
              </p>
            ) : null}
            {weights.isSuccess && projectionText ? (
              <p className="-mt-2 mb-4" data-testid="projection-sentence">
                {projectionText}
              </p>
            ) : null}
            <WeightEntryForm
              units={units}
              timeZone={timeZone}
              lastKg={latest ? displayNumber(latest.kg, units) : null}
              saving={add.isPending}
              onSave={(input) => add.mutateAsync(input)}
            />
            {error ? <Notice kind="error">{error}</Notice> : null}
            {last ? (
              <div
                className="mt-3 flex items-center gap-3 rounded-lg bg-surface-2 p-3"
                role="status"
              >
                <p className="flex-1 text-sm">
                  {last.kind === 'added' ? 'Saved' : 'Deleted'}{' '}
                  {displayWeight(last.entry.kg, units)}.
                </p>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={undo.isPending}
                  onClick={() => undo.mutate(last)}
                >
                  Undo
                </button>
              </div>
            ) : null}
            <div className="mt-3">
              <GoalWeight
                goalKg={goalKg}
                units={units}
                saving={goal.isPending}
                onSave={(kg) => goal.mutateAsync(kg)}
              />
            </div>
          </Section>
        </div>
        {entries.length > 0 ? (
          <div className="lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <Section title="Weight chart">
              <Suspense fallback={<p className="text-text-secondary">Loading chart</p>}>
                <WeightChart
                  points={trend.points}
                  units={units}
                  timeZone={timeZone}
                  goalKg={goalKg}
                  headline={projectionText ? `${headline}. ${projectionText}` : headline}
                  projectionDate={projection.kind === 'projection' ? projection.date : null}
                />
              </Suspense>
            </Section>
          </div>
        ) : null}
        <div className="lg:col-start-1 lg:row-start-2">
          <Section title="Weigh-ins">
            {weights.isError ? (
              <Notice kind="error">Could not load your weigh-ins. Try again in a moment.</Notice>
            ) : (
              <WeightHistory
                entries={entries}
                points={trend.points}
                units={units}
                timeZone={timeZone}
                onEdit={(id, input) => edit.mutateAsync({ id, input })}
                onDelete={(entry) => remove.mutate(entry)}
              />
            )}
          </Section>
        </div>
        <div className="lg:col-start-1 lg:row-start-3">
          <MeasurementsSection />
        </div>
      </div>
    </section>
  );
}
