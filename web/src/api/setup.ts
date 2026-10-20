import { getJson, patchJson, postJson, putJson } from './client';
import type { UnitSystem } from './auth';
import type { ActivityLevel, CalcInput, Deficit, Plan, Sex } from '../lib/tdee';

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

/** The calculator inputs a target row came from; "Reset to formula" recomputes from these. */
export interface Formula {
  sex: Sex;
  age: number;
  weight_kg: number;
  height_cm: number;
  activity: ActivityLevel;
  plan: Plan;
  deficit_kcal: Deficit;
}

export interface TargetRow {
  effective_from: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Null until fiber tracking (task 3.13). */
  fiber_g: number | null;
  /** Null means water is not tracked. */
  water_ml: number | null;
  source: 'calculator' | 'custom';
  bmr: number | null;
  tdee: number | null;
  formula: Formula | null;
}

export const TARGETS_KEY = ['targets'] as const;

/** Newest first: the first row is the one in effect now. */
export function listTargets() {
  return getJson<TargetRow[]>('/targets');
}

export interface CustomTargets {
  kcal: number;
  protein_g: number;
  fat_g: number;
  /** Null: carbs are the rest, recalculated by the server under the same rule. */
  carbs_g: number | null;
  /** The calculator result being adjusted, when no targets are saved yet (sign-up). */
  basis?: CalcInput;
}

export function saveCustomTargets(body: CustomTargets) {
  return postJson<TargetRow>('/targets', body);
}

/** The server recalculates from these inputs; it never stores numbers sent by the browser. */
export function applyCalculation(input: CalcInput) {
  return postJson<TargetRow>('/targets/apply-calculation', input);
}
