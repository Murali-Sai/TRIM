/**
 * What is waiting to be logged on Log food: foods with an amount, or quick adds. Also reads the
 * quick add and custom food forms. Nothing here saves; the server recomputes every number.
 */
import type { CustomFoodInput, Food, QuickFood } from '../api/foods';
import type { LogItem, QuickAdd } from '../api/logs';
import { GRAMS, nutrientsFor, parseAmount } from './foodAmount';
import { formatNumber, parseDecimal } from './units';

export type PickedSource = 'search' | 'recent';

export type Picked =
  | {
      kind: 'food';
      food: Food;
      quantity: number;
      /** A serving label, or "g" for grams. */
      unit: string;
      grams: number;
      source: PickedSource;
    }
  | { kind: 'quick'; quick: QuickAdd };

/** One tap from a recent or favourite: the last serving, else the default serving, else 100 g. */
export function fromLastServing(food: QuickFood | Food, source: PickedSource): Picked {
  const last = 'last' in food ? food.last : null;
  if (last) {
    const unit = last.unit_label && food.servings.some((s) => s.label === last.unit_label);
    return unit && last.quantity !== null && last.unit_label
      ? {
          kind: 'food',
          food,
          quantity: last.quantity,
          unit: last.unit_label,
          grams: last.grams,
          source,
        }
      : { kind: 'food', food, quantity: last.grams, unit: GRAMS.label, grams: last.grams, source };
  }
  const serving = food.servings.find((s) => s.is_default) ?? food.servings[0];
  return serving
    ? { kind: 'food', food, quantity: 1, unit: serving.label, grams: serving.grams, source }
    : { kind: 'food', food, quantity: 100, unit: GRAMS.label, grams: 100, source };
}

export function toItem(p: Picked): LogItem {
  if (p.kind === 'quick') return { quick: p.quick };
  return p.unit === GRAMS.label
    ? { food_id: p.food.id, grams: p.grams, source: p.source }
    : { food_id: p.food.id, quantity: p.quantity, unit_label: p.unit, source: p.source };
}

export function amountText(p: Picked): string {
  if (p.kind === 'quick') return 'Quick add';
  return p.unit === GRAMS.label
    ? `${formatNumber(p.grams)} g`
    : `${formatNumber(p.quantity, p.quantity % 1 ? 1 : 0)} x ${p.unit}`;
}

export function pickedName(p: Picked): string {
  return p.kind === 'quick' ? p.quick.name || 'Quick add' : p.food.name;
}

export function pickedNutrients(p: Picked) {
  if (p.kind === 'quick') {
    const { kcal, protein_g, fat_g, carbs_g } = p.quick;
    return { kcal, protein_g, fat_g, carbs_g };
  }
  return nutrientsFor(p.food, p.grams);
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function totalsOf(list: readonly Picked[]) {
  const t = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
  for (const p of list) {
    const n = pickedNutrients(p);
    t.kcal += n.kcal;
    t.protein_g += n.protein_g;
    t.fat_g += n.fat_g;
    t.carbs_g += n.carbs_g;
  }
  return {
    kcal: r2(t.kcal),
    protein_g: r2(t.protein_g),
    fat_g: r2(t.fat_g),
    carbs_g: r2(t.carbs_g),
  };
}

// --- forms ----------------------------------------------------------------------------------

/** An optional number: empty is unknown (null); anything else must parse. */
function optional(raw: string): number | null | 'bad' {
  if (raw.trim() === '') return null;
  const n = parseDecimal(raw);
  return Number.isFinite(n) && n >= 0 ? n : 'bad';
}

const NUMBER = 'Enter a number, or leave it empty.';

export interface QuickDraft {
  name: string;
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
}

export function readQuickAdd(d: QuickDraft): {
  value: QuickAdd | null;
  errors: Partial<Record<keyof QuickDraft, string>>;
} {
  const errors: Partial<Record<keyof QuickDraft, string>> = {};
  const raw = optional(d.kcal);
  const kcal = raw === 'bad' ? null : raw;
  if (kcal === null) errors.kcal = 'Enter calories.';
  const macro = (k: 'protein' | 'fat' | 'carbs') => {
    const v = optional(d[k]);
    if (v === 'bad') errors[k] = NUMBER;
    return v === 'bad' || v === null ? 0 : v;
  };
  const value = {
    name: d.name.trim() || null,
    kcal: kcal ?? 0,
    protein_g: macro('protein'),
    carbs_g: macro('carbs'),
    fat_g: macro('fat'),
  };
  return { value: Object.keys(errors).length ? null : value, errors };
}

export interface CustomDraft {
  name: string;
  brand: string;
  per: '100g' | 'serving';
  servingLabel: string;
  servingGrams: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  sugar: string;
  sodium: string;
}

export function emptyCustomDraft(name = ''): CustomDraft {
  return {
    name,
    brand: '',
    per: 'serving',
    servingLabel: '1 serving',
    servingGrams: '',
    kcal: '',
    protein: '',
    carbs: '',
    fat: '',
    fiber: '',
    sugar: '',
    sodium: '',
  };
}

export function readCustomFood(d: CustomDraft): {
  value: CustomFoodInput | null;
  errors: Partial<Record<keyof CustomDraft, string>>;
  /** The values per 100 g, as the server will store them. */
  per100: { kcal: number } | null;
  /** Calories and 4P + 4C + 9F differ by more than 15% (worth a second look). */
  mismatch: boolean;
} {
  const errors: Partial<Record<keyof CustomDraft, string>> = {};
  if (!d.name.trim()) errors.name = 'Enter a name.';
  const need = (k: 'kcal' | 'protein' | 'carbs' | 'fat', message: string) => {
    const v = optional(d[k]);
    if (v === null) {
      if (k === 'kcal') errors.kcal = message;
      return 0;
    }
    if (v === 'bad') errors[k] = NUMBER;
    return v === 'bad' ? 0 : v;
  };
  const kcal = need('kcal', 'Enter calories.');
  const protein = need('protein', '');
  const carbs = need('carbs', '');
  const fat = need('fat', '');
  const extra = (k: 'fiber' | 'sugar' | 'sodium') => {
    const v = optional(d[k]);
    if (v === 'bad') errors[k] = NUMBER;
    return v === 'bad' ? null : v;
  };
  const fiber = extra('fiber');
  const sugar = extra('sugar');
  const sodium = extra('sodium');
  let servingGrams: number | null = null;
  if (d.per === 'serving' || d.servingGrams.trim() !== '') {
    servingGrams = parseAmount(d.servingGrams);
    if (servingGrams === null) errors.servingGrams = 'Enter what one serving weighs.';
    if (!d.servingLabel.trim()) errors.servingLabel = 'Name the serving, for example "1 bar".';
  }
  const fromMacros = 4 * protein + 4 * carbs + 9 * fat;
  const larger = Math.max(kcal, fromMacros);
  const mismatch = larger > 0 && Math.abs(kcal - fromMacros) > 0.15 * larger;
  if (Object.keys(errors).length) return { value: null, errors, per100: null, mismatch };
  const factor = d.per === 'serving' && servingGrams ? 100 / servingGrams : 1;
  return {
    value: {
      name: d.name.trim(),
      brand: d.brand.trim() || null,
      per: d.per,
      serving_label: servingGrams ? d.servingLabel.trim() : null,
      serving_grams: servingGrams,
      kcal,
      protein_g: protein,
      carbs_g: carbs,
      fat_g: fat,
      fiber_g: fiber,
      sugar_g: sugar,
      sodium_mg: sodium,
    },
    errors,
    per100: { kcal: r2(kcal * factor) },
    mismatch,
  };
}
