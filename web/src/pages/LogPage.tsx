import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMe } from '../api/auth';
import { ApiError } from '../api/client';
import {
  getQuickFoods,
  QUICK_FOODS_KEY,
  searchFoods,
  setFavourite,
  type Food,
  type QuickFoods,
} from '../api/foods';
import { addLogs, lastLogTime, LAST_TIME_KEY, LOGS_KEY } from '../api/logs';
import { Field } from '../components/Field';
import { macroLine } from '../lib/foodAmount';
import { defaultLogTime, loggedMessage } from '../lib/logTime';
import {
  amountText,
  fromLastServing,
  pickedName,
  pickedNutrients,
  toItem,
  totalsOf,
  type Picked,
  type PickedSource,
} from '../lib/picked';
import { formatNumber } from '../lib/units';
import { isoToZonedWall, zonedWallToIso } from '../lib/zoned';
import { usePageTitle } from '../usePageTitle';
import { Notice, primaryButton, secondaryButton, Section } from './account/Section';
import { CustomFoodSheet } from './log/CustomFoodSheet';
import { FoodDetail } from './log/FoodDetail';
import { QuickAddForm } from './log/QuickAddForm';
import { QuickLists } from './log/QuickLists';
import { TimeChip } from './log/TimeChip';

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function perServing(food: Food): string {
  const serving = food.servings.find((s) => s.is_default) ?? food.servings[0];
  if (serving) {
    const kcal = (food.kcal_100 * serving.grams) / 100;
    return `${formatNumber(Math.round(kcal))} kcal per ${serving.label}`;
  }
  return `${formatNumber(Math.round(food.kcal_100))} kcal per 100 g`;
}

type Tab = 'search' | 'quick';
type Selected = { food: Food; start: Extract<Picked, { kind: 'food' }> };

/**
 * Log food: favourites, recents and frequents before typing, search, quick add, and custom
 * foods; everything picked is logged at one time. The time chip starts at now, rounded down to
 * 5 minutes, or at `?at=` (a time block's "+").
 */
export function LogPage() {
  usePageTitle('Log food');
  const me = useMe();
  if (!me.data) return null;
  return <LogFood timeZone={me.data.timezone} />;
}

function LogFood({ timeZone }: { timeZone: string }) {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const now = defaultLogTime(new Date().toISOString(), timeZone);
  const preset = params.get('at');
  const [wall, setWall] = useState(() => {
    const at =
      preset && !Number.isNaN(Date.parse(preset)) ? isoToZonedWall(preset, timeZone) : null;
    return at && at <= `${now.slice(0, 10)}T23:59` ? at : now;
  });
  const [tab, setTab] = useState<Tab>('search');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState<{ message: string; link: string } | null>(null);

  const q = useDebounced(query.trim(), 300);
  const search = useQuery({
    queryKey: ['foods', 'search', q],
    queryFn: () => searchFoods(q),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
  const quick = useQuery({ queryKey: QUICK_FOODS_KEY, queryFn: getQuickFoods });
  const last = useQuery({ queryKey: LAST_TIME_KEY, queryFn: lastLogTime });
  const lastUsed = last.data?.eaten_at ? isoToZonedWall(last.data.eaten_at, timeZone) : null;
  const favouriteIds = new Set((quick.data?.favourites ?? []).map((f) => f.id));

  const favourite = useMutation({
    mutationFn: ({ food, on }: { food: Food; on: boolean }) => setFavourite(food.id, on),
    onMutate: ({ food, on }) => {
      // Optimistic: the star changes at once; the lists catch up on refetch.
      queryClient.setQueryData<QuickFoods>(QUICK_FOODS_KEY, (old) =>
        old
          ? {
              ...old,
              favourites: on
                ? [{ ...food, last: null, is_favourite: true, times_logged: 0 }, ...old.favourites]
                : old.favourites.filter((f) => f.id !== food.id),
            }
          : old,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['foods'] }),
  });

  const save = useMutation({
    mutationFn: () => addLogs(zonedWallToIso(wall, timeZone), picked.map(toItem)),
    onSuccess: async (rows) => {
      const day = wall.slice(0, 10);
      const group = rows[0]?.log_group_id ?? '';
      setDone({
        message: loggedMessage(rows.length, wall, now.slice(0, 10)),
        link: `/?${day === now.slice(0, 10) ? '' : `date=${day}&`}highlight=${group}`,
      });
      setPicked([]);
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: LOGS_KEY });
      await queryClient.invalidateQueries({ queryKey: QUICK_FOODS_KEY });
    },
  });

  function add(p: Picked) {
    setPicked((list) => [...list, p]);
    setSelected(null);
    setDone(null);
  }

  function open(food: Food, source: PickedSource) {
    const start = fromLastServing(food, source);
    if (start.kind === 'food') setSelected({ food, start });
  }

  const totals = totalsOf(picked);
  const saveError = save.error
    ? (save.error instanceof ApiError && save.error.userMessage) ||
      'Could not log. Check your connection and try again.'
    : null;
  const results = search.data?.results ?? [];
  const searching = q.length >= 2;
  const tabClass = (t: Tab) =>
    `tap flex-1 cursor-pointer rounded-md px-3 py-2 font-semibold transition-colors duration-200 ${
      tab === t ? 'bg-surface text-text shadow-sm' : 'text-text-secondary'
    }`;

  return (
    <section>
      <h2 className="text-2xl font-bold">Log food</h2>
      <div className="mt-4">
        <TimeChip wall={wall} now={now} lastUsed={lastUsed} onChange={setWall} />
      </div>
      {done ? (
        <Notice kind="ok">
          {done.message}{' '}
          <Link to={done.link} className="font-semibold text-accent underline">
            See it on {done.link.includes('date=') ? 'that day' : 'Today'}
          </Link>
        </Notice>
      ) : null}

      {/* Phone: find, then detail and list. Desktop: find left, detail and list right. */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className="rounded-xl border border-border bg-surface p-4" data-testid="find-panel">
          <div
            role="tablist"
            aria-label="Ways to log"
            className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'search'}
              onClick={() => setTab('search')}
              className={tabClass('search')}
            >
              Search
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'quick'}
              onClick={() => setTab('quick')}
              className={tabClass('quick')}
            >
              Quick add
            </button>
          </div>

          {tab === 'quick' ? (
            <div className="mt-4" role="tabpanel" aria-label="Quick add">
              <QuickAddForm onAdd={(quickAdd) => add({ kind: 'quick', quick: quickAdd })} />
            </div>
          ) : (
            <div className="mt-4" role="tabpanel" aria-label="Search">
              <Field
                id="food-search"
                label="Find a food"
                type="search"
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDone(null);
                }}
                hint="Type at least 2 letters."
              />
              {!searching && quick.data ? (
                <QuickLists
                  data={quick.data}
                  onOpen={open}
                  onAdd={(food, source) => add(fromLastServing(food, source))}
                />
              ) : null}
              {search.data?.notice ? <Notice kind="error">{search.data.notice}</Notice> : null}
              {search.isError ? (
                <Notice kind="error">Search is not answering. Try again in a moment.</Notice>
              ) : null}
              {searching && search.isSuccess && results.length === 0 ? (
                <p className="mt-3 text-text-secondary">No foods match &ldquo;{q}&rdquo;.</p>
              ) : null}
              {searching && results.length > 0 ? (
                <ul
                  className="mt-3 flex flex-col divide-y divide-border"
                  aria-label="Search results"
                >
                  {results.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => open(f, 'search')}
                        aria-pressed={selected?.food.id === f.id}
                        className={`tap w-full cursor-pointer rounded-lg px-2 py-2.5 text-left transition-colors duration-200 hover:bg-surface-2 ${
                          selected?.food.id === f.id ? 'bg-surface-2' : ''
                        }`}
                      >
                        <span className="line-clamp-2 font-semibold">{f.name}</span>
                        <span className="num block text-sm text-text-secondary">
                          {[f.brand, perServing(f)].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {searching && search.isSuccess ? (
                <div className="mt-3 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className={`${secondaryButton} cursor-pointer`}
                  >
                    Create a custom food
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:gap-6">
          {selected ? (
            <Section title="How much">
              <FoodDetail
                key={`${selected.food.id}-${selected.start.source}`}
                food={selected.food}
                start={selected.start}
                favourite={favouriteIds.has(selected.food.id)}
                onFavourite={(on) => favourite.mutate({ food: selected.food, on })}
                onAdd={add}
              />
            </Section>
          ) : null}
          <Section title="To log">
            {picked.length === 0 ? (
              <p className="text-text-secondary">
                Pick foods to log. They are all logged at the time above.
              </p>
            ) : (
              <>
                <ul className="flex flex-col divide-y divide-border" data-testid="to-log">
                  {picked.map((p, i) => (
                    <li key={`${pickedName(p)}-${i}`} className="flex items-start gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 font-semibold">{pickedName(p)}</p>
                        <p className="num text-sm text-text-secondary">
                          {macroLine(pickedNutrients(p))} · {amountText(p)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPicked((list) => list.filter((_, j) => j !== i))}
                        className="tap cursor-pointer rounded-lg px-2 py-1 text-sm font-semibold text-accent underline"
                      >
                        Remove<span className="sr-only"> {pickedName(p)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="num mt-3 text-sm font-semibold" data-testid="to-log-total">
                  Total {macroLine(totals)}
                </p>
              </>
            )}
            {saveError ? <Notice kind="error">{saveError}</Notice> : null}
            <button
              type="button"
              disabled={picked.length === 0 || save.isPending}
              onClick={() => save.mutate()}
              className={`${primaryButton} mt-4 w-full cursor-pointer`}
            >
              {save.isPending
                ? 'Logging'
                : picked.length > 1
                  ? `Log ${picked.length} items`
                  : 'Log it'}
            </button>
          </Section>
        </div>
      </div>

      {creating ? (
        <CustomFoodSheet
          name={query.trim()}
          onClose={() => setCreating(false)}
          onCreated={(food) => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ['foods'] });
            open(food, 'search');
          }}
        />
      ) : null}
    </section>
  );
}
