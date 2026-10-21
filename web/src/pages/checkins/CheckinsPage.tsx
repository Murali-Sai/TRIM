import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { CHECKINS_KEY, getCheckin, listCheckins, type CheckinSummary } from '../../api/checkins';
import { shortDate } from '../../lib/chart/headlines';
import { usePageTitle } from '../../usePageTitle';
import { useWideScreen } from '../../useWideScreen';
import { Notice } from '../account/Section';

function weekName(c: Pick<CheckinSummary, 'week_start' | 'week_end'>): string {
  return `${shortDate(c.week_start)} to ${shortDate(c.week_end)} ${c.week_end.slice(0, 4)}`;
}

/**
 * Weekly check-ins (SPEC page 4): weeks newest first with an unread dot; on desktop the list
 * sits left and the chosen week right, on phones a week opens on its own.
 */
export function CheckinsPage() {
  usePageTitle('Check-ins');
  const { week } = useParams();
  const list = useQuery({ queryKey: CHECKINS_KEY, queryFn: listCheckins });
  const wide = useWideScreen();
  const weeks = list.data ?? [];
  const chosen = week ?? weeks[0]?.week_start ?? null;

  return (
    <section>
      <Link to="/charts" className="tap text-sm font-semibold text-accent underline">
        Charts
      </Link>
      <h2 className="mt-2 text-2xl font-bold">Weekly check-ins</h2>
      {list.isError ? (
        <Notice kind="error">Could not load your check-ins. Try again in a moment.</Notice>
      ) : null}
      {list.isSuccess && weeks.length === 0 ? (
        <div
          className="mt-4 rounded-xl border border-dashed border-border p-6 text-center"
          data-testid="checkins-empty"
        >
          <p className="font-semibold">Your first check-in arrives next Monday</p>
          <p className="mt-1 text-text-secondary">
            Each Monday morning, a short recap of the week before: calories, protein, weight trend
            and what you logged.
          </p>
        </div>
      ) : null}
      {weeks.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr] lg:items-start">
          <ul
            className={`flex flex-col gap-2 ${week ? 'hidden lg:flex' : ''}`}
            aria-label="Weeks"
            data-testid="checkin-list"
          >
            {weeks.map((c) => {
              const current = c.week_start === chosen;
              return (
                <li key={c.week_start}>
                  <Link
                    to={`/checkins/${c.week_start}`}
                    aria-current={current ? 'true' : undefined}
                    className={`tap flex items-start gap-3 rounded-xl border p-3 transition-colors duration-200 ${
                      current
                        ? 'border-accent bg-surface-2 lg:border-accent'
                        : 'border-border bg-surface hover:bg-surface-2'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">Week of {weekName(c)}</span>
                      <span className="num block text-sm text-text-secondary">{c.headline}</span>
                    </span>
                    {c.read ? null : (
                      <span className="mt-1.5 flex items-center gap-1 text-xs font-semibold">
                        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
                        <span className="sr-only">Unread</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* On phones the list alone shows until a week is chosen; opening one marks it read,
              so the hidden view must not load. */}
          {chosen && (week || wide) ? (
            <div>
              <CheckinView week={chosen} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CheckinView({ week }: { week: string }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: [...CHECKINS_KEY, week], queryFn: () => getCheckin(week) });
  // Opening marks it read; the list's dot follows.
  useEffect(() => {
    if (q.isSuccess) void queryClient.invalidateQueries({ queryKey: CHECKINS_KEY, exact: true });
  }, [q.isSuccess, queryClient]);
  if (q.isError) {
    return <Notice kind="error">This check-in could not be found.</Notice>;
  }
  if (!q.data) return <div className="min-h-48" aria-busy="true" />;
  const c = q.data;
  return (
    <article
      className="rounded-xl border border-border bg-surface p-4 lg:p-6"
      data-testid="checkin"
      aria-labelledby="checkin-title"
    >
      <Link to="/checkins" className="tap text-sm font-semibold text-accent underline lg:hidden">
        All check-ins
      </Link>
      <h3 id="checkin-title" className="mt-1 text-xl font-bold lg:mt-0">
        Week of {weekName(c)}
      </h3>
      <p className="num mt-1 text-text-secondary">{c.headline}</p>
      <ul className="mt-4 flex max-w-prose flex-col gap-3">
        {c.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </article>
  );
}
