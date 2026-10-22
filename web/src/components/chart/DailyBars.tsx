import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { canvasFont, cssVar, drawDirectLabel, drawPhaseBands } from '../../lib/chart/canvas';
import { ON_TARGET_BAND, shortDate } from '../../lib/chart/headlines';
import { barTicks } from '../../lib/chart/ticks';
import { formatNumber } from '../../lib/units';
import { ChartHost } from './ChartFrame';
import { usePhaseBands } from './usePhaseBands';
import { useThemeVersion } from './useThemeVersion';

export interface DailyBarsProps {
  /** YYYY-MM-DD for each bar (a day, or the first day of a week or month). */
  dates: readonly string[];
  /** null where nothing was logged: a gap, never a zero bar. */
  values: readonly (number | null)[];
  /** The target for each bar, or null where there is none. */
  targets: readonly (number | null)[];
  /** A line over the bars, such as the 7-day average; null breaks it. */
  average?: readonly (number | null)[];
  averageLabel?: string;
  /** CSS color variable name without "--color-", such as "kcal" or "protein". */
  color: string;
  unit: string;
  label: string;
  tooltip: (i: number) => string;
  testId: string;
  /** Small multiples use "small". */
  size?: 'small' | 'large';
}

const HEIGHTS = { small: { phone: 180, wide: 200 }, large: { phone: 220, wide: 280 } } as const;

const noonSec = (day: string) => Date.parse(`${day}T12:00:00Z`) / 1000;

/**
 * Bars from zero with the target drawn across each bar's slot (so a target change shows where
 * it happened), the plus or minus 5% on-target band, and an optional average line. Over
 * target is a softer shade of the same color, never red; tooltips and the table say it in
 * words too.
 */
export function DailyBars({
  dates,
  values,
  targets,
  average,
  averageLabel = '7-day avg',
  color,
  unit,
  label,
  tooltip,
  testId,
  size = 'large',
}: DailyBarsProps) {
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLParagraphElement>(null);
  const themeVersion = useThemeVersion();
  const { bands: phases } = usePhaseBands('utc-days');

  useEffect(() => {
    const el = box.current;
    if (!el || dates.length === 0) return;
    const bar = cssVar(`--color-${color}`);
    const text = cssVar('--color-text');
    const muted = cssVar('--color-text-secondary');
    const grid = cssVar('--color-border');
    const font = canvasFont(13 / uPlot.pxRatio);
    const xs = dates.map(noonSec);
    const over = (i: number) => {
      const v = values[i];
      const t = targets[i];
      return v != null && t != null && v > t * (1 + ON_TARGET_BAND);
    };
    const within = values.map((v, i) => (v == null || over(i) ? null : v));
    const above = values.map((v, i) => (v != null && over(i) ? v : null));
    const top = Math.max(
      1,
      ...values.map((v) => v ?? 0),
      ...targets.map((t) => (t ?? 0) * (1 + ON_TARGET_BAND)),
      ...(average ?? []).map((v) => v ?? 0),
    );
    const slot = xs.length > 1 ? Math.min(...xs.slice(1).map((x, i) => x - (xs[i] ?? x))) : 86_400;
    const height = HEIGHTS[size];
    const h = () => (el.clientWidth < 640 ? height.phone : height.wide);
    const barsOf = uPlot.paths.bars;
    if (!barsOf) return;
    const bars = barsOf({ size: [0.7, 44], gap: 1 });

    function drawTargets(u: uPlot) {
      const { ctx } = u;
      const { left, top: plotTop, width, height: plotHeight } = u.bbox;
      const dpr = uPlot.pxRatio;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, plotTop, width, plotHeight);
      ctx.clip();
      for (let i = 0; i < xs.length; i++) {
        const t = targets[i];
        const x = xs[i];
        if (t == null || x === undefined) continue;
        const x0 = u.valToPos(x - slot / 2, 'x', true);
        const x1 = u.valToPos(x + slot / 2, 'x', true);
        const hi = u.valToPos(t * (1 + ON_TARGET_BAND), 'y', true);
        const lo = u.valToPos(t * (1 - ON_TARGET_BAND), 'y', true);
        ctx.fillStyle = muted;
        ctx.globalAlpha = 0.12;
        ctx.fillRect(x0, hi, x1 - x0, lo - hi);
        ctx.globalAlpha = 1;
        const y = u.valToPos(t, 'y', true);
        ctx.strokeStyle = text;
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      }
      ctx.restore();
      // Labels: the latest target with its number, and the average at its line's end.
      const lastTarget = [...targets].reverse().find((t) => t != null);
      let targetY: number | null = null;
      if (lastTarget != null) {
        targetY = u.valToPos(lastTarget, 'y', true) - 4 * dpr;
        drawDirectLabel(u, `Target ${formatNumber(Math.round(lastTarget))}`, targetY, muted);
      }
      if (average) {
        let i = average.length - 1;
        while (i >= 0 && average[i] == null) i--;
        const v = i >= 0 ? average[i] : null;
        if (v != null) {
          let y = u.valToPos(v, 'y', true) - 6 * dpr;
          if (targetY !== null && Math.abs(targetY - y) < 18 * dpr) {
            y = targetY + (y >= targetY ? 18 : -18) * dpr;
          }
          drawDirectLabel(
            u,
            `${averageLabel} ${formatNumber(Math.round(v))}`,
            y,
            text,
            u.valToPos(xs[i] ?? 0, 'x', true),
          );
        }
      }
    }

    function showTip(u: uPlot) {
      // A reserved line above the plot, so the sentence never covers the bars.
      const t = tip.current;
      const i = u.cursor.idx;
      if (!t) return;
      const off = i == null || u.cursor.left == null || u.cursor.left < 0;
      t.textContent = off ? '' : tooltip(i);
    }

    const series: uPlot.Series[] = [
      {},
      {
        label: 'On target or under',
        fill: bar,
        stroke: bar,
        width: 0,
        paths: bars,
        points: { show: false },
      },
      {
        label: 'Over target',
        fill: `${bar}80`,
        stroke: bar,
        width: 1,
        paths: bars,
        points: { show: false },
      },
    ];
    const data: (readonly (number | null)[])[] = [xs, within, above];
    if (average) {
      series.push({ label: averageLabel, stroke: text, width: 2, points: { show: false } });
      data.push(average);
    }

    const u = new uPlot(
      {
        width: el.clientWidth,
        height: h(),
        legend: { show: false },
        cursor: { points: { show: false }, y: false, drag: { x: false, y: false } },
        scales: {
          x: {
            time: true,
            range: () => [(xs[0] ?? 0) - slot / 2, (xs.at(-1) ?? 0) + slot / 2],
          },
          // Honest axes: calories and grams start at zero.
          y: { range: () => [0, top * 1.12] },
        },
        tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'UTC'),
        axes: [
          {
            stroke: muted,
            font,
            grid: { show: false },
            ticks: { stroke: grid, width: 1 },
            // Ticks on the bars themselves, so no date shows twice.
            splits: (u) => barTicks(xs, u.bbox.width / uPlot.pxRatio),
            // "25 Oct", with no year row.
            values: (_u, vals) =>
              vals.map((v) => shortDate(new Date(v * 1000).toISOString().slice(0, 10))),
          },
          {
            stroke: muted,
            font,
            size: 52,
            // Small multiples say the unit in their headline.
            ...(size === 'large' ? { label: unit, labelFont: font, labelSize: 18 } : {}),
            values: (_u, vals) => vals.map((v) => formatNumber(v)),
            grid: { stroke: grid, width: 1 },
            ticks: { show: false },
          },
        ],
        series,
        hooks: {
          drawClear: [(u) => drawPhaseBands(u, phases)],
          draw: [
            drawTargets,
            // The axis floor, for tests: calorie and macro charts start at zero.
            (u) => (el.dataset.yMin = String(u.scales.y?.min ?? '')),
          ],
          setCursor: [showTip],
        },
      },
      data as uPlot.AlignedData,
      el,
    );
    // Tap shows the tooltip on touch screens.
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') u.setCursor({ left: e.offsetX, top: e.offsetY });
    };
    u.over.addEventListener('pointerdown', onPointerDown);
    u.over.style.touchAction = 'pan-y';
    const resize = new ResizeObserver(() => {
      if (el.clientWidth && el.clientWidth !== u.width)
        u.setSize({ width: el.clientWidth, height: h() });
    });
    resize.observe(el);
    return () => {
      resize.disconnect();
      u.destroy();
    };
  }, [
    dates,
    values,
    targets,
    average,
    averageLabel,
    color,
    unit,
    tooltip,
    size,
    themeVersion,
    phases,
  ]);

  return (
    <>
      <p
        ref={tip}
        aria-hidden="true"
        className="num min-h-5 text-sm text-text-secondary"
        data-testid={`${testId}-tooltip`}
      />
      <ChartHost ref={box} label={label} testId={testId} />
    </>
  );
}
