import type { UnitSystem } from './api/auth';

// Countries that use pounds, feet and inches day to day.
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

/** Default units from the browser locale: imperial in the US, metric elsewhere. */
export function defaultUnitSystem(locale: string | undefined): UnitSystem {
  if (!locale) return 'metric';
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).maximize().region;
  } catch {
    return 'metric';
  }
  return region && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
}

export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
