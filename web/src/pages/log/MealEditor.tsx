import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { searchFoods, type Food, type QuickFood } from '../../api/foods';
import type { Meal, MealInput, MealItemInput } from '../../api/meals';
import { Field } from '../../components/Field';
import { MealIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { GRAMS, macroLine, parseAmount } from '../../lib/foodAmount';
import { byUnit } from '../../lib/mealPortion';
import { fromLastServing, type Picked } from '../../lib/picked';
import { formatNumber } from '../../lib/units';
import { useDebounced } from '../../lib/useDebounced';
import { Notice, primaryButton, secondaryButton } from '../account/Section';
import { FoodDetail, StarIcon } from './FoodDetail';

export const MAX_ITEMS = 30;

/** One row while editing: an amount in the item's unit, and its nutrients per gram. */
interface Row {
  key: string;
  food_id: string;
  name: string;
  /** A serving label, or "g". */
  unit: string;
  amount: string;
  gramsPerUnit: number;
  perGram: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
}

function fromMeal(meal: Meal): Row[] {
  return meal.items
    .filter((i) => !i.missing && i.food_id !== null)
    .map((i) => {
      const unit = byUnit(i);
      const g = i.grams || 1;
      return {
        key: i.id,
        food_id: i.food_id ?? '',
        name: i.name ?? '',
        unit: unit ? (i.unit_label ?? 'g') : 'g',
        amount: String(unit ? i.quantity : i.grams),
        gramsPerUnit: unit ? i.grams / (i.quantity ?? 1) : 1,
        perGram: {
          kcal: i.kcal / g,
          protein_g: i.protein_g / g,
          carbs_g: i.carbs_g / g,
          fat_g: i.fat_g / g,
        },
      };
    });
}

function fromPicked(p: Extract<Picked, { kind: 'food' }>, key: string): Row {
  const f = p.food;
  return {
    key,
    food_id: f.id,
    name: f.name,
    unit: p.unit,
    amount: String(p.quantity),
    gramsPerUnit: p.unit === GRAMS.label ? 1 : p.grams / p.quantity,
    perGram: {
      kcal: f.kcal_100 / 100,
      protein_g: f.protein_100 / 100,
      carbs_g: f.carbs_100 / 100,
      fat_g: f.fat_100 / 100,
    },
  };
}

function rowGrams(r: Row): number | null {
  const q = parseAmount(r.amount);
  return q === null ? null : Math.round(q * r.gramsPerUnit * 100) / 100;
}

function totals(rows: readonly Row[]) {
  const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const r of rows) {
    const g = rowGrams(r) ?? 0;
    t.kcal += r.perGram.kcal * g;
    t.protein_g += r.perGram.protein_g * g;
    t.carbs_g += r.perGram.carbs_g * g;
    t.fat_g += r.perGram.fat_g * g;
  }
  return t;
}

function toInput(r: Row): MealItemInput {
  const q = parseAmount(r.amount) ?? 0;
  return r.unit === GRAMS.label
    ? { food_id: r.food_id, grams: q }
    : { food_id: r.food_id, quantity: q, unit_label: r.unit };
}

interface Props {
  /** null for a new meal. */
  meal: Meal | null;
  recents: readonly QuickFood[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (body: MealInput) => void;
  onFavourite: (on: boolean) => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
}

/** New meal, or edit one: name, foods with amounts (add, remove, reorder), live totals. */
export function MealEditor({
  meal,
  recents,
  busy,
  error,
  onClose,
  onSave,
  onFavourite,
  onArchive,
  onDelete,
}: Props) {
  const id = useId();
  const [name, setName] = useState(meal?.name ?? '');
  const [rows, setRows] = useState<Row[]>(() => (meal ? fromMeal(meal) : []));
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState<Extract<Picked, { kind: 'food' }> | null>(null);
  const [errors, setErrors] = useState<{ name?: string; items?: string }>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const q = useDebounced(query.trim(), 300);
  const search = useQuery({
    queryKey: ['foods', 'search', q],
    queryFn: () => searchFoods(q),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
  const full = rows.length >= MAX_ITEMS;
  const t = totals(rows);
  const archived = meal?.archived_at != null;
  const choices: readonly (Food | QuickFood)[] =
    q.length >= 2 ? (search.data?.results ?? []) : recents.slice(0, 5);

  function update(key: string, change: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  function move(i: number, dir: -1 | 1) {
    setRows((rs) => {
      const next = [...rs];
      const [row] = next.splice(i, 1);
      if (row) next.splice(i + dir, 0, row);
      return next;
    });
  }

  function submit() {
    const found: typeof errors = {};
    if (!name.trim()) found.name = 'Enter a name.';
    if (rows.length === 0) found.items = 'Add at least one food.';
    else if (rows.some((r) => rowGrams(r) === null))
      found.items = 'Enter an amount above 0 for every food.';
    setErrors(found);
    if (found.name || found.items) return;
    onSave({ name: name.trim(), items: rows.map(toInput) });
  }

  return (
    <Sheet title={meal ? `Edit ${meal.name}` : 'New meal'} onClose={onClose} testId="meal-editor">
      {/* Not a form: the food picker below is its own form. */}
      <div className="flex flex-col gap-4">
        <Field
          id={`${id}-name`}
          label="Meal name"
          value={name}
          maxLength={80}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          placeholder="Post-workout lunch"
        />

        <div>
          <p className="font-semibold">Foods</p>
          {rows.length === 0 ? (
            <p className="mt-1 text-sm text-text-secondary">Add the foods below.</p>
          ) : (
            <ul className="mt-1 flex flex-col divide-y divide-border" aria-label="Foods in meal">
              {rows.map((r, i) => {
                const g = rowGrams(r);
                return (
                  <li key={r.key} className="py-2" data-testid="editor-row">
                    <p className="line-clamp-2 font-semibold">{r.name}</p>
                    <p className="num text-sm text-text-secondary">
                      {g === null
                        ? 'Enter an amount'
                        : `${macroLine({
                            kcal: r.perGram.kcal * g,
                            protein_g: r.perGram.protein_g * g,
                            carbs_g: r.perGram.carbs_g * g,
                            fat_g: r.perGram.fat_g * g,
                          })} · ${formatNumber(g)} g`}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label htmlFor={`${id}-${r.key}`} className="sr-only">
                        Amount of {r.name}
                      </label>
                      <input
                        id={`${id}-${r.key}`}
                        inputMode="decimal"
                        autoComplete="off"
                        value={r.amount}
                        onChange={(e) => update(r.key, { amount: e.target.value })}
                        className="tap num w-20 rounded-lg border border-border bg-surface px-2 py-2 text-center"
                      />
                      <span className="text-sm text-text-secondary">
                        {r.unit === GRAMS.label ? 'g' : `x ${r.unit}`}
                      </span>
                      <span className="ml-auto flex gap-1">
                        <button
                          type="button"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          className="tap flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border disabled:opacity-40"
                          aria-label={`Move ${r.name} up`}
                        >
                          <span aria-hidden="true">↑</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => move(i, 1)}
                          disabled={i === rows.length - 1}
                          className="tap flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border disabled:opacity-40"
                          aria-label={`Move ${r.name} down`}
                        >
                          <span aria-hidden="true">↓</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                          className="tap cursor-pointer rounded-lg px-2 text-sm font-semibold text-accent underline"
                        >
                          Remove<span className="sr-only"> {r.name}</span>
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="num mt-2 font-semibold" data-testid="editor-total">
            Total {macroLine(t)}
          </p>
          {errors.items ? <Notice kind="error">{errors.items}</Notice> : null}
        </div>

        <div className="rounded-xl border border-border p-3">
          {full ? (
            <p className="text-sm text-text-secondary">A meal holds up to {MAX_ITEMS} foods.</p>
          ) : picking ? (
            <>
              <FoodDetail
                key={picking.food.id}
                food={picking.food}
                start={picking}
                favourite={null}
                addLabel="Add to meal"
                onFavourite={() => undefined}
                onAdd={(p) => {
                  if (p.kind !== 'food') return;
                  setRows((rs) => [...rs, fromPicked(p, `${p.food.id}-${Date.now()}`)]);
                  setPicking(null);
                  setQuery('');
                }}
              />
              <button
                type="button"
                onClick={() => setPicking(null)}
                className="tap mt-2 cursor-pointer text-sm font-semibold text-accent underline"
              >
                Back to search
              </button>
            </>
          ) : (
            <>
              <Field
                id={`${id}-search`}
                label="Add a food"
                type="search"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                hint={q.length >= 2 ? undefined : 'Type at least 2 letters, or pick a recent food.'}
              />
              {q.length >= 2 && search.isSuccess && choices.length === 0 ? (
                <p className="mt-2 text-sm text-text-secondary">
                  No foods match &ldquo;{q}&rdquo;.
                </p>
              ) : null}
              {choices.length > 0 ? (
                <ul className="mt-2 flex flex-col" aria-label="Foods to add">
                  {choices.map((f) => {
                    const start = fromLastServing(f, 'search');
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => start.kind === 'food' && setPicking(start)}
                          className="tap w-full cursor-pointer rounded-lg px-2 py-2 text-left transition-colors duration-200 hover:bg-surface-2"
                        >
                          <span className="line-clamp-1 font-semibold">{f.name}</span>
                          {f.brand ? (
                            <span className="block text-sm text-text-secondary">{f.brand}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </>
          )}
        </div>

        {error ? <Notice kind="error">{error}</Notice> : null}
        {!archived ? (
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className={`${primaryButton} cursor-pointer`}
          >
            {busy ? 'Saving' : meal ? 'Save meal' : 'Create meal'}
          </button>
        ) : null}

        {meal ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {!archived ? (
              <button
                type="button"
                onClick={() => onFavourite(!meal.is_favourite)}
                aria-pressed={meal.is_favourite}
                className={`${secondaryButton} inline-flex cursor-pointer items-center gap-2`}
              >
                <span className={meal.is_favourite ? 'text-fat-text' : 'text-text-secondary'}>
                  <StarIcon filled={meal.is_favourite} />
                </span>
                {meal.is_favourite ? 'Favourite' : 'Add to favourites'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onArchive(!archived)}
              disabled={busy}
              className={`${secondaryButton} cursor-pointer`}
            >
              {archived ? 'Restore meal' : 'Archive'}
            </button>
            {archived ? (
              confirmDelete ? (
                <span className="flex w-full flex-col gap-2">
                  <span className="text-sm">
                    Delete &ldquo;{meal.name}&rdquo; for good? Past logs stay.
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={onDelete}
                      disabled={busy}
                      className={`${primaryButton} cursor-pointer`}
                    >
                      Delete meal
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className={`${secondaryButton} cursor-pointer`}
                    >
                      Keep it
                    </button>
                  </span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className={`${secondaryButton} cursor-pointer`}
                >
                  Delete
                </button>
              )
            ) : null}
          </div>
        ) : null}
        {archived ? (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <MealIcon width={18} height={18} />
            Archived meals are hidden from your lists. Restore it to log or edit it.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
