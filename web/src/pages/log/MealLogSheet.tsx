import { useId, useState } from 'react';
import type { Meal, MealItem } from '../../api/meals';
import { Sheet } from '../../components/Sheet';
import { macroLine, parseAmount } from '../../lib/foodAmount';
import {
  amountsChanged,
  byUnit,
  itemAmountText,
  itemGrams,
  itemNutrients,
  mealTotals,
  portionLabel,
  PORTIONS,
  scaledAmount,
  type Drafts,
  type ItemDraft,
} from '../../lib/mealPortion';
import { formatNumber } from '../../lib/units';
import { Notice, primaryButton, secondaryButton } from '../account/Section';
import { StapleToggle } from '../staples/StapleToggle';
import { TimeChip } from './TimeChip';

export interface MealLogChoice {
  wall: string;
  multiplier: number;
  drafts: Drafts;
  /** Amounts were changed, so offer to update the meal afterwards. */
  changed: boolean;
}

interface Props {
  meal: Meal;
  /** Starting time, "YYYY-MM-DDTHH:mm" in the user's timezone. */
  wall: string;
  now: string;
  lastUsed: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onLog: (choice: MealLogChoice) => void;
  onEdit: () => void;
}

const chip = 'tap cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold num';

function step(item: MealItem): number {
  return byUnit(item) ? 0.5 : 10;
}

function ItemRow({
  item,
  multiplier,
  draft,
  onChange,
}: {
  item: MealItem;
  multiplier: number;
  draft: ItemDraft | undefined;
  onChange: (d: ItemDraft) => void;
}) {
  const id = useId();
  const name = item.name ?? 'Deleted food';
  if (item.missing) {
    return (
      <li className="flex items-center gap-3 py-2 text-text-secondary" data-testid="meal-item">
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 line-through">{name}</span>
          <span className="block text-sm">This food no longer exists. It is left out.</span>
        </span>
      </li>
    );
  }
  const skipped = draft?.skipped ?? false;
  const shown = draft?.amount ?? String(scaledAmount(item, multiplier));
  const grams = itemGrams(item, multiplier, draft);
  const unit = byUnit(item) ? item.unit_label : 'g';
  const bump = (dir: 1 | -1) => {
    const current = parseAmount(shown) ?? 0;
    const next = Math.max(step(item), Math.round((current + dir * step(item)) * 1000) / 1000);
    onChange({ skipped, amount: String(next) });
  };
  return (
    <li className="py-2" data-testid="meal-item">
      <div className="flex items-start gap-3">
        <input
          id={`${id}-in`}
          type="checkbox"
          checked={!skipped}
          aria-label={`Include ${name}`}
          onChange={() => onChange({ skipped: !skipped, amount: draft?.amount ?? null })}
          className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-accent)]"
        />
        <label htmlFor={`${id}-in`} className="min-w-0 flex-1 cursor-pointer">
          <span className={`line-clamp-2 font-semibold ${skipped ? 'text-text-secondary' : ''}`}>
            {name}
          </span>
          <span className="num block text-sm text-text-secondary">
            {skipped
              ? 'Skipped this time'
              : `${macroLine(itemNutrients(item, grams))} · ${itemAmountText(item, grams)}`}
          </span>
        </label>
      </div>
      {skipped ? null : (
        <div className="mt-2 flex items-center gap-2 pl-8">
          <button
            type="button"
            onClick={() => bump(-1)}
            className="tap flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border text-lg font-semibold transition-colors duration-200 hover:bg-surface-2"
            aria-label={`Less ${name}`}
          >
            <span aria-hidden="true">-</span>
          </button>
          <label htmlFor={`${id}-amt`} className="sr-only">
            Amount of {name} ({byUnit(item) ? `x ${unit}` : 'grams'})
          </label>
          <input
            id={`${id}-amt`}
            inputMode="decimal"
            autoComplete="off"
            value={shown}
            onChange={(e) => onChange({ skipped, amount: e.target.value })}
            className="tap num w-20 rounded-lg border border-border bg-surface px-2 py-2 text-center"
          />
          <button
            type="button"
            onClick={() => bump(1)}
            className="tap flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border text-lg font-semibold transition-colors duration-200 hover:bg-surface-2"
            aria-label={`More ${name}`}
          >
            <span aria-hidden="true">+</span>
          </button>
          <span className="truncate text-sm text-text-secondary">
            {byUnit(item) ? `x ${unit}` : 'g'}
          </span>
        </div>
      )}
    </li>
  );
}

/** Log a saved meal with a time, a portion, skipped items and per-item amounts. */
export function MealLogSheet({
  meal,
  wall,
  now,
  lastUsed,
  busy,
  error,
  onClose,
  onLog,
  onEdit,
}: Props) {
  const [at, setAt] = useState(wall);
  const [multiplier, setMultiplier] = useState(1);
  const [custom, setCustom] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const customId = useId();

  const customValue = custom === null ? null : parseAmount(custom);
  const customBad =
    custom !== null && (customValue === null || customValue < 0.1 || customValue > 10);
  const portion = custom !== null && !customBad && customValue !== null ? customValue : multiplier;
  const totals = mealTotals(meal.items, portion, drafts);
  const included = meal.items.filter((i) => !i.missing && !drafts[i.id]?.skipped).length;
  const badAmount = meal.items.some((i) => {
    const d = drafts[i.id];
    return !i.missing && !d?.skipped && d?.amount != null && parseAmount(d.amount) === null;
  });

  function pick(m: number) {
    setCustom(null);
    setMultiplier(m);
    // A new portion rescales every item, including any typed amounts.
    setDrafts((ds) =>
      Object.fromEntries(Object.entries(ds).map(([k, d]) => [k, { ...d, amount: null }])),
    );
  }

  return (
    <Sheet title={meal.name} onClose={onClose} testId="meal-log-sheet">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (customBad || badAmount || included === 0) return;
          onLog({
            wall: at,
            multiplier: portion,
            drafts,
            changed: amountsChanged(meal.items, portion, drafts),
          });
        }}
        className="flex flex-col gap-4"
      >
        <TimeChip wall={at} now={now} lastUsed={lastUsed} onChange={setAt} />
        {meal.missing > 0 ? (
          <Notice kind="error">
            {meal.missing === 1
              ? '1 food no longer exists. The rest will be logged.'
              : `${meal.missing} foods no longer exist. The rest will be logged.`}
          </Notice>
        ) : null}
        <div>
          <p className="font-semibold" id={`${customId}-portion`}>
            Portion
          </p>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-labelledby={`${customId}-portion`}
          >
            {PORTIONS.map((m) => {
              const on = custom === null && multiplier === m;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(m)}
                  className={`${chip} ${on ? 'border-accent bg-surface-2' : 'border-border'}`}
                >
                  {portionLabel(m)}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={custom !== null}
              onClick={() => setCustom(custom ?? String(multiplier))}
              className={`${chip} ${custom !== null ? 'border-accent bg-surface-2' : 'border-border'}`}
            >
              Custom
            </button>
          </div>
          {custom !== null ? (
            <div className="mt-3">
              <label htmlFor={customId} className="block text-sm font-semibold">
                Custom portion (0.1 to 10)
              </label>
              <input
                id={customId}
                inputMode="decimal"
                autoComplete="off"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                aria-invalid={customBad}
                aria-describedby={customBad ? `${customId}-err` : undefined}
                className="tap num mt-1 w-28 rounded-lg border border-border bg-surface px-3 py-2"
              />
              {customBad ? (
                <p id={`${customId}-err`} className="mt-1 text-sm font-medium text-text">
                  Enter a number from 0.1 to 10.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <ul className="flex flex-col divide-y divide-border" aria-label="Items in this meal">
          {meal.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              multiplier={portion}
              draft={drafts[item.id]}
              onChange={(d) => setDrafts((ds) => ({ ...ds, [item.id]: d }))}
            />
          ))}
        </ul>
        <p className="num font-semibold" data-testid="meal-log-total">
          Total {macroLine(totals)}
        </p>
        {badAmount ? <Notice kind="error">Enter an amount above 0 for every item.</Notice> : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
        <button
          type="submit"
          disabled={busy || included === 0}
          className={`${primaryButton} cursor-pointer`}
        >
          {busy
            ? 'Logging'
            : included === 0
              ? 'Pick at least one item'
              : `Add meal · ${formatNumber(Math.round(totals.kcal))} kcal`}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="tap w-fit cursor-pointer text-sm font-semibold text-accent underline"
        >
          Edit meal
        </button>
        <StapleToggle mealId={meal.id} name={meal.name} />
      </form>
    </Sheet>
  );
}

/** After logging with changed amounts: keep them in the meal, or only for this time. */
export function UpdateMealSheet({
  name,
  busy,
  onUpdate,
  onClose,
}: {
  name: string;
  busy: boolean;
  onUpdate: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Update meal?" onClose={onClose} testId="update-meal-sheet">
      <p>Update &ldquo;{name}&rdquo; with these changes?</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onUpdate}
          disabled={busy}
          className={`${primaryButton} cursor-pointer`}
        >
          Update meal
        </button>
        <button type="button" onClick={onClose} className={`${secondaryButton} cursor-pointer`}>
          Just this time
        </button>
      </div>
    </Sheet>
  );
}
