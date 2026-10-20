import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import type { LogEntry } from '../../api/logs';
import { PlusIcon } from '../../components/icons';
import { amountLabel, sumNutrients } from '../../lib/dayTotals';
import { macroLine } from '../../lib/foodAmount';
import { foodCategory } from '../../lib/foodCategory';
import type { TimeBlock } from '../../lib/logTime';
import { formatNumber } from '../../lib/units';
import { FoodIcon } from './FoodIcon';

interface Props {
  blocks: TimeBlock<LogEntry>[];
  /** Scroll to the latest block (today), or to the block holding `highlight`. */
  scrollToLatest: boolean;
  /** A log_group_id whose cards were just added, briefly highlighted. */
  highlight: string | null;
}

const CHIPS = [
  { key: 'kcal', suffix: ' kcal', color: 'kcal' },
  { key: 'protein_g', suffix: ' P', color: 'protein' },
  { key: 'fat_g', suffix: ' F', color: 'fat' },
  { key: 'carbs_g', suffix: ' C', color: 'carbs' },
] as const;

function EntryCard({ e, fresh }: { e: LogEntry; fresh: boolean }) {
  const amount = amountLabel(e);
  return (
    <li
      className={`flex items-start gap-3 rounded-xl border bg-surface p-3 transition-colors duration-1000 ${
        fresh ? 'border-accent bg-surface-2' : 'border-border'
      }`}
      data-testid="entry-card"
      data-fresh={fresh ? 'true' : undefined}
    >
      <FoodIcon category={foodCategory(e.name)} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-semibold">
          {e.name}
          {e.brand ? <span className="font-normal text-text-secondary"> {e.brand}</span> : null}
        </p>
        <p className="mt-0.5 text-sm text-text-secondary tabular-nums" data-testid="entry-macros">
          {macroLine(e)}
          {amount ? ` · ${amount}` : ''}
        </p>
      </div>
    </li>
  );
}

/** Entries grouped into time blocks along a vertical rail, earliest first. */
export function Timeline({ blocks, scrollToLatest, highlight }: Props) {
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
        return (
          <li
            key={b.wall}
            ref={i === scrollIndex ? target : undefined}
            className="relative"
            data-testid="time-block"
            aria-label={`${b.label}, ${formatNumber(Math.round(t.kcal))} kcal`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="relative z-[1] rounded-full bg-text px-3 py-1 text-sm font-semibold text-surface"
                data-testid="block-pill"
              >
                {b.label}
              </span>
              <Link
                to={`/log?at=${encodeURIComponent(at)}`}
                className="tap relative z-[1] flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface"
                aria-label={`Add food at ${b.label}`}
              >
                <PlusIcon width={18} height={18} />
              </Link>
              <ul className="ml-auto flex flex-wrap justify-end gap-1.5" data-testid="block-chips">
                {CHIPS.map((c) => (
                  <li
                    key={c.key}
                    className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums"
                    style={{ boxShadow: `inset 0 -2px 0 var(--color-${c.color})` }}
                    data-testid={`chip-${c.key}`}
                  >
                    {formatNumber(Math.round(t[c.key]))}
                    {c.suffix}
                  </li>
                ))}
              </ul>
            </div>
            <ul className="mt-3 flex flex-col gap-2 pl-10">
              {b.entries.map((e) => (
                <EntryCard
                  key={e.id}
                  e={e}
                  fresh={highlight !== null && e.log_group_id === highlight}
                />
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
