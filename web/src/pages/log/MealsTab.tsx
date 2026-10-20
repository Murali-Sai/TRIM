import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { itemCount, listMeals, MEALS_KEY, type Meal } from '../../api/meals';
import { MealIcon, PlusIcon } from '../../components/icons';
import { formatNumber } from '../../lib/units';
import { Notice, secondaryButton } from '../account/Section';
import { StarIcon } from './FoodDetail';

function macroGrams(t: Meal['totals']): string {
  const g = (x: number) => formatNumber(Math.round(x));
  return `${g(t.protein_g)}P ${g(t.fat_g)}F ${g(t.carbs_g)}C`;
}

export function MealRow({
  meal,
  onOpen,
  onLog,
  busy = false,
}: {
  meal: Meal;
  onOpen: (meal: Meal) => void;
  /** One tap: the whole meal at the chosen time with saved amounts. Absent for archived. */
  onLog?: ((meal: Meal) => void) | undefined;
  busy?: boolean;
}) {
  return (
    <li className="flex items-center gap-1" data-testid="meal-row">
      <button
        type="button"
        onClick={() => onOpen(meal)}
        className="tap flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-200 hover:bg-surface-2"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-secondary">
          <MealIcon width={20} height={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="line-clamp-1 font-semibold">{meal.name}</span>
            {meal.is_favourite ? (
              <span className="shrink-0 text-fat-text" aria-label="Favourite">
                <StarIcon filled />
              </span>
            ) : null}
          </span>
          <span className="num block text-[13px] text-text-secondary sm:text-sm">
            {itemCount(meal)} · {formatNumber(Math.round(meal.totals.kcal))} kcal
            {/* Phone: the macros get their own line so a group never breaks. */}
            <span className="block sm:inline">
              <span className="hidden sm:inline"> · </span>
              {macroGrams(meal.totals)}
            </span>
          </span>
        </span>
      </button>
      {onLog ? (
        <button
          type="button"
          onClick={() => onLog(meal)}
          disabled={busy}
          className="tap flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface transition-colors duration-200 hover:bg-surface-2 disabled:opacity-60"
          aria-label={`Log ${meal.name} now`}
        >
          <PlusIcon width={18} height={18} />
        </button>
      ) : null}
    </li>
  );
}

interface Props {
  meals: Meal[] | undefined;
  failed: boolean;
  busy: boolean;
  onNew: () => void;
  onOpen: (meal: Meal) => void;
  onLog: (meal: Meal) => void;
  onEdit: (meal: Meal) => void;
}

/** Saved meals: favourites first, then most recently used. Archived ones fold away below. */
export function MealsTab({ meals, failed, busy, onNew, onOpen, onLog, onEdit }: Props) {
  const [showArchived, setShowArchived] = useState(false);
  const archived = useQuery({
    queryKey: [...MEALS_KEY, 'archived'],
    queryFn: () => listMeals(true),
    enabled: showArchived,
  });

  return (
    <div data-testid="meals-tab">
      <button type="button" onClick={onNew} className={`${secondaryButton} w-full cursor-pointer`}>
        New meal
      </button>
      {failed ? (
        <Notice kind="error">Could not load your meals. Try again in a moment.</Notice>
      ) : null}
      {meals && meals.length === 0 ? (
        <p className="mt-3 text-sm text-text-secondary" data-testid="meals-empty">
          Save foods you often eat together as a meal, then log them all in one tap. You can also
          save a time block from Today.
        </p>
      ) : null}
      {meals && meals.length > 0 ? (
        <ul className="mt-3 flex flex-col" aria-label="Saved meals">
          {meals.map((m) => (
            <MealRow key={m.id} meal={m} onOpen={onOpen} onLog={onLog} busy={busy} />
          ))}
        </ul>
      ) : null}
      <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          aria-expanded={showArchived}
          onClick={() => setShowArchived((s) => !s)}
          className="tap cursor-pointer text-sm font-semibold text-accent underline"
        >
          {showArchived ? 'Hide archived meals' : 'Show archived meals'}
        </button>
        {showArchived && archived.data ? (
          archived.data.length === 0 ? (
            <p className="mt-2 text-sm text-text-secondary">No archived meals.</p>
          ) : (
            <ul className="mt-2 flex flex-col" aria-label="Archived meals">
              {archived.data.map((m) => (
                <MealRow key={m.id} meal={m} onOpen={onEdit} />
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
