import { describe, expect, it } from 'vitest';
import { bullet, sparkline, weekBars } from './dashboard';

describe('week bars (Calories this week)', () => {
  it('scales from zero with room for the band, and marks over target', () => {
    const w = weekBars(
      [
        { value: 2000, target: 2000 },
        { value: null, target: 2000 },
        { value: 2300, target: 2000 },
      ],
      100,
    );
    // Top of the scale: the larger of the values and target + 5%, plus 10% headroom.
    expect(w.max).toBeCloseTo(2300 * 1.1, 6);
    expect(w.bars[0]).toMatchObject({ height: (2000 / w.max) * 100, over: false });
    expect(w.bars[1]).toMatchObject({ height: 0, logged: false });
    expect(w.bars[2]).toMatchObject({ over: true });
    expect(w.bars[0]?.targetY).toBeCloseTo(100 - (2000 / w.max) * 100, 6);
    expect(w.bars[0]?.bandTop).toBeCloseTo(100 - (2100 / w.max) * 100, 6);
  });
  it('nothing logged and no target still has a scale', () => {
    expect(weekBars([{ value: null, target: null }], 100).max).toBe(1);
  });
});

describe('bullet bars (Macros this week)', () => {
  it('bar to the average, tick at the target, band at plus or minus 5%', () => {
    const b = bullet(146, 150);
    const scale = 150 * 1.05 * 1.1;
    expect(b.bar).toBeCloseTo((146 / scale) * 100, 6);
    expect(b.tick).toBeCloseTo((150 / scale) * 100, 6);
    expect(b.bandFrom).toBeCloseTo((142.5 / scale) * 100, 6);
    expect(b.bandTo).toBeCloseTo((157.5 / scale) * 100, 6);
    expect(b.onTarget).toBe(true);
    // 142 of 150 is 5.3% under: outside the band.
    expect(bullet(142, 150).onTarget).toBe(false);
  });
  it('an average over the band widens the scale', () => {
    const b = bullet(200, 150);
    expect(b.bar).toBeCloseTo(100 / 1.1, 6);
    expect(b.onTarget).toBe(false);
  });
});

describe('sparkline (Weight, 30 days)', () => {
  const points = [
    { day: '2026-10-02', value: 80.4, trend: 80.4 },
    { day: '2026-10-11', value: 79.2, trend: 80.0 },
    { day: '2026-10-31', value: 79.6, trend: 79.8 },
  ];

  it('maps the last 30 days onto the box, with the goal when it is near', () => {
    const s = sparkline(points, 79.0, '2026-10-31', 300, 60);
    expect(s.dots).toHaveLength(3);
    // The 30 days end today: 2 Oct is the left edge and 31 Oct the right.
    expect(s.dots[0]?.x).toBeCloseTo(0, 6);
    expect(s.dots[2]?.x).toBeCloseTo(300, 6);
    expect(s.trend.startsWith('M0.0,')).toBe(true);
    expect(s.goalY).not.toBeNull();
  });

  it('leaves a far goal off so the line keeps its shape', () => {
    expect(sparkline(points, 62, '2026-10-31', 300, 60).goalY).toBeNull();
  });

  it('only the last 30 days', () => {
    const s = sparkline(
      [{ day: '2026-09-01', value: 82, trend: 82 }, ...points],
      null,
      '2026-10-31',
      300,
      60,
    );
    expect(s.dots).toHaveLength(3);
  });
});
