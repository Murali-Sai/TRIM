import { deleteJson, getJson, patchJson, postJson } from './client';
import type { LogEntry } from './logs';

export interface MealItem {
  id: string;
  food_id: string | null;
  name: string | null;
  brand: string | null;
  grams: number;
  /** Set when saved as a quantity of one of the food's units. */
  quantity: number | null;
  unit_label: string | null;
  sort_order: number;
  /** The food was deleted, so this item is skipped when the meal is logged. */
  missing: boolean;
  /** At the saved amount, from the food's current values. */
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Meal {
  id: string;
  name: string;
  note: string | null;
  is_favourite: boolean;
  use_count: number;
  last_used_at: string | null;
  archived_at: string | null;
  items: MealItem[];
  totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  /** How many items point at a deleted food. */
  missing: number;
}

export type MealItemInput = { food_id: string } & (
  { grams: number } | { quantity: number; unit_label: string }
);

export interface MealInput {
  name: string;
  note?: string | null;
  items: MealItemInput[];
}

export interface MealPatch {
  name?: string;
  note?: string | null;
  is_favourite?: boolean;
  archived?: boolean;
  items?: MealItemInput[];
}

/** The final amount for one item this time; the multiplier scales the others. */
export type ItemOverride = { item_id: string } & ({ grams: number } | { quantity: number });

export interface MealLog {
  eaten_at: string;
  multiplier?: number;
  skipped_item_ids?: string[];
  item_overrides?: ItemOverride[];
}

export const MEALS_KEY = ['meals'] as const;

/** Favourites first, then most recently used, then by name. */
export function listMeals(archived = false) {
  return getJson<Meal[]>(`/meals?archived=${archived}`);
}

export function createMeal(body: MealInput) {
  return postJson<Meal>('/meals', body);
}

/** Save a time block or a selection as a meal; quick adds are left out. */
export function mealFromLogs(name: string, logIds: string[]) {
  return postJson<Meal>('/meals/from-logs', { name, log_ids: logIds });
}

export function editMeal(id: string, body: MealPatch) {
  return patchJson<Meal>(`/meals/${id}`, body);
}

/** Only archived meals can be deleted; past logs stay. */
export function deleteMeal(id: string) {
  return deleteJson<null>(`/meals/${id}`);
}

export function logMeal(id: string, body: MealLog) {
  return postJson<{ entries: LogEntry[]; missing: number }>(`/meals/${id}/log`, body);
}

/** "3 items" */
export function itemCount(meal: Meal): string {
  const n = meal.items.length;
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}
