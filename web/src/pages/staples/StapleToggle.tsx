import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { addStaple, getStaples, removeStaple, STAPLES_KEY } from '../../api/staples';

type Source = { foodId: string; mealId?: undefined } | { mealId: string; foodId?: undefined };

/** "Add as staple" on a food or a saved meal; "Remove from staples" once it is one. */
export function StapleToggle({ name, ...source }: Source & { name: string }) {
  const queryClient = useQueryClient();
  const staples = useQuery({ queryKey: STAPLES_KEY, queryFn: getStaples });
  const mine = staples.data?.staples.find((s) =>
    source.foodId ? s.food_id === source.foodId : s.saved_meal_id === source.mealId,
  );
  const full = staples.data ? staples.data.count >= staples.data.limit : false;
  const change = useMutation({
    mutationFn: async () => {
      if (mine) return removeStaple(mine.id);
      return addStaple(
        source.mealId !== undefined ? { saved_meal_id: source.mealId } : { food_id: source.foodId },
      );
    },
    onSuccess: async (data) => {
      if (data) queryClient.setQueryData(STAPLES_KEY, data);
      await queryClient.invalidateQueries({ queryKey: STAPLES_KEY });
    },
  });
  if (!staples.data) return null;
  const error =
    change.error instanceof ApiError && change.error.userMessage
      ? change.error.userMessage
      : change.error
        ? 'Could not save. Try again.'
        : null;
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => change.mutate()}
        disabled={change.isPending || (!mine && full)}
        aria-label={
          mine ? `Remove ${name} from staples` : full ? undefined : `Add ${name} as a staple`
        }
        className="tap w-fit cursor-pointer text-sm font-semibold text-accent underline disabled:cursor-default disabled:text-text-secondary disabled:no-underline"
      >
        {mine
          ? 'Remove from staples'
          : full
            ? `Staples full (${staples.data.limit} of ${staples.data.limit})`
            : 'Add as staple'}
      </button>
      {error ? (
        <p className="mt-1 text-sm font-medium text-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
