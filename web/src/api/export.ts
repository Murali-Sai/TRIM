import { postFileBody, postForFile } from './client';

export type ExportFormat = 'xlsx' | 'csv' | 'json';

/** In the order of the dataset picker (SPEC page 4, Download my data). */
export const DATASETS = [
  ['food_log', 'Food log'],
  ['daily_totals', 'Daily totals'],
  ['saved_meals', 'Saved meals'],
  ['staples', 'Staples'],
  ['weight', 'Weight'],
  ['measurements', 'Measurements'],
  ['water', 'Water'],
  ['targets', 'Targets history'],
  ['phases', 'Phases'],
  ['checkins', 'Weekly check-ins'],
  ['streaks', 'Streaks and badges'],
  ['custom_foods', 'Custom foods'],
  ['profile', 'Profile'],
] as const;

export type DatasetKey = (typeof DATASETS)[number][0];

export interface ExportRequest {
  format: ExportFormat;
  date_from: string | null;
  date_to: string | null;
  datasets: DatasetKey[];
}

const EXT: Record<ExportFormat, string> = { xlsx: 'xlsx', csv: 'zip', json: 'json' };

function isAppleMobile(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/**
 * Asks the server for the file and hands it to the browser: on iPhone and iPad the share
 * sheet (so it can be saved to Files), elsewhere an ordinary download. Returns the file name.
 */
export async function downloadExport(req: ExportRequest, today: string): Promise<string> {
  const { blob, name: given } = await postForFile('/export', req);
  const name = given ?? `trim-export-${today}.${EXT[req.format]}`;
  const file = new File([blob], name, { type: blob.type });
  if (isAppleMobile() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return name;
    } catch {
      // Closed or not allowed: fall back to a plain download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/** Restores an account from a JSON export; the server takes it only into an empty account. */
export function importExport(file: File) {
  return postFileBody<{ imported: Partial<Record<DatasetKey, number>> }>('/import', file);
}
