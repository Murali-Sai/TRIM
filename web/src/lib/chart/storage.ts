/** Per-chart conveniences (the last range chosen, a dismissed note). Storage can be missing or
 * blocked, so every read and write is guarded and the charts work without it. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A convenience only.
  }
}
