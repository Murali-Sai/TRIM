import { useState, type FormEvent } from 'react';
import type { UnitSystem } from '../../api/auth';
import { Field } from '../../components/Field';
import { primaryButton, secondaryButton } from '../account/Section';
import { displayNumber, displayWeight, parseWeight, unitLabel } from './weightFormat';

interface Props {
  goalKg: number | null;
  units: UnitSystem;
  saving: boolean;
  onSave: (goalKg: number | null) => Promise<unknown>;
}

const linkButton = 'tap rounded-lg px-3 py-2 font-semibold text-accent';

/** The goal is display only: a line on the chart. It never changes targets. */
export function GoalWeight({ goalKg, units, saving, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
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
      await onSave(parsed.kg);
      setEditing(false);
    } catch {
      // The page shows the server's message.
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
        <Field
          id="goal-weight"
          label={`Goal weight (${unitLabel(units)})`}
          className="min-w-40 flex-1"
          inputMode="decimal"
          autoFocus
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          error={error}
        />
        <button type="submit" className={primaryButton} disabled={saving}>
          Save goal
        </button>
        <button type="button" className={secondaryButton} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
    );
  }

  const open = () => {
    setRaw(goalKg === null ? '' : displayNumber(goalKg, units).replace(/,/g, ''));
    setError(null);
    setEditing(true);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      {goalKg === null ? (
        <button type="button" className={linkButton} onClick={open}>
          Set a goal weight
        </button>
      ) : (
        <>
          <p>Goal {displayWeight(goalKg, units)}</p>
          <button
            type="button"
            className={linkButton}
            onClick={open}
            aria-label="Change goal weight"
          >
            Change
          </button>
          <button
            type="button"
            className={linkButton}
            disabled={saving}
            onClick={() => void onSave(null).catch(() => undefined)}
            aria-label="Remove goal weight"
          >
            Remove
          </button>
        </>
      )}
    </div>
  );
}
