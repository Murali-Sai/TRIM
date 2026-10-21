import { deleteJson, getJson, patchJson, postJson, putJson } from './client';

export interface StapleUnit {
  label: string;
  grams: number;
}

export interface Staple {
  id: string;
  food_id: string | null;
  saved_meal_id: string | null;
  /** null when the food or meal was deleted. */
  name: string | null;
  brand: string | null;
  food_group: string | null;
  /** "100 g", "1 egg", or "1 meal" for a saved meal. */
  unit_label: string;
  unit_grams: number | null;
  step_units: number;
  min_units: number;
  max_units: number;
  /** Every amount a suggestion may use, smallest first. */
  amounts: number[];
  is_available: boolean;
  sort_order: number;
  per_unit: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  /** Units the staple can switch to; empty for a meal. */
  units: StapleUnit[];
  missing: boolean;
}

export interface Staples {
  staples: Staple[];
  count: number;
  limit: number;
}

export interface StaplePatch {
  unit_label?: string;
  step_units?: number;
  min_units?: number;
  max_units?: number;
  is_available?: boolean;
}

export interface StaplePrompt {
  offer: boolean;
  foods: { food_id: string; name: string; brand: string | null; times_logged: number }[];
}

export const STAPLES_KEY = ['staples'] as const;
export const STAPLES_PROMPT_KEY = ['staples', 'prompt'] as const;

export function getStaples() {
  return getJson<Staples>('/staples');
}

export function addStaple(body: { food_id: string } | { saved_meal_id: string }) {
  return postJson<Staples>('/staples', body);
}

export function editStaple(id: string, body: StaplePatch) {
  return patchJson<Staples>(`/staples/${id}`, body);
}

export function removeStaple(id: string) {
  return deleteJson<null>(`/staples/${id}`);
}

/** Every staple's id, in the new order. */
export function reorderStaples(ids: string[]) {
  return putJson<Staples>('/staples/order', { ids });
}

export function getStaplePrompt() {
  return getJson<StaplePrompt>('/staples/prompt');
}

/** Yes adds the most-logged foods while there is room; either answer ends the offer. */
export function answerStaplePrompt(accept: boolean) {
  return postJson<Staples>('/staples/prompt', { accept });
}
