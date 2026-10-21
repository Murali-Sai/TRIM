import type { LogEntry } from './logs';
import type { Meal } from './meals';
import { deleteJson, postJson } from './client';

export interface Macros {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export type BudgetChoice =
  { mode: 'rest_of_day' } | { mode: 'fraction'; fraction: number } | { mode: 'kcal'; kcal: number };

export interface Lock {
  staple_id: string;
  /** Keep this amount too. */
  units?: number;
}

export type Context = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface SuggestRequest {
  date: string;
  context: Context;
  budget: BudgetChoice;
  max_items: number;
  excluded_staple_ids: string[];
  locked: Lock[];
  /** Sets already shown in this sheet, never suggested again (Shuffle). */
  exclude_sets: string[][];
}

export interface SuggestedItem {
  staple_id: string;
  food_id: string | null;
  saved_meal_id: string | null;
  name: string;
  unit_label: string;
  units: number;
  grams: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Suggestion {
  items: SuggestedItem[];
  totals: Macros;
  /** Budget minus totals; negative when a suggestion goes over. */
  leaves: Macros;
  match_pct: number;
  /** "Often eaten together at dinner" when every pair on the card scores well. */
  label: string | null;
}

export type SuggestState =
  'ok' | 'no_target' | 'target_reached' | 'within_100' | 'need_staples' | 'no_fit' | 'no_more';

export interface Suggestions {
  date: string;
  context: Context;
  state: SuggestState;
  message: string | null;
  budget: Macros | null;
  left_today: Macros | null;
  suggestions: Suggestion[];
}

export type PlateItem = { staple_id: string; units: number };

export function getSuggestions(body: SuggestRequest) {
  return postJson<Suggestions>('/suggestions', body);
}

/** One time block, source `suggestion`. */
export function logSuggestion(eatenAt: string, items: PlateItem[]) {
  return postJson<LogEntry[]>('/suggestions/log', { eaten_at: eatenAt, items });
}

export function saveSuggestion(name: string, items: PlateItem[]) {
  return postJson<Meal>('/suggestions/save-meal', { name, items });
}

export const plateOf = (s: Suggestion): PlateItem[] =>
  s.items.map((i) => ({ staple_id: i.staple_id, units: i.units }));

export interface PairPreference {
  id: string;
  staple_ids: [string, string];
  names: [string, string];
  created_at: string;
}

/** "Don't suggest these together": the two staples are never on one suggestion again. */
export function neverTogether(stapleIds: [string, string]) {
  return postJson<PairPreference>('/pair-preferences', { staple_ids: stapleIds });
}

export function allowTogether(id: string) {
  return deleteJson<null>(`/pair-preferences/${id}`);
}
