import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMe } from '../api/auth';
import { ApiError } from '../api/client';
import { listLogs, LOGS_KEY, type LogEntry } from '../api/logs';
import { mealFromLogs, MEALS_KEY } from '../api/meals';
import { getSettings, SETTINGS_KEY } from '../api/tracking';
import { Toast } from '../components/Toast';
import { listTargets, TARGETS_KEY } from '../api/setup';
import { sumNutrients, targetOn } from '../lib/dayTotals';
import { dayLabel, defaultLogTime, groupBlocks, shiftWall } from '../lib/logTime';
import { isoToZonedWall, zonedWallToIso } from '../lib/zoned';
import { usePageTitle } from '../usePageTitle';
import { Notice, primaryButton, secondaryButton } from './account/Section';
import { EditEntrySheet } from './today/EditEntrySheet';
import { MoveCopySheet, type MoveCopyMode } from './today/MoveCopySheet';
import { SaveMealSheet } from './today/SaveMealSheet';
import { TargetStrip } from './today/TargetStrip';
import { Timeline } from './today/Timeline';
import { useLogActions } from './today/useLogActions';
import { WaterRow } from './today/WaterRow';

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
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: getSettings });

  function goTo(next: string) {
    if (next > today) return;
    navigate(next === today ? '/' : `/?date=${next}`);
  }

  // Swipe left or right on the header to change day.
  const touch = useRef<{ x: number; y: number } | null>(null);

  const actions = useLogActions();
  const [editing, setEditing] = useState<LogEntry | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [picker, setPicker] = useState<{ mode: MoveCopyMode; ids: string[]; wall: string } | null>(
    null,
  );
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string[] | null>(null);
  const saveMeal = useMutation({
    mutationFn: ({ name, ids }: { name: string; ids: string[] }) => mealFromLogs(name, ids),
    onSuccess: async (meal) => {
      setSaving(null);
      setSelected(new Set());
      actions.say(`Saved ${meal.name} as a meal.`);
      await queryClient.invalidateQueries({ queryKey: MEALS_KEY });
    },
  });
  function startSaving(ids: string[]) {
    saveMeal.reset();
    setSaving(ids);
  }
  // A new day starts with nothing selected.
  useEffect(() => setSelected(new Set()), [day]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmPicker(wall: string) {
    if (!picker) return;
    const vars = { ids: picker.ids, at: zonedWallToIso(wall, timeZone) };
    const done = {
      onSuccess: () => {
        setPicker(null);
        setSelected(new Set());
      },
    };
    if (picker.mode === 'move') actions.move.mutate(vars, done);
    else actions.copy.mutate(vars, done);
  }

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
            <TargetStrip
              totals={totals}
              target={target}
              showFiber={settings.data?.track_fiber ?? true}
            />
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
          {settings.data?.track_water ? (
            <WaterRow
              day={day}
              isToday={isToday}
              timeZone={timeZone}
              unit={settings.data.water_unit}
              targetMl={target?.water_ml ?? null}
              onToast={actions.say}
            />
          ) : null}
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
            <>
              {actions.error && !editing && !picker ? (
                <div className="mb-4">
                  <Notice kind="error">{actions.error}</Notice>
                </div>
              ) : null}
              <Timeline
                blocks={blocks}
                scrollToLatest={isToday}
                highlight={highlight}
                selected={selected}
                selecting={selected.size > 0}
                onToggle={toggle}
                onOpen={(e) => {
                  actions.setError(null);
                  setEditing(e);
                }}
                onDelete={(e) => actions.remove.mutate(e)}
                onDrop={(ids, block) => {
                  actions.move.mutate(
                    { ids, at: block.entries[0]?.eaten_at ?? '' },
                    { onSuccess: () => setSelected(new Set()) },
                  );
                }}
                onSaveBlock={(block) => startSaving(block.entries.map((e) => e.id))}
                onCopyBlock={(block) =>
                  setPicker({
                    mode: 'copy',
                    ids: block.entries.map((e) => e.id),
                    // Copy a time block to today at a chosen time; starts at the block's time.
                    wall: `${today}T${block.wall.slice(11, 16)}`,
                  })
                }
              />
              {selected.size > 0 ? (
                <div
                  role="toolbar"
                  aria-label="Selected items"
                  className="sticky bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+1rem)] z-30 mt-4 grid grid-cols-2 items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-lg lg:bottom-4 lg:flex"
                  data-testid="selection-bar"
                >
                  <p className="col-span-2 font-semibold lg:mr-auto" aria-live="polite">
                    {selected.size} selected
                  </p>
                  <button
                    type="button"
                    className={`${primaryButton} cursor-pointer`}
                    onClick={() =>
                      setPicker({
                        mode: 'move',
                        ids: [...selected],
                        wall: isoToZonedWall(
                          entries.find((e) => selected.has(e.id))?.eaten_at ??
                            new Date().toISOString(),
                          timeZone,
                        ),
                      })
                    }
                  >
                    Move
                  </button>
                  <button
                    type="button"
                    className={`${secondaryButton} cursor-pointer`}
                    onClick={() =>
                      setPicker({
                        mode: 'copy',
                        ids: [...selected],
                        wall: defaultLogTime(new Date().toISOString(), timeZone),
                      })
                    }
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className={`${secondaryButton} cursor-pointer`}
                    onClick={() => startSaving([...selected])}
                  >
                    Save as meal
                  </button>
                  <button
                    type="button"
                    className={`${secondaryButton} cursor-pointer`}
                    onClick={() => setSelected(new Set())}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {editing ? (
        <EditEntrySheet
          entry={editing}
          timeZone={timeZone}
          today={today}
          busy={actions.busy}
          error={actions.error}
          onClose={() => setEditing(null)}
          onSave={(patch) =>
            actions.edit.mutate({ id: editing.id, patch }, { onSuccess: () => setEditing(null) })
          }
          onDuplicate={() =>
            actions.copy.mutate(
              { ids: [editing.id], at: editing.eaten_at },
              { onSuccess: () => setEditing(null) },
            )
          }
          onDelete={() => actions.remove.mutate(editing, { onSuccess: () => setEditing(null) })}
        />
      ) : null}
      {picker ? (
        <MoveCopySheet
          mode={picker.mode}
          count={picker.ids.length}
          wall={picker.wall}
          today={today}
          busy={actions.busy}
          onClose={() => setPicker(null)}
          onConfirm={confirmPicker}
        />
      ) : null}
      {saving ? (
        <SaveMealSheet
          count={saving.length}
          quickAdds={entries.filter((e) => saving.includes(e.id) && e.food_id === null).length}
          busy={saveMeal.isPending}
          error={
            saveMeal.error
              ? (saveMeal.error instanceof ApiError && saveMeal.error.userMessage) ||
                'Could not save. Check your connection and try again.'
              : null
          }
          onClose={() => setSaving(null)}
          onSave={(name) => saveMeal.mutate({ name, ids: saving })}
        />
      ) : null}
      <Toast toast={actions.toast} onDone={actions.clearToast} />
    </section>
  );
}
