import type { Streaks } from '../../api/goals';
import { FlameIcon, SnowflakeIcon } from '../icons';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function label(state: Streaks['calendar'][number]['state']): string {
  return state === 'logged'
    ? 'logged'
    : state === 'freeze'
      ? 'freeze used'
      : state === 'future'
        ? 'still to come'
        : 'not logged';
}

/** The month: a flame on logged days, a snowflake where a freeze was used. */
export function StreakCalendar({ streaks }: { streaks: Streaks }) {
  const first = streaks.calendar[0]?.date;
  // Monday-first grid: blanks before the 1st.
  const lead = first ? (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const month = first
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
        new Date(`${first}T12:00:00Z`),
      )
    : '';
  return (
    <div data-testid="streak-calendar">
      <p className="text-sm font-semibold">{month}</p>
      <div
        className="mt-1 grid grid-cols-7 gap-1 text-center text-xs text-text-secondary"
        aria-hidden="true"
      >
        {DAYS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <ol className="mt-1 grid grid-cols-7 gap-1" aria-label={`${month} calendar`}>
        {Array.from({ length: lead }, (_, i) => (
          <li key={`blank-${i}`} aria-hidden="true" />
        ))}
        {streaks.calendar.map((d) => {
          const day = Number(d.date.slice(8));
          return (
            <li
              key={d.date}
              className={`num flex h-8 items-center justify-center rounded-md text-xs ${
                d.state === 'future' ? 'text-text-secondary opacity-50' : ''
              } ${d.date === streaks.today ? 'ring-1 ring-accent' : ''}`}
              data-state={d.state}
              aria-label={`${day}: ${label(d.state)}`}
            >
              {d.state === 'logged' ? (
                <span className="text-streak" aria-hidden="true">
                  <FlameIcon width={16} height={16} />
                </span>
              ) : d.state === 'freeze' ? (
                <span className="text-accent" aria-hidden="true">
                  <SnowflakeIcon width={16} height={16} />
                </span>
              ) : (
                <span aria-hidden="true">{day}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
