import { useState, type FormEvent } from 'react';
import type { UnitSystem } from '../../api/auth';
import type { WeightEntry, WeightInput } from '../../api/weights';
import { Field } from '../../components/Field';
import type { TrendPoint } from '../../lib/trend';
import { formatDay, formatTime, isoToZonedWall, zonedWallToIso } from '../../lib/zoned';
import { primaryButton, secondaryButton } from '../account/Section';
import { displayNumber, displayWeight, parseWeight, unitLabel } from './weightFormat';

interface Props {
  entries: readonly WeightEntry[];
  points: readonly TrendPoint[];
  units: UnitSystem;
  timeZone: string;
  onEdit: (id: string, input: Partial<WeightInput>) => Promise<unknown>;
  onDelete: (entry: WeightEntry) => void;
}

const SHOWN_AT_FIRST = 20;
const linkButton = 'tap rounded-lg px-3 py-2 font-semibold text-accent underline-offset-2';

function EditRow({
  entry,
  units,
  timeZone,
  onSave,
  onCancel,
}: {
  entry: WeightEntry;
  units: UnitSystem;
  timeZone: string;
  onSave: (input: Partial<WeightInput>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(displayNumber(entry.kg, units).replace(/,/g, ''));
  const [when, setWhen] = useState(isoToZonedWall(entry.measured_at, timeZone));
  const [note, setNote] = useState(entry.note ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseWeight(raw, units);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    try {
      await onSave({
        kg: parsed.kg,
        measured_at: zonedWallToIso(when, timeZone),
        note: note.trim() || null,
      });
    } catch {
      // The page shows the server's message.
    }
  }

  const id = `edit-${entry.id}`;
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-3">
      <Field
        id={`${id}-weight`}
        label={`Weight (${unitLabel(units)})`}
        inputMode="decimal"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        error={error}
      />
      <Field
        id={`${id}-when`}
        label="When"
        type="datetime-local"
        value={when}
        max={isoToZonedWall(new Date().toISOString(), timeZone)}
        onChange={(e) => setWhen(e.target.value)}
      />
      <Field
        id={`${id}-note`}
        label="Note (optional)"
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2 sm:col-span-3">
        <button type="submit" className={primaryButton}>
          Save changes
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Weigh-ins newest first, each with edit and delete. */
export function WeightHistory({ entries, points, units, timeZone, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const outliers = new Set(points.filter((p) => p.outlier).map((p) => p.at));
  const newestFirst = [...entries].reverse();
  const shown = all ? newestFirst : newestFirst.slice(0, SHOWN_AT_FIRST);

  if (entries.length === 0) {
    return <p className="text-text-secondary">Your weigh-ins will be listed here.</p>;
  }
  return (
    <>
      <ul className="divide-y divide-border">
        {shown.map((entry) => {
          const day = formatDay(entry.measured_at, timeZone);
          const time = formatTime(entry.measured_at, timeZone);
          if (editing === entry.id) {
            return (
              <li key={entry.id}>
                <EditRow
                  entry={entry}
                  units={units}
                  timeZone={timeZone}
                  onCancel={() => setEditing(null)}
                  onSave={async (input) => {
                    await onEdit(entry.id, input);
                    setEditing(null);
                  }}
                />
              </li>
            );
          }
          return (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-semibold">{displayWeight(entry.kg, units)}</span>{' '}
                  <span className="text-text-secondary">
                    {day}, {time}
                  </span>
                </p>
                {outliers.has(entry.measured_at) ? (
                  <p className="text-sm text-text-secondary">
                    Not counted in your trend: a big jump from the days around it.
                  </p>
                ) : null}
                {entry.note ? <p className="break-words text-sm">{entry.note}</p> : null}
              </div>
              <div className="flex">
                <button
                  type="button"
                  className={linkButton}
                  aria-label={`Edit ${displayWeight(entry.kg, units)} on ${day}`}
                  onClick={() => setEditing(entry.id)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={linkButton}
                  aria-label={`Delete ${displayWeight(entry.kg, units)} on ${day}`}
                  onClick={() => onDelete(entry)}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {shown.length < newestFirst.length ? (
        <button type="button" className={`${secondaryButton} mt-3`} onClick={() => setAll(true)}>
          Show all {newestFirst.length} weigh-ins
        </button>
      ) : null}
    </>
  );
}
