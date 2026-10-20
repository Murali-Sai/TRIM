import { useState, type FormEvent } from 'react';
import type { LogEntry, LogPatch } from '../../api/logs';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { macroLine } from '../../lib/foodAmount';
import { draftFrom, patchFor, previewFor, readDraft, unitGrams } from '../../lib/logEdit';
import { formatNumber } from '../../lib/units';
import { Notice, primaryButton, secondaryButton } from '../account/Section';

interface Props {
  entry: LogEntry;
  timeZone: string;
  today: string;
  busy: boolean;
  error: string | null;
  onSave: (patch: LogPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const input = 'tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-text';

/** Change the amount, time or date of one entry, duplicate it, or delete it. */
export function EditEntrySheet(p: Props) {
  const { entry: e } = p;
  const [draft, setDraft] = useState(() => draftFrom(e, p.timeZone));
  const [shown, setShown] = useState<ReturnType<typeof readDraft>['errors']>({});
  const read = readDraft(draft, e, p.today);
  const preview = previewFor(e, read.grams);
  const perUnit = unitGrams(e);
  const units = perUnit && e.unit_label ? [e.unit_label, 'g'] : ['g'];

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setShown(read.errors);
    if (Object.keys(read.errors).length > 0) return;
    const patch = patchFor(e, read, p.timeZone);
    if (Object.keys(patch).length === 0) p.onClose();
    else p.onSave(patch);
  }

  return (
    <Sheet title={e.name} onClose={p.onClose} testId="edit-sheet">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {e.brand ? <p className="-mt-2 text-sm text-text-secondary">{e.brand}</p> : null}
        {e.grams !== null ? (
          <div className="grid grid-cols-2 gap-3">
            <Field
              id="edit-amount"
              label="Amount"
              inputMode="decimal"
              autoComplete="off"
              value={draft.amount}
              onChange={(x) => setDraft({ ...draft, amount: x.target.value })}
              error={shown.amount}
            />
            <div>
              <label htmlFor="edit-unit" className="block font-semibold">
                Unit
              </label>
              <select
                id="edit-unit"
                value={draft.unit}
                onChange={(x) => {
                  const unit = x.target.value;
                  // Keep the same amount of food when switching unit.
                  const amount =
                    read.grams === null
                      ? draft.amount
                      : unit === 'g'
                        ? String(read.grams)
                        : formatNumber(read.grams / (perUnit ?? 1), 2).replace(/\.?0+$/, '');
                  setDraft({ ...draft, unit, amount });
                }}
                className={`${input} cursor-pointer`}
              >
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u === 'g' ? 'grams' : `${u} (${formatNumber(perUnit ?? 0)} g)`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">A quick add has no amount to change.</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-time" className="block font-semibold">
              Time
            </label>
            <input
              id="edit-time"
              type="time"
              value={draft.time}
              onChange={(x) => x.target.value && setDraft({ ...draft, time: x.target.value })}
              className={input}
            />
          </div>
          <div>
            <label htmlFor="edit-date" className="block font-semibold">
              Date
            </label>
            <input
              id="edit-date"
              type="date"
              value={draft.date}
              max={p.today}
              aria-invalid={shown.date ? true : undefined}
              aria-describedby={shown.date ? 'edit-date-error' : undefined}
              onChange={(x) => x.target.value && setDraft({ ...draft, date: x.target.value })}
              className={input}
            />
            {shown.date ? (
              <p id="edit-date-error" className="mt-1 text-sm font-medium">
                {shown.date}
              </p>
            ) : null}
          </div>
        </div>

        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm num" data-testid="edit-preview">
          {preview
            ? `${macroLine(preview)} · ${formatNumber(read.grams ?? 0)} g`
            : e.grams === null
              ? macroLine(e)
              : 'Enter an amount to see calories.'}
        </p>

        {p.error ? <Notice kind="error">{p.error}</Notice> : null}

        <div className="flex flex-col gap-3">
          <button type="submit" disabled={p.busy} className={`${primaryButton} cursor-pointer`}>
            {p.busy ? 'Saving' : 'Save'}
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={p.busy}
              onClick={p.onDuplicate}
              className={`${secondaryButton} cursor-pointer`}
            >
              Duplicate
            </button>
            <button
              type="button"
              disabled={p.busy}
              onClick={p.onDelete}
              className={`${secondaryButton} cursor-pointer`}
            >
              Delete
            </button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}
