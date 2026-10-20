/**
 * The edit sheet's rules (SPEC page 4, "Editing"). A new amount scales the entry's own
 * nutrient snapshot, exactly as PATCH /api/logs/{id} does; nothing here saves.
 */
import type { LogEntry, LogPatch } from '../api/logs';
import { parseAmount } from './foodAmount';
import { roundHalfUp } from './tdee';
import { isoToZonedWall, zonedWallToIso } from './zoned';

export const MAX_GRAMS = 5000;

export interface EditDraft {
  amount: string;
  /** The entry's serving unit label, or "g". */
  unit: string;
  date: string;
  time: string;
}

export function draftFrom(e: LogEntry, timeZone: string): EditDraft {
  const wall = isoToZonedWall(e.eaten_at, timeZone);
  const byUnit = e.quantity !== null && e.unit_label !== null;
  return {
    amount: String(byUnit ? e.quantity : (e.grams ?? '')),
    unit: byUnit ? (e.unit_label ?? 'g') : 'g',
    date: wall.slice(0, 10),
    time: wall.slice(11, 16),
  };
}

/** Grams in one of the entry's units, when it was logged in a unit. */
export function unitGrams(e: LogEntry): number | null {
  return e.quantity && e.grams ? e.grams / e.quantity : null;
}

export interface DraftRead {
  errors: Partial<Record<'amount' | 'date', string>>;
  /** The amount as grams, or null while it can't be read. */
  grams: number | null;
  quantity: number | null;
  /** "YYYY-MM-DDTHH:mm" in the user's timezone. */
  wall: string;
}

export function readDraft(d: EditDraft, e: LogEntry, today?: string): DraftRead {
  const errors: DraftRead['errors'] = {};
  const n = parseAmount(d.amount);
  const perUnit = d.unit === 'g' ? 1 : unitGrams(e);
  const grams = n !== null && perUnit !== null ? roundHalfUp(n * perUnit, 2) : null;
  if (e.grams !== null && (grams === null || grams > MAX_GRAMS)) {
    errors.amount = 'Enter an amount above 0, up to 5,000 g.';
  }
  if (today && d.date > today) errors.date = 'Choose today or an earlier day.';
  return { errors, grams, quantity: d.unit === 'g' ? null : n, wall: `${d.date}T${d.time}` };
}

/** Only what changed: a time, grams, or a quantity of the same unit. */
export function patchFor(e: LogEntry, r: DraftRead, timeZone: string): LogPatch {
  const patch: LogPatch = {};
  if (r.wall !== isoToZonedWall(e.eaten_at, timeZone)) {
    patch.eaten_at = zonedWallToIso(r.wall, timeZone);
  }
  if (e.grams === null || r.grams === null) return patch;
  if (r.quantity !== null) {
    if (r.quantity !== e.quantity) patch.quantity = r.quantity;
  } else if (r.grams !== e.grams || e.quantity !== null) {
    patch.grams = r.grams;
  }
  return patch;
}

/** Live preview of the scaled nutrients, rounded to cents like the server. */
export function previewFor(e: LogEntry, grams: number | null) {
  if (grams === null || !e.grams) return null;
  const f = grams / e.grams;
  const s = (x: number) => roundHalfUp(x * f, 2);
  return { kcal: s(e.kcal), protein_g: s(e.protein_g), fat_g: s(e.fat_g), carbs_g: s(e.carbs_g) };
}
