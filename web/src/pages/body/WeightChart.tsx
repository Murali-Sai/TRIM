import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { UnitSystem } from '../../api/auth';
import { ChartFrame, ChartHost, ChartTooltip } from '../../components/chart/ChartFrame';
import { useThemeVersion } from '../../components/chart/useThemeVersion';
import { canvasFont, cssVar, drawDirectLabel, placeTooltip } from '../../lib/chart/canvas';
import { nearestIndex } from '../../lib/chart/nearest';
import { rangeLabel } from '../../lib/chart/headlines';
import { readStored, writeStored } from '../../lib/chart/storage';
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
  /** When the goal-date projection is shown: its local date (YYYY-MM-DD). */
  projectionDate: string | null;
}

const RANGE_KEY = 'trim.chart.weight.range';
/** Share of a fixed range added after today for the projection line. */
const PROJECTION_ROOM = 0.35;
const NOTE_KEY = 'trim.chart.weight.note-dismissed';
function storedRange(): RangeKey {
  const value = readStored(RANGE_KEY);
  return RANGES.includes(value as RangeKey) ? (value as RangeKey) : DEFAULT_RANGE;
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

/** The x window a range chip asks for; All fits the data up to now. */
function expectedWindow(
  range: RangeKey,
  data: ChartData,
  projectionEnd: number | null,
): [number, number] {
  const now = Date.now() / 1000;
  const fixed = rangeWindow(range, now);
  if (!fixed)
    return [data.xs[0] ?? now, Math.max(now, data.xs.at(-1) ?? now, projectionEnd ?? now)];
  // Leave room on the right for the projection line, without squeezing the data.
  if (projectionEnd === null) return fixed;
  const room = (fixed[1] - fixed[0]) * PROJECTION_ROOM;
  return [fixed[0], Math.min(projectionEnd, now + room)];
}

export function WeightChart({ points, units, timeZone, goalKg, headline, projectionDate }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const [range, setRange] = useState<RangeKey>(storedRange);
  const [zoomed, setZoomed] = useState(false);
  const [noteOpen, setNoteOpen] = useState(() => readStored(NOTE_KEY) !== 'yes');
  const themeVersion = useThemeVersion();

  const convert = useMemo(() => (units === 'imperial' ? kgToLb : (kg: number) => kg), [units]);
  const { data, buildMs } = useMemo(() => {
    const t0 = performance.now();
    const built = buildChartData(points, convert);
    return { data: built, buildMs: performance.now() - t0 };
  }, [points, convert]);
  const goal = goalKg === null ? null : convert(goalKg);
  // Noon on the projected day, so the line ends mid-day like a weigh-in.
  const projectionEnd = projectionDate ? Date.parse(`${projectionDate}T12:00:00Z`) / 1000 : null;
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
    const font = canvasFont(13 / uPlot.pxRatio);

    const fmt = (v: number) => formatNumber(v, 1);

    function drawLabels(u: uPlot) {
      const { ctx } = u;
      const { left, top, width, height } = u.bbox;
      const dpr = uPlot.pxRatio;
      ctx.save();
      const label = (value: string, y: number, color: string, endX?: number) =>
        drawDirectLabel(u, value, y, color, endX);
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
        label(`Trend ${fmt(value)}`, trendY, text, u.valToPos(data.xs[last] ?? 0, 'x', true));
      }
      // Projection: a dotted line from today's trend to the goal on the projected date,
      // clipped to the plot so it points the way even when the date is off to the right.
      const latestTrend = [...data.trend].reverse().find((v) => typeof v === 'number');
      if (goal !== null && projectionEnd !== null && typeof latestTrend === 'number') {
        const x0 = u.valToPos(Date.now() / 1000, 'x', true);
        const y0 = u.valToPos(latestTrend, 'y', true);
        const x1 = u.valToPos(projectionEnd, 'x', true);
        const y1 = u.valToPos(goal, 'y', true);
        if (x0 < left + width) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(left, top, width, height);
          ctx.clip();
          ctx.strokeStyle = weight;
          ctx.lineWidth = 2 * dpr;
          ctx.setLineDash([2 * dpr, 4 * dpr]);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          ctx.restore();
          // Label where the visible part of the line ends.
          const xEnd = Math.min(x1, left + width);
          const yEnd = x1 === x0 ? y1 : y0 + ((y1 - y0) * (xEnd - x0)) / (x1 - x0);
          const below = y1 > y0 ? 18 * dpr : -6 * dpr;
          let yLabel = yEnd + below;
          if (trendY !== null && Math.abs(trendY - yLabel) < 18 * dpr) yLabel += 18 * dpr;
          label('projection', yLabel, muted);
        }
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
      // The nearest real weigh-in, skipping the break markers.
      const i = nearestIndex(data.xs.length, u.cursor.idx, (j) => data.source[j] != null);
      const p = i === null ? null : data.source[i];
      const off = u.cursor.left == null || u.cursor.left < 0;
      const text = i === null || !p || off ? null : tooltipText(p, units, timeZone);
      placeTooltip(u, t, text, i === null ? 0 : u.valToPos(data.xs[i] ?? 0, 'x'));
    }

    function applyRange(u: uPlot) {
      const [min, max] = expectedWindow(range, data, projectionEnd);
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
            const [min, max] = expectedWindow(range, data, projectionEnd);
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
  }, [data, buildMs, goal, projectionEnd, range, units, unit, timeZone, themeVersion]);

  const shown = rangeWindow(range, Date.now() / 1000);
  const visible = points.filter((p) => {
    const x = Date.parse(p.at) / 1000;
    return !shown || (x >= shown[0] && x <= shown[1]);
  });
  const label =
    `Weight chart, ${rangeLabel(range)}. ${headline}. ` +
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
      <ChartFrame
        range={{
          value: range,
          options: RANGES,
          onChange: (r) => {
            setRange(r);
            writeStored(RANGE_KEY, r);
          },
        }}
        controls={
          <>
            {!noteOpen ? (
              <button
                type="button"
                className="tap cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold"
                aria-label="What the trend line means"
                onClick={() => setNoteOpen(true)}
              >
                <span aria-hidden="true">ⓘ</span>
              </button>
            ) : null}
            {zoomed ? (
              <button
                type="button"
                className={`${secondaryButton} cursor-pointer text-sm`}
                onClick={() => {
                  const [min, max] = expectedWindow(range, data, projectionEnd);
                  plot.current?.setScale('x', { min, max });
                }}
              >
                Reset zoom
              </button>
            ) : null}
          </>
        }
        note={
          <>
            Dots are weigh-ins, the line is your trend and the shaded area is your typical daily
            swing.{goal === null ? '' : ' The dashed line is your goal.'} Hollow dots are not
            counted.
          </>
        }
        table={{
          caption: label,
          columns: ['Date', 'Time', `Weight (${unit})`, `Trend (${unit})`, 'Excluded as outlier'],
          numeric: [2, 3],
          rows: [...visible]
            .reverse()
            .map((p) => [
              formatDay(p.at, timeZone),
              formatTime(p.at, timeZone),
              formatNumber(convert(p.value), 1),
              p.trend === null ? '' : formatNumber(convert(p.trend), 1),
              p.outlier ? 'Yes' : 'No',
            ]),
        }}
      >
        <ChartHost ref={box} label={label} testId="weight-chart" />
        <ChartTooltip ref={tip} testId="weight-tooltip" />
      </ChartFrame>
    </div>
  );
}
