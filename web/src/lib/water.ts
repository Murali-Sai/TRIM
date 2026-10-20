/** Water (SPEC page 3, Water): stored in ml; fl oz only for display and input. */
import { formatNumber, parseDecimal } from './units';

export type WaterUnit = 'ml' | 'fl_oz';

export const ML_PER_FL_OZ = 29.5735;
export const MAX_WATER_ML = 5000;

/** Whole ml, as stored. */
export function flOzToMl(flOz: number): number {
  return Math.round(flOz * ML_PER_FL_OZ);
}

export function mlToFlOz(ml: number): number {
  return ml / ML_PER_FL_OZ;
}

/** "1,750 ml" or "68 fl oz" */
export function formatWater(ml: number, unit: WaterUnit): string {
  return unit === 'ml'
    ? `${formatNumber(Math.round(ml))} ml`
    : `${formatNumber(Math.round(mlToFlOz(ml)))} fl oz`;
}

export function waterButtons(unit: WaterUnit): { label: string; ml: number }[] {
  return unit === 'ml'
    ? [
        { label: '+250 ml', ml: 250 },
        { label: '+500 ml', ml: 500 },
      ]
    : [
        { label: '+8 fl oz', ml: flOzToMl(8) },
        { label: '+16 fl oz', ml: flOzToMl(16) },
      ];
}

/** A typed amount in the user's unit as whole ml, or null when it is not 1 to 5,000 ml. */
export function parseWater(raw: string, unit: WaterUnit): number | null {
  const n = parseDecimal(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ml = unit === 'ml' ? Math.round(n) : flOzToMl(n);
  return ml > 0 && ml <= MAX_WATER_ML ? ml : null;
}
