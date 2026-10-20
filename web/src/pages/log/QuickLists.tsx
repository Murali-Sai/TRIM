import { useState, type ReactNode } from 'react';
import type { Meal } from '../../api/meals';
import type { QuickFood, QuickFoods } from '../../api/foods';
import { PlusIcon } from '../../components/icons';
import { amountText, fromLastServing, pickedNutrients, type PickedSource } from '../../lib/picked';
import { formatNumber } from '../../lib/units';
import { StarIcon } from './FoodDetail';

interface Props {
  data: QuickFoods;
  /** Open the amount picker for this food. */
  onOpen: (food: QuickFood, source: PickedSource) => void;
  /** One tap: add at the last serving (or the default serving). */
  onAdd: (food: QuickFood, source: PickedSource) => void;
  /** Recently logged saved meals, shown at the top of Recent. */
  meals?: readonly Meal[];
  renderMeal?: (meal: Meal) => ReactNode;
}

type ListKey = 'recents' | 'frequents';

function Row({
  food,
  source,
  onOpen,
  onAdd,
}: {
  food: QuickFood;
  source: PickedSource;
  onOpen: Props['onOpen'];
  onAdd: Props['onAdd'];
}) {
  const start = fromLastServing(food, source);
  const kcal = Math.round(pickedNutrients(start).kcal);
  const amount = amountText(start);
  return (
    <li className="flex items-center gap-1" data-testid="quick-row">
      <button
        type="button"
        onClick={() => onOpen(food, source)}
        className="tap flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-200 hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="line-clamp-1 font-semibold">{food.name}</span>
            {food.is_favourite ? (
              <span className="shrink-0 text-fat-text" aria-label="Favourite">
                <StarIcon filled />
              </span>
            ) : null}
          </span>
          <span className="num block truncate text-sm text-text-secondary">
            {amount} · {formatNumber(kcal)} kcal
            {food.brand ? ` · ${food.brand}` : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onAdd(food, source)}
        className="tap flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface transition-colors duration-200 hover:bg-surface-2"
        aria-label={`Add ${food.name}, ${amount}`}
      >
        <PlusIcon width={18} height={18} />
      </button>
    </li>
  );
}

/** Before typing: favourites first, then Recent or Frequent (SPEC page 1, UX principle 1). */
export function QuickLists({ data, onOpen, onAdd, meals = [], renderMeal }: Props) {
  const [list, setList] = useState<ListKey>('recents');
  const rows = data[list];
  const recentMeals = list === 'recents' && renderMeal ? meals : [];
  const empty =
    data.favourites.length === 0 &&
    data.recents.length === 0 &&
    data.frequents.length === 0 &&
    meals.length === 0;

  if (empty) {
    return (
      <p className="mt-3 text-sm text-text-secondary" data-testid="quick-empty">
        Foods you log or star show up here, ready to log again in one tap.
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4" data-testid="quick-lists">
      {data.favourites.length > 0 ? (
        <div>
          <h4 className="eyebrow">Favourites</h4>
          <ul className="mt-1 flex flex-col" aria-label="Favourites">
            {data.favourites.map((f) => (
              <Row key={f.id} food={f} source="recent" onOpen={onOpen} onAdd={onAdd} />
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <div role="tablist" aria-label="Your foods" className="flex gap-1">
          {(
            [
              ['recents', 'Recent'],
              ['frequents', 'Frequent'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={list === key}
              onClick={() => setList(key)}
              className={`tap cursor-pointer rounded-full px-3 py-1 text-sm font-semibold transition-colors duration-200 ${
                list === key ? 'bg-text text-surface' : 'text-text-secondary hover:bg-surface-2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {recentMeals.length > 0 && renderMeal ? (
          <ul className="mt-1 flex flex-col" aria-label="Recent meals">
            {recentMeals.map(renderMeal)}
          </ul>
        ) : null}
        {rows.length > 0 ? (
          <ul
            className="mt-1 flex flex-col"
            aria-label={list === 'recents' ? 'Recent' : 'Frequent'}
          >
            {rows.map((f) => (
              <Row key={f.id} food={f} source="recent" onOpen={onOpen} onAdd={onAdd} />
            ))}
          </ul>
        ) : recentMeals.length > 0 ? null : (
          <p className="mt-2 text-sm text-text-secondary">
            {list === 'frequents'
              ? 'Foods you log twice or more in 90 days show up here.'
              : 'Nothing logged yet.'}
          </p>
        )}
      </div>
    </div>
  );
}
