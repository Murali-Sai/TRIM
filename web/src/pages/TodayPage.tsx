import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMe } from '../api/auth';
import { listLogs, LOGS_KEY } from '../api/logs';
import { listTargets, TARGETS_KEY } from '../api/setup';
import { sumNutrients, targetOn } from '../lib/dayTotals';
import { dayLabel, groupBlocks, shiftWall } from '../lib/logTime';
import { isoToZonedWall, zonedWallToIso } from '../lib/zoned';
import { usePageTitle } from '../usePageTitle';
import { Notice } from './account/Section';
import { TargetStrip } from './today/TargetStrip';
import { Timeline } from './today/Timeline';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HIGHLIGHT_MS = 2500;

function addDays(day: string, n: number): string {
  return shiftWall(`${day}T00:00`, n * 24 * 60).slice(0, 10);
}

export function TodayPage() {
  const me = useMe();
  if (!me.data) return null;
  return <Today timeZone={me.data.timezone} />;
}

function Today({ timeZone }: { timeZone: string }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const today = isoToZonedWall(new Date().toISOString(), timeZone).slice(0, 10);
  const asked = params.get('date');
  const day = asked && DAY.test(asked) && asked <= today ? asked : today;
  const isToday = day === today;
  usePageTitle(isToday ? 'Today' : dayLabel(day));

  const [highlight, setHighlight] = useState(params.get('highlight'));
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlight]);

  const logs = useQuery({ queryKey: [...LOGS_KEY, day], queryFn: () => listLogs(day) });
  const targets = useQuery({ queryKey: TARGETS_KEY, queryFn: listTargets });

  function goTo(next: string) {
    if (next > today) return;
    navigate(next === today ? '/' : `/?date=${next}`);
  }

  // Swipe left or right on the header to change day.
  const touch = useRef<{ x: number; y: number } | null>(null);

  const entries = logs.data ?? [];
  const blocks = groupBlocks(entries, timeZone);
  const totals = sumNutrients(entries);
  const target = targets.data ? targetOn(targets.data, day) : null;

  return (
    <section>
      <header
        className="flex flex-wrap items-center gap-2"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          const t = e.changedTouches[0];
          touch.current = null;
          if (!start || !t) return;
          const dx = t.clientX - start.x;
          if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(t.clientY - start.y)) {
            goTo(addDays(day, dx < 0 ? 1 : -1));
          }
        }}
      >
        <h2 className="mr-auto text-2xl font-bold">{isToday ? 'Today' : dayLabel(day)}</h2>
        <button
          type="button"
          onClick={() => goTo(addDays(day, -1))}
          className="tap rounded-lg border border-border bg-surface px-3 py-2 font-semibold"
          aria-label="Previous day"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <label className="sr-only" htmlFor="today-date">
          Day
        </label>
        <input
          id="today-date"
          type="date"
          value={day}
          max={today}
          onChange={(e) => e.target.value && goTo(e.target.value)}
          className="tap rounded-lg border border-border bg-surface px-3 py-2"
        />
        <button
          type="button"
          onClick={() => goTo(addDays(day, 1))}
          disabled={isToday}
          className="tap rounded-lg border border-border bg-surface px-3 py-2 font-semibold disabled:opacity-40"
          aria-label="Next day"
        >
          <span aria-hidden="true">›</span>
        </button>
      </header>

      {/* Phone: strip on top, timeline below. Desktop: strip in the left column, timeline in
          the center at up to 720 px. */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,720px)] lg:items-start lg:gap-6">
        <div className="lg:sticky lg:top-4">
          {targets.isError ? (
            <Notice kind="error">Could not load your targets. Try again in a moment.</Notice>
          ) : target ? (
            <TargetStrip totals={totals} target={target} />
          ) : targets.isSuccess ? (
            <div
              className="rounded-xl border border-border bg-surface p-4"
              data-testid="set-targets"
            >
              <p className="font-semibold">No targets for this day</p>
              <p className="mt-1 text-sm text-text-secondary">
                Set calorie and macro targets to see how the day adds up.
              </p>
              <Link
                to="/targets"
                className="tap mt-3 inline-block rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-contrast"
              >
                Set targets
              </Link>
            </div>
          ) : (
            <div className="min-h-24" aria-busy="true" />
          )}
        </div>

        <div>
          {logs.isError ? (
            <Notice kind="error">Could not load this day. Try again in a moment.</Notice>
          ) : logs.isPending ? (
            <div className="min-h-40" aria-busy="true" />
          ) : blocks.length === 0 ? (
            <div
              className="rounded-xl border border-dashed border-border p-6 text-center"
              data-testid="empty-day"
            >
              <p className="text-text-secondary">Nothing logged yet. Tap + to add what you ate.</p>
              <Link
                to={
                  isToday
                    ? '/log'
                    : `/log?at=${encodeURIComponent(zonedWallToIso(`${day}T12:00`, timeZone))}`
                }
                className="tap mt-3 inline-block rounded-lg border border-border bg-surface px-4 py-2.5 font-semibold"
              >
                Add food
              </Link>
            </div>
          ) : (
            <Timeline blocks={blocks} scrollToLatest={isToday} highlight={highlight} />
          )}
        </div>
      </div>
    </section>
  );
}
