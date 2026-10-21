import type { MeasureUnit } from '../api/measurements';
import { formatNumber } from './units';

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

/** What a unit stores: lengths in cm, masses in kg, percentages as they are. */
export function kindOf(unit: MeasureUnit): 'length' | 'mass' | 'percent' | 'text' {
  if (unit === 'cm' || unit === 'in') return 'length';
  if (unit === 'kg' || unit === 'lb') return 'mass';
  return unit === '%' ? 'percent' : 'text';
}

/** A stored value (cm, kg or %) in the metric's unit. */
export function toDisplay(stored: number, unit: MeasureUnit): number {
  if (unit === 'in') return stored / CM_PER_IN;
  if (unit === 'lb') return stored / KG_PER_LB;
  return stored;
}

/** What a person typed, in the metric's unit, as the stored value. */
export function fromDisplay(shown: number, unit: MeasureUnit): number {
  if (unit === 'in') return shown * CM_PER_IN;
  if (unit === 'lb') return shown * KG_PER_LB;
  return shown;
}

/** "90.0 cm", "35.4 in", "18.4%". */
export function formatReading(stored: number, unit: MeasureUnit, precision: number): string {
  const shown = formatNumber(toDisplay(stored, unit), precision);
  return unit === '%' ? `${shown}%` : `${shown} ${unit}`;
}

export const UNIT_OPTIONS: readonly [MeasureUnit, string][] = [
  ['cm', 'centimeters (cm)'],
  ['in', 'inches (in)'],
  ['%', 'percent (%)'],
  ['kg', 'kilograms (kg)'],
  ['lb', 'pounds (lb)'],
  ['text', 'text (a word or note)'],
];

export function unitLabel(unit: MeasureUnit): string {
  return UNIT_OPTIONS.find(([u]) => u === unit)?.[1] ?? unit;
}
