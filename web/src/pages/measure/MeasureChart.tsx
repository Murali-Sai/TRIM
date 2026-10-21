import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { Metric } from '../../api/measurements';
import { ChartHost, ChartTooltip } from '../../components/chart/ChartFrame';
import { usePhaseBands } from '../../components/chart/usePhaseBands';
import { useThemeVersion } from '../../components/chart/useThemeVersion';
import {
  canvasFont,
  cssVar,
  drawDirectLabel,
  drawPhaseBands,
  placeTooltip,
} from '../../lib/chart/canvas';
import { nearestIndex } from '../../lib/chart/nearest';
import { alignSides, type OverlayPoint } from '../../lib/measureSeries';
import { formatReading, toDisplay } from '../../lib/measureUnits';
import { computeTrend, MEASUREMENT_ALPHA, type Reading } from '../../lib/trend';
import { formatNumber } from '../../lib/units';
import { formatDay } from '../../lib/zoned';

function axes(
  font: string,
  muted: string,
  grid: string,
  label: string,
  fmt: (v: number) => string,
) {
  return [
    { stroke: muted, font, grid: { show: false }, ticks: { stroke: grid, width: 1 } },
    {
      stroke: muted,
      font,
      size: 56,
      label,
      labelFont: font,
      labelSize: 18,
      values: (_u: uPlot, vals: number[]) => vals.map(fmt),
      grid: { stroke: grid, width: 1 },
      ticks: { show: false },
    },
  ];
}

/**
 * One metric with the weight-style trend (SPEC page 4): readings as dots and the EWMA trend
 * (a = 0.25) as a line, breaking across gaps over 7 days. A left and right pair share the
 * chart: left solid, right dashed, each labeled at its end.
 */
export function MeasureChart({
  metric,
  readings,
  window,
  timeZone,
  color,
  label,
  height,
}: {
  metric: Metric;
  readings: Map<string, Reading[]>;
  /** [min, max] in unix seconds, from the range chips. */
  window: [number, number] | null;
  timeZone: string;
  color: string;
  label: string;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const themeVersion = useThemeVersion();
  const { bands: phases } = usePhaseBands('zoned');
  const first = metric.types[0];
  const unit = first?.unit ?? 'cm';
  const precision = first?.precision ?? 1;

  const data = useMemo(() => {
    const sides = metric.types.map((t) => {
      const result = computeTrend(readings.get(t.id) ?? [], { alpha: MEASUREMENT_ALPHA });
      // Until the trend shows (5 readings over 7 days), a thin line joins the readings.
      return {
        side: t.side,
        visible: result.visible,
        points: result.points.map((p) => ({
          ...p,
          trend: result.visible ? p.trend : p.outlier ? null : p.value,
        })),
      };
    });
    return { ...alignSides(sides), meta: sides };
  }, [metric, readings]);

  useEffect(() => {
    const el = box.current;
    if (!el || data.xs.length === 0) return;
    const line = cssVar(color.replace(/^var\((.*)\)$/, '$1')) || color;
    const text = cssVar('--color-text');
    const muted = cssVar('--color-text-secondary');
    const grid = cssVar('--color-border');
    const font = canvasFont(13 / uPlot.pxRatio);
    const show = (v: number) => toDisplay(v, unit);
    const fmt = (v: number) => formatNumber(v, precision);
    const series: uPlot.Series[] = [{}];
    const values: (number | null | undefined)[][] = [];
    data.sides.forEach((s, k) => {
      const dashed = k === 1;
      series.push({
        label: `${data.meta[k]?.side ?? 'readings'} points`,
        paths: () => null,
        points: { show: true, size: 7, width: 0, fill: `${line}66`, stroke: `${line}66` },
      });
      series.push({
        label: `${data.meta[k]?.side ?? ''} trend`,
        stroke: line,
        width: data.meta[k]?.visible ? 2.5 : 1.5,
        ...(dashed ? { dash: [6, 5] } : {}),
        points: { show: false },
      });
      values.push(s.readings.map((v) => (typeof v === 'number' ? show(v) : v)));
      values.push(s.trend.map((v) => (typeof v === 'number' ? show(v) : v)));
    });

    function drawEnds(u: uPlot) {
      if (data.sides.length < 2) return;
      data.sides.forEach((s, k) => {
        for (let i = data.xs.length - 1; i >= 0; i--) {
          const v = s.trend[i] ?? s.readings[i];
          if (typeof v !== 'number') continue;
          const y = u.valToPos(show(v), 'y', true) - 8 * uPlot.pxRatio;
          drawDirectLabel(
            u,
            k === 0 ? 'Left' : 'Right',
            y,
            text,
            u.valToPos(data.xs[i] ?? 0, 'x', true),
          );
          break;
        }
      });
    }

    function showTip(u: uPlot) {
      const t = tip.current;
      if (!t) return;
      const i = nearestIndex(data.xs.length, u.cursor.idx, (j) =>
        data.sides.some((s) => typeof s.readings[j] === 'number'),
      );
      const off = u.cursor.left == null || u.cursor.left < 0;
      let words: string | null = null;
      if (i !== null && !off) {
        const parts = data.sides
          .map((s, k) => {
            const v = s.readings[i];
            if (typeof v !== 'number') return null;
            const side = data.meta[k]?.side;
            return `${side ? `${side} ` : ''}${formatReading(v, unit, precision)}`;
          })
          .filter(Boolean);
        words = `${formatDay(new Date((data.xs[i] ?? 0) * 1000).toISOString(), timeZone)}: ${parts.join(', ')}`;
      }
      placeTooltip(u, t, words, i === null ? 0 : u.valToPos(data.xs[i] ?? 0, 'x'));
    }

    const u = new uPlot(
      {
        width: el.clientWidth,
        height: height ?? (el.clientWidth < 640 ? 200 : 240),
        legend: { show: false },
        cursor: { drag: { x: false, y: false }, points: { show: false }, y: false },
        scales: {
          x: { time: true },
          y: {
            range: (_u, min, max) => {
              const pad = Math.max((max - min) * 0.1, 10 ** -precision);
              return [min - pad, max + pad];
            },
          },
        },
        axes: axes(font, muted, grid, unit === '%' ? '%' : unit, fmt),
        series,
        hooks: {
          drawClear: [(u) => drawPhaseBands(u, phases)],
          draw: [drawEnds],
          setCursor: [showTip],
        },
      },
      [data.xs, ...values] as uPlot.AlignedData,
      el,
    );
    if (window) u.setScale('x', { min: window[0], max: window[1] });
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: u.height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
    };
  }, [data, window, unit, precision, color, timeZone, height, themeVersion, phases]);

  return (
    <div className="relative">
      <ChartHost ref={box} label={label} testId="measure-chart" />
      <ChartTooltip ref={tip} />
    </div>
  );
}

export interface OverlayLine {
  name: string;
  color: string;
  /** The right side of a pair, which shares its color with the left. */
  dashed?: boolean;
  points: OverlayPoint[];
}

/**
 * Percent change since a start date for several metrics on one chart: a bold 0% line labeled
 * "start", and each line labeled at its end.
 */
export function OverlayChart({
  lines,
  window,
  label,
}: {
  lines: readonly OverlayLine[];
  window: [number, number] | null;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const themeVersion = useThemeVersion();
  const { bands: phases } = usePhaseBands('zoned');
  const data = useMemo(() => {
    const xs = [
      ...new Set(lines.flatMap((l) => l.points.map((p) => Math.round(Date.parse(p.at) / 1000)))),
    ].sort((a, b) => a - b);
    const index = new Map(xs.map((x, i) => [x, i]));
    const ys = lines.map((l) => {
      const out: (number | undefined)[] = xs.map(() => undefined);
      for (const p of l.points) {
        const i = index.get(Math.round(Date.parse(p.at) / 1000));
        if (i !== undefined) out[i] = p.pct;
      }
      return out;
    });
    return { xs, ys };
  }, [lines]);

  useEffect(() => {
    const el = box.current;
    if (!el || data.xs.length === 0) return;
    const text = cssVar('--color-text');
    const muted = cssVar('--color-text-secondary');
    const grid = cssVar('--color-border');
    const font = canvasFont(13 / uPlot.pxRatio);
    const colors: string[] = lines.map(
      (l) => cssVar(l.color.replace(/^var\((.*)\)$/, '$1')) || l.color,
    );

    function drawStartAndEnds(u: uPlot) {
      const { ctx } = u;
      const { left, width } = u.bbox;
      const dpr = uPlot.pxRatio;
      const y0 = u.valToPos(0, 'y', true);
      ctx.save();
      ctx.strokeStyle = text;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(left, y0);
      ctx.lineTo(left + width, y0);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.font = canvasFont(12);
      ctx.fillStyle = text;
      ctx.textBaseline = 'bottom';
      ctx.fillText('start', left + 4 * dpr, y0 - 3 * dpr);
      ctx.restore();
      data.ys.forEach((ys, k) => {
        for (let i = ys.length - 1; i >= 0; i--) {
          const v = ys[i];
          if (typeof v !== 'number') continue;
          drawDirectLabel(
            u,
            lines[k]?.name ?? '',
            u.valToPos(v, 'y', true) - 6 * dpr,
            colors[k] ?? text,
            u.valToPos(data.xs[i] ?? 0, 'x', true),
          );
          break;
        }
      });
    }

    const u = new uPlot(
      {
        width: el.clientWidth,
        height: el.clientWidth < 640 ? 240 : 320,
        legend: { show: false },
        cursor: { drag: { x: false, y: false }, points: { show: false }, y: false },
        scales: {
          x: { time: true },
          y: {
            range: (_u, min, max) => {
              const lo = Math.min(min, 0);
              const hi = Math.max(max, 0);
              const pad = Math.max((hi - lo) * 0.12, 0.5);
              return [lo - pad, hi + pad];
            },
          },
        },
        axes: axes(font, muted, grid, '% change', (v) => `${formatNumber(v, 1)}%`),
        series: [
          {},
          ...lines.map((l, k) => ({
            stroke: colors[k] ?? text,
            width: 2.5,
            ...(l.dashed ? { dash: [6, 5] } : {}),
            spanGaps: true,
            points: { show: true, size: 5, width: 0, fill: colors[k] ?? text },
          })),
        ],
        hooks: {
          drawClear: [(u) => drawPhaseBands(u, phases)],
          draw: [drawStartAndEnds],
        },
      },
      [data.xs, ...data.ys] as uPlot.AlignedData,
      el,
    );
    if (window) u.setScale('x', { min: window[0], max: window[1] });
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: u.height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
    };
  }, [data, lines, window, themeVersion, phases]);

  return <ChartHost ref={box} label={label} testId="overlay-chart" />;
}
