import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import { FITS_KEY, QUICK_FOODS_KEY } from '../../api/foods';
import { lastLogTime, LAST_TIME_KEY, LOGS_KEY, type LogEntry } from '../../api/logs';
import { MEALS_KEY } from '../../api/meals';
import { getStaples, STAPLES_KEY } from '../../api/staples';
import {
  allowTogether,
  getSuggestions,
  logSuggestion,
  neverTogether,
  plateOf,
  saveSuggestion,
  type BudgetChoice,
  type Context,
  type Lock,
  type Macros,
  type Suggestion,
} from '../../api/suggestions';
import { LockIcon, ShuffleIcon, ThumbDownIcon, UnlockIcon } from '../../components/icons';
import { Sheet } from '../../components/Sheet';
import { blockLabel, defaultLogTime } from '../../lib/logTime';
import { barFill, contextFor, itemAmount, leavesLine, plateName } from '../../lib/suggest';
import { formatNumber, parseDecimal } from '../../lib/units';
import { isoToZonedWall, zonedWallToIso } from '../../lib/zoned';
import { Notice, primaryButton, secondaryButton } from '../account/Section';
import { TimeChip } from '../log/TimeChip';

type BudgetKey = 'rest' | 'q' | 't' | 'h' | 'custom';
const BUDGETS: readonly [BudgetKey, string, number | null][] = [
  ['rest', 'Rest of today', null],
  ['q', 'Next meal 25%', 0.25],
  ['t', 'Next meal 33%', 1 / 3],
  ['h', 'Next meal 50%', 0.5],
  ['custom', 'Custom', null],
];
const BARS: readonly { key: keyof Macros; label: string; color: string }[] = [
  { key: 'kcal', label: 'Calories', color: 'kcal' },
  { key: 'protein_g', label: 'Protein', color: 'protein' },
  { key: 'fat_g', label: 'Fat', color: 'fat' },
  { key: 'carbs_g', label: 'Carbs', color: 'carbs' },
];
const chip =
  'tap cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors duration-200';
const on = 'border-accent bg-surface-2';
const off = 'border-border';
const keyOf = (s: Suggestion) => s.items.map((i) => i.staple_id);
const message = (e: unknown, fallback: string) =>
  (e instanceof ApiError && e.userMessage) || fallback;

interface Props {
  timeZone: string;
  /** Starting time, "YYYY-MM-DDTHH:mm" in the user's timezone. */
  wall: string;
  onClose: () => void;
  onLogged: (entries: LogEntry[], wall: string) => void;
}

function Bars({ totals, budget }: { totals: Macros; budget: Macros }) {
  return (
    <div className="mt-3 grid grid-cols-4 gap-2" aria-hidden="true">
      {BARS.map((b) => {
        const f = barFill(totals[b.key], budget[b.key]);
        return (
          <div key={b.key}>
            <div className="text-xs text-text-secondary">{b.label}</div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-2">
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${f.pct}%`, background: `var(--color-${b.color})` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Card({
  s,
  index,
  budget,
  wall,
  locks,
  onLock,
  onLog,
  logging,
  onSave,
  saving,
  onNever,
  neverBusy,
}: {
  s: Suggestion;
  index: number;
  budget: Macros;
  wall: string;
  locks: Map<string, number>;
  onLock: (staple: string, units: number) => void;
  onLog: () => void;
  logging: boolean;
  onSave: (name: string) => void;
  saving: boolean;
  onNever: (pair: [string, string]) => void;
  neverBusy: boolean;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  // Thumbs-down on a plate of 3 or more: which two do not go together?
  const [picking, setPicking] = useState<string[] | null>(null);
  const thumbsDown = () => {
    const [a, b] = s.items;
    if (s.items.length === 2 && a && b) onNever([a.staple_id, b.staple_id]);
    else setPicking([]);
  };
  const id = useId();
  const g = (x: number) => formatNumber(Math.round(x));
  const t = s.totals;
  return (
    <li
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="suggestion"
      aria-label={`Suggestion ${index + 1}, ${s.match_pct}% match`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="num text-sm text-text-secondary">
          {g(t.kcal)} kcal · {g(t.protein_g)}P {g(t.fat_g)}F {g(t.carbs_g)}C
        </p>
        <p className="num shrink-0 font-semibold" data-testid="match">
          {formatNumber(s.match_pct, 1)}% match
        </p>
      </div>
      {s.label ? (
        <p
          className="mt-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold"
          data-testid="pair-label"
        >
          {s.label}
        </p>
      ) : null}
      <ul className="mt-2 flex flex-col divide-y divide-border" aria-label="Items">
        {s.items.map((i) => {
          const locked = locks.get(i.staple_id) === i.units;
          return (
            <li key={i.staple_id} className="flex items-center gap-2 py-1" data-testid="sugg-item">
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 font-semibold">{i.name}</span>
                <span className="num block text-sm text-text-secondary">
                  {itemAmount(i)} · {g(i.kcal)} kcal
                </span>
              </span>
              <button
                type="button"
                aria-pressed={locked}
                aria-label={`Keep ${i.name}, ${itemAmount(i)}, when shuffling`}
                onClick={() => onLock(i.staple_id, i.units)}
                className={`tap flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 hover:bg-surface-2 ${
                  locked ? 'text-accent' : 'text-text-secondary'
                }`}
              >
                {locked ? (
                  <LockIcon width={18} height={18} />
                ) : (
                  <UnlockIcon width={18} height={18} />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Bars totals={t} budget={budget} />
      <p className="mt-2 text-sm" data-testid="leaves">
        {leavesLine(s.leaves)}
      </p>
      {picking !== null ? (
        <div className="mt-3" role="group" aria-label="Which two don't go together?">
          <p className="text-sm font-semibold">Which two don&apos;t go together?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {s.items.map((i) => {
              const picked = picking.includes(i.staple_id);
              return (
                <button
                  key={i.staple_id}
                  type="button"
                  aria-pressed={picked}
                  disabled={!picked && picking.length >= 2}
                  onClick={() =>
                    setPicking((p) =>
                      p === null
                        ? p
                        : picked
                          ? p.filter((x) => x !== i.staple_id)
                          : [...p, i.staple_id],
                    )
                  }
                  className={`${chip} ${picked ? on : off} disabled:opacity-50`}
                >
                  {i.name}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={picking.length !== 2 || neverBusy}
              onClick={() => {
                const [a, b] = picking;
                if (a && b) onNever([a, b]);
              }}
              className={`${primaryButton} cursor-pointer`}
            >
              Don&apos;t suggest these together
            </button>
            <button
              type="button"
              onClick={() => setPicking(null)}
              className={`${secondaryButton} cursor-pointer`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : naming === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onLog}
            disabled={logging}
            className={`${primaryButton} cursor-pointer`}
          >
            {logging ? 'Logging' : `Log at ${blockLabel(wall)}`}
          </button>
          <button
            type="button"
            onClick={() => setNaming(plateName(s.items.map((i) => i.name)))}
            className={`${secondaryButton} cursor-pointer`}
          >
            Save as meal
          </button>
          {s.items.length > 1 ? (
            <button
              type="button"
              onClick={thumbsDown}
              disabled={neverBusy}
              aria-label="Don't suggest these together"
              title="Don't suggest these together"
              className="tap ml-auto flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border text-text-secondary transition-colors duration-200 hover:bg-surface-2"
            >
              <ThumbDownIcon width={18} height={18} />
            </button>
          ) : null}
        </div>
      ) : (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming.trim()) onSave(naming.trim());
          }}
        >
          <label htmlFor={id} className="block text-sm font-semibold">
            Meal name
          </label>
          <input
            id={id}
            value={naming}
            maxLength={80}
            onChange={(e) => setNaming(e.target.value)}
            className="tap mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving || !naming.trim()}
              className={`${primaryButton} cursor-pointer`}
            >
              {saving ? 'Saving' : 'Save meal'}
            </button>
            <button
              type="button"
              onClick={() => setNaming(null)}
              className={`${secondaryButton} cursor-pointer`}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/**
 * "What should I eat?" (SPEC page 4): budget, item and staple chips, then three combinations
 * of the user's staples. Each can be logged at the chosen time as one time block or saved as a
 * meal; Shuffle shows the next three, keeping any locked items.
 */
export function SuggestSheet({ timeZone, wall: startWall, onClose, onLogged }: Props) {
  const queryClient = useQueryClient();
  const now = defaultLogTime(new Date().toISOString(), timeZone);
  const [wall, setWall] = useState(startWall);
  const [context, setContext] = useState<Context>(() => contextFor(startWall));
  const [undo, setUndo] = useState<{ id: string; names: [string, string] } | null>(null);
  const [budgetKey, setBudgetKey] = useState<BudgetKey>('rest');
  const [custom, setCustom] = useState('');
  const [maxItems, setMaxItems] = useState(3);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [locks, setLocks] = useState<Map<string, number>>(new Map());
  const [shown, setShown] = useState<string[][]>([]);
  // Locks take effect on the next Shuffle (or a new search), not as they are tapped.
  const [applied, setApplied] = useState<Lock[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const customId = useId();

  const staples = useQuery({ queryKey: STAPLES_KEY, queryFn: getStaples });
  const last = useQuery({ queryKey: LAST_TIME_KEY, queryFn: lastLogTime });
  const lastUsed = last.data?.eaten_at ? isoToZonedWall(last.data.eaten_at, timeZone) : null;
  const usable = (staples.data?.staples ?? []).filter((s) => s.is_available && !s.missing);

  const customKcal = custom.trim() ? parseDecimal(custom) : Number.NaN;
  const customBad = budgetKey === 'custom' && !(customKcal > 0 && customKcal <= 10000);
  const budget: BudgetChoice =
    budgetKey === 'rest'
      ? { mode: 'rest_of_day' }
      : budgetKey === 'custom'
        ? { mode: 'kcal', kcal: customKcal }
        : { mode: 'fraction', fraction: BUDGETS.find((b) => b[0] === budgetKey)?.[2] ?? 1 };
  const lockList = (m: Map<string, number>): Lock[] =>
    [...m].map(([staple_id, units]) => ({ staple_id, units }));
  const request = {
    date: wall.slice(0, 10),
    context,
    budget,
    max_items: maxItems,
    excluded_staple_ids: [...excluded],
    locked: applied,
    exclude_sets: shown,
  };
  const result = useQuery({
    queryKey: ['suggestions', request],
    queryFn: () => getSuggestions(request),
    enabled: !customBad,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  /** A new search: settings changed, so nothing has been shown yet. */
  const restart = (keep: Map<string, number> = locks) => {
    setShown([]);
    setApplied(lockList(keep));
    setSaved(null);
  };
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: LOGS_KEY });
    await queryClient.invalidateQueries({ queryKey: QUICK_FOODS_KEY });
    await queryClient.invalidateQueries({ queryKey: FITS_KEY });
    await queryClient.invalidateQueries({ queryKey: LAST_TIME_KEY });
  };

  const log = useMutation({
    mutationFn: (s: Suggestion) => logSuggestion(zonedWallToIso(wall, timeZone), plateOf(s)),
    onSuccess: async (entries) => {
      await refresh();
      onLogged(entries, wall);
    },
  });
  const save = useMutation({
    mutationFn: ({ s, name }: { s: Suggestion; name: string }) => saveSuggestion(name, plateOf(s)),
    onSuccess: async (meal) => {
      setSaved(`Saved "${meal.name}" to your meals.`);
      await queryClient.invalidateQueries({ queryKey: MEALS_KEY });
    },
  });

  const never = useMutation({
    mutationFn: neverTogether,
    onSuccess: (pair) => {
      setUndo({ id: pair.id, names: pair.names });
      restart();
      void queryClient.invalidateQueries({ queryKey: ['suggestions'] });
    },
  });
  const allow = useMutation({
    mutationFn: allowTogether,
    onSuccess: () => {
      setUndo(null);
      restart();
      void queryClient.invalidateQueries({ queryKey: ['suggestions'] });
    },
  });

  const data = result.data;
  const list = data?.suggestions ?? [];
  const state = data?.state;

  return (
    <Sheet title="What should I eat?" onClose={onClose} testId="suggest-sheet">
      <div className="flex flex-col gap-4">
        <TimeChip
          wall={wall}
          now={now}
          lastUsed={lastUsed}
          onChange={(w) => {
            setWall(w);
            setContext(contextFor(w));
            restart();
          }}
        />
        <div>
          <p className="font-semibold" id={`${customId}-context`}>
            Meal
          </p>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-labelledby={`${customId}-context`}
          >
            {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={context === c}
                onClick={() => {
                  setContext(c);
                  restart();
                }}
                className={`${chip} capitalize ${context === c ? on : off}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="font-semibold" id={`${customId}-budget`}>
            Fit into
          </p>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-labelledby={`${customId}-budget`}
          >
            {BUDGETS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={budgetKey === key}
                onClick={() => {
                  setBudgetKey(key);
                  restart();
                }}
                className={`${chip} ${budgetKey === key ? on : off}`}
              >
                {label}
              </button>
            ))}
          </div>
          {budgetKey === 'custom' ? (
            <div className="mt-3">
              <label htmlFor={customId} className="block text-sm font-semibold">
                Calories for this meal
              </label>
              <input
                id={customId}
                inputMode="decimal"
                autoComplete="off"
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value);
                  restart();
                }}
                aria-invalid={customBad && custom.trim() !== ''}
                className="tap num mt-1 w-32 rounded-lg border border-border bg-surface px-3 py-2"
              />
            </div>
          ) : null}
        </div>
        <div>
          <p className="font-semibold" id={`${customId}-items`}>
            Up to
          </p>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-labelledby={`${customId}-items`}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={maxItems === n}
                aria-label={`Up to ${n} ${n === 1 ? 'item' : 'items'}`}
                onClick={() => {
                  setMaxItems(n);
                  restart();
                }}
                className={`${chip} num min-w-11 ${maxItems === n ? on : off}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        {usable.length > 0 ? (
          <div>
            <p className="font-semibold" id={`${customId}-staples`}>
              Staples to use
            </p>
            <div
              className="mt-2 flex flex-wrap gap-2"
              role="group"
              aria-labelledby={`${customId}-staples`}
            >
              {usable.map((st) => {
                const use = !excluded.has(st.id);
                return (
                  <button
                    key={st.id}
                    type="button"
                    aria-pressed={use}
                    onClick={() => {
                      setExcluded((x) => {
                        const next = new Set(x);
                        if (use) next.add(st.id);
                        else next.delete(st.id);
                        return next;
                      });
                      const next = new Map(locks);
                      next.delete(st.id);
                      setLocks(next);
                      restart(next);
                    }}
                    className={`${chip} max-w-full truncate ${
                      use ? on : `${off} text-text-secondary line-through`
                    }`}
                  >
                    {st.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <p className="text-sm text-text-secondary">
          Suggestions combine your staples to fit your numbers. They are not dietary advice. Pairing
          is based on what people commonly eat together and on your own history, so it can still
          miss your taste; the thumbs-down teaches it.
        </p>

        {result.isError ? (
          <Notice kind="error">
            {message(result.error, 'Could not get suggestions. Try again in a moment.')}
          </Notice>
        ) : null}
        {log.isError ? (
          <Notice kind="error">{message(log.error, 'Could not log. Try again.')}</Notice>
        ) : null}
        {save.isError ? (
          <Notice kind="error">{message(save.error, 'Could not save the meal. Try again.')}</Notice>
        ) : null}
        {saved ? <Notice kind="ok">{saved}</Notice> : null}
        {undo ? (
          <Notice kind="ok">
            Won&apos;t suggest {undo.names[0]} and {undo.names[1]} together.{' '}
            <button
              type="button"
              onClick={() => allow.mutate(undo.id)}
              disabled={allow.isPending}
              className="cursor-pointer font-semibold text-accent underline"
            >
              Undo
            </button>
          </Notice>
        ) : null}
        {never.isError || allow.isError ? (
          <Notice kind="error">Could not save that. Try again.</Notice>
        ) : null}

        {state && state !== 'ok' ? (
          <div
            className="rounded-xl border border-dashed border-border p-4 text-center"
            data-testid="suggest-empty"
          >
            <p>{data?.message}</p>
            {state === 'need_staples' ? (
              <Link
                to="/staples"
                className="tap mt-2 inline-block font-semibold text-accent underline"
              >
                Manage staples
              </Link>
            ) : state === 'no_target' ? (
              <Link
                to="/targets"
                className="tap mt-2 inline-block font-semibold text-accent underline"
              >
                Set targets
              </Link>
            ) : null}
          </div>
        ) : null}

        {list.length > 0 && data?.budget ? (
          <ol
            className="flex flex-col gap-3"
            aria-label="Suggestions"
            aria-busy={result.isFetching}
          >
            {list.map((s, i) => (
              <Card
                key={keyOf(s).join('+')}
                s={s}
                index={i}
                budget={data.budget as Macros}
                wall={wall}
                locks={locks}
                onLock={(staple, units) =>
                  setLocks((l) => {
                    const next = new Map(l);
                    if (next.get(staple) === units) next.delete(staple);
                    else next.set(staple, units);
                    return next;
                  })
                }
                onLog={() => log.mutate(s)}
                logging={log.isPending && log.variables === s}
                onSave={(name) => save.mutate({ s, name })}
                saving={save.isPending && save.variables?.s === s}
                onNever={(pair) => never.mutate(pair)}
                neverBusy={never.isPending}
              />
            ))}
          </ol>
        ) : result.isPending && !customBad ? (
          <div className="min-h-40" aria-busy="true" />
        ) : null}

        {state === 'ok' || state === 'no_more' ? (
          <button
            type="button"
            onClick={() => {
              if (state === 'no_more') return;
              setShown((x) => [...x, ...list.map(keyOf)]);
              setApplied(lockList(locks));
              setSaved(null);
            }}
            disabled={result.isFetching || state === 'no_more'}
            className={`${secondaryButton} flex cursor-pointer items-center justify-center gap-2`}
          >
            <ShuffleIcon width={18} height={18} />
            Shuffle
          </button>
        ) : null}
      </div>
    </Sheet>
  );
}
