import { getJson } from './client';

export interface Goal {
  kind: 'log_food' | 'protein' | 'calories' | 'weigh_in' | 'water' | 'measurement';
  text: string;
  done: number;
  needed: number;
  complete: boolean;
}

export interface WeekGoals {
  week_start: string;
  goals: Goal[];
  /** All three complete. */
  perfect: boolean;
  perfect_weeks: number;
}

export interface Badge {
  key: string;
  name: string;
  how: string;
  earned_at: string | null;
}

export interface Streaks {
  today: string;
  current_days: number;
  longest_days: number;
  freezes_held: number;
  today_logged: boolean;
  message: string | null;
  weigh_in: { current_weeks: number; longest_weeks: number; this_week: number };
  month: string;
  calendar: { date: string; state: 'logged' | 'freeze' | 'none' | 'future' }[];
}

// Under ['logs'], so every add, edit or delete refreshes them.
export const GOALS_KEY = ['logs', 'goals'] as const;
export const BADGES_KEY = ['logs', 'badges'] as const;
export const STREAKS_KEY = ['logs', 'streaks'] as const;

export function getGoals() {
  return getJson<WeekGoals>('/goals');
}

export function getBadges() {
  return getJson<Badge[]>('/badges');
}

export function getStreaks(month?: string) {
  return getJson<Streaks>(month ? `/streaks?month=${month}` : '/streaks');
}
