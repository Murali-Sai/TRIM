/**
 * TDEE calculator and default macro targets, exactly as in SPEC page 3.
 * Mirrors api/app/tdee.py; both pass shared/tdee_vectors.json.
 * Everything is computed unrounded and rounded once at the end.
 */

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'heavy' | 'athlete';
export type Plan = 'maintain' | 'lose';
export type RuleSet = 'standard' | 'high_bmi';
export type Deficit = 600 | 650 | 700;

export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;
export const LB_IN_KG = 0.45359237;
export const CM_PER_IN = 2.54;

export const ACTIVITY_LEVELS: readonly { value: ActivityLevel; label: string; factor: number }[] = [
  { value: 'sedentary', label: 'Sedentary (office job)', factor: 1.2 },
  { value: 'light', label: 'Light exercise (1 to 3 days a week)', factor: 1.375 },
  { value: 'moderate', label: 'Moderate exercise (3 to 5 days a week)', factor: 1.55 },
  { value: 'heavy', label: 'Heavy exercise (6 to 7 days a week)', factor: 1.725 },
  { value: 'athlete', label: 'Athlete (2 times a day)', factor: 1.9 },
];

export const DEFICITS: readonly Deficit[] = [600, 650, 700];
export const DEFAULT_DEFICIT: Deficit = 650;
export const CALORIE_FLOOR: Record<Sex, number> = { male: 1500, female: 1200 };
export const KCAL_PER_KG_FAT = 7700;

export const LIMITS = {
  age: { min: 18, max: 100 },
  weight_kg: { min: 30, max: 300 },
  height_cm: { min: 120, max: 230 },
} as const;

/**
 * Round half up to `digits` decimals. The value is first snapped to 9 decimals so binary noise
 * (1780 x 1.725 = 3070.4999...) rounds the way the decimal arithmetic in the SPEC does.
 */
export function roundHalfUp(x: number, digits = 0): number {
  const scale = 10 ** digits;
  return Math.floor(Number((x * scale).toFixed(9)) + 0.5) / scale;
}

/** Fiber: the Adequate Intake of 14 g per 1,000 kcal (SPEC page 3); 2,759 kcal gives 39 g. */
export const FIBER_G_PER_1000_KCAL = 14;

export function fiberDefault(kcal: number): number {
  return roundHalfUp((kcal * FIBER_G_PER_1000_KCAL) / 1000);
}

export function lbToKg(lb: number): number {
  return lb * LB_IN_KG;
}

export function kgToLb(kg: number): number {
  return kg / LB_IN_KG;
}

export function ftInToCm(ft: number, inches: number): number {
  return (ft * 12 + inches) * CM_PER_IN;
}

export function activityFactor(level: ActivityLevel): number {
  const found = ACTIVITY_LEVELS.find((a) => a.value === level);
  if (!found) throw new Error(`Unknown activity level: ${level}`);
  return found.factor;
}

/** Mifflin-St Jeor. */
export function bmr(sex: Sex, age: number, weightKg: number, heightCm: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

/** BMI as shown to the user (one decimal). Plan and rule choices use this same value. */
export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return roundHalfUp(weightKg / (m * m), 1);
}

export function suggestedPlan(bmiValue: number): Plan {
  return bmiValue >= 25 ? 'lose' : 'maintain';
}

/** BMI 30 or more uses 0.7 g/lb protein and 25% fat, whichever plan the user picks. */
export function ruleSetFor(bmiValue: number): RuleSet {
  return bmiValue >= 30 ? 'high_bmi' : 'standard';
}

export interface Macros {
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  /** True when protein and fat alone use the whole target, so carbs were set to 0. */
  carbs_clamped: boolean;
  raw: { protein_g: number; fat_g: number; carbs_g: number };
}

export function macrosFor(targetKcal: number, weightKg: number, ruleSet: RuleSet): Macros {
  const lb = kgToLb(weightKg);
  const protein = (ruleSet === 'high_bmi' ? 0.7 : 0.8) * lb;
  const fat = ruleSet === 'high_bmi' ? (0.25 * targetKcal) / KCAL_PER_G.fat : 0.3 * lb;
  const carbsRaw =
    (targetKcal - KCAL_PER_G.protein * protein - KCAL_PER_G.fat * fat) / KCAL_PER_G.carbs;
  const clamped = carbsRaw < 0;
  const carbs = clamped ? 0 : carbsRaw;
  return {
    protein_g: roundHalfUp(protein),
    fat_g: roundHalfUp(fat),
    carbs_g: roundHalfUp(carbs),
    carbs_clamped: clamped,
    raw: { protein_g: protein, fat_g: fat, carbs_g: carbs },
  };
}

/**
 * Custom edits (SPEC page 3, "Custom targets"): protein and fat stay as the user has them and
 * carbs fill the rest of the calorie target.
 */
export function carbsForRest(
  kcal: number,
  proteinG: number,
  fatG: number,
): { carbs_g: number; carbs_clamped: boolean } {
  const rest = (kcal - KCAL_PER_G.protein * proteinG - KCAL_PER_G.fat * fatG) / KCAL_PER_G.carbs;
  if (rest < 0) return { carbs_g: 0, carbs_clamped: true };
  return { carbs_g: roundHalfUp(rest), carbs_clamped: false };
}

export interface CalcInput {
  sex: Sex;
  age: number;
  weight_kg: number;
  height_cm: number;
  activity: ActivityLevel;
  /** Omit to use the suggested plan. */
  plan?: Plan;
  /** Used only for the Lose plan; defaults to 650. */
  deficit_kcal?: Deficit;
}

export interface CalcResult {
  bmr: number;
  tdee: number;
  weekly_tdee: number;
  bmi: number;
  suggested_plan: Plan;
  plan: Plan;
  rule_set: RuleSet;
  deficit_kcal: number;
  target_kcal: number;
  floor_applied: boolean;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  carbs_clamped: boolean;
  /** Rough weekly loss at 7,700 kcal per kg, for display only. */
  pace_kg_per_week: number;
  raw: {
    bmr: number;
    tdee: number;
    weight_lb: number;
    target_kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  };
}

export function calculate(input: CalcInput): CalcResult {
  const bmrRaw = bmr(input.sex, input.age, input.weight_kg, input.height_cm);
  const tdeeRaw = bmrRaw * activityFactor(input.activity);
  const bmiValue = bmi(input.weight_kg, input.height_cm);
  const suggested = suggestedPlan(bmiValue);
  const plan = input.plan ?? suggested;
  const ruleSet = ruleSetFor(bmiValue);

  const deficit = plan === 'lose' ? (input.deficit_kcal ?? DEFAULT_DEFICIT) : 0;
  let target = tdeeRaw - deficit;
  // The floor guards against too steep a deficit; maintenance is left as calculated.
  const floor = CALORIE_FLOOR[input.sex];
  const floorApplied = plan === 'lose' && target < floor;
  if (floorApplied) target = floor;

  const m = macrosFor(target, input.weight_kg, ruleSet);
  const actualDeficit = Math.max(0, tdeeRaw - target);
  return {
    bmr: roundHalfUp(bmrRaw),
    tdee: roundHalfUp(tdeeRaw),
    weekly_tdee: roundHalfUp(tdeeRaw * 7),
    bmi: bmiValue,
    suggested_plan: suggested,
    plan,
    rule_set: ruleSet,
    deficit_kcal: deficit,
    target_kcal: roundHalfUp(target),
    floor_applied: floorApplied,
    protein_g: m.protein_g,
    fat_g: m.fat_g,
    carbs_g: m.carbs_g,
    carbs_clamped: m.carbs_clamped,
    pace_kg_per_week: plan === 'lose' ? roundHalfUp((actualDeficit * 7) / KCAL_PER_KG_FAT, 2) : 0,
    raw: {
      bmr: bmrRaw,
      tdee: tdeeRaw,
      weight_lb: kgToLb(input.weight_kg),
      target_kcal: target,
      ...m.raw,
    },
  };
}

export type BodyStatsField = keyof typeof LIMITS;

/** Errors keyed by field, in form order. Empty when everything is in range. */
export function validateBodyStats(input: {
  age: number;
  weight_kg: number;
  height_cm: number;
}): Partial<Record<BodyStatsField, string>> {
  const errors: Partial<Record<BodyStatsField, string>> = {};
  const { age, weight_kg: w, height_cm: h } = input;
  if (!Number.isInteger(age) || age < LIMITS.age.min || age > LIMITS.age.max) {
    errors.age = 'Enter an age from 18 to 100.';
  }
  if (!Number.isFinite(w) || w < LIMITS.weight_kg.min || w > LIMITS.weight_kg.max) {
    errors.weight_kg = 'Enter a weight from 30 to 300 kg (66 to 661 lb).';
  }
  if (!Number.isFinite(h) || h < LIMITS.height_cm.min || h > LIMITS.height_cm.max) {
    errors.height_cm = 'Enter a height from 120 to 230 cm (3 ft 11 in to 7 ft 6 in).';
  }
  return errors;
}
