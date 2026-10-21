import type { DatasetKey } from '../api/export';
import { formatNumber } from './units';

const NOUNS: Partial<Record<DatasetKey, [string, string]>> = {
  food_log: ['food entry', 'food entries'],
  weight: ['weigh-in', 'weigh-ins'],
  measurements: ['measurement', 'measurements'],
  water: ['water entry', 'water entries'],
  saved_meals: ['saved meal', 'saved meals'],
  custom_foods: ['custom food', 'custom foods'],
  staples: ['staple', 'staples'],
  targets: ['target', 'targets'],
  phases: ['phase', 'phases'],
  streaks: ['badge', 'badges'],
};

/** "Imported 120 food entries, 30 weigh-ins and 2 phases." (what came in, nothing that did not) */
export function importSummary(counts: Partial<Record<DatasetKey, number>>): string {
  const parts = (Object.keys(NOUNS) as DatasetKey[])
    .filter((k) => (counts[k] ?? 0) > 0)
    .map((k) => {
      const n = counts[k] ?? 0;
      const [one, many] = NOUNS[k] ?? ['row', 'rows'];
      return `${formatNumber(n)} ${n === 1 ? one : many}`;
    });
  if (parts.length === 0) return 'Imported your profile. The file had no entries.';
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `Imported ${list}.`;
}
