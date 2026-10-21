import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignSides, changeSince, indexedChange, overlayLine } from './measureSeries';

const vectors = JSON.parse(
  readFileSync(join(process.cwd(), '..', 'shared', 'measurement_vectors.json'), 'utf8'),
) as {
  indexed_change: { value: number; base: number; pct: number }[];
  change_since: {
    readings: { day: string; at: string; value: number }[];
    from: string | null;
    start: { day: string; value: number };
    latest: { day: string; value: number };
    change: number;
    pct: number;
  }[];
};

describe('indexed change (shared vectors)', () => {
  it.each(vectors.indexed_change)('$value from $base is $pct%', ({ value, base, pct }) => {
    expect(Math.round(indexedChange(value, base) * 10) / 10).toBe(pct);
  });

  it('AC: waist 90.0 to 87.3 cm is -3.0%', () => {
    expect(indexedChange(87.3, 90).toFixed(1)).toBe('-3.0');
  });
});

describe('changeSince (shared vectors)', () => {
  it.each(vectors.change_since)('from $from', (v) => {
    const c = changeSince(v.readings, v.from);
    expect(c).not.toBeNull();
    expect(c?.start.day).toBe(v.start.day);
    expect(c?.latest.day).toBe(v.latest.day);
    expect(Math.round((c?.change ?? 0) * 10) / 10).toBe(v.change);
    expect(Math.round((c?.pct ?? 0) * 10) / 10).toBe(v.pct);
  });

  it('needs two readings', () => {
    expect(changeSince([{ day: '2026-09-01', at: '2026-09-01T12:00:00Z', value: 90 }])).toBeNull();
  });
});

describe('overlayLine', () => {
  it('indexes every reading from the start date to the first one on or after it', () => {
    const readings = vectors.change_since[0]?.readings ?? [];
    const line = overlayLine(readings, '2026-09-10');
    expect(line.map((p) => p.day)).toEqual(['2026-09-15', '2026-10-13']);
    expect(line.map((p) => Math.round(p.pct * 10) / 10)).toEqual([0, -1.5]);
  });
});

describe('alignSides', () => {
  const pt = (day: string, value: number, trend: number | null = value) => ({
    day,
    at: `${day}T12:00:00Z`,
    value,
    trend,
  });

  it('shares one x axis and leaves the other side open', () => {
    const { xs, sides } = alignSides([
      { points: [pt('2026-10-01', 33), pt('2026-10-03', 33.2)] },
      { points: [pt('2026-10-02', 34)] },
    ]);
    expect(xs).toHaveLength(3);
    expect(sides[0]?.readings).toEqual([33, undefined, 33.2]);
    expect(sides[1]?.readings).toEqual([undefined, 34, undefined]);
  });

  it('breaks the trend across a gap over 7 days', () => {
    const { sides } = alignSides([
      { points: [pt('2026-10-01', 90), pt('2026-10-02', 89.8), pt('2026-10-20', 88)] },
      { points: [pt('2026-10-10', 1)] },
    ]);
    // x order: 1, 2, 10, 20; the null at the 10th breaks the line before the 20th.
    expect(sides[0]?.trend).toEqual([90, 89.8, null, 88]);
  });
});
