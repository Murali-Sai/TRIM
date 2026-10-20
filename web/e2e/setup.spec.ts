import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

interface WorkedCase {
  name: string;
  input: {
    sex: string;
    age: number;
    weight_kg: number;
    height_cm: number;
    activity: string;
  };
  expect: {
    bmr?: number;
    tdee?: number;
    bmi?: number;
    plan?: string;
    rule_set?: string;
    target_kcal?: number;
    protein_g?: number;
    fat_g?: number;
    carbs_g?: number;
  };
}

const vectors = JSON.parse(
  readFileSync(new URL('../../shared/tdee_vectors.json', import.meta.url), 'utf8'),
) as { calculate: WorkedCase[] };

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const WORKED = vectors.calculate.filter((c) => c.name.startsWith('SPEC worked example'));

interface State {
  setup: 'body_stats' | 'targets' | 'done';
  stats: Record<string, unknown>;
  patched: Record<string, unknown>[];
  applied: Record<string, unknown>[];
}

/** A stateful stand-in for the API's setup endpoints. */
async function stubSetupApi(page: Page, unitSystem: 'metric' | 'imperial' = 'metric') {
  const state: State = {
    setup: 'body_stats',
    stats: {
      sex: null,
      age: null,
      height_cm: null,
      activity_level: null,
      unit_system: unitSystem,
      latest_weight_kg: null,
    },
    patched: [],
    applied: [],
  };
  await stubExternal(page, () => ({ ...ME, unit_system: unitSystem, setup: state.setup }));
  await page.route('**/api/me/body-stats', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.patched.push(body);
      state.stats = { ...body, latest_weight_kg: body.weight_kg };
      state.setup = 'targets';
    }
    await route.fulfill({ json: state.stats });
  });
  await page.route('**/api/targets/apply-calculation', async (route) => {
    state.applied.push(route.request().postDataJSON() as Record<string, unknown>);
    state.setup = 'done';
    await route.fulfill({ status: 201, json: {} });
  });
  return state;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const ACTIVITY_LABEL: Record<string, string> = {
  sedentary: 'Sedentary (office job)',
  moderate: 'Moderate exercise (3 to 5 days a week)',
};

function fmt(n: number) {
  return n.toLocaleString('en-US');
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    for (const c of WORKED) {
      test(`${c.name} shows exactly those targets`, async ({ page }) => {
        const state = await stubSetupApi(page);
        await page.goto('/');
        await expect(page).toHaveURL(/\/setup$/);
        await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
        await noHorizontalScroll(page);

        await page.getByLabel('Age (years)').fill(String(c.input.age));
        await page.getByLabel('Sex for calorie formula').selectOption(c.input.sex);
        await page.getByLabel('Weight (kg)').fill(String(c.input.weight_kg));
        await page.getByLabel('Height (cm)').fill(String(c.input.height_cm));
        await page.getByLabel('Activity level').selectOption({
          label: ACTIVITY_LABEL[c.input.activity] ?? '',
        });
        await page.getByRole('button', { name: 'Continue' }).click();

        await expect(page.getByRole('heading', { name: 'Your targets' })).toBeVisible();
        expect(state.patched[0]).toMatchObject({
          sex: c.input.sex,
          age: c.input.age,
          weight_kg: c.input.weight_kg,
          height_cm: c.input.height_cm,
          activity_level: c.input.activity,
        });
        const e = c.expect;
        await expect(page.getByTestId('bmi')).toHaveText(`BMI ${e.bmi?.toFixed(1)}`);
        const suggested = e.plan === 'lose' ? 'Lose weight' : 'Maintain';
        await expect(page.getByText(suggested).locator('..')).toContainText('Suggested');
        await expect(page.getByTestId('tdee')).toHaveText(fmt(e.tdee ?? 0));
        await expect(page.getByTestId('bmr')).toHaveText(`BMR ${fmt(e.bmr ?? 0)} kcal`);
        if (e.plan === 'lose') {
          await expect(page.getByTestId('daily-target')).toHaveText(
            `Target ${fmt(e.target_kcal ?? 0)} kcal, ${fmt((e.tdee ?? 0) - (e.target_kcal ?? 0))} below maintenance`,
          );
        } else {
          await expect(page.getByTestId('daily-target')).toHaveCount(0);
        }
        const macros = page.getByTestId('macros');
        await expect(macros).toContainText(`Protein ${e.protein_g} g`);
        await expect(macros).toContainText(`Fat ${e.fat_g} g`);
        await expect(macros).toContainText(`Carbs ${e.carbs_g} g`);
        await expect(macros).toContainText(
          e.rule_set === 'high_bmi' ? '(25% of calories)' : '(0.3 g per lb)',
        );
        await noHorizontalScroll(page);

        await page.getByRole('button', { name: 'Use these targets' }).click();
        await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
        expect(state.applied[0]).toMatchObject({ ...c.input, plan: e.plan, deficit_kcal: 650 });
      });
    }

    test('imperial users see pace in pounds', async ({ page }) => {
      await stubSetupApi(page, 'imperial');
      await page.goto('/setup');
      await page.getByLabel('Age (years)').fill('35');
      await page.getByLabel('Sex for calorie formula').selectOption('male');
      await page.getByLabel('Weight (lb)').fill('209.4');
      await page.getByLabel('Feet').fill('6');
      await page.getByLabel('Inches').fill('2');
      await page
        .getByLabel('Activity level')
        .selectOption({ label: ACTIVITY_LABEL.moderate ?? '' });
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByTestId('pace')).toHaveText('About 1.3 lb a week. Rough estimate.');
    });

    test('imperial entry is converted to kg and cm', async ({ page }) => {
      const state = await stubSetupApi(page, 'imperial');
      await page.goto('/setup');
      await page.getByLabel('Age (years)').fill('30');
      await page.getByLabel('Sex for calorie formula').selectOption('male');
      await page.getByLabel('Weight (lb)').fill('176.4');
      await page.getByLabel('Feet').fill('5');
      await page.getByLabel('Inches').fill('11');
      await page
        .getByLabel('Activity level')
        .selectOption({ label: ACTIVITY_LABEL.moderate ?? '' });
      await noHorizontalScroll(page);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Your targets' })).toBeVisible();
      const sent = state.patched[0] as { weight_kg: number; height_cm: number };
      expect(sent.weight_kg).toBeCloseTo(80.0137, 3);
      expect(sent.height_cm).toBeCloseTo(180.34, 2);
      await expect(page.getByTestId('macros')).toContainText('Protein 141 g');
    });

    test('switching units keeps what was typed', async ({ page }) => {
      await stubSetupApi(page, 'metric');
      await page.goto('/setup');
      await page.getByLabel('Weight (kg)').fill('80');
      await page.getByLabel('Height (cm)').fill('180');
      await page.getByRole('radio', { name: 'Imperial' }).click();
      await expect(page.getByLabel('Weight (lb)')).toHaveValue('176.4');
      await expect(page.getByLabel('Feet')).toHaveValue('5');
      await expect(page.getByLabel('Inches')).toHaveValue('11');
    });

    test('out-of-range and missing fields are highlighted', async ({ page }) => {
      const state = await stubSetupApi(page);
      await page.goto('/setup');
      await page.getByLabel('Age (years)').fill('17');
      await page.getByLabel('Weight (kg)').fill('25');
      await page.getByLabel('Height (cm)').fill('250');
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByText('Enter an age from 18 to 100.')).toBeVisible();
      await expect(page.getByText(/Enter a weight from 30 to 300 kg/)).toBeVisible();
      await expect(page.getByText(/Enter a height from 120 to 230 cm/)).toBeVisible();
      await expect(page.getByText('Choose your activity level.')).toBeVisible();
      await expect(page.getByLabel('Age (years)')).toHaveAttribute('aria-invalid', 'true');
      await noHorizontalScroll(page);
      expect(state.patched).toHaveLength(0);
    });

    test('Maintain can be chosen over a suggested Lose, and deficit chips change the target', async ({
      page,
    }) => {
      const state = await stubSetupApi(page);
      await page.goto('/setup');
      await page.getByLabel('Age (years)').fill('35');
      await page.getByLabel('Sex for calorie formula').selectOption('male');
      await page.getByLabel('Weight (kg)').fill('95');
      await page.getByLabel('Height (cm)').fill('188');
      await page
        .getByLabel('Activity level')
        .selectOption({ label: ACTIVITY_LABEL.moderate ?? '' });
      await page.getByRole('button', { name: 'Continue' }).click();

      await expect(page.getByTestId('pace')).toHaveText('About 0.6 kg a week. Rough estimate.');
      await page.getByRole('radio', { name: '700 kcal' }).click();
      await expect(page.getByTestId('daily-target')).toHaveText(
        'Target 2,330 kcal, 700 below maintenance',
      );
      await page.getByText('Maintain').click();
      await expect(page.getByTestId('daily-target')).toHaveCount(0);
      await expect(page.getByTestId('pace')).toHaveCount(0);
      await page.getByRole('button', { name: 'Use these targets' }).click();
      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
      expect(state.applied[0]).toMatchObject({ plan: 'maintain' });
    });

    test('Adjust opens the Targets editor; carbs follow a calorie edit', async ({ page }) => {
      const state = await stubSetupApi(page);
      const custom: Record<string, unknown>[] = [];
      await page.route('**/api/targets', async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: [] });
        custom.push(route.request().postDataJSON() as Record<string, unknown>);
        state.setup = 'done';
        await route.fulfill({ status: 201, json: {} });
      });
      await page.goto('/setup');
      await page.getByLabel('Age (years)').fill('35');
      await page.getByLabel('Sex for calorie formula').selectOption('male');
      await page.getByLabel('Weight (kg)').fill('95');
      await page.getByLabel('Height (cm)').fill('188');
      await page
        .getByLabel('Activity level')
        .selectOption({ label: ACTIVITY_LABEL.moderate ?? '' });
      await page.getByRole('button', { name: 'Continue' }).click();

      await page.getByRole('button', { name: 'Adjust' }).click();
      await expect(page.getByRole('heading', { name: 'Adjust your targets' })).toBeVisible();
      await expect(page.getByLabel('Calories (kcal)')).toHaveValue('2380');
      await page.getByLabel('Calories (kcal)').fill('2300');
      await expect(page.getByLabel('Protein (g)')).toHaveValue('168');
      await expect(page.getByLabel('Fat (g)')).toHaveValue('63');
      // (2,300 - 4 x 168 - 9 x 63) / 4 = 265.25
      await expect(page.getByLabel('Carbs (g)')).toHaveValue('265');
      await noHorizontalScroll(page);

      await page.getByRole('button', { name: 'Use these targets' }).click();
      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
      expect(state.applied).toHaveLength(0);
      expect(custom).toHaveLength(1);
      expect(custom[0]).toMatchObject({ kcal: 2300, protein_g: 168, fat_g: 63, carbs_g: null });
      expect(custom[0]?.basis).toMatchObject({ weight_kg: 95, plan: 'lose', deficit_kcal: 650 });
    });

    test('Adjust and Cancel goes back to the result card without saving', async ({ page }) => {
      const state = await stubSetupApi(page);
      await page.goto('/setup');
      await page.getByLabel('Age (years)').fill('30');
      await page.getByLabel('Sex for calorie formula').selectOption('male');
      await page.getByLabel('Weight (kg)').fill('80');
      await page.getByLabel('Height (cm)').fill('180');
      await page
        .getByLabel('Activity level')
        .selectOption({ label: ACTIVITY_LABEL.moderate ?? '' });
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('button', { name: 'Adjust' }).click();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByTestId('tdee')).toHaveText('2,759');
      expect(state.applied).toHaveLength(0);
    });

    test('the calorie floor is explained', async ({ page }) => {
      await stubSetupApi(page);
      await page.goto('/setup');
      await page.getByLabel('Age (years)').fill('80');
      await page.getByLabel('Sex for calorie formula').selectOption('female');
      await page.getByLabel('Weight (kg)').fill('60');
      await page.getByLabel('Height (cm)').fill('150');
      await page
        .getByLabel('Activity level')
        .selectOption({ label: ACTIVITY_LABEL.sedentary ?? '' });
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByTestId('daily-target')).toContainText('Target 1,200 kcal');
      await expect(page.getByTestId('floor-note')).toContainText('lowest suggested target');
    });
  });
}

test('a user who finished setup goes straight to Today', async ({ page }) => {
  await stubExternal(page);
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/$/);
});
