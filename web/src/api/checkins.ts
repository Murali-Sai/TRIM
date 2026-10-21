import { getJson } from './client';

export interface CheckinSummary {
  /** The week's Monday and Sunday (YYYY-MM-DD). */
  week_start: string;
  week_end: string;
  /** "Avg 2,310 kcal, on target 5 of 7 days" */
  headline: string;
  read: boolean;
  /** Its first three sentences. */
  preview: string[];
}

export interface Checkin extends CheckinSummary {
  /** Every sentence, in plain words. */
  lines: string[];
}

export const CHECKINS_KEY = ['checkins'] as const;

export function listCheckins() {
  return getJson<CheckinSummary[]>('/checkins');
}

/** Opening a check-in marks it read. */
export function getCheckin(week: string) {
  return getJson<Checkin>(`/checkins/${week}`);
}
