import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { QUICK_FOODS_KEY, type QuickFood } from '../../api/foods';
import { LOGS_KEY, type LogEntry } from '../../api/logs';
import { STAPLES_KEY } from '../../api/staples';
import {
  createMeal,
  deleteMeal,
  editMeal,
  listMeals,
  logMeal,
  MEALS_KEY,
  type Meal,
  type MealInput,
  type MealItemInput,
  type MealPatch,
} from '../../api/meals';
import { mealLogBody, updatedItems } from '../../lib/mealPortion';
import { zonedWallToIso } from '../../lib/zoned';
import { MealEditor } from './MealEditor';
import { MealLogSheet, UpdateMealSheet, type MealLogChoice } from './MealLogSheet';

function message(e: unknown, fallback: string): string {
  return (e instanceof ApiError && e.userMessage) || fallback;
}

interface Options {
  timeZone: string;
  /** The page's chosen time: one tap logs here. */
  wall: string;
  now: string;
  lastUsed: string | null;
  recents: readonly QuickFood[];
  onLogged: (meal: Meal, entries: LogEntry[], wall: string) => void;
}

/** Saved meals on Log food: the list, one-tap log, the log sheet, the editor and the
 * "Update meal?" prompt after logging changed amounts. */
export function useMealSheets({ timeZone, wall, now, lastUsed, recents, onLogged }: Options) {
  const queryClient = useQueryClient();
  const meals = useQuery({ queryKey: MEALS_KEY, queryFn: () => listMeals() });
  const [open, setOpen] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<{ meal: Meal | null } | null>(null);
  const [prompt, setPrompt] = useState<{ meal: Meal; items: MealItemInput[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A staple shows its meal's name and totals, so it refreshes with the meals.
  const refreshMeals = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: MEALS_KEY }),
      queryClient.invalidateQueries({ queryKey: STAPLES_KEY }),
    ]);

  const log = useMutation({
    mutationFn: ({ meal, choice }: { meal: Meal; choice: MealLogChoice }) =>
      logMeal(
        meal.id,
        mealLogBody(
          meal.items,
          choice.multiplier,
          choice.drafts,
          zonedWallToIso(choice.wall, timeZone),
        ),
      ),
    onSuccess: async (res, { meal, choice }) => {
      setError(null);
      setOpen(null);
      onLogged(meal, res.entries, choice.wall);
      if (choice.changed) {
        setPrompt({ meal, items: updatedItems(meal.items, choice.multiplier, choice.drafts) });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LOGS_KEY }),
        queryClient.invalidateQueries({ queryKey: QUICK_FOODS_KEY }),
        refreshMeals(),
      ]);
    },
    onError: (e) => setError(message(e, 'Could not log. Check your connection and try again.')),
  });

  const save = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: MealInput | MealPatch }) =>
      id ? editMeal(id, body) : createMeal(body as MealInput),
    onSuccess: async (meal, { body }) => {
      setError(null);
      // Favourite and archive keep the editor open on the fresh meal; a save closes it.
      if ('items' in body || body.archived === false) setEditing(null);
      else setEditing((e) => (e ? { meal } : e));
      setPrompt(null);
      await queryClient.invalidateQueries({ queryKey: MEALS_KEY });
    },
    onError: (e) => setError(message(e, 'Could not save. Check your connection and try again.')),
  });

  const remove = useMutation({
    mutationFn: (meal: Meal) => deleteMeal(meal.id),
    onSuccess: async () => {
      setError(null);
      setEditing(null);
      await refreshMeals();
    },
    onError: (e) => setError(message(e, 'Could not delete. Check your connection and try again.')),
  });

  const busy = log.isPending || save.isPending || remove.isPending;

  function quickLog(meal: Meal) {
    log.mutate({ meal, choice: { wall, multiplier: 1, drafts: {}, changed: false } });
  }

  const sheets = (
    <>
      {open ? (
        <MealLogSheet
          meal={open}
          wall={wall}
          now={now}
          lastUsed={lastUsed}
          busy={log.isPending}
          error={error}
          onClose={() => {
            setOpen(null);
            setError(null);
          }}
          onLog={(choice) => log.mutate({ meal: open, choice })}
          onEdit={() => {
            setOpen(null);
            setError(null);
            setEditing({ meal: open });
          }}
        />
      ) : null}
      {editing ? (
        <MealEditor
          key={editing.meal?.id ?? 'new'}
          meal={editing.meal}
          recents={recents}
          busy={busy}
          error={error}
          onClose={() => {
            setEditing(null);
            setError(null);
          }}
          onSave={(body) => save.mutate({ id: editing.meal?.id ?? null, body })}
          onFavourite={(on) =>
            editing.meal && save.mutate({ id: editing.meal.id, body: { is_favourite: on } })
          }
          onArchive={(archived) => {
            if (!editing.meal) return;
            save.mutate({ id: editing.meal.id, body: { archived } });
            if (archived) setEditing(null);
          }}
          onDelete={() => editing.meal && remove.mutate(editing.meal)}
        />
      ) : null}
      {prompt ? (
        <UpdateMealSheet
          name={prompt.meal.name}
          busy={save.isPending}
          onClose={() => setPrompt(null)}
          onUpdate={() => save.mutate({ id: prompt.meal.id, body: { items: prompt.items } })}
        />
      ) : null}
    </>
  );

  return {
    meals,
    busy,
    /** An error from a one-tap log, shown on the page (no sheet is open). */
    pageError: open || editing ? null : error,
    openMeal: (meal: Meal) => {
      setError(null);
      setOpen(meal);
    },
    quickLog,
    startNew: () => {
      setError(null);
      setEditing({ meal: null });
    },
    edit: (meal: Meal) => {
      setError(null);
      setEditing({ meal });
    },
    sheets,
  };
}
