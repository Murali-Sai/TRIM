import {
  blockLabel,
  defaultLogTime,
  groupBlocks,
  loggedMessage,
  roundDown5,
  shiftWall,
  timeChipLabel,
} from './logTime';
import { zonedWallToIso } from './zoned';

const NY = 'America/New_York';

describe('time chip', () => {
  test('new entries default to now rounded down to 5 minutes, in the user timezone', () => {
    // 23:07 UTC is 19:07 in New York.
    expect(defaultLogTime('2026-10-17T23:07:42Z', NY)).toBe('2026-10-17T19:05');
    expect(roundDown5('2026-10-17T19:00')).toBe('2026-10-17T19:00');
    expect(roundDown5('2026-10-17T19:04')).toBe('2026-10-17T19:00');
    expect(roundDown5('2026-10-17T19:59')).toBe('2026-10-17T19:55');
  });

  test('-30 min and -1 h, across midnight too', () => {
    expect(shiftWall('2026-10-17T19:05', -30)).toBe('2026-10-17T18:35');
    expect(shiftWall('2026-10-17T19:05', -60)).toBe('2026-10-17T18:05');
    expect(shiftWall('2026-10-17T00:20', -30)).toBe('2026-10-16T23:50');
  });

  test('labels', () => {
    const today = '2026-10-17';
    expect(timeChipLabel('2026-10-17T16:00', today)).toBe('Today, 4:00 PM');
    expect(timeChipLabel('2026-10-16T08:05', today)).toBe('Yesterday, 8:05 AM');
    expect(timeChipLabel('2026-10-14T12:30', today)).toBe('Wed 14 Oct, 12:30 PM');
    expect(timeChipLabel('2026-10-17T00:00', today)).toBe('Today, 12:00 AM');
    expect(loggedMessage(2, '2026-10-17T16:00', today)).toBe('Logged 2 items at 4 PM today.');
    expect(loggedMessage(1, '2026-10-14T08:05', today)).toBe(
      'Logged 1 item at 8:05 AM on Wed 14 Oct.',
    );
  });
});

describe('time blocks', () => {
  test('pill shows "4 PM" on the hour, otherwise "4:30 PM"', () => {
    expect(blockLabel('2026-10-17T16:00')).toBe('4 PM');
    expect(blockLabel('2026-10-17T16:30')).toBe('4:30 PM');
    expect(blockLabel('2026-10-17T00:05')).toBe('12:05 AM');
    expect(blockLabel('2026-10-17T12:00')).toBe('12 PM');
    expect(blockLabel('2026-10-17T16:30', { hour12: false })).toBe('16:30');
  });

  test('AC: food logged at 19:00 for 16:00 lands in the 4 PM block on the right local day', () => {
    // At 19:00 the user moves the chip to 16:00 and logs.
    const eatenAt = zonedWallToIso('2026-10-17T16:00', NY);
    expect(eatenAt).toBe('2026-10-17T20:00:00.000Z');
    const entries = [
      { id: 'a', eaten_at: '2026-10-17T23:00:00Z' }, // logged "now" at 19:00
      { id: 'b', eaten_at: eatenAt },
    ];
    const blocks = groupBlocks(entries, NY);
    expect(blocks.map((b) => [b.label, b.day, b.entries.map((e) => e.id)])).toEqual([
      ['4 PM', '2026-10-17', ['b']],
      ['7 PM', '2026-10-17', ['a']],
    ]);
  });

  test('entries in the same minute form one block, earliest block first', () => {
    const blocks = groupBlocks(
      [
        { id: 'late', eaten_at: '2026-10-17T22:30:00Z' },
        { id: 'one', eaten_at: '2026-10-17T20:00:00Z' },
        { id: 'two', eaten_at: '2026-10-17T20:00:00Z' },
        { id: 'next minute', eaten_at: '2026-10-17T20:01:00Z' },
      ],
      NY,
    );
    expect(blocks.map((b) => [b.wall, b.entries.map((e) => e.id)])).toEqual([
      ['2026-10-17T16:00', ['one', 'two']],
      ['2026-10-17T16:01', ['next minute']],
      ['2026-10-17T18:30', ['late']],
    ]);
  });

  test('a late-night entry in Tokyo stays on its local day', () => {
    // 23:30 on 17 Oct in Tokyo is 14:30 UTC.
    const [block] = groupBlocks([{ id: 'x', eaten_at: '2026-10-17T14:30:00Z' }], 'Asia/Tokyo');
    expect(block?.day).toBe('2026-10-17');
    expect(block?.label).toBe('11:30 PM');
  });
});
