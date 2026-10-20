import { getJson } from './client';
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
