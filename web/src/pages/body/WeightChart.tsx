import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { UnitSystem } from '../../api/auth';
import { kgToLb } from '../../lib/tdee';
import type { TrendPoint } from '../../lib/trend';
import { formatNumber } from '../../lib/units';
import {
  buildChartData,
  DEFAULT_RANGE,
  RANGES,
  rangeWindow,
  type ChartData,
  type RangeKey,
} from '../../lib/weightChart';
import { formatDay, formatTime } from '../../lib/zoned';
import { secondaryButton } from '../account/Section';
import { displayWeight, unitLabel } from './weightFormat';

interface Props {
  points: readonly TrendPoint[];
  units: UnitSystem;
  timeZone: string;
  goalKg: number | null;
  /** The headline sentence, reused in the chart's aria-label. */
  headline: string;
}

const RANGE_KEY = 'trim.chart.weight.range';
const NOTE_KEY = 'trim.chart.weight.note-dismissed';
const RANGE_LABELS: Record<RangeKey, string> = {
  '1W': 'last week',
  '1M': 'last month',
  '3M': 'last 3 months',
  '6M': 'last 6 months',
  '1Y': 'last year',
  All: 'all time',
};

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A convenience only; the chart works without it.
  }
}

function storedRange(): RangeKey {
  const value = readStored(RANGE_KEY);
  return RANGES.includes(value as RangeKey) ? (value as RangeKey) : DEFAULT_RANGE;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Bumps when the theme changes, so the canvas redraws with the new colors. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', bump);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    return () => {
      media.removeEventListener('change', bump);
      observer.disconnect();
    };
  }, []);
  return version;
}

function tooltipText(p: TrendPoint, units: UnitSystem, timeZone: string): string {
  const when = `${formatDay(p.at, timeZone)}, ${formatTime(p.at, timeZone)}`;
  const value = displayWeight(p.value, units);
  if (p.outlier) {
    return `${when}: ${value}, not counted in your trend (a big jump from the days around it)`;
  }
  if (!p.counted) return `${when}: ${value}, not counted: only the first weigh-in of a day counts`;
  return `${when}: ${value}, trend ${displayWeight(p.trend ?? p.value, units)}`;
}

/** Index of the nearest real weigh-in to `idx` (skipping the break markers). */
function nearestPoint(data: ChartData, idx: number | null | undefined): number | null {
  if (idx == null) return null;
  for (let d = 0; d < data.xs.length; d++) {
    if (data.source[idx - d]) return idx - d;
    if (data.source[idx + d]) return idx + d;
  }
  return null;
}

/** The x window a range chip asks for; All fits the data up to now. */
function expectedWindow(range: RangeKey, data: ChartData): [number, number] {
  const now = Date.now() / 1000;
  return rangeWindow(range, now) ?? [data.xs[0] ?? now, Math.max(now, data.xs.at(-1) ?? now)];
}

export function WeightChart({ points, units, timeZone, goalKg, headline }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const [range, setRange] = useState<RangeKey>(storedRange);
  const [zoomed, setZoomed] = useState(false);
  const [table, setTable] = useState(false);
  const [noteOpen, setNoteOpen] = useState(() => readStored(NOTE_KEY) !== 'yes');
  const themeVersion = useThemeVersion();

  const convert = useMemo(() => (units === 'imperial' ? kgToLb : (kg: number) => kg), [units]);
  const { data, buildMs } = useMemo(() => {
    const t0 = performance.now();
    const built = buildChartData(points, convert);
    return { data: built, buildMs: performance.now() - t0 };
  }, [points, convert]);
  const goal = goalKg === null ? null : convert(goalKg);
  const unit = unitLabel(units);

  useEffect(() => {
    const el = box.current;
    if (!el || data.xs.length === 0) return;
    const started = performance.now();
    const weight = cssVar('--color-weight');
    const text = cssVar('--color-text');
    const muted = cssVar('--color-text-secondary');
    const grid = cssVar('--color-border');
    const surface = cssVar('--color-surface');
    const font = `13px ${getComputedStyle(document.body).fontFamily}`;

    const fmt = (v: number) => formatNumber(v, 1);

    function drawLabels(u: uPlot) {
      const { ctx } = u;
      const { left, top, width, height } = u.bbox;
      const dpr = uPlot.pxRatio;
      ctx.save();
      ctx.font = font.replace(/^(\d+)px/, (_, n: string) => `${Number(n) * dpr}px`);
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'right';
      // Direct labels on a surface-colored backing, so dots never hide them.
      const label = (value: string, y: number, color: string) => {
        const x = left + width - 4 * dpr;
        const w = ctx.measureText(value).width;
        ctx.fillStyle = surface;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x - w - 3 * dpr, y - 16 * dpr, w + 6 * dpr, 17 * dpr);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillText(value, x, y);
      };
      let goalY: number | null = null;
      if (goal !== null) {
        goalY = u.valToPos(goal, 'y', true);
        if (goalY >= top && goalY <= top + height) {
          ctx.strokeStyle = muted;
          ctx.lineWidth = 1.5 * dpr;
          ctx.setLineDash([6 * dpr, 5 * dpr]);
          ctx.beginPath();
          ctx.moveTo(left, goalY);
          ctx.lineTo(left + width, goalY);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          goalY = null;
        }
      }
      // Latest trend value in view, labeled at the line's end.
      const [xMin, xMax] = [u.scales.x?.min ?? 0, u.scales.x?.max ?? 0];
      let last = -1;
      for (let i = data.xs.length - 1; i >= 0; i--) {
        const x = data.xs[i] ?? 0;
        if (typeof data.trend[i] === 'number' && x >= xMin && x <= xMax) {
          last = i;
          break;
        }
      }
      let trendY: number | null = null;
      if (last >= 0) {
        const value = data.trend[last] as number;
        trendY = u.valToPos(value, 'y', true) - 8 * dpr;
        label(`Trend ${fmt(value)}`, trendY, text);
      }
      if (goal !== null && goalY !== null) {
        let y = goalY - 4 * dpr;
        if (trendY !== null && Math.abs(trendY - y) < 18 * dpr) y = goalY + 18 * dpr;
        label(`Goal ${fmt(goal)}`, y, muted);
      }
      ctx.restore();
    }

    function showTip(u: uPlot) {
      const t = tip.current;
      if (!t) return;
      const i = nearestPoint(data, u.cursor.idx);
      const p = i === null ? null : data.source[i];
      if (i === null || !p || u.cursor.left == null || u.cursor.left < 0) {
        t.hidden = true;
        return;
      }
      t.textContent = tooltipText(p, units, timeZone);
      t.hidden = false;
      const x = u.valToPos(data.xs[i] ?? 0, 'x');
      const half = t.offsetWidth / 2;
      const maxLeft = u.over.clientWidth - t.offsetWidth;
      t.style.left = `${Math.max(0, Math.min(maxLeft, x - half)) + u.over.offsetLeft}px`;
    }

    function applyRange(u: uPlot) {
      const [min, max] = expectedWindow(range, data);
      u.setScale('x', { min, max });
    }

    const options: uPlot.Options = {
      width: el.clientWidth,
      height: el.clientWidth < 640 ? 240 : 320,
      legend: { show: false },
      cursor: {
        drag: { x: true, y: false, setScale: true },
        points: { show: false },
        y: false,
      },
      scales: {
        x: { time: true },
        y: {
          range: (_u, min, max) => {
            const lo = Math.min(min, goal ?? min);
            const hi = Math.max(max, goal ?? max);
            const pad = Math.max((hi - lo) * 0.08, units === 'imperial' ? 1 : 0.5);
            return [lo - pad, hi + pad];
          },
        },
      },
      axes: [
        {
          stroke: muted,
          font,
          grid: { show: false },
          ticks: { stroke: grid, width: 1 },
        },
        {
          stroke: muted,
          font,
          size: 56,
          label: unit,
          labelFont: font,
          labelSize: 18,
          values: (_u, vals) => vals.map((v) => fmt(v)),
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
        },
      ],
      series: [
        {},
        {
          label: 'Weigh-ins',
          paths: () => null,
          points: { show: true, size: 8, width: 0, fill: `${weight}55`, stroke: `${weight}55` },
        },
        {
          label: 'Not counted',
          paths: () => null,
          points: { show: true, size: 9, width: 1.5, fill: surface, stroke: weight },
        },
        { label: 'Trend', stroke: weight, width: 2.5, points: { show: false } },
        {
          label: 'Gap',
          stroke: weight,
          width: 2,
          dash: [5, 6],
          spanGaps: true,
          points: { show: false },
        },
        { label: 'Swing high', stroke: 'transparent', points: { show: false } },
        { label: 'Swing low', stroke: 'transparent', points: { show: false } },
      ],
      bands: [{ series: [5, 6], fill: `${weight}38` }],
      hooks: {
        draw: [
          drawLabels,
          () => {
            // Time to first paint (uPlot draws in a microtask after construction).
            el.dataset.renderMs ??= String(Math.round(buildMs + performance.now() - started));
          },
        ],
        setCursor: [showTip],
        setScale: [
          (u, key) => {
            if (key !== 'x') return;
            const [min, max] = expectedWindow(range, data);
            const off = (a: number | undefined, b: number) => Math.abs((a ?? b) - b) > 60;
            setZoomed(off(u.scales.x?.min, min) || off(u.scales.x?.max, max));
          },
        ],
      },
    };

    const u = new uPlot(
      options,
      [
        data.xs,
        data.readings,
        data.outliers,
        data.trend,
        data.gapTrend,
        data.bandHi,
        data.bandLo,
      ] as uPlot.AlignedData,
      el,
    );
    plot.current = u;
    applyRange(u);

    // Wheel zoom around the pointer.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const min = u.scales.x?.min ?? 0;
      const max = u.scales.x?.max ?? 0;
      const at = u.posToVal(e.offsetX, 'x');
      const factor = e.deltaY < 0 ? 0.8 : 1.25;
      u.setScale('x', { min: at - (at - min) * factor, max: at + (max - at) * factor });
    };
    // Tap shows the tooltip; two fingers pinch-zoom.
    const touches = new Map<number, number>();
    let pinch: { dist: number; min: number; max: number; mid: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, e.offsetX);
      if (touches.size === 2) {
        const [a, b] = [...touches.values()] as [number, number];
        pinch = {
          dist: Math.max(Math.abs(a - b), 10),
          min: u.scales.x?.min ?? 0,
          max: u.scales.x?.max ?? 0,
          mid: u.posToVal((a + b) / 2, 'x'),
        };
      } else {
        u.setCursor({ left: e.offsetX, top: e.offsetY });
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, e.offsetX);
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()] as [number, number];
        const scale = pinch.dist / Math.max(Math.abs(a - b), 10);
        u.setScale('x', {
          min: pinch.mid - (pinch.mid - pinch.min) * scale,
          max: pinch.mid + (pinch.max - pinch.mid) * scale,
        });
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
    };
    u.over.addEventListener('wheel', onWheel, { passive: false });
    u.over.addEventListener('pointerdown', onPointerDown);
    u.over.addEventListener('pointermove', onPointerMove);
    u.over.addEventListener('pointerup', onPointerUp);
    u.over.addEventListener('pointercancel', onPointerUp);
    u.over.style.touchAction = 'pan-y';

    const resize = new ResizeObserver(() => {
      if (el.clientWidth && el.clientWidth !== u.width) {
        u.setSize({ width: el.clientWidth, height: el.clientWidth < 640 ? 240 : 320 });
      }
    });
    resize.observe(el);

    return () => {
      resize.disconnect();
      u.destroy();
      plot.current = null;
    };
  }, [data, buildMs, goal, range, units, unit, timeZone, themeVersion]);

  const shown = rangeWindow(range, Date.now() / 1000);
  const visible = points.filter((p) => {
    const x = Date.parse(p.at) / 1000;
    return !shown || (x >= shown[0] && x <= shown[1]);
  });
  const label =
    `Weight chart, ${RANGE_LABELS[range]}. ${headline}. ` +
    `${visible.length} weigh-in${visible.length === 1 ? '' : 's'} shown.` +
    (goal === null ? '' : ` Goal ${displayWeight(goalKg ?? 0, units)}.`);

  if (points.length === 0) return null;
  return (
    <div>
      {noteOpen ? (
        <div
          className="mb-3 flex items-start gap-3 rounded-lg bg-surface-2 p-3 text-sm"
          role="note"
        >
          <p className="flex-1">
            Your weight swings day to day with water and food. The line shows the real direction.
          </p>
          <button
            type="button"
            className="tap -m-2 rounded-lg px-3 py-2 font-semibold"
            onClick={() => {
              setNoteOpen(false);
              writeStored(NOTE_KEY, 'yes');
            }}
          >
            Got it
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Time range" className="flex flex-wrap gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              aria-label={RANGE_LABELS[r]}
              className={`tap min-w-11 rounded-lg px-2 py-2 text-sm font-semibold ${
                range === r ? 'bg-accent text-accent-contrast' : 'bg-surface-2'
              }`}
              onClick={() => {
                setRange(r);
                writeStored(RANGE_KEY, r);
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {!noteOpen ? (
            <button
              type="button"
              className="tap rounded-lg px-3 py-2 text-sm font-semibold"
              aria-label="What the trend line means"
              onClick={() => setNoteOpen(true)}
            >
              <span aria-hidden="true">ⓘ</span>
            </button>
          ) : null}
          {zoomed ? (
            <button
              type="button"
              className={`${secondaryButton} text-sm`}
              onClick={() => {
                const [min, max] = expectedWindow(range, data);
                plot.current?.setScale('x', { min, max });
              }}
            >
              Reset zoom
            </button>
          ) : null}
          <button
            type="button"
            className={`${secondaryButton} text-sm`}
            aria-pressed={table}
            onClick={() => setTable((t) => !t)}
          >
            {table ? 'View as chart' : 'View as table'}
          </button>
        </div>
      </div>
      <div className={table ? 'hidden' : 'relative mt-3'}>
        <div ref={box} role="img" aria-label={label} data-testid="weight-chart" />
        <div
          ref={tip}
          hidden
          aria-hidden="true"
          data-testid="weight-tooltip"
          className="pointer-events-none absolute top-0 z-10 max-w-[90%] rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow"
        />
        <p className="mt-2 text-xs text-text-secondary">
          Dots are weigh-ins, the line is your trend and the shaded area is your typical daily
          swing.{goal === null ? '' : ' The dashed line is your goal.'} Hollow dots are not counted.
        </p>
      </div>
      {table ? (
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Time</th>
                <th className="py-2 pr-2">Weight ({unit})</th>
                <th className="py-2 pr-2">Trend ({unit})</th>
                <th className="py-2">Excluded as outlier</th>
              </tr>
            </thead>
            <tbody>
              {[...visible].reverse().map((p) => (
                <tr key={p.at} className="border-b border-border">
                  <td className="py-2 pr-2">{formatDay(p.at, timeZone)}</td>
                  <td className="py-2 pr-2">{formatTime(p.at, timeZone)}</td>
                  <td className="py-2 pr-2">{formatNumber(convert(p.value), 1)}</td>
                  <td className="py-2 pr-2">
                    {p.trend === null ? '' : formatNumber(convert(p.trend), 1)}
                  </td>
                  <td className="py-2">{p.outlier ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
