import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { LogEntry } from '../../api/logs';
import { MealIcon, PlusIcon } from '../../components/icons';
import { amountLabel, sumNutrients } from '../../lib/dayTotals';
import { macroLine } from '../../lib/foodAmount';
import { foodCategory } from '../../lib/foodCategory';
import type { TimeBlock } from '../../lib/logTime';
import { formatNumber } from '../../lib/units';
import { FoodIcon } from './FoodIcon';

export interface TimelineActions {
  /** Ids of the selected cards. */
  selected: ReadonlySet<string>;
  /** True once anything is selected: tapping a card then toggles it. */
  selecting: boolean;
  onToggle: (id: string) => void;
  onOpen: (e: LogEntry) => void;
  onDelete: (e: LogEntry) => void;
  /** Desktop drag: cards dropped onto another block move to its time. */
  onDrop: (ids: string[], block: TimeBlock<LogEntry>) => void;
  onCopyBlock: (block: TimeBlock<LogEntry>) => void;
  onSaveBlock: (block: TimeBlock<LogEntry>) => void;
}

interface Props extends TimelineActions {
  blocks: TimeBlock<LogEntry>[];
  /** Scroll to the latest block (today), or to the block holding `highlight`. */
  scrollToLatest: boolean;
  /** A log_group_id whose cards were just added, briefly highlighted. */
  highlight: string | null;
}

const LONG_PRESS_MS = 500;
const DRAG_TYPE = 'application/x-trim-log-ids';

const CHIPS = [
  { key: 'kcal', suffix: ' kcal', color: 'kcal' },
  { key: 'protein_g', suffix: ' P', color: 'protein' },
  { key: 'fat_g', suffix: ' F', color: 'fat' },
  { key: 'carbs_g', suffix: ' C', color: 'carbs' },
] as const;

function EntryCard({
  e,
  fresh,
  actions,
}: {
  e: LogEntry;
  fresh: boolean;
  actions: TimelineActions;
}) {
  const amount = amountLabel(e);
  const checked = actions.selected.has(e.id);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);

  function cancelPress() {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  }

  return (
    <li
      className={`group relative flex items-stretch gap-1 rounded-xl border bg-surface transition-colors duration-200 ${
        checked
          ? 'border-accent ring-1 ring-accent'
          : fresh
            ? 'border-accent bg-surface-2'
            : 'border-border'
      }`}
      data-testid="entry-card"
      data-fresh={fresh ? 'true' : undefined}
      data-selected={checked ? 'true' : undefined}
      draggable
      onDragStart={(ev) => {
        const ids = checked ? [...actions.selected] : [e.id];
        ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
        ev.dataTransfer.effectAllowed = 'move';
      }}
    >
      {/* Desktop: a checkbox on every card. Phone: shown once a long-press starts selecting. */}
      <label
        className={`${
          actions.selecting ? 'flex' : 'hidden lg:flex'
        } tap cursor-pointer items-center pl-3`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => actions.onToggle(e.id)}
          className="h-5 w-5 cursor-pointer accent-[var(--color-accent)]"
        />
        <span className="sr-only">Select {e.name}</span>
      </label>
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-xl p-2.5 text-left sm:gap-3 sm:p-3 [-webkit-touch-callout:none]"
        // While selecting, the checkbox is the accessible control; the card is a big target.
        aria-label={actions.selecting ? undefined : `Edit ${e.name}`}
        aria-hidden={actions.selecting ? true : undefined}
        tabIndex={actions.selecting ? -1 : undefined}
        data-testid="entry-open"
        onPointerDown={(ev) => {
          if (ev.pointerType !== 'touch') return;
          pressed.current = false;
          cancelPress();
          press.current = setTimeout(() => {
            pressed.current = true;
            actions.onToggle(e.id);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(ev) => {
          if (press.current || pressed.current) ev.preventDefault();
        }}
        onClick={() => {
          // The click after a long-press only ends the press.
          if (pressed.current) {
            pressed.current = false;
            return;
          }
          if (actions.selecting) actions.onToggle(e.id);
          else actions.onOpen(e);
        }}
      >
        <FoodIcon category={foodCategory(e.name)} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-semibold">
            {e.name}
            {e.brand ? <span className="font-normal text-text-secondary"> {e.brand}</span> : null}
          </span>
          <span
            className="num mt-0.5 block text-[13px] text-text-secondary sm:text-sm"
            data-testid="entry-macros"
          >
            {macroLine(e)}
            {amount ? ` · ${amount}` : ''}
          </span>
        </span>
      </button>
      {/* Desktop: hovering (or focusing) a card shows delete beside the card's own edit. */}
      <button
        type="button"
        onClick={() => actions.onDelete(e)}
        className="hidden cursor-pointer items-center px-3 text-text-secondary transition-opacity duration-200 hover:text-text focus-visible:opacity-100 lg:flex lg:opacity-0 lg:group-hover:opacity-100"
        aria-label={`Delete ${e.name}`}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
        </svg>
      </button>
    </li>
  );
}

/** The block's menu: copy it to another day, or save its foods as a meal. */
function BlockMenu({
  label,
  onCopy,
  onSave,
}: {
  label: string;
  onCopy: () => void;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function onDown(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div
      ref={root}
      // Phone: the menu hangs from the header row's right edge so it stays on screen.
      className="z-[2] sm:relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          root.current?.querySelector<HTMLElement>('button')?.focus();
        }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
          e.preventDefault();
          const items = [
            ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
          ];
          const i = items.indexOf(document.activeElement as HTMLElement);
          items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="tap flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border bg-surface transition-colors duration-200 hover:bg-surface-2"
        aria-label={`Options for the ${label} block`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <circle cx="5.5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="18.5" cy="12" r="1.7" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label={`${label} block`}
          className="absolute right-0 top-10 z-20 w-52 rounded-xl sm:left-0 sm:right-auto border border-border bg-surface p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onCopy)}
            className="tap w-full cursor-pointer rounded-lg px-3 py-2.5 text-left font-semibold transition-colors duration-200 hover:bg-surface-2 focus-visible:bg-surface-2"
          >
            Copy to another day
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onSave)}
            className="tap w-full cursor-pointer rounded-lg px-3 py-2.5 text-left font-semibold transition-colors duration-200 hover:bg-surface-2 focus-visible:bg-surface-2"
          >
            Save as meal
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Entries grouped into time blocks along a vertical rail, earliest first. */
export function Timeline({ blocks, scrollToLatest, highlight, ...actions }: Props) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const target = useRef<HTMLLIElement>(null);
  const highlightIndex = highlight
    ? blocks.findIndex((b) => b.entries.some((e) => e.log_group_id === highlight))
    : -1;
  const scrollIndex =
    highlightIndex >= 0 ? highlightIndex : scrollToLatest ? blocks.length - 1 : -1;
  const scrollKey = blocks[scrollIndex]?.wall;

  useEffect(() => {
    if (scrollKey) target.current?.scrollIntoView?.({ block: 'center' });
  }, [scrollKey]);

  return (
    <ol className="relative flex flex-col gap-6" aria-label="Time blocks" data-testid="timeline">
      {/* The rail. */}
      <span aria-hidden="true" className="absolute bottom-2 left-[1.15rem] top-2 w-px bg-border" />
      {blocks.map((b, i) => {
        const t = sumNutrients(b.entries);
        const at = b.entries[0]?.eaten_at ?? '';
        const mealNames = [
          ...new Set(b.entries.map((e) => e.meal_name).filter((n): n is string => !!n)),
        ];
        return (
          <li
            key={b.wall}
            ref={i === scrollIndex ? target : undefined}
            className={`relative rounded-xl transition-colors duration-200 ${
              dropTarget === b.wall ? 'bg-surface-2 outline-dashed outline-2 outline-accent' : ''
            }`}
            data-testid="time-block"
            onDragOver={(ev) => {
              if (!ev.dataTransfer.types.includes(DRAG_TYPE)) return;
              ev.preventDefault();
              ev.dataTransfer.dropEffect = 'move';
              setDropTarget(b.wall);
            }}
            onDragLeave={(ev) => {
              if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDropTarget(null);
            }}
            onDrop={(ev) => {
              setDropTarget(null);
              const raw = ev.dataTransfer.getData(DRAG_TYPE);
              if (!raw) return;
              ev.preventDefault();
              const ids = (JSON.parse(raw) as string[]).filter(
                (id) => !b.entries.some((x) => x.id === id),
              );
              if (ids.length > 0) actions.onDrop(ids, b);
            }}
            aria-label={`${b.label}, ${formatNumber(Math.round(t.kcal))} kcal`}
          >
            <div className="relative flex flex-wrap items-center gap-2">
              <span
                className="num relative z-[1] rounded-full bg-text px-3 py-1 text-sm font-semibold text-surface"
                data-testid="block-pill"
              >
                {b.label}
              </span>
              {mealNames.length > 0 ? (
                <span
                  className="flex min-w-0 items-center gap-1 text-sm font-semibold text-text-secondary"
                  data-testid="block-meal"
                >
                  <MealIcon width={16} height={16} />
                  <span className="truncate">{mealNames.join(', ')}</span>
                </span>
              ) : null}
              <Link
                to={`/log?at=${encodeURIComponent(at)}`}
                className="tap relative z-[1] flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border bg-surface transition-colors duration-200 hover:bg-surface-2"
                aria-label={`Add food at ${b.label}`}
              >
                <PlusIcon width={18} height={18} />
              </Link>
              <BlockMenu
                label={b.label}
                onCopy={() => actions.onCopyBlock(b)}
                onSave={() => actions.onSaveBlock(b)}
              />
              <ul className="ml-auto flex flex-wrap justify-end gap-1.5" data-testid="block-chips">
                {CHIPS.map((c) => (
                  <li
                    key={c.key}
                    className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold num"
                    style={{ boxShadow: `inset 0 -2px 0 var(--color-${c.color})` }}
                    data-testid={`chip-${c.key}`}
                  >
                    {formatNumber(Math.round(t[c.key]))}
                    {c.suffix}
                  </li>
                ))}
              </ul>
            </div>
            <ul className="mt-3 flex flex-col gap-2 pl-6 sm:pl-10">
              {b.entries.map((e) => (
                <EntryCard
                  key={e.id}
                  e={e}
                  fresh={highlight !== null && e.log_group_id === highlight}
                  actions={actions}
                />
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
