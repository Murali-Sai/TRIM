/**
 * Goal-date projection, exactly as in SPEC page 3. Display only.
 * Mirrors project_goal in api/app/trend.py; both pass shared/trend_vectors.json.
 */
import { dayNumber } from './trend';

export const MIN_RATE_KG_PER_WEEK = 0.1;
export const MAX_WEEKS = 104;
// So exactly 0.1 kg a week and exactly 104 weeks are shown despite floating point.
const EPSILON = 1e-9;

export interface ProjectionInput {
  trend_kg: number;
  goal_kg: number | null;
  weekly_rate_kg: number | null;
  trend_visible: boolean;
  /** The user's local date, YYYY-MM-DD. */
  today: string;
}

export type Projection =
  /** Nothing to say: no goal, or the trend is not visible yet. */
  | { kind: 'none' }
  /** "No projection: your trend is flat or moving away from your goal." */
  | { kind: 'no_projection' }
  | { kind: 'projection'; weeks: number; date: string };

export function projectGoal(input: ProjectionInput): Projection {
  const { trend_kg: trend, goal_kg: goal, weekly_rate_kg: rate } = input;
  if (goal === null || !input.trend_visible) return { kind: 'none' };
  if (rate === null || Math.abs(rate) < MIN_RATE_KG_PER_WEEK - EPSILON) {
    return { kind: 'no_projection' };
  }
  const weeks = (goal - trend) / rate;
  if (!(weeks > 0) || weeks > MAX_WEEKS + EPSILON) return { kind: 'no_projection' };
  const days = dayNumber(input.today) + Math.round(weeks * 7);
  return {
    kind: 'projection',
    weeks,
    date: new Date(days * 86_400_000).toISOString().slice(0, 10),
  };
}
