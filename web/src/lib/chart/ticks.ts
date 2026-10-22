/**
 * The x ticks for a bar chart: one per bar when they fit, else every k-th bar counted back
 * from the latest, so the newest bar always has its label. Ticks only ever sit on bars, so a
 * date label never repeats (uPlot's own time ticks can fall twice in one day on a wide chart).
 */
export function barTicks(xs: readonly number[], width: number, minSpace = 64): number[] {
  if (xs.length === 0) return [];
  const fit = Math.max(1, Math.floor(width / minSpace));
  const step = Math.ceil(xs.length / fit);
  const out: number[] = [];
  for (let i = xs.length - 1; i >= 0; i -= step) out.push(xs[i] as number);
  return out.reverse();
}
