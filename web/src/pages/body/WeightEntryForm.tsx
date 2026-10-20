import { useState, type FormEvent } from 'react';
import type { UnitSystem } from '../../api/auth';
import type { WeightInput } from '../../api/weights';
import { Field } from '../../components/Field';
import { isoToZonedWall, zonedWallToIso } from '../../lib/zoned';
import { primaryButton, secondaryButton } from '../account/Section';
import { parseWeight, unitLabel } from './weightFormat';

interface Props {
  units: UnitSystem;
  timeZone: string;
  /** Shown as the placeholder, so the last weigh-in is a glance away. */
  lastKg: string | null;
  saving: boolean;
  onSave: (input: WeightInput) => Promise<unknown>;
}

/**
 * Quick entry: one number and Enter. Time defaults to now; a different time or a note is one
 * tap away but never in the way.
 */
export function WeightEntryForm({ units, timeZone, lastKg, saving, onSave }: Props) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const nowWall = isoToZonedWall(new Date().toISOString(), timeZone);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseWeight(raw, units);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const input: WeightInput = { kg: parsed.kg };
    if (more && when) input.measured_at = zonedWallToIso(when, timeZone);
    if (more && note.trim()) input.note = note.trim();
    try {
      await onSave(input);
      setRaw('');
      setNote('');
      setWhen('');
      setMore(false);
    } catch {
      // The page shows the server's message.
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Field
          id="weight"
          label={`Weight (${unitLabel(units)})`}
          className="flex-1"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          autoFocus
          placeholder={lastKg ?? undefined}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          error={error}
        />
        <button
          type="submit"
          className={`${primaryButton} ${error ? 'mb-7' : ''}`}
          disabled={saving}
        >
          Save
        </button>
      </div>
      {more ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            id="weight-when"
            label="When"
            type="datetime-local"
            max={nowWall}
            value={when || nowWall}
            onChange={(e) => setWhen(e.target.value)}
          />
          <Field
            id="weight-note"
            label="Note (optional)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      ) : (
        <div>
          <button type="button" className={secondaryButton} onClick={() => setMore(true)}>
            Change time or add a note
          </button>
        </div>
      )}
    </form>
  );
}
