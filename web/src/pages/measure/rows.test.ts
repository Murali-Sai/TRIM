import { describe, expect, it } from 'vitest';
import type { MeasurementType, Metric } from '../../api/measurements';
import { changeRows, fewReadings } from './rows';

const type = (id: string, over: Partial<MeasurementType> = {}): MeasurementType => ({
  id,
  name: 'Waist',
  unit: 'cm',
  precision: 1,
  side: null,
  pair_id: null,
  is_preset: true,
  is_active: true,
  sort_order: 0,
  archived_at: null,
  entries: 0,
  latest: null,
  ...over,
});
const r = (day: string, value: number) => ({ day, at: `${day}T12:00:00Z`, value });

describe('changeRows', () => {
  it('says how much a metric moved since its first reading, in its unit', () => {
    const waist = type('w', { unit: 'in' });
    const metrics: Metric[] = [{ key: 'w', name: 'Waist', types: [waist] }];
    const readings = new Map([['w', [r('2026-09-01', 90), r('2026-10-13', 87.3)]]]);
    const [row] = changeRows(metrics, readings);
    // 87.3 cm is 34.4 in; 2.7 cm is 1.1 in.
    expect(row).toMatchObject({
      latest: '34.4 in',
      change: 'down 1.1 in',
      dir: 'down',
      since: '2026-09-01',
    });
    expect(row?.pct).toBeCloseTo(-3, 5);
  });

  it('a pair is two rows, a single reading has no change yet', () => {
    const l = type('l', { name: 'Thigh', side: 'left', pair_id: 't' });
    const rt = type('r', { name: 'Thigh', side: 'right', pair_id: 't' });
    const metrics: Metric[] = [{ key: 't', name: 'Thigh', types: [l, rt] }];
    const readings = new Map([
      ['l', [r('2026-10-01', 55), r('2026-10-08', 55)]],
      ['r', [r('2026-10-01', 56)]],
    ]);
    const rows = changeRows(metrics, readings);
    expect(rows.map((x) => [x.name, x.change])).toEqual([
      ['Thigh, left', 'unchanged'],
      ['Thigh, right', 'first reading'],
    ]);
  });
});

describe('fewReadings', () => {
  it('needs 5 days with a reading spanning 7 days', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-07'];
    expect(fewReadings(days.map((d) => r(d, 90)))).toBe(false);
    expect(fewReadings(days.slice(0, 4).map((d) => r(d, 90)))).toBe(true);
    expect(
      fewReadings(
        ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map((d) => r(d, 90)),
      ),
    ).toBe(true);
  });
});
