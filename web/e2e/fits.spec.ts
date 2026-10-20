import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 3.14: the "Fits my macros" sort on Log food. AC (ranking) is tested in the API
// (tests/test_fit.py, tests/test_fits_my_macros.py); here the list shows that order.

const NOW = new Date('2026-10-17T23:07:00Z');
const FOOD = {
  brand: null,
  source: 'custom',
  tier: 'personal',
  fiber_100: null,
  sugar_100: null,
  sodium_mg_100: null,
  density_g_ml: null,
  kcal_mismatch: false,
  is_favourite: false,
  times_logged: 2,
  last: null,
};
function food(id: string, name: string, per100: number[], serving: [string, number]) {
  const [kcal_100, protein_100, carbs_100, fat_100] = per100;
  return {
    ...FOOD,
    id,
    name,
    kcal_100,
    protein_100,
    carbs_100,
    fat_100,
    servings: [{ label: serving[0], grams: serving[1], is_default: true }],
  };
}
const CHICKEN = food('f-chicken', 'Chicken breast', [165, 31, 0, 3.6], ['1 portion', 120]);
const RICE = food('f-rice', 'Cooked rice', [130, 2.7, 28.2, 0.3], ['1 bowl', 150]);
const row = (
  f: ReturnType<typeof food>,
  score: number,
  label: string,
  fills: number[],
  overflows: string[],
  upTo: number,
) => ({
  kind: 'food',
  food: f,
  meal_id: null,
  meal_name: null,
  meal_items: null,
  serving: { grams: f.servings[0]?.grams, quantity: 1, unit_label: f.servings[0]?.label },
  nutrients: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  score,
  label,
  fills: { kcal: fills[0], protein_g: fills[1], carbs_g: fills[2], fat_g: fills[3] },
  overflows,
  fits_up_to_g: upTo,
});
const FITS = {
  date: '2026-10-17',
  has_target: true,
  remaining: { kcal: 300, protein_g: 40, carbs_g: 25, fat_g: 8 },
  results: [
    {
      ...row(CHICKEN, 0.6, 'Great fit', [0.66, 0.93, 0, 0.54], [], 180),
      nutrients: { kcal: 198, protein_g: 37.2, carbs_g: 0, fat_g: 4.32 },
    },
    {
      ...row(RICE, 0.27, 'Partial fit', [0.65, 0.1, 1, 0.06], ['carbs_g'], 230),
      nutrients: { kcal: 195, protein_g: 4.05, carbs_g: 42.3, fat_g: 0.45 },
    },
  ],
};

async function open(page: Page, fits: unknown = FITS) {
  const posted: { items: unknown[] }[] = [];
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/logs/last-time', (r) => r.fulfill({ json: { eaten_at: null } }));
  await page.route('**/api/meals**', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/foods/quick', (r) =>
    r.fulfill({ json: { favourites: [], recents: [CHICKEN, RICE], frequents: [] } }),
  );
  await page.route('**/api/foods/fits-my-macros**', (r) => r.fulfill({ json: fits }));
  await page.route(
    (u) => u.pathname === '/api/logs',
    (r) => {
      posted.push(r.request().postDataJSON() as { items: unknown[] });
      return r.fulfill({ status: 201, json: [{ id: 'l1', log_group_id: 'g1' }] });
    },
  );
  await page.goto('/log');
  return posted;
}

for (const vp of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('ranks what fits what is left, with labels and "fits up to"', async ({ page }) => {
      const posted = await open(page);
      await page.getByRole('tab', { name: 'Fits my macros' }).click();
      await expect(page.getByTestId('fits-left')).toHaveText('Left today: 300 kcal · 40P 8F 25C');
      const rows = page.getByTestId('fit-row');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText('Chicken breast');
      await expect(rows.nth(0).getByTestId('fit-label')).toHaveText('Great fit');
      await expect(rows.nth(0)).toContainText('1 x 1 portion · 198 kcal · fits up to 180 g');
      await expect(rows.nth(1).getByTestId('fit-label')).toHaveText('Partial fit');
      await expect(rows.nth(1)).toContainText('carbs over');
      await expect(rows.nth(1)).toContainText(
        'Fills 65% of calories left, 10% of protein left, 6% of fat left, 100% of carbs left; goes over on carbs.',
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await page.getByRole('button', { name: 'Add Chicken breast, 1 x 1 portion' }).click();
      await page.getByRole('button', { name: 'Log it' }).click();
      await expect
        .poll(() => posted)
        .toEqual([
          {
            eaten_at: '2026-10-17T23:05:00.000Z',
            items: [
              { food_id: 'f-chicken', quantity: 1, unit_label: '1 portion', source: 'recent' },
            ],
          },
        ]);
    });

    test('tapping a row opens the amount picker at its serving', async ({ page }) => {
      await open(page);
      await page.getByRole('tab', { name: 'Fits my macros' }).click();
      await page.getByTestId('fit-row').nth(1).getByRole('button').first().click();
      await expect(page.getByLabel('Unit')).toHaveValue('1 bowl');
      await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('1');
    });
  });
}

test('no target today: no Fits my macros sort', async ({ page }) => {
  await open(page, { date: '2026-10-17', has_target: false, remaining: null, results: [] });
  await expect(page.getByRole('tab', { name: 'Recent' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Fits my macros' })).toHaveCount(0);
});

test('nothing fits says what was checked', async ({ page }) => {
  await open(page, { ...FITS, results: [] });
  await page.getByRole('tab', { name: 'Fits my macros' }).click();
  await expect(page.getByTestId('fits-empty')).toContainText('Nothing you usually eat fits');
});
