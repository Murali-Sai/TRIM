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
  /** The Progress dashboard's Today card: eaten against target only, with no controls. */
  compact?: boolean;
  /** Off when the user does not track fiber. */
  showFiber?: boolean;
}

const SHORT: Record<string, string> = {
  kcal: 'kcal',
  protein_g: 'Protein',
  fat_g: 'Fat',
  carbs_g: 'Carbs',
};

// Text-safe nutrient shades, written out so Tailwind keeps the classes.
const TEXT: Record<string, string> = {
  kcal: 'text-kcal-text',
  protein: 'text-protein-text',
  fat: 'text-fat-text',
  carbs: 'text-carbs-text',
};

function Bar({ fill, color, tall }: { fill: number; color: string; tall?: boolean }) {
  const h = tall ? 'h-2' : 'h-1';
  return (
    <div className={`${h} mt-1.5 rounded-full bg-surface-2`} aria-hidden="true">
      <div
        className={`${h} rounded-full`}
        style={{ width: `${fill * 100}%`, background: `var(--color-${color})` }}
      />
    </div>
  );
}

/** "+42 over" in the nutrient's text-safe shade (no red, no alarm), else the percent. */
function Status({ c }: { c: StripColumn }) {
  if (c.over > 0) {
    return (
      <span className={`num text-xs font-semibold ${TEXT[c.color] ?? ''}`}>
        +{formatNumber(c.over)} over
      </span>
    );
  }
  return c.pct !== null ? <span className="num text-xs text-text-secondary">{c.pct}%</span> : null;
}

/** Calories on one line, then protein, fat and carbs beneath, each with a thin bar. */
function Eaten({ cols, id, large }: { cols: StripColumn[]; id: string; large?: boolean }) {
  const [kcal, ...macros] = cols;
  if (!kcal) return null;
  return (
    <div>
      <div data-testid={`${id}kcal`}>
        <div className="flex items-baseline gap-2">
          <span className="eyebrow">{SHORT.kcal}</span>
          <span className="ml-auto">
            <Status c={kcal} />
          </span>
        </div>
        <p className="mt-0.5 leading-none">
          <span className={`num font-semibold ${large ? 'text-4xl' : 'text-3xl'}`}>
            {formatNumber(kcal.eaten)}
          </span>
          <span className="num text-sm text-text-secondary"> / {formatNumber(kcal.target)}</span>
        </p>
        <Bar fill={kcal.fill} color={kcal.color} tall />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {macros.map((c) => (
          <div key={c.key} className="min-w-0" data-testid={`${id}${c.key}`}>
            <p className="flex items-baseline gap-1">
              <span className="eyebrow truncate">{SHORT[c.key]}</span>
              <span className="ml-auto">
                <Status c={c} />
              </span>
            </p>
            <p className="mt-0.5 leading-tight">
              <span className="num text-lg font-semibold">{formatNumber(c.eaten)}</span>
              <span className="num text-xs text-text-secondary"> / {formatNumber(c.target)}</span>
            </p>
            <Bar fill={c.fill} color={c.color} tall={large === true} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Phone and tablet: calories and macros eaten against target, with a second page (swipe or
 * the dots) for what is left plus fiber, sugar and sodium. Desktop: both, stacked, with
 * larger figures and bars.
 */
export function TargetStrip({ totals, target, compact = false, showFiber = true }: Props) {
  const cols = stripColumns(totals, target);
  const left = remainingColumns(totals, target);
  const [page, setPage] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  // Foods with no fiber data are counted, so a low total is not mistaken for a low day.
  const unknownFiber = totals.unknown.fiber_g;
  const extras = [
    ...(showFiber
      ? [
          {
            key: 'fiber',
            label: 'Fiber',
            value:
              target.fiber_g !== null
                ? `${formatNumber(Math.round(totals.fiber_g))} / ${formatNumber(target.fiber_g)} g`
                : `${formatNumber(Math.round(totals.fiber_g))} g`,
            note:
              unknownFiber > 0
                ? `fiber unknown for ${unknownFiber} ${unknownFiber === 1 ? 'food' : 'foods'}`
                : null,
          },
        ]
      : []),
    {
      key: 'sugar',
      label: 'Sugar',
      value: `${formatNumber(Math.round(totals.sugar_g))} g`,
      note: null,
    },
    {
      key: 'sodium',
      label: 'Sodium',
      value: `${formatNumber(Math.round(totals.sodium_mg))} mg`,
      note: null,
    },
  ];

  function go(to: number) {
    const el = scroller.current;
    if (el) el.scrollTo({ left: to * el.clientWidth, behavior: 'smooth' });
    setPage(to);
  }

  const remainingPage = (id: string) => (
    <div className="text-sm">
      <p className="eyebrow">Left</p>
      <div className="mt-1 grid grid-cols-4 gap-3">
        {left.map((c) => (
          <p key={c.key} className="min-w-0" data-testid={`${id}left-${c.key}`}>
            <span className="sr-only">{c.label} left: </span>
            <span className="block truncate text-text-secondary" aria-hidden="true">
              {c.label}
            </span>
            <span className={`num font-semibold ${c.over > 0 ? (TEXT[c.color] ?? '') : ''}`}>
              {c.over > 0 ? `${formatNumber(c.over)} over` : formatNumber(c.left)}
            </span>
          </p>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3">
        {extras.map((x) => (
          <p key={x.key} className="min-w-0" data-testid={`${id}extra-${x.key}`}>
            <span className="block truncate text-text-secondary">{x.label}</span>
            <span className="num font-semibold">{x.value}</span>
            {x.note ? (
              <span className="block text-xs text-text-secondary" data-testid="fiber-unknown">
                {x.note}
              </span>
            ) : null}
          </p>
        ))}
      </div>
    </div>
  );

  if (compact) {
    const [kcal, ...macros] = cols;
    // Narrow cards: calories, then one row per macro so labels never squeeze.
    return (
      <div data-testid="target-strip-compact">
        {kcal ? <Eaten cols={[kcal]} id="dash-" /> : null}
        <ul className="mt-3 flex flex-col gap-2">
          {macros.map((c) => (
            <li key={c.key} data-testid={`dash-${c.key}`}>
              <p className="flex items-baseline gap-2 text-sm">
                <span className={`font-semibold ${TEXT[c.color] ?? ''}`}>{SHORT[c.key]}</span>
                <span className="num">
                  {formatNumber(c.eaten)}
                  <span className="text-text-secondary"> / {formatNumber(c.target)} g</span>
                </span>
                <span className="ml-auto">
                  <Status c={c} />
                </span>
              </p>
              <Bar fill={c.fill} color={c.color} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section
      aria-label="Targets for this day"
      className="rounded-xl border border-border bg-surface p-3 lg:p-4"
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
          <div className="w-full shrink-0 snap-start" data-testid="strip-page-1">
            <Eaten cols={cols} id="strip-" />
          </div>
          <div className="w-full shrink-0 snap-start" data-testid="strip-page-2">
            {remainingPage('')}
          </div>
        </div>
        <div className="mt-2 flex justify-center gap-1">
          {[0, 1].map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-pressed={page === i}
              className="flex h-6 w-6 cursor-pointer items-center justify-center"
              aria-label={i === 0 ? 'Eaten and targets' : 'What is left'}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  page === i ? 'w-4 bg-text' : 'w-1.5 bg-border'
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Desktop: eaten, then what is left. */}
      <div className="hidden lg:block">
        <Eaten cols={cols} id="strip-desktop-" large />
        <div className="mt-5 border-t border-border pt-4">{remainingPage('desktop-')}</div>
      </div>
    </section>
  );
}
