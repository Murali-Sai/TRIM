/** Pure, so it is unit tested without uPlot or a canvas. */
/** Index of the data point nearest the cursor that `has` a value, or null. */
export function nearestIndex(
  length: number,
  idx: number | null | undefined,
  has: (i: number) => boolean,
): number | null {
  if (idx == null) return null;
  for (let d = 0; d < length; d++) {
    if (idx - d >= 0 && has(idx - d)) return idx - d;
    if (idx + d < length && has(idx + d)) return idx + d;
  }
  return null;
}
