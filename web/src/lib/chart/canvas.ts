/**
 * Drawing helpers shared by the uPlot charts: theme colors, direct labels at a line's end, and
 * the target line with its on-target band. Each is a plain function of the plot, so a chart
 * calls them from its draw hook.
 */
import uPlot from 'uplot';
import { BAND_ALPHA, type PhaseBand } from '../phases';
import { ON_TARGET_BAND } from './headlines';

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The body font at `px` CSS pixels, scaled for the canvas. */
export function canvasFont(px = 13): string {
  return `${px * uPlot.pxRatio}px ${getComputedStyle(document.body).fontFamily}`;
}

/**
 * A direct label on a surface-colored backing, so dots and bars never hide it. It sits just
 * after `endX` (where its line ends), or right-aligned at the plot's edge when there is no
 * room. `y` is the text baseline in canvas pixels.
 */
export function drawDirectLabel(
  u: uPlot,
  text: string,
  y: number,
  color: string,
  endX = u.bbox.left + u.bbox.width,
): void {
  const { ctx } = u;
  const { left, width } = u.bbox;
  const dpr = uPlot.pxRatio;
  ctx.save();
  ctx.font = canvasFont();
  ctx.textBaseline = 'bottom';
  const w = ctx.measureText(text).width;
  const pad = 6 * dpr;
  const fits = endX + pad + w <= left + width;
  const x = fits ? endX + pad : left + width - 4 * dpr;
  ctx.textAlign = fits ? 'left' : 'right';
  const boxLeft = fits ? x - 3 * dpr : x - w - 3 * dpr;
  ctx.fillStyle = cssVar('--color-surface');
  ctx.globalAlpha = 0.85;
  ctx.fillRect(boxLeft, y - 16 * dpr, w + 6 * dpr, 17 * dpr);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export interface TargetOptions {
  value: number;
  /** "Target 2,300": the label always shows the number. */
  label: string;
  color: string;
  /** Shade the on-target band (target plus or minus 5%). */
  band?: boolean;
  dashed?: boolean;
}

/** The target as a line, optionally with its on-target band, labeled at the right edge. Returns
 * the label's baseline (canvas pixels), or null when the target is off the plot. */
export function drawTarget(u: uPlot, t: TargetOptions): number | null {
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const dpr = uPlot.pxRatio;
  const y = u.valToPos(t.value, 'y', true);
  ctx.save();
  if (t.band) {
    const hi = u.valToPos(t.value * (1 + ON_TARGET_BAND), 'y', true);
    const lo = u.valToPos(t.value * (1 - ON_TARGET_BAND), 'y', true);
    const y0 = Math.max(top, Math.min(hi, lo));
    const y1 = Math.min(top + height, Math.max(hi, lo));
    if (y1 > y0) {
      ctx.fillStyle = t.color;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(left, y0, width, y1 - y0);
      ctx.globalAlpha = 1;
    }
  }
  const inside = y >= top && y <= top + height;
  if (inside) {
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1.5 * dpr;
    if (t.dashed ?? true) ctx.setLineDash([6 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();
  }
  ctx.restore();
  if (!inside) return null;
  const baseline = y - 4 * dpr;
  drawDirectLabel(u, t.label, baseline, cssVar('--color-text-secondary'));
  return baseline;
}

/** Places a sentence tooltip above the plot, centered on `x` (CSS pixels in the plot area) and
 * kept inside it. */
export function placeTooltip(u: uPlot, tip: HTMLElement, text: string | null, x: number): void {
  if (text === null) {
    tip.hidden = true;
    return;
  }
  tip.textContent = text;
  tip.hidden = false;
  const half = tip.offsetWidth / 2;
  const maxLeft = u.over.clientWidth - tip.offsetWidth;
  tip.style.left = `${Math.max(0, Math.min(maxLeft, x - half)) + u.over.offsetLeft}px`;
}

/** Diet phases as light neutral tints behind the data, each named at the top edge (SPEC page
 * 4, Phases on every time chart). Call from the drawClear hook so the series draw on top. */
export function drawPhaseBands(u: uPlot, bands: readonly PhaseBand[]): void {
  // The names in view, for tests and debugging (the tints are canvas pixels).
  const drawn: string[] = [];
  u.root.dataset.phases = '';
  if (bands.length === 0) return;
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const dpr = uPlot.pxRatio;
  const tint = cssVar('--color-text-secondary');
  const text = cssVar('--color-text-secondary');
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.font = canvasFont(11);
  ctx.textBaseline = 'top';
  for (const b of bands) {
    const x0 = Math.max(left, u.valToPos(b.from, 'x', true));
    const x1 = Math.min(left + width, u.valToPos(b.to, 'x', true));
    if (x1 <= x0) continue;
    drawn.push(b.name);
    ctx.globalAlpha = BAND_ALPHA[b.kind];
    ctx.fillStyle = tint;
    ctx.fillRect(x0, top, x1 - x0, height);
    // A thin edge where a phase starts, so two phases side by side stay apart.
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x0, top, dpr, height);
    ctx.globalAlpha = 1;
    const w = ctx.measureText(b.name).width;
    if (w + 8 * dpr <= x1 - x0) {
      ctx.fillStyle = text;
      ctx.fillText(b.name, x0 + 4 * dpr, top + 3 * dpr);
    }
  }
  ctx.restore();
  u.root.dataset.phases = drawn.join(',');
}
