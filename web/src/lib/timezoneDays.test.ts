import { describe, expect, it } from 'vitest';
import { defaultLogTime, groupBlocks, loggedMessage } from './logTime';
import { rangeDates } from './nutritionSeries';
import { isoToZonedWall, zonedWallToIso } from './zoned';

// Task 3.12. AC: users in UTC-5 and UTC+9 at 23:30 local. The browser's own timezone never
// matters: every "today" and every day boundary comes from the user's timezone setting.

const CASES = [
  // New York in January is UTC-5: 23:30 on the 15th is 04:30 UTC on the 16th.
  { name: 'UTC-5', tz: 'America/New_York', now: '2026-01-16T04:30:00.000Z', day: '2026-01-15' },
  // Tokyo is UTC+9: 23:30 on the 15th is 14:30 UTC on the 15th.
  { name: 'UTC+9', tz: 'Asia/Tokyo', now: '2026-01-15T14:30:00.000Z', day: '2026-01-15' },
] as const;

describe.each(CASES)('$name at 23:30 local', ({ tz, now, day }) => {
  it('today is the local date', () => {
    expect(isoToZonedWall(now, tz)).toBe(`${day}T23:30`);
    expect(defaultLogTime(now, tz)).toBe(`${day}T23:30`);
    expect(loggedMessage(1, defaultLogTime(now, tz), day)).toBe('Logged 1 item at 11:30 PM today.');
  });

  it('a log time round-trips to the same instant', () => {
    expect(zonedWallToIso(`${day}T23:30`, tz)).toBe(now);
  });

  it('entries group into blocks on their local day', () => {
    const later = new Date(Date.parse(now) + 45 * 60_000).toISOString(); // 00:15 next day
    const blocks = groupBlocks([{ eaten_at: now }, { eaten_at: later }], tz);
    expect(blocks.map((b) => [b.day, b.label])).toEqual([
      [day, '11:30 PM'],
      [
        new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
        '12:15 AM',
      ],
    ]);
  });

  it('chart ranges end on the local today', () => {
    const today = isoToZonedWall(now, tz).slice(0, 10);
    expect(rangeDates('1W', today, null)).toEqual([
      new Date(Date.parse(`${day}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10),
      day,
    ]);
  });
});
