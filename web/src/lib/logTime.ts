/**
 * Times for food logging (SPEC page 4, "Today screen design and time-based logging").
 * A "wall" time is "YYYY-MM-DDTHH:mm" in the user's profile timezone (see ./zoned).
 */
import { isoToZonedWall } from './zoned';

/** Minutes floored to a multiple of 5: new entries default to now, rounded down. */
export function roundDown5(wall: string): string {
  const minutes = Number(wall.slice(14, 16));
  return `${wall.slice(0, 14)}${String(minutes - (minutes % 5)).padStart(2, '0')}`;
}

export function defaultLogTime(nowIso: string, timeZone: string): string {
  return roundDown5(isoToZonedWall(nowIso, timeZone));
}

/** Wall-clock arithmetic ("-30 min", "-1 h"); crossing midnight moves the date. */
export function shiftWall(wall: string, minutes: number): string {
  return new Date(Date.parse(`${wall}:00Z`) + minutes * 60_000).toISOString().slice(0, 16);
}

function clock(wall: string, hour12: boolean, alwaysMinutes: boolean): string {
  const h = Number(wall.slice(11, 13));
  const m = wall.slice(14, 16);
  if (!hour12) return `${String(h).padStart(2, '0')}:${m}`;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return alwaysMinutes || m !== '00' ? `${h12}:${m} ${suffix}` : `${h12} ${suffix}`;
}

/** The time block pill: "4 PM" on the hour, otherwise "4:30 PM"; "16:30" in 24-hour. */
export function blockLabel(wall: string, opts: { hour12?: boolean } = {}): string {
  return clock(wall, opts.hour12 ?? true, false);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat 17 Oct" for a YYYY-MM-DD local day. */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Today", "Yesterday" or "Wed 14 Oct". */
export function relativeDay(day: string, today: string): string {
  const yesterday = shiftWall(`${today}T00:00`, -24 * 60).slice(0, 10);
  return day === today ? 'Today' : day === yesterday ? 'Yesterday' : dayLabel(day);
}

/** The time chip: "Today, 4:00 PM", "Yesterday, 8:05 AM" or "Wed 14 Oct, 12:30 PM". */
export function timeChipLabel(wall: string, today: string): string {
  return `${relativeDay(wall.slice(0, 10), today)}, ${clock(wall, true, true)}`;
}

/** After saving: "Logged 2 items at 4 PM today." or "... at 8:05 AM on Wed 14 Oct." */
export function loggedMessage(count: number, wall: string, today: string): string {
  const day = relativeDay(wall.slice(0, 10), today);
  const when = day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : `on ${day}`;
  return `Logged ${count} ${count === 1 ? 'item' : 'items'} at ${blockLabel(wall)} ${when}.`;
}

export interface TimeBlock<T> {
  /** The block's minute as a wall time; also its key. */
  wall: string;
  day: string;
  label: string;
  entries: T[];
}

/** All entries with the same eaten_at minute form one block; blocks are earliest first. */
export function groupBlocks<T extends { eaten_at: string }>(
  entries: readonly T[],
  timeZone: string,
  opts: { hour12?: boolean } = {},
): TimeBlock<T>[] {
  const byWall = new Map<string, T[]>();
  const sorted = [...entries].sort((a, b) => Date.parse(a.eaten_at) - Date.parse(b.eaten_at));
  for (const e of sorted) {
    const wall = isoToZonedWall(e.eaten_at, timeZone);
    const list = byWall.get(wall);
    if (list) list.push(e);
    else byWall.set(wall, [e]);
  }
  return [...byWall].map(([wall, list]) => ({
    wall,
    day: wall.slice(0, 10),
    label: blockLabel(wall, opts),
    entries: list,
  }));
}
