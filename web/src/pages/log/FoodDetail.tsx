import { useState, type FormEvent } from 'react';
import type { Food } from '../../api/foods';
import { Field } from '../../components/Field';
import {
  amountOptions,
  GRAMS,
  gramsFor,
  macroLine,
  nutrientsFor,
  parseAmount,
} from '../../lib/foodAmount';
import type { Picked } from '../../lib/picked';
import { formatNumber } from '../../lib/units';
import { primaryButton } from '../account/Section';

interface Props {
  food: Food;
  /** Where it was picked from, and the amount to start at (the last serving for recents). */
  start: Extract<Picked, { kind: 'food' }>;
  favourite: boolean;
  onFavourite: (on: boolean) => void;
  onAdd: (picked: Picked) => void;
}

/** The amount picker for one food, with a live preview of what it adds. */
export function FoodDetail({ food, start, favourite, onFavourite, onAdd }: Props) {
  const options = amountOptions(food);
  const first = options.find((o) => o.label === start.unit) ?? options[0] ?? GRAMS;
  const [unit, setUnit] = useState(first.label);
  const [amount, setAmount] = useState(String(start.unit === first.label ? start.quantity : 1));
  const [error, setError] = useState<string | null>(null);

  const chosen = options.find((o) => o.label === unit) ?? first;
  const quantity = parseAmount(amount);
  const grams = quantity === null ? null : gramsFor(quantity, chosen);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (quantity === null || grams === null || grams > 5000) {
      setError('Enter an amount above 0, up to 5,000 g.');
      return;
    }
    setError(null);
    onAdd({ kind: 'food', food, quantity, unit: chosen.label, grams, source: start.source });
  }

  return (
    <form onSubmit={onSubmit} noValidate data-testid="food-detail">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">{food.name}</h3>
          {food.brand ? <p className="text-sm text-text-secondary">{food.brand}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => onFavourite(!favourite)}
          aria-pressed={favourite}
          aria-label={
            favourite ? `Remove ${food.name} from favourites` : `Add ${food.name} to favourites`
          }
          className={`tap flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border transition-colors duration-200 hover:bg-surface-2 ${
            favourite ? 'text-fat-text' : 'text-text-secondary'
          }`}
        >
          <StarIcon filled={favourite} />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field
          id="log-amount"
          label="Amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={error}
        />
        <div>
          <label htmlFor="log-unit" className="block font-semibold">
            Unit
          </label>
          <select
            id="log-unit"
            value={unit}
            onChange={(e) => {
              const next = e.target.value;
              setUnit(next);
              if (next === 'g' && unit !== 'g' && grams !== null) setAmount(String(grams));
              if (next !== 'g' && unit === 'g') setAmount('1');
            }}
            className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5"
          >
            {options.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label === 'g' ? 'grams' : `${o.label} (${formatNumber(o.grams)} g)`}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="num mt-3 text-sm" data-testid="detail-preview">
        {grams === null
          ? 'Enter an amount to see calories.'
          : `${macroLine(nutrientsFor(food, grams))} · ${formatNumber(grams)} g`}
      </p>
      <button type="submit" className={`${primaryButton} mt-4`}>
        Add to list
      </button>
    </form>
  );
}

/** An original star outline; filled when the food is a favourite. */
export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9L12 3.5Z" />
    </svg>
  );
}
