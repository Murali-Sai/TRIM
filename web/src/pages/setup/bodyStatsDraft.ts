import type { UnitSystem } from '../../api/auth';
import {
  ftInToCm,
  validateBodyStats,
  type ActivityLevel,
  type BodyStatsField,
  type Sex,
} from '../../lib/tdee';
import { cmToFtIn, formatNumber, kgToLb, lbToKg, parseDecimal } from '../../lib/units';

export interface BodyStatsValues {
  sex: Sex;
  age: number;
  weight_kg: number;
  height_cm: number;
  activity: ActivityLevel;
  unit_system: UnitSystem;
}

/** What is typed in the body stats fields, as text, in the units on screen. */
export interface BodyStatsDraft {
  units: UnitSystem;
  age: string;
  sex: Sex | '';
  weight: string;
  heightCm: string;
  feet: string;
  inches: string;
  activity: ActivityLevel | '';
}

export type BodyStatsErrors = Partial<Record<BodyStatsField | 'sex' | 'activity', string>>;

export function draftFrom(initial: {
  unit_system: UnitSystem;
  sex: Sex | null;
  age: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  activity: ActivityLevel | null;
}): BodyStatsDraft {
  const units = initial.unit_system;
  const kg = initial.weight_kg;
  const fi = initial.height_cm ? cmToFtIn(initial.height_cm) : null;
  return {
    units,
    age: initial.age?.toString() ?? '',
    sex: initial.sex ?? '',
    weight: kg === null ? '' : units === 'imperial' ? formatNumber(kgToLb(kg), 1) : String(kg),
    heightCm: initial.height_cm?.toString() ?? '',
    feet: fi?.ft.toString() ?? '',
    inches: fi?.in.toString() ?? '',
    activity: initial.activity ?? '',
  };
}

/** Carries what was typed across, so switching units never loses an entry. */
export function switchUnits(d: BodyStatsDraft, next: UnitSystem): BodyStatsDraft {
  if (next === d.units) return d;
  const out = { ...d, units: next };
  const w = parseDecimal(d.weight);
  if (!Number.isNaN(w)) {
    out.weight = next === 'imperial' ? formatNumber(kgToLb(w), 1) : formatNumber(lbToKg(w), 1);
  }
  if (next === 'imperial') {
    const cm = parseDecimal(d.heightCm);
    if (!Number.isNaN(cm)) {
      const fi = cmToFtIn(cm);
      out.feet = String(fi.ft);
      out.inches = String(fi.in);
    }
  } else {
    const ft = parseDecimal(d.feet);
    if (!Number.isNaN(ft)) {
      out.heightCm = formatNumber(ftInToCm(ft, parseDecimal(d.inches) || 0), 1);
    }
  }
  return out;
}

/** Converts to kg and cm and validates. `values` is null while anything is missing or wrong. */
export function readDraft(d: BodyStatsDraft): {
  values: BodyStatsValues | null;
  errors: BodyStatsErrors;
} {
  const w = parseDecimal(d.weight);
  const weightKg = d.units === 'imperial' ? lbToKg(w) : w;
  const heightCm =
    d.units === 'imperial'
      ? ftInToCm(parseDecimal(d.feet), d.inches.trim() === '' ? 0 : parseDecimal(d.inches))
      : parseDecimal(d.heightCm);
  const age = parseDecimal(d.age);

  const errors: BodyStatsErrors = validateBodyStats({
    age,
    weight_kg: weightKg,
    height_cm: heightCm,
  });
  if (!d.sex) errors.sex = 'Choose one.';
  if (!d.activity) errors.activity = 'Choose your activity level.';
  if (Object.keys(errors).length > 0 || !d.sex || !d.activity) return { values: null, errors };
  return {
    values: {
      sex: d.sex,
      age,
      weight_kg: weightKg,
      height_cm: heightCm,
      activity: d.activity,
      unit_system: d.units,
    },
    errors,
  };
}
