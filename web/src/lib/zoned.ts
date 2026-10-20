/**
 * Wall-clock times in the user's profile timezone, which may differ from the browser's.
 * Used for the "When" field: `datetime-local` inputs hold a wall time with no zone.
 */

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** "2026-10-17T08:00" in `timeZone` to an ISO instant. Times skipped by a DST jump move forward. */
export function zonedWallToIso(wall: string, timeZone: string): string {
  const guess = Date.parse(`${wall}:00Z`);
  const first = offsetMs(guess, timeZone);
  let utc = guess - first;
  const second = offsetMs(utc, timeZone);
  // Offsets disagree near a DST change. Use the second one unless it is not self-consistent,
  // which means the wall time falls in the skipped hour; then keep the first (moves forward).
  if (second !== first && offsetMs(guess - second, timeZone) === second) utc = guess - second;
  return new Date(utc).toISOString();
}

/** An ISO instant to "YYYY-MM-DDTHH:mm" wall time in `timeZone`. */
export function isoToZonedWall(iso: string, timeZone: string): string {
  const utc = Date.parse(iso);
  return new Date(utc + offsetMs(utc, timeZone)).toISOString().slice(0, 16);
}

/** "Sat 17 Oct" and "8:05 AM" style labels for an instant, in `timeZone`. */
export function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
