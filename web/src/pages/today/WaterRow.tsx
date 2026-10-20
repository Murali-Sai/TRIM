import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { addWater, deleteWater, listWater, WATER_KEY } from '../../api/tracking';
import { formatWater, parseWater, waterButtons, type WaterUnit } from '../../lib/water';
import { zonedWallToIso } from '../../lib/zoned';
import type { ToastMessage } from '../../components/Toast';

interface Props {
  day: string;
  isToday: boolean;
  timeZone: string;
  unit: WaterUnit;
  /** Null when no water target is set (water has no default). */
  targetMl: number | null;
  onToast: (text: string, action?: ToastMessage['action']) => void;
}

const button =
  'tap cursor-pointer rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-semibold transition-colors duration-200 hover:bg-surface-2 disabled:opacity-60';

/** Under the strip when water tracking is on: a bar toward the target and one-tap adds. */
export function WaterRow({ day, isToday, timeZone, unit, targetMl, onToast }: Props) {
  const queryClient = useQueryClient();
  const id = useId();
  const water = useQuery({ queryKey: [...WATER_KEY, day], queryFn: () => listWater(day) });
  const [custom, setCustom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: WATER_KEY });

  const undo = useMutation({ mutationFn: deleteWater, onSuccess: refresh });
  const add = useMutation({
    // A past day gets its water at noon; today, now.
    mutationFn: (ml: number) =>
      addWater(ml, isToday ? undefined : zonedWallToIso(`${day}T12:00`, timeZone)),
    onSuccess: async (row) => {
      setError(null);
      setCustom(null);
      await refresh();
      onToast(`Added ${formatWater(row.ml, unit)} of water.`, {
        label: 'Undo',
        onClick: () => undo.mutate(row.id),
      });
    },
    onError: () => setError('Could not add water. Check your connection and try again.'),
  });

  const total = (water.data ?? []).reduce((s, w) => s + w.ml, 0);
  const fill = targetMl ? Math.min(1, total / targetMl) : 0;

  function onCustom(e: FormEvent) {
    e.preventDefault();
    const ml = parseWater(custom ?? '', unit);
    if (ml === null) {
      setError(unit === 'ml' ? 'Enter 1 to 5,000 ml.' : 'Enter 1 to 169 fl oz.');
      return;
    }
    add.mutate(ml);
  }

  return (
    <section
      aria-label="Water"
      className="mt-3 rounded-xl border border-border bg-surface p-3 lg:p-4"
      data-testid="water-row"
    >
      <div className="flex items-baseline gap-2">
        <span className="eyebrow">Water</span>
        <span className="num ml-auto text-sm" data-testid="water-total">
          {formatWater(total, unit)}
          {targetMl ? (
            <span className="text-text-secondary"> / {formatWater(targetMl, unit)}</span>
          ) : null}
        </span>
      </div>
      {targetMl ? (
        <div className="mt-1.5 h-1.5 rounded-full bg-surface-2" aria-hidden="true">
          <div
            className="h-1.5 rounded-full"
            style={{ width: `${fill * 100}%`, background: 'var(--color-water)' }}
          />
        </div>
      ) : (
        <p className="mt-1 text-sm text-text-secondary">
          <Link to="/targets" className="font-semibold text-accent underline">
            Set a water target
          </Link>{' '}
          to see a bar toward it.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {waterButtons(unit).map((b) => (
          <button
            key={b.label}
            type="button"
            disabled={add.isPending}
            onClick={() => add.mutate(b.ml)}
            className={button}
            aria-label={`Add ${b.label.slice(1)} of water`}
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          aria-expanded={custom !== null}
          onClick={() => setCustom(custom === null ? '' : null)}
          className={button}
        >
          Custom
        </button>
      </div>
      {custom !== null ? (
        <form onSubmit={onCustom} noValidate className="mt-3 flex items-end gap-2">
          <div>
            <label htmlFor={`${id}-amt`} className="block text-sm font-semibold">
              Amount ({unit === 'ml' ? 'ml' : 'fl oz'})
            </label>
            <input
              id={`${id}-amt`}
              inputMode="decimal"
              autoComplete="off"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="tap num mt-1 w-28 rounded-lg border border-border bg-surface px-3 py-2"
            />
          </div>
          <button type="submit" disabled={add.isPending} className={`${button} mb-0.5`}>
            Add
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
