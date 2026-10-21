import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 3.19: My staples. AC (21st rejected, countable defaults) is tested in the API
// (tests/test_staples.py); here the page shows the counter, switches, reorders, edits the
// amounts, adds from a food and answers the 14-day prompt.

const NOW = new Date('2026-10-17T23:07:00Z');
const PER = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

function staple(id: string, name: string, unit: string, grams: number, min: number, max: number) {
  const step = max - min === 3 ? 1 : 0.5;
  const amounts: number[] = [];
  for (let v = min; v <= max; v += step) amounts.push(v);
  return {
    id,
    food_id: `f-${id}`,
    saved_meal_id: null,
    name,
    brand: null,
    food_group: null,
    unit_label: unit,
    unit_grams: grams,
    step_units: step,
    min_units: min,
    max_units: max,
    amounts,
    is_available: true,
    sort_order: 0,
    per_unit: { ...PER, kcal: Math.round(2 * grams) },
    units: [
      { label: '100 g', grams: 100 },
      ...(unit === '100 g' ? [{ label: '1 slice', grams: 30 }] : [{ label: unit, grams }]),
    ],
    missing: false,
  };
}

type StapleRow = ReturnType<typeof staple>;

const FOOD = {
  id: 'f-oats',
  name: 'Rolled oats',
  brand: null,
  source: 'custom',
  tier: 'personal',
  kcal_100: 380,
  protein_100: 13,
  carbs_100: 67,
  fat_100: 7,
  fiber_100: null,
  sugar_100: null,
  sodium_mg_100: null,
  density_g_ml: null,
  kcal_mismatch: false,
  is_favourite: false,
  times_logged: 4,
  last: null,
  servings: [{ label: '1 cup', grams: 80, is_default: true }],
};

interface Calls {
  patches: { id: string; body: Record<string, unknown> }[];
  orders: string[][];
  posts: unknown[];
  answers: unknown[];
}

async function open(
  page: Page,
  path: string,
  start: StapleRow[],
  opts: { offer?: boolean; limit?: number } = {},
): Promise<Calls> {
  const calls: Calls = { patches: [], orders: [], posts: [], answers: [] };
  let rows = [...start];
  let offer = opts.offer ?? false;
  const body = () => ({ staples: rows, count: rows.length, limit: opts.limit ?? 20 });
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/logs/last-time', (r) => r.fulfill({ json: { eaten_at: null } }));
  await page.route('**/api/meals**', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/foods/quick', (r) =>
    r.fulfill({ json: { favourites: [], recents: [FOOD], frequents: [] } }),
  );
  await page.route('**/api/foods/fits-my-macros**', (r) =>
    r.fulfill({ json: { date: '2026-10-17', has_target: false, remaining: PER, results: [] } }),
  );
  await page.route(
    (u) => u.pathname.startsWith('/api/staples'),
    async (r) => {
      const req = r.request();
      const path = new URL(req.url()).pathname;
      const method = req.method();
      if (path === '/api/staples/prompt') {
        if (method === 'POST') {
          calls.answers.push(req.postDataJSON());
          offer = false;
          rows = [...rows, staple('p1', 'Rolled oats', '1 cup', 80, 0.5, 3)];
          return r.fulfill({ json: body() });
        }
        return r.fulfill({
          json: offer
            ? {
                offer: true,
                foods: Array.from({ length: 10 }, (_, i) => ({
                  food_id: `t${i}`,
                  name: i === 0 ? 'Rolled oats' : `Food ${i}`,
                  brand: null,
                  times_logged: 20 - i,
                })),
              }
            : { offer: false, foods: [] },
        });
      }
      if (path === '/api/staples/order') {
        const ids = (req.postDataJSON() as { ids: string[] }).ids;
        calls.orders.push(ids);
        rows = ids.map((id) => rows.find((s) => s.id === id) as StapleRow);
        return r.fulfill({ json: body() });
      }
      if (path === '/api/staples' && method === 'POST') {
        calls.posts.push(req.postDataJSON());
        rows = [
          ...rows,
          { ...staple('new', 'Rolled oats', '1 cup', 80, 0.5, 3), food_id: 'f-oats' },
        ];
        return r.fulfill({ status: 201, json: body() });
      }
      const id = path.split('/').pop() ?? '';
      if (method === 'PATCH') {
        const patch = req.postDataJSON() as Record<string, unknown>;
        calls.patches.push({ id, body: patch });
        rows = rows.map((s) => {
          if (s.id !== id) return s;
          const next = { ...s, ...patch } as StapleRow;
          if (patch.unit_label === '1 slice') {
            next.unit_grams = 30;
            next.amounts = [1, 2, 3, 4];
          }
          return next;
        });
        return r.fulfill({ json: body() });
      }
      if (method === 'DELETE') {
        rows = rows.filter((s) => s.id !== id);
        return r.fulfill({ status: 204 });
      }
      return r.fulfill({ json: body() });
    },
  );
  await page.goto(path);
  return calls;
}

const BREAD = staple('s-bread', 'Sourdough bread', '100 g', 100, 0.5, 3);
const EGGS = staple('s-eggs', 'Large egg', '1 egg', 50, 1, 4);

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('the Staples tab lists staples with a counter, switch and reorder', async ({ page }) => {
      const calls = await open(page, '/log', [BREAD, EGGS]);
      await page.getByRole('tab', { name: 'Staples' }).click();
      await expect(page.getByTestId('staples-count')).toHaveText('2 of 20');
      const rows = page.getByTestId('staple-row');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(1)).toContainText('1 egg · 1 to 4 · 100 kcal each');
      await expect(rows.nth(0)).toContainText('100 g · 0.5 to 3');
      await noSideScroll(page);

      const sw = page.getByRole('switch', { name: 'Use Large egg in suggestions' });
      await expect(sw).toHaveAttribute('aria-checked', 'true');
      await sw.click();
      await expect(sw).toHaveAttribute('aria-checked', 'false');
      await expect
        .poll(() => calls.patches)
        .toEqual([{ id: 's-eggs', body: { is_available: false } }]);

      await expect(page.getByRole('button', { name: 'Move Sourdough bread up' })).toBeDisabled();
      await page.getByRole('button', { name: 'Move Sourdough bread down' }).click();
      await expect.poll(() => calls.orders).toEqual([['s-eggs', 's-bread']]);
      await expect(rows.nth(0)).toContainText('Large egg');
    });

    test('the edit sheet changes the unit and the allowed amounts', async ({ page }) => {
      const calls = await open(page, '/log', [BREAD]);
      await page.getByRole('tab', { name: 'Staples' }).click();
      await page.getByRole('button', { name: 'Edit Sourdough bread' }).click();
      const sheet = page.getByTestId('staple-sheet');
      await expect(sheet.getByTestId('staple-amount')).toHaveText([
        '0.5 · 50 g',
        '1 · 100 g',
        '1.5 · 150 g',
        '2 · 200 g',
        '2.5 · 250 g',
        '3 · 300 g',
      ]);
      // A countable unit starts at 1 to 4 in steps of 1.
      await sheet.getByLabel('Unit').selectOption('1 slice');
      await expect(sheet.getByTestId('staple-amount')).toHaveText([
        '1 · 30 g',
        '2 · 60 g',
        '3 · 90 g',
        '4 · 120 g',
      ]);
      await sheet.getByLabel('To').fill('9');
      await expect(sheet.getByRole('alert')).toHaveText(
        'Allow at most 7 amounts. Use a bigger step or a narrower range.',
      );
      await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
      await sheet.getByLabel('To').fill('3');
      await expect(sheet.getByLabel('Food group')).toHaveValue('');
      await sheet.getByLabel('Food group').selectOption('Bread and tortillas');
      await sheet.getByRole('button', { name: 'Save' }).click();
      await expect(sheet).toBeHidden();
      expect(calls.patches).toEqual([
        {
          id: 's-bread',
          body: {
            unit_label: '1 slice',
            food_group: 'bread_tortillas',
            min_units: 1,
            max_units: 3,
            step_units: 1,
          },
        },
      ]);
      await noSideScroll(page);
    });

    test('Add as staple on a food detail', async ({ page }) => {
      const calls = await open(page, '/log', [BREAD]);
      await page.getByRole('button', { name: 'Rolled oats' }).first().click();
      const detail = page.getByTestId('food-detail');
      await detail.getByRole('button', { name: 'Add Rolled oats as a staple' }).click();
      await expect.poll(() => calls.posts).toEqual([{ food_id: 'f-oats' }]);
      await expect(
        detail.getByRole('button', { name: 'Remove Rolled oats from staples' }),
      ).toBeVisible();
    });

    test('staples full shows the limit instead of Add', async ({ page }) => {
      const full = Array.from({ length: 20 }, (_, i) =>
        staple(`s${i}`, `Food ${i}`, '100 g', 100, 0.5, 3),
      );
      await open(page, '/log', full);
      await page.getByRole('button', { name: 'Rolled oats' }).first().click();
      await expect(
        page.getByTestId('food-detail').getByRole('button', { name: 'Staples full (20 of 20)' }),
      ).toBeDisabled();
    });

    test('the 14-day prompt adds the most-logged foods once', async ({ page }) => {
      const calls = await open(page, '/account', [], { offer: true });
      await page.getByRole('link', { name: 'Manage staples' }).click();
      await expect(page).toHaveURL(/\/staples$/);
      await expect(page.getByRole('heading', { name: 'My staples' })).toBeVisible();
      const prompt = page.getByTestId('staples-prompt');
      await expect(prompt).toContainText('Add your 10 most-logged foods as staples?');
      await expect(page.getByTestId('staples-count')).toHaveText('0 of 20');
      await prompt.getByRole('button', { name: 'Add them' }).click();
      await expect(prompt).toBeHidden();
      expect(calls.answers).toEqual([{ accept: true }]);
      await expect(page.getByTestId('staples-count')).toHaveText('1 of 20');
      await noSideScroll(page);
    });
  });
}
