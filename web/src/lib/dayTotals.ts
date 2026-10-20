/**
 * Day totals and the Today target strip (SPEC page 4). Totals are summed from the unrounded
 * entry values and rounded once, so they can differ by 1 or 2 from the rounded items added up.
 */
import { formatNumber } from './units';

type Macro = 'kcal' | 'protein_g' | 'fat_g' | 'carbs_g';
type Extra = 'fiber_g' | 'sugar_g' | 'sodium_mg';

export const MACROS: readonly { key: Macro; label: string; unit: string; color: string }[] = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', color: 'kcal' },
  { key: 'protein_g', label: 'Protein', unit: 'g', color: 'protein' },
  { key: 'fat_g', label: 'Fat', unit: 'g', color: 'fat' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g', color: 'carbs' },
];

const EXTRAS = ['fiber_g', 'sugar_g', 'sodium_mg'] as const;

export type MacroTotals = Record<Macro, number>;
export type DayTotals = MacroTotals &
  Record<Extra, number> & {
    /** Entries whose value is unknown (null), so the sum may be low. */
    unknown: Record<Extra, number>;
  };

type Nutrients = Record<Macro, number> & Record<Extra, number | null>;

export function sumNutrients(entries: readonly Nutrients[]): DayTotals {
  const t: DayTotals = {
    kcal: 0,
    protein_g: 0,
    fat_g: 0,
    carbs_g: 0,
    fiber_g: 0,
    sugar_g: 0,
    sodium_mg: 0,
    unknown: { fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
  };
  for (const e of entries) {
    for (const m of MACROS) t[m.key] += e[m.key];
    for (const x of EXTRAS) {
      const v = e[x];
      if (v === null) t.unknown[x] += 1;
      else t[x] += v;
    }
  }
  // Keep sums free of binary noise (0.1 + 0.2) before display rounding.
  for (const k of [...MACROS.map((m) => m.key), ...EXTRAS]) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

export interface StripColumn {
  key: Macro;
  label: string;
  unit: string;
  color: string;
  /** Rounded once from the unrounded total. */
  eaten: number;
  target: number;
  /** Whole percent of target, or null for a 0 target. */
  pct: number | null;
  /** Bar fill from 0 to 1; full once at or over target. */
  fill: number;
  /** How far over target, rounded; 0 when not over. */
  over: number;
}

export function stripColumns(totals: MacroTotals, target: MacroTotals): StripColumn[] {
  return MACROS.map((m) => {
    const eaten = totals[m.key];
    const goal = target[m.key];
    const ratio = goal > 0 ? eaten / goal : null;
    return {
      ...m,
      eaten: Math.round(eaten),
      target: goal,
      pct: ratio === null ? null : Math.round(ratio * 100),
      fill: ratio === null ? 0 : Math.min(1, Math.max(0, ratio)),
      over: Math.max(0, Math.round(eaten - goal)),
    };
  });
}

/** The strip's second page: what is left of each target, or how far over. */
export function remainingColumns(totals: MacroTotals, target: MacroTotals) {
  return MACROS.map((m) => {
    const diff = target[m.key] - totals[m.key];
    return {
      ...m,
      left: Math.max(0, Math.round(diff)),
      over: Math.max(0, Math.round(-diff)),
    };
  });
}

/** The target row in effect on `day`. Rows are newest first, as GET /api/targets sends them. */
export function targetOn<T extends { effective_from: string }>(
  rows: readonly T[],
  day: string,
): T | null {
  return rows.find((r) => r.effective_from <= day) ?? null;
}

/** "350 g", or a quantity of a serving unit: "2 cup" for "1 cup", "4 egg". */
export function amountLabel(e: {
  grams: number | null;
  quantity: number | null;
  unit_label: string | null;
}): string {
  if (e.quantity !== null && e.unit_label) {
    const unit = e.unit_label.replace(/^1 /, '');
    return `${formatNumber(e.quantity, e.quantity % 1 ? 1 : 0)} ${unit}`;
  }
  return e.grams !== null ? `${formatNumber(e.grams, e.grams % 1 ? 1 : 0)} g` : '';
}
