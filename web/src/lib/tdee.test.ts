import vectors from '../../../shared/tdee_vectors.json';
import {
  calculate,
  ftInToCm,
  lbToKg,
  macrosFor,
  validateBodyStats,
  type CalcInput,
  type RuleSet,
} from './tdee';

// The same vectors run in api/tests/test_tdee.py, so both implementations agree.

type Expect = Record<string, unknown> & { raw?: Record<string, number> };

function check(actual: Record<string, unknown>, expected: Expect) {
  for (const [key, want] of Object.entries(expected)) {
    if (key === 'raw') continue;
    expect({ [key]: actual[key] }).toEqual({ [key]: want });
  }
  const raw = actual.raw as Record<string, number>;
  for (const [key, want] of Object.entries(expected.raw ?? {})) {
    expect(Math.abs((raw[key] ?? NaN) - want), `raw.${key}`).toBeLessThanOrEqual(0.01);
  }
}

describe('calculate', () => {
  test.each(vectors.calculate.map((v) => [v.name, v] as const))('%s', (_, v) => {
    check(calculate(v.input as CalcInput) as unknown as Record<string, unknown>, v.expect);
  });
});

describe('macrosFor', () => {
  test.each(vectors.macros.map((v) => [v.name, v] as const))('%s', (_, v) => {
    const m = macrosFor(v.input.target_kcal, v.input.weight_kg, v.input.rule_set as RuleSet);
    const { kcal_from_rounded, ...rest } = v.expect as Expect & { kcal_from_rounded?: number };
    check(m as unknown as Record<string, unknown>, rest);
    if (kcal_from_rounded !== undefined) {
      expect(4 * m.protein_g + 4 * m.carbs_g + 9 * m.fat_g).toBe(kcal_from_rounded);
    }
  });
});

describe('units', () => {
  test.each(vectors.units.map((v) => [v.name, v] as const))('%s', (_, v) => {
    const u = v as {
      lb?: number;
      expect_kg?: number;
      ft?: number;
      in?: number;
      expect_cm?: number;
    };
    if (u.lb !== undefined) {
      expect(Math.abs(lbToKg(u.lb) - (u.expect_kg ?? NaN))).toBeLessThanOrEqual(0.01);
    }
    if (u.ft !== undefined) {
      expect(Math.abs(ftInToCm(u.ft, u.in ?? 0) - (u.expect_cm ?? NaN))).toBeLessThanOrEqual(0.01);
    }
  });
});

describe('validateBodyStats', () => {
  test.each(vectors.validation.map((v) => [v.name, v] as const))('%s', (_, v) => {
    expect(Object.keys(validateBodyStats(v.input))).toEqual(v.errors);
  });
});
