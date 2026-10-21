import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import {
  asMetrics,
  createType,
  editType,
  listTypes,
  MEASUREMENT_TYPES_KEY,
  reorderTypes,
  type MeasureUnit,
  type MeasurementTypePatch,
  type Metric,
} from '../../api/measurements';
import { Field } from '../../components/Field';
import { ArrowDownIcon, ArrowUpIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { kindOf, UNIT_OPTIONS } from '../../lib/measureUnits';
import { moveItem } from '../../lib/staples';
import { usePageTitle } from '../../usePageTitle';
import { Notice, primaryButton, secondaryButton, Section } from '../account/Section';

const message = (e: unknown, fallback: string) =>
  (e instanceof ApiError && e.userMessage) || fallback;
const iconButton =
  'tap flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-colors duration-200 hover:bg-surface-2 disabled:cursor-default disabled:opacity-30';

function unitText(unit: MeasureUnit): string {
  return unit === 'text' ? 'text' : unit;
}

function EditSheet({
  metric,
  busy,
  error,
  onClose,
  onSave,
  onArchive,
}: {
  metric: Metric;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (patch: MeasurementTypePatch) => void;
  onArchive: () => void;
}) {
  const t = metric.types[0];
  const id = useId();
  const [name, setName] = useState(metric.name);
  const [unit, setUnit] = useState<MeasureUnit>(t?.unit ?? 'cm');
  const [precision, setPrecision] = useState(t?.precision ?? 1);
  if (!t) return null;
  const readings = metric.types.reduce((n, x) => n + x.entries, 0);
  // With readings, a metric only switches between units that store the same thing.
  const units = UNIT_OPTIONS.filter(([u]) => readings === 0 || kindOf(u) === kindOf(t.unit));
  return (
    <Sheet title={metric.name} onClose={onClose} testId="metric-sheet">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            ...(name.trim() !== metric.name ? { name: name.trim() } : {}),
            ...(unit !== t.unit ? { unit } : {}),
            ...(precision !== t.precision ? { precision } : {}),
          });
        }}
      >
        <Field
          id={`${id}-name`}
          label="Name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <div>
          <label htmlFor={`${id}-unit`} className="block font-semibold">
            Unit
          </label>
          <select
            id={`${id}-unit`}
            value={unit}
            onChange={(e) => setUnit(e.target.value as MeasureUnit)}
            className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5"
          >
            {units.map(([u, label]) => (
              <option key={u} value={u}>
                {label}
              </option>
            ))}
          </select>
          {readings > 0 ? (
            <p className="mt-1 text-sm text-text-secondary">
              It has readings, so it keeps the same kind of unit.
            </p>
          ) : null}
        </div>
        {unit !== 'text' ? (
          <div>
            <label htmlFor={`${id}-precision`} className="block font-semibold">
              Decimal places
            </label>
            <select
              id={`${id}-precision`}
              value={precision}
              onChange={(e) => setPrecision(Number(e.target.value))}
              className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              {[0, 1, 2, 3].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className={`${primaryButton} cursor-pointer`}
        >
          {busy ? 'Saving' : 'Save'}
        </button>
        <div className="border-t border-border pt-4">
          <button
            type="button"
            onClick={onArchive}
            disabled={busy}
            className={`${secondaryButton} cursor-pointer`}
          >
            Archive {metric.name}
          </button>
          <p className="mt-2 text-sm text-text-secondary">
            Archiving hides it from logging and charts. Its{' '}
            {readings === 1 ? 'reading' : 'readings'} stay in your history and downloads, and you
            can restore it any time.
          </p>
        </div>
      </form>
    </Sheet>
  );
}

function AddMetric({ onAdded }: { onAdded: () => void }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<MeasureUnit>('cm');
  const [paired, setPaired] = useState(false);
  const add = useMutation({
    mutationFn: () => createType({ name: name.trim(), unit, paired, precision: 1 }),
    onSuccess: (data) => {
      queryClient.setQueryData(
        [...MEASUREMENT_TYPES_KEY, 'live'],
        data.filter((t) => !t.archived_at),
      );
      void queryClient.invalidateQueries({ queryKey: MEASUREMENT_TYPES_KEY });
      setName('');
      setPaired(false);
      onAdded();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) add.mutate();
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" data-testid="add-metric">
      <Field
        id={`${id}-name`}
        label="Name"
        value={name}
        maxLength={40}
        placeholder="Calf, Resting heart rate, Mood"
        onChange={(e) => setName(e.target.value)}
      />
      <div>
        <label htmlFor={`${id}-unit`} className="block font-semibold">
          Unit
        </label>
        <select
          id={`${id}-unit`}
          value={unit}
          onChange={(e) => setUnit(e.target.value as MeasureUnit)}
          className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5"
        >
          {UNIT_OPTIONS.map(([u, label]) => (
            <option key={u} value={u}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <label className="tap flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={paired}
          onChange={(e) => setPaired(e.target.checked)}
          className="h-5 w-5 accent-[var(--color-accent)]"
        />
        <span>Left and right (two readings, one chart)</span>
      </label>
      {add.isError ? (
        <Notice kind="error">{message(add.error, 'Could not add it. Try again.')}</Notice>
      ) : null}
      <button
        type="submit"
        disabled={!name.trim() || add.isPending}
        className={`${primaryButton} cursor-pointer`}
      >
        {add.isPending ? 'Adding' : 'Add metric'}
      </button>
    </form>
  );
}

/** Manage metrics (task 4.2): create, rename, reorder, switch on or off, archive, restore. */
export function MetricsPage() {
  usePageTitle('Manage metrics');
  const queryClient = useQueryClient();
  const live = useQuery({
    queryKey: [...MEASUREMENT_TYPES_KEY, 'live'],
    queryFn: () => listTypes(false),
  });
  const archived = useQuery({
    queryKey: [...MEASUREMENT_TYPES_KEY, 'archived'],
    queryFn: () => listTypes(true),
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const metrics = asMetrics(live.data ?? []);
  const gone = asMetrics(archived.data ?? []);
  const current = metrics.find((m) => m.key === editing) ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: MEASUREMENT_TYPES_KEY });
  const edit = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: MeasurementTypePatch }) => editType(id, patch),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => editType(id, { is_active: on }),
    onSettled: refresh,
  });
  const reorder = useMutation({
    mutationFn: (order: Metric[]) => reorderTypes(order.flatMap((m) => m.types.map((t) => t.id))),
    onSettled: refresh,
  });
  const restore = useMutation({
    mutationFn: (id: string) => editType(id, { archived: false }),
    onSettled: refresh,
  });
  const failed = toggle.error ?? reorder.error ?? restore.error;

  return (
    <section className="max-w-2xl">
      <Link to="/body" className="tap text-sm font-semibold text-accent underline">
        Body
      </Link>
      <h2 className="mt-2 text-2xl font-bold">Manage metrics</h2>
      <div className="mt-4 flex flex-col gap-4">
        <Section
          title="Your metrics"
          description="Switched-on metrics show in the quick log and charts."
        >
          {live.isError ? (
            <Notice kind="error">Could not load your metrics. Try again in a moment.</Notice>
          ) : null}
          {failed ? (
            <Notice kind="error">{message(failed, 'Could not save. Try again.')}</Notice>
          ) : null}
          <ul className="flex flex-col divide-y divide-border" aria-label="Your metrics">
            {metrics.map((m, i) => {
              const t = m.types[0];
              if (!t) return null;
              const readings = m.types.reduce((n, x) => n + x.entries, 0);
              return (
                <li key={m.key} className="flex items-center gap-1 py-1" data-testid="metric-row">
                  <button
                    type="button"
                    onClick={() => {
                      edit.reset();
                      setEditing(m.key);
                    }}
                    className="tap flex min-w-0 flex-1 cursor-pointer flex-col rounded-lg px-2 py-2 text-left transition-colors duration-200 hover:bg-surface-2"
                    aria-label={`Edit ${m.name}`}
                  >
                    <span
                      className={`line-clamp-2 font-semibold ${t.is_active ? '' : 'text-text-secondary'}`}
                    >
                      {m.name}
                      {m.types.length === 2 ? (
                        <span className="font-normal text-text-secondary"> · left and right</span>
                      ) : null}
                    </span>
                    <span className="num text-sm text-text-secondary">
                      {unitText(t.unit)} · {readings === 1 ? '1 reading' : `${readings} readings`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => reorder.mutate(moveItem(metrics, i, i - 1))}
                    disabled={i === 0 || reorder.isPending}
                    className={iconButton}
                    aria-label={`Move ${m.name} up`}
                  >
                    <ArrowUpIcon width={18} height={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => reorder.mutate(moveItem(metrics, i, i + 1))}
                    disabled={i === metrics.length - 1 || reorder.isPending}
                    className={iconButton}
                    aria-label={`Move ${m.name} down`}
                  >
                    <ArrowDownIcon width={18} height={18} />
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={t.is_active}
                    aria-label={`Track ${m.name}`}
                    onClick={() => toggle.mutate({ id: t.id, on: !t.is_active })}
                    className="tap flex h-11 shrink-0 cursor-pointer items-center pl-1"
                  >
                    <span
                      aria-hidden="true"
                      className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${t.is_active ? 'bg-accent' : 'bg-border'}`}
                    >
                      <span
                        className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-surface shadow transition-transform duration-200 motion-reduce:transition-none ${t.is_active ? 'translate-x-6' : 'translate-x-1'}`}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
        <Section title="Add a metric">
          {added ? <Notice kind="ok">Added. It is switched on and ready to log.</Notice> : null}
          <AddMetric onAdded={() => setAdded(true)} />
        </Section>
        {gone.length > 0 ? (
          <Section title="Archived" description="Their readings are kept and still download.">
            <ul className="flex flex-col divide-y divide-border" aria-label="Archived metrics">
              {gone.map((m) => {
                const readings = m.types.reduce((n, x) => n + x.entries, 0);
                return (
                  <li
                    key={m.key}
                    className="flex items-center gap-3 py-2"
                    data-testid="archived-row"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{m.name}</span>
                      <span className="num text-sm text-text-secondary">
                        {readings === 1 ? '1 reading' : `${readings} readings`}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => m.types[0] && restore.mutate(m.types[0].id)}
                      disabled={restore.isPending}
                      className={`${secondaryButton} cursor-pointer`}
                    >
                      Restore<span className="sr-only"> {m.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}
      </div>
      {current ? (
        <EditSheet
          key={current.key}
          metric={current}
          busy={edit.isPending}
          error={edit.error ? message(edit.error, 'Could not save. Try again.') : null}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            const first = current.types[0];
            if (!first) return;
            if (Object.keys(patch).length === 0) setEditing(null);
            else edit.mutate({ id: first.id, patch });
          }}
          onArchive={() => {
            const first = current.types[0];
            if (first) edit.mutate({ id: first.id, patch: { archived: true } });
          }}
        />
      ) : null}
    </section>
  );
}
