import { useState, type FormEvent } from 'react';
import type { Food } from '../../api/foods';
import { Field } from '../../components/Field';
import {
  amountOptions,
  gramsFor,
  macroLine,
  nutrientsFor,
  parseAmount,
} from '../../lib/foodAmount';
import { formatNumber } from '../../lib/units';
import { primaryButton } from '../account/Section';

export interface Picked {
  food: Food;
  quantity: number;
  /** A serving label, or "g" for grams. */
  unit: string;
  grams: number;
}

interface Props {
  food: Food;
  onAdd: (picked: Picked) => void;
}

/** The amount picker for one food, with a live preview of what it adds. */
export function FoodDetail({ food, onAdd }: Props) {
  const options = amountOptions(food);
  const first = options[0] ?? { label: 'g', grams: 1, is_default: false };
  const [unit, setUnit] = useState(first.label);
  const [amount, setAmount] = useState(first.label === 'g' ? '100' : '1');
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
    onAdd({ food, quantity, unit: chosen.label, grams });
  }

  return (
    <form onSubmit={onSubmit} noValidate data-testid="food-detail">
      <h3 className="text-lg font-semibold">{food.name}</h3>
      {food.brand ? <p className="text-sm text-text-secondary">{food.brand}</p> : null}
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
