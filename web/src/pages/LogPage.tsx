import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '../api/auth';
import { ApiError } from '../api/client';
import { searchFoods, type Food } from '../api/foods';
import { addLogs, lastLogTime, LAST_TIME_KEY, LOGS_KEY, type LogItem } from '../api/logs';
import { Field } from '../components/Field';
import { macroLine, nutrientsFor } from '../lib/foodAmount';
import { defaultLogTime, loggedMessage } from '../lib/logTime';
import { formatNumber } from '../lib/units';
import { isoToZonedWall, zonedWallToIso } from '../lib/zoned';
import { usePageTitle } from '../usePageTitle';
import { Notice, primaryButton, Section } from './account/Section';
import { FoodDetail, type Picked } from './log/FoodDetail';
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

function toItem(p: Picked): LogItem {
  return p.unit === 'g'
    ? { food_id: p.food.id, grams: p.grams }
    : { food_id: p.food.id, quantity: p.quantity, unit_label: p.unit };
}

function amountText(p: Picked): string {
  return p.unit === 'g'
    ? `${formatNumber(p.grams)} g`
    : `${formatNumber(p.quantity, p.quantity % 1 ? 1 : 0)} x ${p.unit}`;
}

/**
 * Log food: search, pick amounts, and log them all at one time. The time chip starts at now,
 * rounded down to 5 minutes, or at `?at=` (a time block's "+").
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
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Food | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const q = useDebounced(query.trim(), 300);
  const search = useQuery({
    queryKey: ['foods', 'search', q],
    queryFn: () => searchFoods(q),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
  const last = useQuery({ queryKey: LAST_TIME_KEY, queryFn: lastLogTime });
  const lastUsed = last.data?.eaten_at ? isoToZonedWall(last.data.eaten_at, timeZone) : null;

  const save = useMutation({
    mutationFn: () => addLogs(zonedWallToIso(wall, timeZone), picked.map(toItem)),
    onSuccess: async (rows) => {
      setDone(loggedMessage(rows.length, wall, now.slice(0, 10)));
      setPicked([]);
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: LOGS_KEY });
    },
  });

  const totals = picked.reduce(
    (t, p) => {
      const n = nutrientsFor(p.food, p.grams);
      return {
        kcal: t.kcal + n.kcal,
        protein_g: t.protein_g + n.protein_g,
        fat_g: t.fat_g + n.fat_g,
        carbs_g: t.carbs_g + n.carbs_g,
      };
    },
    { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
  );
  const saveError = save.error
    ? (save.error instanceof ApiError && save.error.userMessage) ||
      'Could not log. Check your connection and try again.'
    : null;
  const results = search.data?.results ?? [];

  return (
    <section>
      <h2 className="text-2xl font-bold">Log food</h2>
      <div className="mt-4">
        <TimeChip wall={wall} now={now} lastUsed={lastUsed} onChange={setWall} />
      </div>
      {done ? <Notice kind="ok">{done}</Notice> : null}

      {/* Phone: search, then detail and list. Desktop: search left, detail and list right. */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
        <Section title="Search">
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
          {search.data?.notice ? <Notice kind="error">{search.data.notice}</Notice> : null}
          {search.isError ? (
            <Notice kind="error">Search is not answering. Try again in a moment.</Notice>
          ) : null}
          {q.length >= 2 && search.isSuccess && results.length === 0 ? (
            <p className="mt-3 text-text-secondary">No foods match &ldquo;{q}&rdquo;.</p>
          ) : null}
          {results.length > 0 ? (
            <ul className="mt-3 flex flex-col divide-y divide-border" aria-label="Search results">
              {results.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(f)}
                    aria-pressed={selected?.id === f.id}
                    className={`tap w-full rounded-lg px-2 py-2.5 text-left ${
                      selected?.id === f.id ? 'bg-surface-2' : ''
                    }`}
                  >
                    <span className="line-clamp-2 font-semibold">{f.name}</span>
                    <span className="block text-sm text-text-secondary">
                      {[f.brand, perServing(f)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:gap-6">
          {selected ? (
            <Section title="How much">
              <FoodDetail
                key={selected.id}
                food={selected}
                onAdd={(p) => {
                  setPicked((list) => [...list, p]);
                  setSelected(null);
                  setDone(null);
                }}
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
                    <li key={`${p.food.id}-${i}`} className="flex items-start gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 font-semibold">{p.food.name}</p>
                        <p className="text-sm text-text-secondary">
                          {macroLine(nutrientsFor(p.food, p.grams))} · {amountText(p)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPicked((list) => list.filter((_, j) => j !== i))}
                        className="tap rounded-lg px-2 py-1 text-sm font-semibold text-accent underline"
                      >
                        Remove<span className="sr-only"> {p.food.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm font-semibold" data-testid="to-log-total">
                  Total {macroLine(totals)}
                </p>
              </>
            )}
            {saveError ? <Notice kind="error">{saveError}</Notice> : null}
            <button
              type="button"
              disabled={picked.length === 0 || save.isPending}
              onClick={() => save.mutate()}
              className={`${primaryButton} mt-4 w-full`}
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
    </section>
  );
}
