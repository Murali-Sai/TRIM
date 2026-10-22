import { describe, expect, it } from 'vitest';
import { barTicks } from './ticks';

const days = (n: number) => Array.from({ length: n }, (_, i) => 43_200 + i * 86_400);

describe('barTicks', () => {
  it('puts one tick on each bar when they fit, never two in a day', () => {
    const xs = days(7);
    const ticks = barTicks(xs, 1200);
    expect(ticks).toEqual(xs);
    expect(new Set(ticks.map((t) => Math.floor(t / 86_400))).size).toBe(ticks.length);
  });

  it('thins to every k-th bar on a narrow chart, keeping the latest', () => {
    const xs = days(30);
    const ticks = barTicks(xs, 320);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(ticks.at(-1)).toBe(xs.at(-1));
    expect(ticks.every((t) => xs.includes(t))).toBe(true);
  });

  it('handles no bars and a zero width', () => {
    expect(barTicks([], 500)).toEqual([]);
    expect(barTicks(days(3), 0)).toEqual([days(3)[2]]);
  });
});
