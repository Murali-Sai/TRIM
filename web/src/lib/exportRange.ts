import { addDays } from './nutritionSeries';

export type RangeChoice = 'all' | '30' | '90' | 'year' | 'custom';

export const RANGE_CHOICES: readonly [RangeChoice, string][] = [
  ['all', 'All time'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['year', 'This year'],
  ['custom', 'Custom'],
];

/** The dates an export asks for; null means no limit on that side. Days count today. */
export function exportDates(
  choice: RangeChoice,
  today: string,
  custom: { from: string; to: string } = { from: '', to: '' },
): { date_from: string | null; date_to: string | null } {
  switch (choice) {
    case 'all':
      return { date_from: null, date_to: null };
    case '30':
      return { date_from: addDays(today, -29), date_to: today };
    case '90':
      return { date_from: addDays(today, -89), date_to: today };
    case 'year':
      return { date_from: `${today.slice(0, 4)}-01-01`, date_to: today };
    case 'custom':
      return { date_from: custom.from || null, date_to: custom.to || null };
  }
}
