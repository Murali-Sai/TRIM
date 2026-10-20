import {
  editField,
  editorFrom,
  readEditor,
  TARGET_LIMITS,
  tdeeByActivity,
  type EditorState,
} from './targetsEditor';

const SPEC = { kcal: 2759, protein_g: 141, fat_g: 53, carbs_g: 430 };

describe('editField', () => {
  test('editing calories recalculates carbs only', () => {
    const s = editField(editorFrom(SPEC), 'kcal', '2500');
    expect(s).toMatchObject({ kcal: '2500', protein: '141', fat: '53', carbs: '365' });
    expect(s.carbsEdited).toBe(false);
  });

  test('editing protein or fat also leaves carbs as the rest', () => {
    const s = editField(editorFrom(SPEC), 'protein', '160');
    // (2759 - 640 - 477) / 4 = 410.5
    expect(s).toMatchObject({ kcal: '2759', protein: '160', fat: '53', carbs: '411' });
  });

  test('once carbs are typed, calorie edits leave them alone', () => {
    let s = editField(editorFrom(SPEC), 'carbs', '300');
    expect(s.carbsEdited).toBe(true);
    s = editField(s, 'kcal', '2400');
    expect(s).toMatchObject({ kcal: '2400', protein: '141', fat: '53', carbs: '300' });
  });

  test('half-typed calories keep the last carbs until the number is readable', () => {
    const s = editField(editorFrom(SPEC), 'kcal', '');
    expect(s.carbs).toBe('430');
  });

  test('carbs clamp at 0 when protein and fat use the whole target', () => {
    const s = editField(
      editorFrom({ kcal: 2000, protein_g: 176, fat_g: 66, carbs_g: 0 }),
      'kcal',
      '1000',
    );
    expect(s.carbs).toBe('0');
    expect(readEditor(s).clamped).toBe(true);
  });
});

describe('readEditor', () => {
  test('valid values', () => {
    const r = readEditor(editField(editorFrom(SPEC), 'kcal', '2500'));
    expect(r.errors).toEqual({});
    expect(r.values).toEqual({ kcal: 2500, protein_g: 141, fat_g: 53, carbs_g: null });
    expect(r.kcalFromMacros).toBe(4 * 141 + 9 * 53 + 4 * 365);
  });

  test('typed carbs are sent as typed', () => {
    const r = readEditor(editField(editorFrom(SPEC), 'carbs', '300'));
    expect(r.values?.carbs_g).toBe(300);
  });

  test.each([
    ['kcal', '499'],
    ['kcal', '10001'],
    ['kcal', 'abc'],
    ['protein', '1501'],
    ['fat', ''],
  ] as const)('%s = %j is refused', (field, raw) => {
    const r = readEditor({ ...editorFrom(SPEC), [field]: raw } as EditorState);
    expect(Object.keys(r.errors)).toEqual([field]);
    expect(r.values).toBeNull();
  });

  test('typed carbs out of range are refused', () => {
    const r = readEditor(editField(editorFrom(SPEC), 'carbs', '1501'));
    expect(Object.keys(r.errors)).toEqual(['carbs']);
  });

  test('limits match the API', () => {
    expect(TARGET_LIMITS).toEqual({ kcal: { min: 500, max: 10000 }, grams: { max: 1500 } });
  });
});

describe('tdeeByActivity', () => {
  test('SPEC worked example at all five levels', () => {
    const rows = tdeeByActivity({ sex: 'male', age: 30, weight_kg: 80, height_cm: 180 });
    // 1,780 x 1.2, 1.375, 1.55, 1.725 (3070.5 rounds up), 1.9
    expect(rows.map((r) => r.tdee)).toEqual([2136, 2448, 2759, 3071, 3382]);
    expect(rows.map((r) => r.value)).toEqual([
      'sedentary',
      'light',
      'moderate',
      'heavy',
      'athlete',
    ]);
  });
});
