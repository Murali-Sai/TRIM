import { isoToZonedWall, zonedWallToIso } from './zoned';

describe('zonedWallToIso', () => {
  test.each([
    ['2026-10-17T08:00', 'America/New_York', '2026-10-17T12:00:00.000Z'],
    ['2026-10-17T23:30', 'Asia/Tokyo', '2026-10-17T14:30:00.000Z'],
    ['2026-12-01T08:00', 'America/New_York', '2026-12-01T13:00:00.000Z'],
    ['2026-10-17T12:00', 'UTC', '2026-10-17T12:00:00.000Z'],
    // 01:30 happens twice on 1 Nov 2026 in New York; the first (daylight time) wins.
    ['2026-11-01T01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'],
    // 02:30 does not exist on 8 Mar 2026 in New York; it lands just after the jump.
    ['2026-03-08T02:30', 'America/New_York', '2026-03-08T07:30:00.000Z'],
  ])('%s in %s', (wall, tz, iso) => {
    expect(zonedWallToIso(wall, tz)).toBe(iso);
  });
});

describe('isoToZonedWall', () => {
  test.each([
    ['2026-10-17T12:00:00Z', 'America/New_York', '2026-10-17T08:00'],
    ['2026-10-17T14:30:00Z', 'Asia/Tokyo', '2026-10-17T23:30'],
    ['2026-10-17T02:30:00Z', 'America/New_York', '2026-10-16T22:30'],
  ])('%s in %s', (iso, tz, wall) => {
    expect(isoToZonedWall(iso, tz)).toBe(wall);
  });

  test('round-trips', () => {
    const wall = '2026-07-04T19:45';
    expect(isoToZonedWall(zonedWallToIso(wall, 'Europe/London'), 'Europe/London')).toBe(wall);
  });
});
