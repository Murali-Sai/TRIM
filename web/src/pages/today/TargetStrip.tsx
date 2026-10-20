import { useRef, useState } from 'react';
import {
  remainingColumns,
  stripColumns,
  type DayTotals,
  type MacroTotals,
  type StripColumn,
} from '../../lib/dayTotals';
import { formatNumber } from '../../lib/units';

interface Props {
  totals: DayTotals;
  target: MacroTotals & { fiber_g: number | null };
}

function Bar({ fill, color, tall }: { fill: number; color: string; tall?: boolean }) {
  return (
    <div
      className={`${tall ? 'h-2.5' : 'h-1.5'} mt-1 rounded-full bg-surface-2`}
      aria-hidden="true"
    >
      <div
        className={`${tall ? 'h-2.5' : 'h-1.5'} rounded-full`}
        style={{ width: `${fill * 100}%`, background: `var(--color-${color})` }}
      />
    </div>
  );
}

function Eaten({ c }: { c: StripColumn }) {
  return (
    <>
      <span className="font-semibold tabular-nums">{formatNumber(c.eaten)}</span>
      <span className="text-text-secondary tabular-nums"> / {formatNumber(c.target)}</span>
      {c.over > 0 ? (
        // Over target: said plainly in the nutrient's own color, no red alarm.
        <span
          className="block text-xs font-semibold opacity-70"
          style={{ color: `var(--color-${c.color})` }}
        >
          +{formatNumber(c.over)} over
        </span>
      ) : null}
    </>
  );
}

/**
 * Phone and tablet: four columns of eaten / target with thin bars, and a second page (swipe or
 * the dots) with what is left plus fiber, sugar and sodium. Desktop: the same, stacked
 * vertically with larger bars.
 */
export function TargetStrip({ totals, target }: Props) {
  const cols = stripColumns(totals, target);
  const left = remainingColumns(totals, target);
  const [page, setPage] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  const extras = [
    {
      key: 'fiber',
      label: 'Fiber',
      value:
        target.fiber_g !== null
          ? `${formatNumber(Math.round(totals.fiber_g))} / ${formatNumber(target.fiber_g)} g`
          : `${formatNumber(Math.round(totals.fiber_g))} g`,
    },
    { key: 'sugar', label: 'Sugar', value: `${formatNumber(Math.round(totals.sugar_g))} g` },
    {
      key: 'sodium',
      label: 'Sodium',
      value: `${formatNumber(Math.round(totals.sodium_mg))} mg`,
    },
  ];

  function go(to: number) {
    const el = scroller.current;
    if (el) el.scrollTo({ left: to * el.clientWidth, behavior: 'smooth' });
    setPage(to);
  }

  const remainingPage = (id: string) => (
    <div className="text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Left</p>
      <div className="mt-1 grid grid-cols-4 gap-3">
        {left.map((c) => (
          <p key={c.key} className="min-w-0" data-testid={`${id}left-${c.key}`}>
            <span className="sr-only">{c.label} left: </span>
            <span className="block truncate text-text-secondary" aria-hidden="true">
              {c.label}
            </span>
            <span className="font-semibold tabular-nums">
              {c.over > 0 ? `${formatNumber(c.over)} over` : formatNumber(c.left)}
            </span>
          </p>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-3">
        {extras.map((x) => (
          <p key={x.key} className="min-w-0" data-testid={`${id}extra-${x.key}`}>
            <span className="block truncate text-text-secondary">{x.label}</span>
            <span className="font-semibold tabular-nums">{x.value}</span>
          </p>
        ))}
      </div>
    </div>
  );

  return (
    <section
      aria-label="Targets for this day"
      className="rounded-xl border border-border bg-surface p-4"
      data-testid="target-strip"
    >
      {/* Phone and tablet: two swipeable pages. */}
      <div className="lg:hidden">
        <div
          ref={scroller}
          className="relative flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(e) => {
            const el = e.currentTarget;
            setPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
        >
          <div
            className="grid w-full shrink-0 snap-start grid-cols-4 gap-3"
            data-testid="strip-page-1"
          >
            {cols.map((c) => (
              <div key={c.key} className="min-w-0 text-sm" data-testid={`strip-${c.key}`}>
                <p className="truncate text-text-secondary">{c.label}</p>
                <p className="font-semibold leading-tight tabular-nums">{formatNumber(c.eaten)}</p>
                <p className="text-xs text-text-secondary tabular-nums">
                  / {formatNumber(c.target)}
                </p>
                <Bar fill={c.fill} color={c.color} />
                <p className="mt-0.5 text-xs tabular-nums">
                  {c.over > 0 ? (
                    <span
                      className="font-semibold opacity-70"
                      style={{ color: `var(--color-${c.color})` }}
                    >
                      +{formatNumber(c.over)} over
                    </span>
                  ) : c.pct !== null ? (
                    <span className="text-text-secondary">{c.pct}%</span>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
          <div className="w-full shrink-0 snap-start" data-testid="strip-page-2">
            {remainingPage('')}
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-2">
          {[0, 1].map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-pressed={page === i}
              className="flex h-6 w-6 items-center justify-center"
              aria-label={i === 0 ? 'Eaten and targets' : 'What is left'}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${page === i ? 'bg-text' : 'bg-border'}`}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Desktop: the strip runs vertically with larger bars, then what is left. */}
      <div className="hidden lg:block">
        <ul className="flex flex-col gap-4">
          {cols.map((c) => (
            <li key={c.key} data-testid={`strip-desktop-${c.key}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{c.label}</span>
                <span className="text-right">
                  <Eaten c={c} />
                  {c.pct !== null ? (
                    <span className="ml-2 text-sm text-text-secondary">{c.pct}%</span>
                  ) : null}
                </span>
              </div>
              <Bar fill={c.fill} color={c.color} tall />
            </li>
          ))}
        </ul>
        <div className="mt-5 border-t border-border pt-4">{remainingPage('desktop-')}</div>
      </div>
    </section>
  );
}
