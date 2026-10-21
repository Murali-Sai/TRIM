import { GoalRing } from '../../components/GoalRing';
import { FlameIcon, SnowflakeIcon } from '../../components/icons';
import { StreakCalendar } from '../../components/streak/StreakCalendar';
import { useStreaks } from '../../components/streak/useStreaks';
import { streakHeadline } from '../../lib/chart/headlines';
import { DashCard } from './DashCard';

/** "23-day streak · 2 of 3 goals done", the flame, freezes, goal rings and the month. Gone
 * entirely when streaks are off, so the grid closes up. */
export function StreakCard() {
  const { on, streaks, goals } = useStreaks();
  if (!on) return null;
  if (!streaks) return <DashCard title="Streak and goals" headline=" " testId="card-streak" />;
  const list = goals?.goals ?? [];
  const headline = streakHeadline({
    days: streaks.current_days,
    goalsDone: list.filter((g) => g.complete).length,
    goals: list.length,
  });
  return (
    <DashCard title="Streak and goals" headline={headline} testId="card-streak">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span
            className={streaks.today_logged ? 'text-streak' : 'text-text-secondary'}
            aria-hidden="true"
          >
            <FlameIcon width={32} height={32} />
          </span>
          <span className="num text-3xl font-semibold" aria-hidden="true">
            {streaks.current_days}
          </span>
          <span
            className="ml-auto flex gap-1"
            aria-label={`${streaks.freezes_held} of 2 freezes held`}
            role="img"
          >
            {[0, 1].map((i) => (
              <span key={i} className={i < streaks.freezes_held ? 'text-accent' : 'text-border'}>
                <SnowflakeIcon width={20} height={20} />
              </span>
            ))}
          </span>
        </div>
        {list.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {list.map((g) => (
              <GoalRing key={g.kind} goal={g} />
            ))}
          </div>
        ) : null}
        <StreakCalendar streaks={streaks} />
      </div>
    </DashCard>
  );
}
