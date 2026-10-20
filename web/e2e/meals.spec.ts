import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 3.7b. AC: the "Post-workout lunch" example logs 1,345 kcal at 1x and 2,018 kcal at
// 1.5x; one-tap log under 3 s on phone. The clock is fixed at 19:07 on 17 Oct in New York.

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const NOW = new Date('2026-10-17T23:07:00Z');

function item(id: string, name: string, grams: number, n: [number, number, number, number]) {
  const [kcal, protein_g, fat_g, carbs_g] = n;
  return {
    id,
    food_id: `food-${id}`,
    name,
    brand: null,
    grams,
    quantity: null,
    unit_label: null,
    sort_order: 0,
    missing: false,
    kcal,
    protein_g,
    fat_g,
    carbs_g,
  };
}

// Per 100 g: butter 720 kcal 1P 80F 0C, chicken breast 120 25 1 0, rice 230 2.5 0.15 50,
// mixed veg 128.4 0.12 0.08 35.6; here at the saved amounts.
const LUNCH = {
  id: 'meal-lunch',
  name: 'Post-workout lunch',
  note: null,
  is_favourite: false,
  use_count: 4,
  last_used_at: '2026-10-16T17:00:00Z',
  archived_at: null,
  items: [
    item('butter', 'Butter', 20, [144, 0.2, 16, 0]),
    item('chicken', 'Chicken breast', 350, [420, 87.5, 3.5, 0]),
    item('rice', 'Rice, cooked', 200, [460, 5, 0.3, 100]),
    item('veg', 'Mixed veg', 250, [321, 0.3, 0.2, 89]),
  ],
  totals: { kcal: 1345, protein_g: 93, carbs_g: 189, fat_g: 20 },
  missing: 0,
};

const RICE_FOOD = {
  id: 'food-rice',
  name: 'Rice, cooked',
  brand: null,
  source: 'fdc',
  tier: 'cache',
  kcal_100: 230,
  protein_100: 2.5,
  carbs_100: 50,
  fat_100: 0.15,
  fiber_100: null,
  sugar_100: null,
  sodium_mg_100: null,
  density_g_ml: null,
  kcal_mismatch: false,
  servings: [{ label: '1 cup', grams: 158, is_default: true }],
};

interface Calls {
  logged: { id: string; body: Record<string, unknown> }[];
  created: Record<string, unknown>[];
  patched: { id: string; body: Record<string, unknown> }[];
  undone: string[];
  fromLogs: Record<string, unknown>[];
}

async function stubMeals(page: Page, meals: (typeof LUNCH)[] = [LUNCH]) {
  const calls: Calls = { logged: [], created: [], patched: [], undone: [], fromLogs: [] };
  const live = meals.map((m) => ({ ...m }));
  await page.route('**/api/meals**', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const parts = url.pathname.split('/');
    const method = req.method();
    const body = (req.postData() ? req.postDataJSON() : {}) as Record<string, unknown>;
    if (url.pathname === '/api/meals' && method === 'GET') {
      const archived = url.searchParams.get('archived') === 'true';
      return route.fulfill({ json: live.filter((m) => (m.archived_at !== null) === archived) });
    }
    if (url.pathname === '/api/meals/from-logs') {
      calls.fromLogs.push(body);
      return route.fulfill({ status: 201, json: { ...LUNCH, id: 'meal-new', name: body.name } });
    }
    if (url.pathname === '/api/meals' && method === 'POST') {
      calls.created.push(body);
      const meal = { ...LUNCH, id: 'meal-new', name: String(body.name), use_count: 0 };
      live.push(meal);
      return route.fulfill({ status: 201, json: meal });
    }
    const id = parts[3] ?? '';
    const meal = live.find((m) => m.id === id) ?? LUNCH;
    if (parts[4] === 'log') {
      calls.logged.push({ id, body });
      const entries = meal.items.map((i, n) => ({
        id: `e${n}`,
        log_group_id: 'g-meal',
        eaten_at: body.eaten_at,
        name: i.name,
      }));
      return route.fulfill({ status: 201, json: { entries, missing: meal.missing } });
    }
    calls.patched.push({ id, body });
    return route.fulfill({ json: { ...meal, ...body } });
  });
  await page.route('**/api/logs/groups/*', (route) => {
    calls.undone.push(new URL(route.request().url()).pathname.split('/')[4] ?? '');
    return route.fulfill({ status: 204, body: '' });
  });
  return calls;
}

async function openLog(page: Page, meals?: (typeof LUNCH)[]) {
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/logs/last-time', (r) => r.fulfill({ json: { eaten_at: null } }));
  await page.route('**/api/foods/quick', (r) =>
    r.fulfill({ json: { favourites: [], recents: [], frequents: [] } }),
  );
  await page.route('**/api/foods/search**', (r) =>
    r.fulfill({ json: { results: [RICE_FOOD], notice: null } }),
  );
  const calls = await stubMeals(page, meals);
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

const LOGGED = 'Logged Post-workout lunch, 4 items at 7:05 PM today.';

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('AC: one tap logs the whole meal in under 3 seconds', async ({ page }) => {
      const calls = await openLog(page);
      await page.getByRole('tab', { name: 'Meals' }).click();
      const row = page.getByTestId('meal-row').filter({ hasText: 'Post-workout lunch' });
      await expect(row).toContainText('4 items · 1,345 kcal · 93P 20F 189C');
      await noHorizontalScroll(page);

      const started = Date.now();
      await page.getByRole('button', { name: 'Log Post-workout lunch now' }).click();
      await expect(page.getByText(LOGGED)).toBeVisible();
      expect(Date.now() - started).toBeLessThan(3000);
      await expect
        .poll(() => calls.logged)
        .toEqual([{ id: 'meal-lunch', body: { eaten_at: '2026-10-17T23:05:00.000Z' } }]);

      // Undo takes the whole meal back in one step.
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect.poll(() => calls.undone).toEqual(['g-meal']);
      await expect(page.getByText(LOGGED)).toHaveCount(0);
    });

    test('AC: the sheet scales to 2,018 kcal at 1.5x; skip and per-item amounts', async ({
      page,
    }) => {
      const calls = await openLog(page);
      await page.getByRole('tab', { name: 'Meals' }).click();
      await page.getByRole('button', { name: /^Post-workout lunch/ }).click();
      const sheet = page.getByTestId('meal-log-sheet');
      const total = sheet.getByTestId('meal-log-total');
      await expect(total).toHaveText('Total 1,345 kcal · 93P 20F 189C');
      await sheet.getByRole('button', { name: '1.5x' }).click();
      await expect(total).toHaveText('Total 2,018 kcal · 140P 30F 284C');
      await noHorizontalScroll(page);

      // Not eating the veg this time, and a bit more rice.
      await sheet.getByLabel('Include Mixed veg').uncheck();
      await sheet.getByRole('button', { name: 'More Rice, cooked' }).click();
      await expect(sheet.getByLabel('Amount of Rice, cooked (grams)')).toHaveValue('310');
      await expect(total).toHaveText('Total 1,559 kcal · 139P 30F 155C');
      await sheet.getByRole('button', { name: 'Add meal · 1,559 kcal' }).click();

      await expect
        .poll(() => calls.logged[0]?.body)
        .toEqual({
          eaten_at: '2026-10-17T23:05:00.000Z',
          multiplier: 1.5,
          skipped_item_ids: ['veg'],
          item_overrides: [{ item_id: 'rice', grams: 310 }],
        });
      await expect(page.getByText(LOGGED)).toBeVisible();

      // The changed amount can go back into the meal.
      const prompt = page.getByTestId('update-meal-sheet');
      await expect(prompt).toContainText('Update “Post-workout lunch” with these changes?');
      await prompt.getByRole('button', { name: 'Update meal' }).click();
      await expect
        .poll(() => calls.patched)
        .toEqual([
          {
            id: 'meal-lunch',
            body: {
              items: [
                { food_id: 'food-butter', grams: 20 },
                { food_id: 'food-chicken', grams: 350 },
                { food_id: 'food-rice', grams: 310 },
                { food_id: 'food-veg', grams: 250 },
              ],
            },
          },
        ]);
      await expect(prompt).toHaveCount(0);
    });

    test('a portion alone is just this time: no update prompt', async ({ page }) => {
      const calls = await openLog(page);
      await page.getByRole('tab', { name: 'Meals' }).click();
      await page.getByRole('button', { name: /^Post-workout lunch/ }).click();
      const sheet = page.getByTestId('meal-log-sheet');
      await sheet.getByRole('button', { name: 'Custom' }).click();
      await sheet.getByLabel('Custom portion (0.1 to 10)').fill('0.75');
      await sheet.getByRole('button', { name: /^Add meal/ }).click();
      await expect
        .poll(() => calls.logged[0]?.body)
        .toEqual({
          eaten_at: '2026-10-17T23:05:00.000Z',
          multiplier: 0.75,
        });
      await expect(page.getByText(LOGGED)).toBeVisible();
      await expect(page.getByTestId('update-meal-sheet')).toHaveCount(0);
    });

    test('new meal from scratch with the normal search', async ({ page }) => {
      const calls = await openLog(page, []);
      await page.getByRole('tab', { name: 'Meals' }).click();
      await expect(page.getByTestId('meals-empty')).toBeVisible();
      await page.getByRole('button', { name: 'New meal' }).click();
      const editor = page.getByTestId('meal-editor');
      await editor.getByRole('button', { name: 'Create meal' }).click();
      await expect(editor.getByText('Enter a name.')).toBeVisible();
      await expect(editor.getByText('Add at least one food.')).toBeVisible();

      await editor.getByLabel('Meal name').fill('Rice bowl');
      await editor.getByLabel('Add a food').fill('rice');
      await editor.getByRole('button', { name: /^Rice, cooked/ }).click();
      await editor.getByLabel('Unit').selectOption('g');
      await editor.getByLabel('Amount', { exact: true }).fill('200');
      await editor.getByRole('button', { name: 'Add to meal' }).click();
      await expect(editor.getByTestId('editor-total')).toHaveText('Total 460 kcal · 5P 0F 100C');
      await noHorizontalScroll(page);
      await editor.getByRole('button', { name: 'Create meal' }).click();
      await expect
        .poll(() => calls.created)
        .toEqual([{ name: 'Rice bowl', items: [{ food_id: 'food-rice', grams: 200 }] }]);
      await expect(editor).toHaveCount(0);
    });

    test('a meal with a deleted food says so and logs the rest', async ({ page }) => {
      const gone = {
        ...LUNCH,
        items: [
          {
            ...item('butter', 'Butter', 20, [0, 0, 0, 0]),
            food_id: null,
            name: null,
            missing: true,
          },
          ...LUNCH.items.slice(1),
        ],
        totals: { kcal: 1201, protein_g: 92.8, carbs_g: 189, fat_g: 4 },
        missing: 1,
      } as unknown as typeof LUNCH;
      await openLog(page, [gone]);
      await page.getByRole('tab', { name: 'Meals' }).click();
      await page.getByRole('button', { name: /^Post-workout lunch/ }).click();
      const sheet = page.getByTestId('meal-log-sheet');
      await expect(sheet).toContainText('1 food no longer exists. The rest will be logged.');
      await expect(sheet.getByTestId('meal-log-total')).toHaveText(
        'Total 1,201 kcal · 93P 4F 189C',
      );
    });

    test('meals show up in search and in recents, marked with a meal icon', async ({ page }) => {
      await openLog(page);
      await expect(page.getByRole('list', { name: 'Recent meals' })).toContainText(
        'Post-workout lunch',
      );
      await page.getByLabel('Find a food').fill('lunch');
      await expect(page.getByRole('list', { name: 'Matching meals' })).toContainText(
        'Post-workout lunch',
      );
    });
  });
}

// --- Today: save a block or a selection as a meal, and the meal name by the time pill ---------

const ENTRY = {
  food_id: 'food-x',
  logged_on: '2026-10-17',
  brand: null,
  grams: 100,
  quantity: null,
  unit_label: null,
  kcal: 100,
  protein_g: 10,
  carbs_g: 10,
  fat_g: 2,
  fiber_g: null,
  sugar_g: null,
  sodium_mg: null,
  source: 'search',
  saved_meal_id: null,
  meal_name: null,
};
const DAY = [
  {
    ...ENTRY,
    id: 'm1',
    log_group_id: 'g1',
    name: 'Chicken breast',
    eaten_at: '2026-10-17T17:00:00Z',
    source: 'meal',
    saved_meal_id: 'meal-lunch',
    meal_name: 'Post-workout lunch',
  },
  {
    ...ENTRY,
    id: 'm2',
    log_group_id: 'g1',
    name: 'Rice, cooked',
    eaten_at: '2026-10-17T17:00:00Z',
    source: 'meal',
    saved_meal_id: 'meal-lunch',
    meal_name: 'Post-workout lunch',
  },
  {
    ...ENTRY,
    id: 's1',
    log_group_id: 'g2',
    name: 'Greek yogurt',
    eaten_at: '2026-10-17T20:00:00Z',
  },
  {
    ...ENTRY,
    id: 's2',
    log_group_id: 'g2',
    name: 'Cake',
    food_id: null,
    grams: null,
    source: 'quick_add',
    eaten_at: '2026-10-17T20:00:00Z',
  },
];

async function openToday(page: Page) {
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/targets', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/logs**', (r) => r.fulfill({ json: DAY }));
  const calls = await stubMeals(page);
  await page.goto('/');
  await expect(page.getByTestId('time-block').first()).toBeVisible();
  return calls;
}

const block = (page: Page, label: string) =>
  page
    .getByTestId('time-block')
    .filter({ has: page.getByTestId('block-pill').getByText(label, { exact: true }) });

for (const vp of VIEWPORTS) {
  test.describe(`Today ${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('a block from a saved meal shows its name; a block saves as a meal', async ({ page }) => {
      const calls = await openToday(page);
      await expect(block(page, '1 PM').getByTestId('block-meal')).toHaveText('Post-workout lunch');
      await expect(block(page, '4 PM').getByTestId('block-meal')).toHaveCount(0);
      await noHorizontalScroll(page);

      await page.getByRole('button', { name: 'Options for the 4 PM block' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.getByRole('menuitem', { name: 'Save as meal' }).click();
      const sheet = page.getByTestId('save-meal-sheet');
      await expect(sheet).toContainText(
        '1 food with the amounts you logged. 1 quick add is left out, since there is no food to save.',
      );
      await sheet.getByLabel('Meal name').fill('Afternoon snack');
      await sheet.getByRole('button', { name: 'Save meal' }).click();
      await expect
        .poll(() => calls.fromLogs)
        .toEqual([{ name: 'Afternoon snack', log_ids: ['s1', 's2'] }]);
      await expect(page.getByTestId('toast')).toHaveText('Saved Afternoon snack as a meal.');
    });

    test('the block menu closes with Escape', async ({ page }) => {
      await openToday(page);
      const options = page.getByRole('button', { name: 'Options for the 1 PM block' });
      await options.click();
      await expect(page.getByRole('menuitem', { name: 'Copy to another day' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'Save as meal' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(options).toBeFocused();
    });
  });
}

test.describe('Today desktop selection', () => {
  test.use({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });

  test('selected cards from different blocks save as one meal', async ({ page }) => {
    const calls = await openToday(page);
    await page.getByLabel('Select Chicken breast').check();
    await page.getByLabel('Select Greek yogurt').check();
    await page.getByTestId('selection-bar').getByRole('button', { name: 'Save as meal' }).click();
    const sheet = page.getByTestId('save-meal-sheet');
    await expect(sheet).toContainText('2 foods with the amounts you logged.');
    await sheet.getByLabel('Meal name').fill('Mix');
    await sheet.getByRole('button', { name: 'Save meal' }).click();
    await expect.poll(() => calls.fromLogs).toEqual([{ name: 'Mix', log_ids: ['m1', 's1'] }]);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });
});
