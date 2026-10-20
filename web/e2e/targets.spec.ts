import { expect, test, type Page } from '@playwright/test';
import type { CalcInput } from '../src/lib/tdee';
import { calculate, carbsForRest, roundHalfUp } from '../src/lib/tdee';
import { latestTrendKg } from '../src/pages/body/weightFormat';
import { ME, stubExternal } from './fixtures';
import { VIEWPORTS as LAYOUT_WIDTHS } from './viewports';
import { stubWeights, type Entry } from './weights-stub';

// Task 3.3. AC: editing calories recalculates carbs only; targets never change without the
// user tapping "Use these targets" or saving an edit.

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const METRIC = { ...ME, unit_system: 'metric' as const };

// SPEC worked example: male 30, 80 kg, 180 cm, moderate. 2,759 kcal: 141 P, 53 F, 430 C.
const FORMULA = {
  sex: 'male',
  age: 30,
  weight_kg: 80,
  height_cm: 180,
  activity: 'moderate',
  plan: 'maintain',
  deficit_kcal: 650,
} as const;

interface Row {
  effective_from: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  source: 'calculator' | 'custom';
  bmr: number | null;
  tdee: number | null;
  formula: typeof FORMULA | Record<string, unknown> | null;
}

const CALCULATOR_ROW: Row = {
  effective_from: '2026-10-01',
  kcal: 2759,
  protein_g: 141,
  fat_g: 53,
  carbs_g: 430,
  source: 'calculator',
  bmr: 1780,
  tdee: 2759,
  formula: FORMULA,
};

/** A stateful /api/targets that recalculates like the API, and records every write. */
async function stubTargets(page: Page, initial: Row[] = [CALCULATOR_ROW]) {
  const state = {
    rows: [...initial],
    custom: [] as Record<string, unknown>[],
    applied: [] as Record<string, unknown>[],
  };
  await page.route('**/api/targets', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: state.rows });
    const body = req.postDataJSON() as {
      kcal: number;
      protein_g: number;
      fat_g: number;
      carbs_g: number | null;
    };
    state.custom.push(body);
    const row: Row = {
      ...(state.rows[0] ?? CALCULATOR_ROW),
      kcal: body.kcal,
      protein_g: body.protein_g,
      fat_g: body.fat_g,
      carbs_g: body.carbs_g ?? carbsForRest(body.kcal, body.protein_g, body.fat_g).carbs_g,
      source: 'custom',
      effective_from: '2026-10-20',
    };
    state.rows.unshift(row);
    return route.fulfill({ status: 201, json: row });
  });
  await page.route('**/api/targets/apply-calculation', async (route) => {
    const body = route.request().postDataJSON() as CalcInput;
    state.applied.push(body as unknown as Record<string, unknown>);
    const r = calculate(body);
    const row: Row = {
      effective_from: '2026-10-20',
      kcal: r.target_kcal,
      protein_g: r.protein_g,
      fat_g: r.fat_g,
      carbs_g: r.carbs_g,
      source: 'calculator',
      bmr: r.bmr,
      tdee: r.tdee,
      formula: { ...body, plan: r.plan, deficit_kcal: body.deficit_kcal ?? 650 },
    };
    state.rows.unshift(row);
    return route.fulfill({ status: 201, json: row });
  });
  return state;
}

function weighIns(days: number, startKg = 80): Entry[] {
  return Array.from({ length: days }, (_, i) => {
    const day = `2026-10-${String(1 + i).padStart(2, '0')}`;
    return {
      id: `seed${i}`,
      day,
      measured_at: `${day}T11:00:00.000Z`,
      kg: startKg - 0.15 * i,
      note: null,
    };
  });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function editorValues(page: Page) {
  return {
    kcal: await page.getByLabel('Calories (kcal)').inputValue(),
    protein: await page.getByLabel('Protein (g)').inputValue(),
    fat: await page.getByLabel('Fat (g)').inputValue(),
    carbs: await page.getByLabel('Carbs (g)').inputValue(),
  };
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('editing calories recalculates carbs only, and nothing saves until Save', async ({
      page,
    }) => {
      await stubExternal(page, METRIC);
      const api = await stubTargets(page);
      await page.goto('/targets');
      await expect(page.getByRole('heading', { name: 'Targets', exact: true })).toBeVisible();
      await expect(page.getByTestId('current-kcal')).toHaveText('2,759');
      await expect(page.getByTestId('current-source')).toContainText('From the calculator');
      expect(await editorValues(page)).toEqual({
        kcal: '2759',
        protein: '141',
        fat: '53',
        carbs: '430',
      });

      await page.getByLabel('Calories (kcal)').fill('2500');
      expect(await editorValues(page)).toEqual({
        kcal: '2500',
        protein: '141',
        fat: '53',
        carbs: '365',
      });
      await expect(page.getByText('The rest of your calories', { exact: true })).toBeVisible();
      expect(api.custom).toHaveLength(0);
      expect(api.applied).toHaveLength(0);
      await noHorizontalScroll(page);

      await page.getByRole('button', { name: 'Save targets' }).click();
      await expect(page.getByText('Targets saved.')).toBeVisible();
      expect(api.custom).toEqual([{ kcal: 2500, protein_g: 141, fat_g: 53, carbs_g: null }]);
      await expect(page.getByTestId('current-kcal')).toHaveText('2,500');
      await expect(page.getByTestId('current-source')).toContainText('Your own numbers');
      await expect(page.getByTestId('current-targets')).toContainText('365 g');
    });

    test('carbs the user types are kept when calories change', async ({ page }) => {
      await stubExternal(page, METRIC);
      const api = await stubTargets(page);
      await page.goto('/targets');
      await page.getByLabel('Carbs (g)').fill('300');
      await page.getByLabel('Calories (kcal)').fill('2400');
      expect((await editorValues(page)).carbs).toBe('300');
      await expect(page.getByTestId('macro-sum')).toHaveText(
        'Protein, fat and carbs add up to 2,241 kcal, not 2,400.',
      );

      await page.getByRole('button', { name: 'Make carbs the rest again' }).click();
      expect((await editorValues(page)).carbs).toBe('340');
      await page.getByLabel('Carbs (g)').fill('300');
      await page.getByRole('button', { name: 'Save targets' }).click();
      await expect(page.getByText('Targets saved.')).toBeVisible();
      expect(api.custom).toEqual([{ kcal: 2400, protein_g: 141, fat_g: 53, carbs_g: 300 }]);
    });

    test('protein and fat over the target clamp carbs at 0 with a message', async ({ page }) => {
      await stubExternal(page, METRIC);
      await stubTargets(page);
      await page.goto('/targets');
      await page.getByLabel('Protein (g)').fill('250');
      await page.getByLabel('Calories (kcal)').fill('1000');
      expect((await editorValues(page)).carbs).toBe('0');
      await expect(
        page.getByText(
          'Protein and fat already use your full calorie target. Lower them or raise calories.',
        ),
      ).toBeVisible();
    });

    test('out-of-range values are explained and not saved', async ({ page }) => {
      await stubExternal(page, METRIC);
      const api = await stubTargets(page);
      await page.goto('/targets');
      await page.getByLabel('Calories (kcal)').fill('300');
      await page.getByRole('button', { name: 'Save targets' }).click();
      await expect(page.getByText('Enter calories from 500 to 10,000.')).toBeVisible();
      expect(api.custom).toHaveLength(0);
    });

    test('Reset to formula fills in the rule-based values, saved only on Save', async ({
      page,
    }) => {
      await stubExternal(page, METRIC);
      const custom: Row = {
        ...CALCULATOR_ROW,
        kcal: 2200,
        carbs_g: 240,
        source: 'custom',
      };
      const api = await stubTargets(page, [custom, CALCULATOR_ROW]);
      await page.goto('/targets');
      await expect(page.getByTestId('current-kcal')).toHaveText('2,200');

      await page.getByRole('button', { name: 'Reset to formula' }).click();
      expect(await editorValues(page)).toEqual({
        kcal: '2759',
        protein: '141',
        fat: '53',
        carbs: '430',
      });
      await expect(page.getByText('Formula values filled in. Save to use them.')).toBeVisible();
      await expect(page.getByTestId('current-kcal')).toHaveText('2,200');
      expect(api.applied).toHaveLength(0);

      await page.getByRole('button', { name: 'Save targets' }).click();
      await expect(page.getByText('Targets saved.')).toBeVisible();
      expect(api.custom).toHaveLength(0);
      expect(api.applied).toEqual([FORMULA]);
      await expect(page.getByTestId('current-kcal')).toHaveText('2,759');
    });

    test('no targets yet points to the calculator', async ({ page }) => {
      await stubExternal(page, METRIC);
      await stubTargets(page, []);
      await page.goto('/targets');
      await expect(page.getByText('No targets yet.')).toBeVisible();
      await expect(page.getByTestId('targets-editor')).toHaveCount(0);
      await page.getByRole('link', { name: 'Open the calculator' }).click();
      await expect(page).toHaveURL(/\/targets\/calculator$/);
    });

    test('calculator: latest trend weight, five-level table, old vs new before saving', async ({
      page,
    }) => {
      await stubExternal(page, METRIC);
      const entries = weighIns(14);
      await stubWeights(page, entries);
      const api = await stubTargets(page);
      await page.goto('/targets/calculator');
      await expect(page.getByRole('heading', { name: 'TDEE calculator' })).toBeVisible();

      const trendKg = roundHalfUp(latestTrendKg(entries) ?? 0, 1);
      expect(trendKg).not.toBe(entries.at(-1)?.kg);
      await expect(page.getByLabel('Weight (kg)')).toHaveValue(String(trendKg));
      await expect(page.getByTestId('trend-note')).toHaveText(
        `Weight is your latest trend weight, ${trendKg.toFixed(1)} kg.`,
      );
      await expect(page.getByLabel('Age (years)')).toHaveValue('30');
      await expect(page.getByLabel('Height (cm)')).toHaveValue('180');

      const input = { ...FORMULA, weight_kg: trendKg };
      const r = calculate(input);
      await expect(page.getByTestId('tdee')).toHaveText(r.tdee.toLocaleString('en-US'));

      const table = page.getByTestId('tdee-table');
      await expect(table.locator('tbody tr')).toHaveCount(5);
      const base = r.raw.bmr;
      for (const [i, factor] of [1.2, 1.375, 1.55, 1.725, 1.9].entries()) {
        await expect(table.locator('tbody tr').nth(i).locator('td')).toHaveText(
          roundHalfUp(base * factor).toLocaleString('en-US'),
        );
      }
      await expect(table.locator('tr[aria-current="true"]')).toContainText('Moderate');
      await noHorizontalScroll(page);

      await page.getByRole('button', { name: 'Use these targets' }).click();
      const confirm = page.getByTestId('confirm-targets');
      await expect(confirm.getByRole('heading', { name: 'Use these targets?' })).toBeFocused();
      await expect(confirm.getByTestId('old-kcal')).toHaveText('2,759 kcal');
      await expect(confirm.getByTestId('new-kcal')).toHaveText(
        `${r.target_kcal.toLocaleString('en-US')} kcal`,
      );
      await expect(confirm.getByTestId('old-carbs_g')).toHaveText('430 g');
      await expect(confirm.getByTestId('new-protein_g')).toHaveText(`${r.protein_g} g`);
      await noHorizontalScroll(page);

      // Backing out saves nothing.
      await confirm.getByRole('button', { name: 'Keep my current targets' }).click();
      await expect(confirm).toHaveCount(0);
      expect(api.applied).toHaveLength(0);

      await page.getByRole('button', { name: 'Use these targets' }).click();
      await page.getByRole('button', { name: 'Yes, use these' }).click();
      await expect(page).toHaveURL(/\/targets$/);
      await expect(page.getByText('Targets saved.')).toBeVisible();
      expect(api.applied).toEqual([input]);
      await expect(page.getByTestId('current-kcal')).toHaveText(
        r.target_kcal.toLocaleString('en-US'),
      );
    });

    test('calculator: Calculate updates the result and Reset brings back the prefill', async ({
      page,
    }) => {
      await stubExternal(page, METRIC);
      await stubWeights(page, [
        {
          id: 'w1',
          day: '2026-10-19',
          measured_at: '2026-10-19T11:00:00.000Z',
          kg: 80,
          note: null,
        },
      ]);
      await stubTargets(page);
      await page.goto('/targets/calculator');
      await expect(page.getByLabel('Weight (kg)')).toHaveValue('80');
      await expect(page.getByTestId('tdee')).toHaveText('2,759');

      await page.getByLabel('Activity level', { exact: true }).selectOption('heavy');
      // Nothing changes until Calculate.
      await expect(page.getByTestId('tdee')).toHaveText('2,759');
      await page.getByRole('button', { name: 'Calculate' }).click();
      await expect(page.getByTestId('tdee')).toHaveText('3,071');
      await expect(page.getByTestId('tdee-table').locator('tr[aria-current="true"]')).toContainText(
        'Heavy',
      );

      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await expect(page.getByLabel('Activity level', { exact: true })).toHaveValue('moderate');
      await expect(page.getByTestId('tdee')).toHaveText('2,759');
    });

    test('calculator: Adjust opens the editor on the new result', async ({ page }) => {
      await stubExternal(page, METRIC);
      await stubWeights(page, [
        {
          id: 'w1',
          day: '2026-10-19',
          measured_at: '2026-10-19T11:00:00.000Z',
          kg: 95,
          note: null,
        },
      ]);
      const api = await stubTargets(page);
      await page.goto('/targets/calculator');
      await page.getByRole('button', { name: 'Adjust' }).click();
      // The saved plan (Maintain) stays chosen, even though BMI 29.3 would suggest Lose.
      const r = calculate({ ...FORMULA, weight_kg: 95 });
      expect((await editorValues(page)).kcal).toBe(String(r.target_kcal));
      await page.getByLabel('Calories (kcal)').fill('2600');
      await page.getByRole('button', { name: 'Save targets' }).click();
      await expect(page).toHaveURL(/\/targets$/);
      expect(api.custom[0]).toMatchObject({ kcal: 2600, protein_g: r.protein_g, carbs_g: null });
      expect(api.custom[0]?.basis).toMatchObject({ weight_kg: 95, plan: r.plan });
    });

    test('calculator: missing details show the empty state', async ({ page }) => {
      await stubExternal(page, METRIC);
      await stubWeights(page, []);
      await page.route('**/api/me/body-stats', (route) =>
        route.fulfill({
          json: {
            sex: null,
            age: null,
            height_cm: null,
            activity_level: null,
            unit_system: 'metric',
            latest_weight_kg: null,
            goal_weight_kg: null,
          },
        }),
      );
      await stubTargets(page, []);
      await page.goto('/targets/calculator');
      await expect(page.getByTestId('calculator-empty')).toHaveText(
        'Fill in all fields to see your TDEE.',
      );
      await page.getByRole('button', { name: 'Calculate' }).click();
      await expect(page.getByText('Enter an age from 18 to 100.')).toBeVisible();
      await noHorizontalScroll(page);
    });

    test('the Account page links to targets and the calculator', async ({ page }) => {
      await stubExternal(page, METRIC);
      await stubTargets(page);
      await page.goto('/account');
      await page.getByRole('link', { name: 'TDEE calculator' }).click();
      await expect(page).toHaveURL(/\/targets\/calculator$/);
      await page.goto('/account');
      await page.getByRole('link', { name: 'Edit targets' }).click();
      await expect(page).toHaveURL(/\/targets$/);
    });
  });
}

for (const vp of LAYOUT_WIDTHS) {
  test(`layout at ${vp.width}px: no sideways scroll; calculator form beside the result on wide screens`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await stubExternal(page, METRIC);
    await stubWeights(page, weighIns(14));
    await stubTargets(page);
    await page.goto('/targets');
    await expect(page.getByTestId('targets-editor')).toBeVisible();
    await noHorizontalScroll(page);

    await page.goto('/targets/calculator');
    await expect(page.getByTestId('tdee-table')).toBeVisible();
    await noHorizontalScroll(page);
    const form = await page.getByRole('heading', { name: 'Your details' }).boundingBox();
    const result = await page.getByRole('heading', { name: 'Result' }).boundingBox();
    if (!form || !result) throw new Error('missing sections');
    if (vp.width >= 1024) {
      // Desktop: form left, result card right (SPEC page 4, Screens).
      expect(result.x).toBeGreaterThan(form.x + form.width / 2);
      expect(Math.abs(result.y - form.y)).toBeLessThan(5);
    } else {
      expect(result.y).toBeGreaterThan(form.y);
    }
  });
}
