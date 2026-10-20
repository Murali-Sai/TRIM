import { deleteJson, getJson, patchJson, postJson, putJson } from './client';
import type { Serving } from '../lib/foodAmount';

export interface Food {
  id: string;
  name: string;
  brand: string | null;
  source: 'custom' | 'fdc' | 'off';
  tier: 'personal' | 'cache' | 'fdc' | 'off';
  kcal_100: number;
  protein_100: number;
  carbs_100: number;
  fat_100: number;
  fiber_100: number | null;
  sugar_100: number | null;
  sodium_mg_100: number | null;
  density_g_ml: number | null;
  kcal_mismatch: boolean;
  servings: Serving[];
}

export interface FoodSearch {
  results: Food[];
  /** Set when an outside food database did not answer, so results may be incomplete. */
  notice: string | null;
}

export function searchFoods(q: string) {
  return getJson<FoodSearch>(`/foods/search?q=${encodeURIComponent(q)}`);
}

/** Grams, or a quantity of one of the food's units: the latest amount the user logged. */
export interface LastServing {
  grams: number;
  quantity: number | null;
  unit_label: string | null;
}

export interface QuickFood extends Food {
  last: LastServing | null;
  is_favourite: boolean;
  times_logged: number;
}

export interface QuickFoods {
  favourites: QuickFood[];
  recents: QuickFood[];
  frequents: QuickFood[];
}

export const QUICK_FOODS_KEY = ['foods', 'quick'] as const;

/** Favourites, recents and frequents, shown before typing. */
export function getQuickFoods() {
  return getJson<QuickFoods>('/foods/quick');
}

export function setFavourite(foodId: string, on: boolean) {
  return on
    ? putJson<null>(`/foods/${foodId}/favourite`)
    : deleteJson<null>(`/foods/${foodId}/favourite`);
}

/** A label as typed: per 100 g, or per serving with the serving's weight. */
export interface CustomFoodInput {
  name: string;
  brand?: string | null;
  per: '100g' | 'serving';
  serving_label?: string | null;
  serving_grams?: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
}

export function createCustomFood(body: CustomFoodInput) {
  return postJson<Food>('/foods', body);
}

export function editCustomFood(id: string, body: CustomFoodInput) {
  return patchJson<Food>(`/foods/${id}`, body);
}
