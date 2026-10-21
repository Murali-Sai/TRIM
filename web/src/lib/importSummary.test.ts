import { describe, expect, it } from 'vitest';
import { importSummary } from './importSummary';

describe('importSummary', () => {
  it('lists what came in', () => {
    expect(importSummary({ food_log: 1200, weight: 1, phases: 2, profile: 1, water: 0 })).toBe(
      'Imported 1,200 food entries, 1 weigh-in and 2 phases.',
    );
    expect(importSummary({ staples: 3 })).toBe('Imported 3 staples.');
    expect(importSummary({ profile: 1 })).toBe('Imported your profile. The file had no entries.');
  });
});
