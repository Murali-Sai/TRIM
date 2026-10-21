import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Phase, PhaseInput, PhaseKind } from '../../api/phases';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { shortDate } from '../../lib/chart/headlines';
import { KIND_NAMES } from '../../lib/phases';
import { addDays } from '../../lib/nutritionSeries';
import { Notice, primaryButton, secondaryButton } from '../account/Section';

const KINDS: readonly PhaseKind[] = ['cut', 'maintain', 'bulk', 'custom'];

/**
 * New or edit phase. Saving never changes targets; once saved, the sheet says so and offers
 * "Also update targets" as its own step (SPEC page 3, Diet phases).
 */
export function PhaseSheet({
  phase,
  ongoing,
  today,
  busy,
  error,
  saved,
  onSave,
  onDelete,
  onClose,
}: {
  /** The phase being edited, or null for a new one. */
  phase: Phase | null;
  /** The phase still going (no end date), which a new phase may end. */
  ongoing: Phase | null;
  today: string;
  busy: boolean;
  error: string | null;
  /** Set once the phase is saved: the sheet then offers "Also update targets". */
  saved: boolean;
  onSave: (body: PhaseInput) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<PhaseKind>(phase?.kind ?? 'cut');
  const [label, setLabel] = useState(phase?.label ?? '');
  const [start, setStart] = useState(phase?.start_date ?? today);
  const [end, setEnd] = useState(phase?.end_date ?? '');
  const [note, setNote] = useState(phase?.note ?? '');
  const [endCurrent, setEndCurrent] = useState(true);
  const [bad, setBad] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const group = useId();
  const id = useId();

  const canEnd = !phase && ongoing !== null && start > ongoing.start_date;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (kind === 'custom' && !label.trim()) return setBad('Give your phase a name.');
    if (!start) return setBad('Pick a start date.');
    if (end && end < start) return setBad('The end date cannot be before the start date.');
    setBad(null);
    onSave({
      kind,
      label: label.trim() || null,
      start_date: start,
      end_date: end || null,
      note: note.trim() || null,
      ...(canEnd && endCurrent ? { end_current: true } : {}),
    });
  }

  if (saved) {
    return (
      <Sheet title="Phase saved" onClose={onClose} testId="phase-sheet">
        <p>Your targets have not changed. Phases only mark dates on your charts.</p>
        <p className="mt-2 text-text-secondary">
          If this phase comes with new targets, you can change them now.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/targets" className={`${secondaryButton} inline-block`}>
            Also update targets
          </Link>
          <button
            type="button"
            className={`${primaryButton} cursor-pointer`}
            onClick={onClose}
            autoFocus
          >
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  const message = bad ?? error;
  return (
    <Sheet
      title={phase ? `Edit ${phase.name}` : 'New phase'}
      onClose={onClose}
      testId="phase-sheet"
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <fieldset>
          <legend className="font-semibold">Kind</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <label
                key={k}
                className={`tap flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors duration-200 ${
                  kind === k ? 'border-accent bg-surface-2' : 'border-border hover:bg-surface-2'
                }`}
              >
                <input
                  type="radio"
                  name={group}
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="accent-[var(--color-accent)]"
                />
                {KIND_NAMES[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          id={`${id}-label`}
          label={kind === 'custom' ? 'Name' : 'Name (optional)'}
          hint={kind === 'custom' ? 'Such as "Holiday" or "Training block".' : undefined}
          maxLength={40}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <div className="flex flex-col gap-4">
          <Field
            id={`${id}-start`}
            label="Start"
            type="date"
            value={start}
            max={addDays(today, 366)}
            onChange={(e) => setStart(e.target.value)}
          />
          <Field
            id={`${id}-end`}
            label="End (optional)"
            hint="Leave empty while the phase is going."
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        {canEnd && ongoing ? (
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={endCurrent}
              onChange={(e) => setEndCurrent(e.target.checked)}
              className="mt-1 h-5 w-5 accent-[var(--color-accent)]"
            />
            <span>
              End your {ongoing.name} on {shortDate(addDays(start, -1))}
            </span>
          </label>
        ) : null}
        <div>
          <label htmlFor={`${id}-note`} className="block font-semibold">
            Note (optional)
          </label>
          <textarea
            id={`${id}-note`}
            maxLength={500}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5"
          />
        </div>
        <p className="text-sm text-text-secondary">Saving a phase does not change your targets.</p>
        {message ? <Notice kind="error">{message}</Notice> : null}
        <button type="submit" disabled={busy} className={`${primaryButton} w-full cursor-pointer`}>
          {busy ? 'Saving' : phase ? 'Save' : 'Add phase'}
        </button>
        {phase ? (
          confirmDelete ? (
            <div className="rounded-lg border border-border p-3" role="group" aria-label="Confirm">
              <p>Delete this phase? Your food, weight and targets stay as they are.</p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  className={`${secondaryButton} cursor-pointer`}
                  onClick={onDelete}
                  disabled={busy}
                >
                  Delete phase
                </button>
                <button
                  type="button"
                  className={`${secondaryButton} cursor-pointer`}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${secondaryButton} w-full cursor-pointer`}
              onClick={() => setConfirmDelete(true)}
            >
              Delete {phase.name}
            </button>
          )
        ) : null}
      </form>
    </Sheet>
  );
}
