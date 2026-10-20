import { Link } from 'react-router';
import type { Streaks, WeekGoals } from '../../api/goals';
import { GoalRing } from '../GoalRing';
import { FlameIcon, SnowflakeIcon } from '../icons';
import { Sheet } from '../Sheet';
import { StreakCalendar } from './StreakCalendar';
import { nextBadge } from './useStreaks';

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const weeks = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;

/** Tapping the flame: streaks, freezes, the month, this week's goals and the next badge. */
export function StreakSheet({
  streaks,
  goals,
  onClose,
}: {
  streaks: Streaks;
  goals: WeekGoals | undefined;
  onClose: () => void;
}) {
  const next = nextBadge(streaks.longest_days, streaks.current_days);
  return (
    <Sheet title="Your streak" onClose={onClose} testId="streak-sheet">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="eyebrow">Current</p>
            <p className="num mt-1 flex items-center gap-1.5 text-2xl font-semibold">
              <span
                className={streaks.today_logged ? 'text-streak' : 'text-text-secondary'}
                aria-hidden="true"
              >
                <FlameIcon />
              </span>
              {days(streaks.current_days)}
            </p>
          </div>
          <div>
            <p className="eyebrow">Longest</p>
            <p className="num mt-1 text-2xl font-semibold">{days(streaks.longest_days)}</p>
          </div>
          <div>
            <p className="eyebrow">Freezes</p>
            <p
              className="mt-1 flex items-center gap-1"
              aria-label={`${streaks.freezes_held} of 2 freezes held`}
            >
              {[0, 1].map((i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={i < streaks.freezes_held ? 'text-accent' : 'text-border'}
                >
                  <SnowflakeIcon />
                </span>
              ))}
            </p>
          </div>
          <div>
            <p className="eyebrow">Weigh-ins</p>
            <p className="num mt-1 font-semibold">{weeks(streaks.weigh_in.current_weeks)}</p>
            <p className="text-xs text-text-secondary">
              {streaks.weigh_in.this_week} of 3 this week
            </p>
          </div>
        </div>
        <p className="text-sm text-text-secondary">
          {streaks.message ??
            (streaks.today_logged
              ? 'Today is logged.'
              : 'Log anything today to keep it going. A freeze covers a missed day.')}
        </p>
        <StreakCalendar streaks={streaks} />
        {goals && goals.goals.length > 0 ? (
          <div>
            <p className="eyebrow">This week</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {goals.goals.map((g) => (
                <GoalRing key={g.kind} goal={g} />
              ))}
            </div>
            {goals.perfect ? <p className="mt-2 text-sm font-semibold">Perfect week.</p> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          {next ? <p className="text-sm">{next}</p> : <span />}
          <Link
            to="/account/badges"
            onClick={onClose}
            className="tap text-sm font-semibold text-accent underline"
          >
            Badges
          </Link>
        </div>
      </div>
    </Sheet>
  );
}
