import type { WeightEntry } from '../../api/weights';
import {
  displayWeight,
  formatLongDate,
  parseWeight,
  projectionFor,
  projectionSentence,
  trendFor,
  trendSentence,
} from './weightFormat';

function entries(values: [string, number][]): WeightEntry[] {
  return values.map(([day, kg], i) => ({
    id: `w${i}`,
    day,
    measured_at: `${day}T11:00:00Z`,
    kg,
    note: null,
  }));
}

describe('parseWeight', () => {
  test('pounds become kg at gram precision', () => {
    expect(parseWeight('176.4', 'imperial')).toEqual({ kg: 80.014 });
  });
  test('accepts a comma as the decimal mark', () => {
    expect(parseWeight('79,5', 'metric')).toEqual({ kg: 79.5 });
  });
  test.each([
    ['', 'metric'],
    ['abc', 'metric'],
  ] as const)('rejects %j', (raw, units) => {
    expect(parseWeight(raw, units)).toEqual({ error: 'Enter your weight as a number.' });
  });
  test.each([
    ['29.9', 'metric'],
    ['300.1', 'metric'],
    ['66.0', 'imperial'],
    ['662', 'imperial'],
  ] as const)('%s %s is out of range', (raw, units) => {
    expect(parseWeight(raw, units)).toHaveProperty('error');
  });
  test.each([
    ['30', 'metric'],
    ['300', 'metric'],
    ['661', 'imperial'],
  ] as const)('%s %s is in range', (raw, units) => {
    expect(parseWeight(raw, units)).toHaveProperty('kg');
  });
});

test('displayWeight converts only for display', () => {
  expect(displayWeight(80.014, 'imperial')).toBe('176.4 lb');
  expect(displayWeight(80.014, 'metric')).toBe('80.0 kg');
});

describe('trendSentence', () => {
  test('no weigh-ins', () => {
    expect(trendSentence(trendFor([]), 'metric')).toBe(
      'No weigh-ins yet. Add your first one to get started.',
    );
  });

  test('says how many more weigh-ins are needed', () => {
    const t = trendFor(
      entries([
        ['2026-10-01', 80],
        ['2026-10-02', 80],
      ]),
    );
    expect(trendSentence(t, 'metric')).toBe('Log 3 more weigh-ins to see your trend.');
    const one = trendFor(entries([1, 2, 3, 4].map((d) => [`2026-10-0${d * 2}`, 80])));
    expect(trendSentence(one, 'metric')).toBe('Log 1 more weigh-in to see your trend.');
  });

  test('says how many more days are needed', () => {
    const t = trendFor(entries([1, 2, 3, 4, 5].map((d) => [`2026-10-0${d}`, 80])));
    expect(trendSentence(t, 'metric')).toBe('Keep weighing in over 2 more days to see your trend.');
  });

  test('trend and weekly rate, SPEC style', () => {
    // Readings falling 0.064 kg a day; the trend lags them, so check the shape only.
    const days = Array.from({ length: 14 }, (_, i) => {
      const day = `2026-10-${String(4 + i).padStart(2, '0')}`;
      return [day, 80.832 - 0.064 * i] as [string, number];
    });
    const sentence = trendSentence(trendFor(entries(days)), 'metric');
    expect(sentence).toMatch(/^Trend 80\.\d kg, down 0\.\d kg a week$/);
  });

  test('flat is steady', () => {
    const t = trendFor(entries([1, 3, 5, 7, 9].map((d) => [`2026-10-0${d}`, 80])));
    expect(trendSentence(t, 'imperial')).toBe('Trend 176.4 lb, steady');
  });
});

describe('projection sentence', () => {
  // Five weigh-ins over 14 days that land the trend near 79.8 kg, falling.
  const falling = trendFor(
    entries(
      Array.from({ length: 14 }, (_, i) => [
        `2026-10-${String(4 + i).padStart(2, '0')}`,
        80.6 - 0.064 * i,
      ]),
    ),
  );

  test('SPEC example wording and date', () => {
    expect(
      projectionSentence({ kind: 'projection', weeks: 10.67, date: '2026-12-31' }, 75, 'metric'),
    ).toBe('75.0 kg goal around 31 Dec 2026 if your current rate continues.');
  });

  test('flat or wrong direction', () => {
    expect(projectionSentence({ kind: 'no_projection' }, 75, 'metric')).toBe(
      'No projection: your trend is flat or moving away from your goal.',
    );
  });

  test('nothing without a goal', () => {
    expect(projectionFor(falling, null, '2026-10-17')).toEqual({ kind: 'none' });
    expect(projectionSentence({ kind: 'none' }, null, 'metric')).toBeNull();
  });

  test('projects from the latest trend and weekly rate', () => {
    const p = projectionFor(falling, 75, '2026-10-17');
    expect(p.kind).toBe('projection');
    const away = projectionFor(falling, 90, '2026-10-17');
    expect(away.kind).toBe('no_projection');
  });

  test('formatLongDate ignores the browser locale', () => {
    expect(formatLongDate('2026-12-31')).toBe('31 Dec 2026');
  });
});
