import type { FitMacro, FitRow, Fits, QuickFood } from '../../api/foods';
import type { Meal } from '../../api/meals';
import { MealIcon, PlusIcon } from '../../components/icons';
import { formatNumber } from '../../lib/units';

const BARS: readonly { key: FitMacro; label: string; color: string; text: string }[] = [
  { key: 'kcal', label: 'calories', color: 'kcal', text: 'text-kcal-text' },
  { key: 'protein_g', label: 'protein', color: 'protein', text: 'text-protein-text' },
  { key: 'fat_g', label: 'fat', color: 'fat', text: 'text-fat-text' },
  { key: 'carbs_g', label: 'carbs', color: 'carbs', text: 'text-carbs-text' },
];

const whole = (x: number) => formatNumber(Math.round(x));

function amount(r: FitRow): string {
  if (r.kind === 'meal') return `${r.meal_items ?? 0} ${r.meal_items === 1 ? 'item' : 'items'}`;
  const s = r.serving;
  if (!s) return '';
  return s.unit_label
    ? `${formatNumber(s.quantity ?? 1)} x ${s.unit_label}`
    : `${whole(s.grams)} g`;
}

/** What each candidate fills of what is left, in words for screen readers. */
function fillWords(r: FitRow): string {
  const parts = BARS.map((b) => `${Math.round(r.fills[b.key] * 100)}% of ${b.label} left`);
  const over = r.overflows.map((m) => BARS.find((b) => b.key === m)?.label).filter(Boolean);
  return `Fills ${parts.join(', ')}${over.length ? `; goes over on ${over.join(' and ')}` : ''}.`;
}

interface Props {
  fits: Fits;
  meals: readonly Meal[];
  onOpenFood: (food: QuickFood, row: FitRow) => void;
  onAddFood: (food: QuickFood, row: FitRow) => void;
  onOpenMeal: (meal: Meal) => void;
  onLogMeal: (meal: Meal) => void;
}

/** The "Fits my macros" sort: Great and Partial fits for what is left today. */
export function FitsList({ fits, meals, onOpenFood, onAddFood, onOpenMeal, onLogMeal }: Props) {
  const left = fits.remaining;
  if (fits.results.length === 0) {
    return (
      <p className="mt-2 text-sm text-text-secondary" data-testid="fits-empty">
        Nothing you usually eat fits what is left. Your favourites, custom foods, saved meals and
        foods from the last 60 days are checked.
      </p>
    );
  }
  return (
    <div className="mt-1">
      {left ? (
        <p className="num mt-1 text-sm text-text-secondary" data-testid="fits-left">
          Left today: {whole(Math.max(0, left.kcal))} kcal · {whole(Math.max(0, left.protein_g))}P{' '}
          {whole(Math.max(0, left.fat_g))}F {whole(Math.max(0, left.carbs_g))}C
        </p>
      ) : null}
      <ul className="mt-1 flex flex-col" aria-label="Fits my macros">
        {fits.results.map((r) => {
          const meal = r.kind === 'meal' ? meals.find((m) => m.id === r.meal_id) : undefined;
          const name = r.kind === 'meal' ? (r.meal_name ?? '') : (r.food?.name ?? '');
          const open = () => (meal ? onOpenMeal(meal) : r.food ? onOpenFood(r.food, r) : undefined);
          return (
            <li
              key={`${r.kind}-${r.food?.id ?? r.meal_id}`}
              className="flex items-center gap-1"
              data-testid="fit-row"
            >
              <button
                type="button"
                onClick={open}
                className="tap flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-200 hover:bg-surface-2"
              >
                {r.kind === 'meal' ? (
                  <span className="mt-0.5 shrink-0 text-text-secondary">
                    <MealIcon width={18} height={18} />
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="line-clamp-1 font-semibold">{name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        r.label === 'Great fit' ? 'bg-accent text-accent-contrast' : 'bg-surface-2'
                      }`}
                      data-testid="fit-label"
                    >
                      {r.label}
                    </span>
                  </span>
                  <span className="num block text-sm text-text-secondary">
                    {amount(r)} · {whole(r.nutrients.kcal)} kcal
                    {r.fits_up_to_g ? ` · fits up to ${formatNumber(r.fits_up_to_g)} g` : ''}
                  </span>
                  <span className="mt-1 grid grid-cols-4 gap-1" aria-hidden="true">
                    {BARS.map((b) => (
                      <span key={b.key} className="h-1 rounded-full bg-surface-2">
                        <span
                          className="block h-1 rounded-full"
                          style={{
                            width: `${Math.round(r.fills[b.key] * 100)}%`,
                            background: `var(--color-${b.color})`,
                          }}
                        />
                      </span>
                    ))}
                  </span>
                  {r.overflows.length ? (
                    <span className="mt-0.5 block text-xs" aria-hidden="true">
                      {r.overflows.map((m) => {
                        const b = BARS.find((x) => x.key === m);
                        return b ? (
                          <span key={m} className={`mr-2 font-semibold ${b.text}`}>
                            {b.label} over
                          </span>
                        ) : null;
                      })}
                    </span>
                  ) : null}
                  <span className="sr-only">{fillWords(r)}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => (meal ? onLogMeal(meal) : r.food ? onAddFood(r.food, r) : undefined)}
                className="tap flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface transition-colors duration-200 hover:bg-surface-2"
                aria-label={meal ? `Log ${name} now` : `Add ${name}, ${amount(r)}`}
              >
                <PlusIcon width={18} height={18} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
