import { deleteJson, getJson, patchJson, postJson } from './client';

export interface LogEntry {
  id: string;
  log_group_id: string;
  food_id: string | null;
  eaten_at: string;
  /** The user's local date, YYYY-MM-DD, fixed when logged. */
  logged_on: string;
  name: string;
  brand: string | null;
  grams: number | null;
  quantity: number | null;
  unit_label: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  source: string;
  /** Set when logged from a saved meal (cleared if the meal is deleted). */
  saved_meal_id: string | null;
  meal_name: string | null;
}

/** Nutrients only, with no food or amount. */
export interface QuickAdd {
  name?: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** A food with grams or a quantity of one of its serving units, or a quick add. */
export type LogItem =
  | ({ food_id: string; source?: 'search' | 'recent' } & (
      { grams: number } | { quantity: number; unit_label: string }
    ))
  | { quick: QuickAdd };

export const LOGS_KEY = ['logs'] as const;
export const LAST_TIME_KEY = ['logs', 'last-time'] as const;

/** One add: every item gets this time and one shared group. Nutrients come from the server. */
export function addLogs(eaten_at: string, items: LogItem[]) {
  return postJson<LogEntry[]>('/logs', { eaten_at, items });
}

export function listLogs(dateFrom: string, dateTo = dateFrom) {
  return getJson<LogEntry[]>(`/logs?date_from=${dateFrom}&date_to=${dateTo}`);
}

export function lastLogTime() {
  return getJson<{ eaten_at: string | null }>('/logs/last-time');
}

/** A new time, new grams, or a new quantity of the entry's own unit. */
export interface LogPatch {
  eaten_at?: string;
  grams?: number;
  quantity?: number;
}

export function editLog(id: string, body: LogPatch) {
  return patchJson<LogEntry>(`/logs/${id}`, body);
}

export function deleteLog(id: string) {
  return deleteJson<null>(`/logs/${id}`);
}

export function restoreLog(id: string) {
  return postJson<LogEntry>(`/logs/${id}/restore`);
}

/** Moves entries (or a whole time block) to a new time or day. */
export function moveLogs(ids: string[], eaten_at: string) {
  return postJson<LogEntry[]>('/logs/move', { ids, eaten_at });
}

/** Copies entries (or a time block) to a time on any day up to today, as one new add. */
export function copyLogs(ids: string[], eaten_at: string) {
  return postJson<LogEntry[]>('/logs/copy', { ids, eaten_at });
}

/** Undo a whole add (such as a meal) in one step, by its log_group_id. */
export function deleteGroup(groupId: string) {
  return deleteJson<null>(`/logs/groups/${groupId}`);
}
