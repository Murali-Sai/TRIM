import type { WaterUnit } from '../lib/water';
import { deleteJson, getJson, patchJson, postJson } from './client';

export interface TrackingSettings {
  track_water: boolean;
  track_fiber: boolean;
  water_unit: WaterUnit;
  /** Streaks, goals and badges shown. */
  gamification: boolean;
  /** Local "HH:MM" for the streak reminder, or null when off. */
  streak_reminder: string | null;
}

export const SETTINGS_KEY = ['settings'] as const;
export const WATER_KEY = ['water'] as const;

export function getSettings() {
  return getJson<TrackingSettings>('/me/settings');
}

export function saveSettings(body: Partial<TrackingSettings>) {
  return patchJson<TrackingSettings>('/me/settings', body);
}

export interface WaterAdd {
  id: string;
  logged_at: string;
  logged_on: string;
  ml: number;
}

export function listWater(day: string) {
  return getJson<WaterAdd[]>(`/water?date_from=${day}`);
}

export function waterDays(dateFrom: string, dateTo: string) {
  return getJson<{ date: string; ml: number }[]>(
    `/water/days?date_from=${dateFrom}&date_to=${dateTo}`,
  );
}

/** Logged now unless `logged_at` is given (a past day). */
export function addWater(ml: number, logged_at?: string) {
  return postJson<WaterAdd>('/water', logged_at ? { ml, logged_at } : { ml });
}

export function deleteWater(id: string) {
  return deleteJson<null>(`/water/${id}`);
}
