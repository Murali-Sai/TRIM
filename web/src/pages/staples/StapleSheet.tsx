import { useId, useState } from 'react';
import type { Staple, StaplePatch } from '../../api/staples';
import { Sheet } from '../../components/Sheet';
import { parseAmount } from '../../lib/foodAmount';
import { allowedAmounts, amountsError, defaultAmounts, formatUnits } from '../../lib/staples';
import { formatNumber } from '../../lib/units';
import { Notice, primaryButton } from '../account/Section';

interface Props {
  staple: Staple;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (patch: StaplePatch) => void;
  onRemove: () => void;
}

/** A unit's default amounts, as the API sets them when the unit changes. */
function defaultsFor(staple: Staple, label: string): { min: string; max: string; step: string } {
  if (label === staple.unit_label) {
    return {
      min: String(staple.min_units),
      max: String(staple.max_units),
      step: String(staple.step_units),
    };
  }
  const d = defaultAmounts(label);
  return { min: String(d.min), max: String(d.max), step: String(d.step) };
}

/** The staple's unit and the amounts a suggestion may use. */
export function StapleSheet({ staple, busy, error, onClose, onSave, onRemove }: Props) {
  const id = useId();
  const [unit, setUnit] = useState(staple.unit_label);
  const [fields, setFields] = useState(() => defaultsFor(staple, staple.unit_label));
  const name = staple.name ?? 'Deleted food';
  const min = parseAmount(fields.min) ?? Number.NaN;
  const max = parseAmount(fields.max) ?? Number.NaN;
  const step = parseAmount(fields.step) ?? Number.NaN;
  const problem = amountsError(min, max, step);
  const amounts = allowedAmounts(min, max, step) ?? [];
  const unitGrams = staple.units.find((u) => u.label === unit)?.grams ?? staple.unit_grams;

  const input = (key: keyof typeof fields, label: string) => (
    <div>
      <label htmlFor={`${id}-${key}`} className="block text-sm font-semibold">
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        inputMode="decimal"
        autoComplete="off"
        value={fields[key]}
        onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
        aria-invalid={problem !== null}
        aria-describedby={problem ? `${id}-problem` : undefined}
        className="tap num mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2"
      />
    </div>
  );

  return (
    <Sheet title={name} onClose={onClose} testId="staple-sheet">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (problem) return;
          onSave({
            ...(unit !== staple.unit_label ? { unit_label: unit } : {}),
            min_units: min,
            max_units: max,
            step_units: step,
          });
        }}
      >
        {staple.units.length > 0 ? (
          <div>
            <label htmlFor={`${id}-unit`} className="block font-semibold">
              Unit
            </label>
            <select
              id={`${id}-unit`}
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                setFields(defaultsFor(staple, e.target.value));
              }}
              className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              {staple.units.map((u) => (
                <option key={u.label} value={u.label}>
                  {u.label === '100 g' ? '100 g' : `${u.label} (${formatNumber(u.grams)} g)`}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            A saved meal counts as one unit: the whole meal at its saved amounts.
          </p>
        )}
        <fieldset>
          <legend className="font-semibold">Amounts a suggestion can use</legend>
          <p className="text-sm text-text-secondary">
            How many of {unit === '1 meal' ? 'the meal' : `"${unit}"`} at a time, up to 7 choices.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            {input('min', 'From')}
            {input('max', 'To')}
            {input('step', 'Step')}
          </div>
        </fieldset>
        {problem ? (
          <p id={`${id}-problem`} className="text-sm font-medium text-text" role="alert">
            {problem}
          </p>
        ) : (
          <div>
            <p className="text-sm font-semibold">Allowed</p>
            <ul className="mt-1 flex flex-wrap gap-2" aria-label="Allowed amounts">
              {amounts.map((a) => (
                <li
                  key={a}
                  className="num rounded-full border border-border px-3 py-1 text-sm"
                  data-testid="staple-amount"
                >
                  {formatUnits(a)}
                  {unitGrams ? (
                    <span className="text-text-secondary">
                      {' '}
                      · {formatNumber(Math.round(a * unitGrams))} g
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error ? <Notice kind="error">{error}</Notice> : null}
        <button
          type="submit"
          disabled={busy || problem !== null}
          className={`${primaryButton} cursor-pointer`}
        >
          {busy ? 'Saving' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="tap w-fit cursor-pointer text-sm font-semibold text-accent underline"
        >
          Remove from staples
        </button>
      </form>
    </Sheet>
  );
}
