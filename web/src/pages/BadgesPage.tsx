import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { BADGES_KEY, getBadges } from '../api/goals';
import { Medal } from '../components/streak/MilestoneCard';
import { useStreaks } from '../components/streak/useStreaks';
import { usePageTitle } from '../usePageTitle';
import { Notice } from './account/Section';

const SHORT: Record<string, string> = {
  streak_7: '7',
  streak_30: '30',
  streak_100: '100',
  streak_365: '365',
  weigh_in_4: '4w',
  weigh_in_12: '12w',
  weigh_in_52: '52w',
  first_saved_meal: '1',
  entries_100: '100',
  entries_1000: '1k',
  perfect_weeks_10: '10',
  first_phase: '1',
  measurements_4: '4w',
};

const earnedOn = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );

/** Earned badges in color with their dates; locked ones in outline with how to earn them. */
export function BadgesPage() {
  usePageTitle('Badges');
  const { on } = useStreaks();
  const badges = useQuery({ queryKey: BADGES_KEY, queryFn: getBadges, enabled: on });
  return (
    <section>
      <Link to="/account" className="tap text-sm font-semibold text-accent underline">
        Account
      </Link>
      <h2 className="mt-2 text-2xl font-bold">Badges</h2>
      {!on ? (
        <p className="mt-4 text-text-secondary">
          Streaks and badges are off. Turn them on in Account to see your badges.
        </p>
      ) : badges.isError ? (
        <Notice kind="error">Could not load your badges. Try again in a moment.</Notice>
      ) : (
        <ul
          className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          aria-label="Badges"
        >
          {(badges.data ?? []).map((b) => (
            <li
              key={b.key}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center ${
                b.earned_at ? 'border-border bg-surface' : 'border-dashed border-border'
              }`}
              data-testid="badge"
              data-earned={b.earned_at ? 'true' : 'false'}
            >
              <Medal days={SHORT[b.key] ?? ''} earned={b.earned_at !== null} />
              <p className="font-semibold">{b.name}</p>
              <p className="text-sm text-text-secondary">
                {b.earned_at ? `Earned ${earnedOn(b.earned_at)}` : b.how}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
