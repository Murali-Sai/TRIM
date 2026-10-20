import { getJson, patchJson, postJson, putJson } from './client';
import type { UnitSystem } from './auth';
import type { ActivityLevel, CalcInput, Sex } from '../lib/tdee';

export interface BodyStats {
  sex: Sex | null;
  age: number | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  unit_system: UnitSystem;
  latest_weight_kg: number | null;
  goal_weight_kg: number | null;
}

export interface BodyStatsUpdate {
  sex: Sex;
  age: number;
  height_cm: number;
  activity_level: ActivityLevel;
  unit_system: UnitSystem;
  weight_kg?: number;
}

export const BODY_STATS_KEY = ['me', 'body-stats'] as const;

export function getBodyStats() {
  return getJson<BodyStats>('/me/body-stats');
}

/** Display only: the goal line and the goal-date projection. Null clears it. */
export function setGoalWeight(goal_weight_kg: number | null) {
  return putJson<{ goal_weight_kg: number | null }>('/me/goal-weight', { goal_weight_kg });
}

export function saveBodyStats(body: BodyStatsUpdate) {
  return patchJson<BodyStats>('/me/body-stats', body);
}

export interface TargetRow {
  effective_from: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  source: 'calculator' | 'custom';
}

/** The server recalculates from these inputs; it never stores numbers sent by the browser. */
export function applyCalculation(input: CalcInput) {
  return postJson<TargetRow>('/targets/apply-calculation', input);
}
