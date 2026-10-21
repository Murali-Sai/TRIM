import { useQuery } from '@tanstack/react-query';
import { getGoals, getStreaks, GOALS_KEY, STREAKS_KEY } from '../../api/goals';
import { getSettings, SETTINGS_KEY } from '../../api/tracking';

/** Streaks and this week's goals, or `on: false` when the user turned them off. */
export function useStreaks() {
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: getSettings });
  const on = settings.data?.gamification ?? false;
  const streaks = useQuery({ queryKey: STREAKS_KEY, queryFn: () => getStreaks(), enabled: on });
  const goals = useQuery({ queryKey: GOALS_KEY, queryFn: getGoals, enabled: on });
  return { on, streaks: streaks.data, goals: goals.data };
}

export const MILESTONES = [7, 30, 100, 365] as const;

/** The next streak badge and how far off it is: "7 days to the 30-day badge". */
export function nextBadge(longest: number, current: number): string | null {
  const next = MILESTONES.find((m) => m > Math.max(longest, current));
  if (next === undefined) return null;
  const left = next - current;
  return `${left} ${left === 1 ? 'day' : 'days'} to the ${next}-day badge`;
}
