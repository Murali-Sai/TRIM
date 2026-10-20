import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 3.7. AC: logging a recent food under 5 s. The clock is fixed at 19:07 in New York.

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const NOW = new Date('2026-10-17T23:07:00Z');

const BASE = {
  brand: null,
  source: 'fdc',
  tier: 'personal',
  fiber_100: null,
  sugar_100: null,
  sodium_mg_100: null,
  density_g_ml: null,
  kcal_mismatch: false,
  is_favourite: false,
  times_logged: 3,
};
const RICE = {
  ...BASE,
  id: 'food-rice',
  name: 'White rice, cooked',
  kcal_100: 130,
  protein_100: 2.7,
  carbs_100: 28.2,
  fat_100: 0.3,
  servings: [{ label: '1 cup', grams: 158, is_default: true }],
  last: { grams: 150, quantity: null, unit_label: null },
};
const YOGURT = {
  ...BASE,
  id: 'food-yogurt',
  name: 'Greek yogurt, plain',
  kcal_100: 97,
  protein_100: 9,
  carbs_100: 3.6,
  fat_100: 5,
  servings: [{ label: '1 cup', grams: 200, is_default: true }],
  last: { grams: 400, quantity: 2, unit_label: '1 cup' },
  times_logged: 9,
};

interface Calls {
  posted: { eaten_at: string; items: Record<string, unknown>[] }[];
  favourites: { method: string; id: string }[];
  created: Record<string, unknown>[];
}

async function open(
  page: Page,
  quick = { favourites: [] as unknown[], recents: [RICE, YOGURT], frequents: [YOGURT, RICE] },
) {
  const calls: Calls = { posted: [], favourites: [], created: [] };
  const state = { ...quick };
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/logs/last-time', (r) => r.fulfill({ json: { eaten_at: null } }));
  await page.route('**/api/foods/quick', (r) => r.fulfill({ json: state }));
  await page.route('**/api/foods/search**', (r) =>
    r.fulfill({ json: { results: [], notice: null } }),
  );
  await page.route('**/api/foods/*/favourite', (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[3] ?? '';
    const method = route.request().method();
    calls.favourites.push({ method, id });
    const food = [RICE, YOGURT].find((f) => f.id === id);
    state.favourites = method === 'PUT' && food ? [{ ...food, is_favourite: true }] : [];
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/foods', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    calls.created.push(body);
    const grams = body.serving_grams as number;
    const f = 100 / grams;
    return route.fulfill({
      status: 201,
      json: {
        ...BASE,
        id: 'food-custom',
        name: body.name,
        brand: body.brand,
        source: 'custom',
        kcal_100: (body.kcal as number) * f,
        protein_100: (body.protein_g as number) * f,
        carbs_100: (body.carbs_g as number) * f,
        fat_100: (body.fat_g as number) * f,
        servings: [{ label: body.serving_label, grams, is_default: true }],
      },
    });
  });
  await page.route('**/api/logs', (route) => {
    const body = route.request().postDataJSON() as Calls['posted'][number];
    calls.posted.push(body);
    const rows = body.items.map((item, i) => ({
      id: `l${i}`,
      log_group_id: 'g1',
      eaten_at: body.eaten_at,
      ...item,
    }));
    return route.fulfill({ status: 201, json: rows });
  });
  await page.goto('/log');
  await expect(page.getByRole('heading', { name: 'Log food' })).toBeVisible();
  return calls;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('AC: a recent food is logged in under 5 seconds, at its last serving', async ({
      page,
    }) => {
      const calls = await open(page);
      const add = page.getByRole('button', { name: 'Add White rice, cooked, 150 g' });
      await expect(add).toBeVisible();
      await noHorizontalScroll(page);

      const started = Date.now();
      await add.click();
      await page.getByRole('button', { name: 'Log it' }).click();
      await expect(page.getByText('Logged 1 item at 7:05 PM today.')).toBeVisible();
      expect(Date.now() - started).toBeLessThan(5000);

      expect(calls.posted).toEqual([
        {
          eaten_at: '2026-10-17T23:05:00.000Z',
          items: [{ food_id: 'food-rice', grams: 150, source: 'recent' }],
        },
      ]);
    });

    test('a recent row opens at its last serving; Frequent switches the list', async ({ page }) => {
      const calls = await open(page);
      await page
        .getByRole('button', { name: /^Greek yogurt, plain/ })
        .first()
        .click();
      await expect(page.getByLabel('Unit')).toHaveValue('1 cup');
      await expect(page.getByLabel('Amount')).toHaveValue('2');
      await page.getByRole('button', { name: 'Add to list' }).click();
      await page.getByRole('button', { name: 'Log it' }).click();
      expect(calls.posted[0]?.items).toEqual([
        { food_id: 'food-yogurt', quantity: 2, unit_label: '1 cup', source: 'recent' },
      ]);

      await page.getByRole('tab', { name: 'Frequent' }).click();
      const rows = page.getByRole('list', { name: 'Frequent' }).getByTestId('quick-row');
      await expect(rows.first()).toContainText('Greek yogurt, plain');
      await expect(rows.first()).toContainText('2 x 1 cup · 388 kcal');
    });

    test('starring a food puts it in Favourites; unstarring takes it out', async ({ page }) => {
      const calls = await open(page);
      await page
        .getByRole('button', { name: /^White rice, cooked/ })
        .first()
        .click();
      const star = page.getByRole('button', { name: 'Add White rice, cooked to favourites' });
      await star.click();
      await expect(page.getByRole('list', { name: 'Favourites' })).toContainText(
        'White rice, cooked',
      );
      await expect(
        page.getByRole('button', { name: 'Remove White rice, cooked from favourites' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Remove White rice, cooked from favourites' }).click();
      await expect(page.getByRole('list', { name: 'Favourites' })).toHaveCount(0);
      expect(calls.favourites).toEqual([
        { method: 'PUT', id: 'food-rice' },
        { method: 'DELETE', id: 'food-rice' },
      ]);
    });

    test('quick add: calories and optional macros, no food', async ({ page }) => {
      const calls = await open(page);
      await page.getByRole('tab', { name: 'Quick add' }).click();
      await page.getByRole('button', { name: 'Add to list' }).click();
      await expect(page.getByText('Enter calories.')).toBeVisible();

      await page.getByLabel('Name (optional)').fill('Office cake');
      await page.getByLabel('Calories (kcal)').fill('320');
      await page.getByLabel('Protein (g)').fill('4');
      await page.getByLabel('Fat (g)').fill('15');
      await page.getByLabel('Carbs (g)').fill('41');
      await page.getByRole('button', { name: 'Add to list' }).click();
      await expect(page.getByTestId('to-log')).toContainText('Office cake');
      await expect(page.getByTestId('to-log')).toContainText('320 kcal · 4P 15F 41C · Quick add');
      await noHorizontalScroll(page);
      await page.getByRole('button', { name: 'Log it' }).click();
      expect(calls.posted[0]?.items).toEqual([
        { quick: { name: 'Office cake', kcal: 320, protein_g: 4, carbs_g: 41, fat_g: 15 } },
      ]);
    });

    test('nothing found: create a custom food from its label and log it', async ({ page }) => {
      const calls = await open(page);
      await page.getByLabel('Find a food').fill('protein bar');
      await expect(page.getByText('No foods match “protein bar”.')).toBeVisible();
      await page.getByRole('button', { name: 'Create a custom food' }).click();

      const sheet = page.getByTestId('custom-food-sheet');
      await expect(sheet.getByLabel('Name', { exact: true })).toHaveValue('protein bar');
      await sheet.getByLabel('Name', { exact: true }).fill('Protein bar');
      await sheet.getByLabel('Serving', { exact: true }).fill('1 bar');
      await sheet.getByLabel('Serving weight (g)').fill('60');
      await sheet.getByLabel('Calories (per serving)').fill('210');
      await sheet.getByLabel('Protein (g)').fill('20');
      await sheet.getByLabel('Carbs (g)').fill('22');
      await sheet.getByLabel('Fat (g)', { exact: true }).fill('6');
      await expect(sheet.getByTestId('cf-per100')).toHaveText('350 kcal per 100 g');
      await expect(sheet.getByTestId('cf-mismatch')).toHaveCount(0);
      await noHorizontalScroll(page);
      await sheet.getByRole('button', { name: 'Save food' }).click();

      expect(calls.created[0]).toMatchObject({
        name: 'Protein bar',
        per: 'serving',
        serving_label: '1 bar',
        serving_grams: 60,
        kcal: 210,
        protein_g: 20,
        fiber_g: null,
      });
      // It opens straight in How much, at one bar.
      await expect(page.getByTestId('food-detail')).toContainText('Protein bar');
      await expect(page.getByLabel('Unit')).toHaveValue('1 bar');
      await expect(page.getByTestId('detail-preview')).toHaveText('210 kcal · 20P 6F 22C · 60 g');
    });

    test('a label whose calories do not add up gets a gentle check', async ({ page }) => {
      await open(page);
      await page.getByLabel('Find a food').fill('odd');
      await page.getByRole('button', { name: 'Create a custom food' }).click();
      const sheet = page.getByTestId('custom-food-sheet');
      await sheet.getByLabel('Serving weight (g)').fill('100');
      await sheet.getByLabel('Calories (per serving)').fill('500');
      await sheet.getByLabel('Protein (g)').fill('10');
      await expect(sheet.getByTestId('cf-mismatch')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
    });
  });
}

test('a new user sees what the quick lists will hold', async ({ page }) => {
  await open(page, { favourites: [], recents: [], frequents: [] });
  await expect(page.getByTestId('quick-empty')).toHaveText(
    'Foods you log or star show up here, ready to log again in one tap.',
  );
});
