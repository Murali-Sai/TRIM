/**
 * The Targets editor's rules (SPEC page 3, "Custom targets"): editing calories, protein or fat
 * recalculates carbs as the rest, unless the user has typed carbs too. Nothing here saves.
 */
import { formatNumber, parseDecimal } from './units';
import {
  ACTIVITY_LEVELS,
  bmr,
  carbsForRest,
  roundHalfUp,
  KCAL_PER_G,
  type ActivityLevel,
  type Sex,
} from './tdee';

/** Same ranges as the API's POST /targets. */
export const TARGET_LIMITS = { kcal: { min: 500, max: 10000 }, grams: { max: 1500 } } as const;

export type EditorField = 'kcal' | 'protein' | 'fat' | 'carbs';

export interface EditorState {
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
  /** True once the user types carbs; then calorie edits stop changing them. */
  carbsEdited: boolean;
}

export interface TargetValues {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

export function editorFrom(t: TargetValues): EditorState {
  return {
    kcal: String(t.kcal),
    protein: String(t.protein_g),
    fat: String(t.fat_g),
    carbs: String(t.carbs_g),
    carbsEdited: false,
  };
}

function whole(raw: string): number {
  const n = parseDecimal(raw);
  return Number.isFinite(n) ? roundHalfUp(n) : NaN;
}

export function editField(state: EditorState, field: EditorField, raw: string): EditorState {
  const next = { ...state, [field]: raw };
  if (field === 'carbs') return { ...next, carbsEdited: true };
  if (next.carbsEdited) return next;
  const kcal = whole(next.kcal);
  const protein = whole(next.protein);
  const fat = whole(next.fat);
  // Keep the last carbs while a number is half typed.
  if ([kcal, protein, fat].some(Number.isNaN)) return next;
  return { ...next, carbs: String(carbsForRest(kcal, protein, fat).carbs_g) };
}

/** Back to "carbs are the rest" after the user typed them. */
export function carbsAsRest(state: EditorState): EditorState {
  return editField({ ...state, carbsEdited: false }, 'kcal', state.kcal);
}

export interface EditorRead {
  errors: Partial<Record<EditorField, string>>;
  /** carbs_g null: carbs are the rest, and the server recalculates them the same way. */
  values: { kcal: number; protein_g: number; fat_g: number; carbs_g: number | null } | null;
  /** Protein and fat already use the whole calorie target. */
  clamped: boolean;
  /** What the macros add up to, when every field is readable. */
  kcalFromMacros: number | null;
}

const NAMES: Record<Exclude<EditorField, 'kcal'>, string> = {
  protein: 'protein',
  fat: 'fat',
  carbs: 'carbs',
};

export function readEditor(state: EditorState): EditorRead {
  const errors: EditorRead['errors'] = {};
  const kcal = whole(state.kcal);
  const { min, max } = TARGET_LIMITS.kcal;
  if (!(kcal >= min && kcal <= max)) {
    errors.kcal = `Enter calories from ${formatNumber(min)} to ${formatNumber(max)}.`;
  }
  const grams = (field: Exclude<EditorField, 'kcal'>): number => {
    const g = whole(state[field]);
    if (!(g >= 0 && g <= TARGET_LIMITS.grams.max)) {
      errors[field] = `Enter ${NAMES[field]} from 0 to ${formatNumber(TARGET_LIMITS.grams.max)} g.`;
    }
    return g;
  };
  const protein = grams('protein');
  const fat = grams('fat');
  const carbs = state.carbsEdited ? grams('carbs') : whole(state.carbs);
  const ok = Object.keys(errors).length === 0;
  const clamped = !state.carbsEdited && ok && carbsForRest(kcal, protein, fat).carbs_clamped;
  const readable = ok && !Number.isNaN(carbs);
  return {
    errors,
    values: ok
      ? { kcal, protein_g: protein, fat_g: fat, carbs_g: state.carbsEdited ? carbs : null }
      : null,
    clamped,
    kcalFromMacros: readable
      ? KCAL_PER_G.protein * protein + KCAL_PER_G.fat * fat + KCAL_PER_G.carbs * carbs
      : null,
  };
}

/** The calculator's table: maintenance calories at each of the five activity levels. */
export function tdeeByActivity(input: {
  sex: Sex;
  age: number;
  weight_kg: number;
  height_cm: number;
}): { value: ActivityLevel; label: string; factor: number; tdee: number }[] {
  const base = bmr(input.sex, input.age, input.weight_kg, input.height_cm);
  return ACTIVITY_LEVELS.map((a) => ({ ...a, tdee: roundHalfUp(base * a.factor) }));
}
