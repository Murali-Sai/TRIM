import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 3.21: the suggestion sheet. AC: logging a suggestion creates one time block with
// source `suggestion` (the API test tests/test_suggestions.py checks the rows); here the
// sheet sends the plate at the chosen time and works at 375 and 1280 px.

const NOW = new Date('2026-10-17T23:07:00Z');
const TARGET = {
  effective_from: '2026-10-01',
  kcal: 2300,
  protein_g: 150,
  carbs_g: 280,
  fat_g: 65,
  fiber_g: null,
  water_ml: null,
  source: 'custom',
  bmr: null,
  tdee: null,
  formula: null,
};
const BUDGET = { kcal: 900, protein_g: 60, carbs_g: 100, fat_g: 25 };

function item(id: string, name: string, unit: string, units: number, grams: number, kcal: number) {
  return {
    staple_id: id,
    food_id: `f-${id}`,
    saved_meal_id: null,
    name,
    unit_label: unit,
    units,
    grams,
    kcal,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
  };
}
const RICE = item('rice', 'Rice', '100 g', 3, 300, 390);
const EGG = item('egg', 'Egg', '1 egg', 4, 200, 288);
const YOG = item('yog', 'Greek yogurt', '1 cup', 1.5, 255, 150);
const CHICKEN = item('chicken', 'Chicken breast', '100 g', 1.5, 150, 248);
const PB = item('pb', 'Peanut butter', '1 tbsp', 2, 32, 188);
const plate = (items: ReturnType<typeof item>[], kcal: number, match: number, leaves: object) => ({
  items,
  totals: { kcal, protein_g: 59.25, carbs_g: 95.35, fat_g: 21.15 },
  leaves,
  match_pct: match,
});
const FIRST = [
  plate([RICE, EGG, YOG], 828, 97.5, { kcal: 72, protein_g: 0.75, carbs_g: 4.65, fat_g: 3.85 }),
  plate([CHICKEN, RICE, PB], 826, 97.2, { kcal: 74, protein_g: -2.6, carbs_g: 9.2, fat_g: 2.3 }),
  plate([{ ...CHICKEN, units: 1, grams: 100, kcal: 165 }, RICE, EGG], 843, 97, {
    kcal: 57,
    protein_g: -4.3,
    carbs_g: 13.8,
    fat_g: 1.3,
  }),
];
const NEXT = [
  plate([EGG, YOG, { ...PB, units: 0.5 }], 485, 88.1, {
    kcal: 415,
    protein_g: 10,
    carbs_g: 80,
    fat_g: 3,
  }),
];
const STAPLES = ['rice', 'egg', 'yog', 'chicken', 'pb'].map((id, i) => ({
  id,
  food_id: `f-${id}`,
  saved_meal_id: null,
  name: ['Rice', 'Egg', 'Greek yogurt', 'Chicken breast', 'Peanut butter'][i],
  brand: null,
  food_group: null,
  unit_label: '100 g',
  unit_grams: 100,
  step_units: 0.5,
  min_units: 0.5,
  max_units: 3,
  amounts: [0.5, 1, 1.5, 2, 2.5, 3],
  is_available: true,
  sort_order: i,
  per_unit: { kcal: 100, protein_g: 0, carbs_g: 0, fat_g: 0 },
  units: [],
  missing: false,
}));

interface Calls {
  asked: Record<string, unknown>[];
  logged: Record<string, unknown>[];
  saved: Record<string, unknown>[];
  never: unknown[];
  undone: string[];
}

async function open(
  page: Page,
  path: string,
  answer?: (body: Record<string, unknown>) => Record<string, unknown>,
): Promise<Calls> {
  const calls: Calls = { asked: [], logged: [], saved: [], never: [], undone: [] };
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/targets', (r) => r.fulfill({ json: [TARGET] }));
  await page.route('**/api/logs?**', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/logs/last-time', (r) => r.fulfill({ json: { eaten_at: null } }));
  await page.route('**/api/meals**', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/foods/quick', (r) =>
    r.fulfill({ json: { favourites: [], recents: [], frequents: [] } }),
  );
  await page.route('**/api/foods/fits-my-macros**', (r) =>
    r.fulfill({ json: { date: '2026-10-17', has_target: false, remaining: null, results: [] } }),
  );
  await page.route('**/api/staples', (r) =>
    r.fulfill({ json: { staples: STAPLES, count: STAPLES.length, limit: 20 } }),
  );
  await page.route('**/api/pair-preferences**', async (r) => {
    if (r.request().method() === 'DELETE') {
      calls.undone.push(new URL(r.request().url()).pathname.split('/').pop() ?? '');
      return r.fulfill({ status: 204 });
    }
    const body = r.request().postDataJSON() as { staple_ids: string[] };
    calls.never.push(body);
    const name = (id: string) => STAPLES.find((st) => st.id === id)?.name ?? '';
    return r.fulfill({
      status: 201,
      json: {
        id: 'pair-1',
        staple_ids: body.staple_ids,
        names: body.staple_ids.map(name),
        created_at: '2026-10-17T23:07:00Z',
      },
    });
  });
  await page.route('**/api/suggestions**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    const body = r.request().postDataJSON() as Record<string, unknown>;
    if (path === '/api/suggestions/log') {
      calls.logged.push(body);
      const items = body.items as unknown[];
      return r.fulfill({
        status: 201,
        json: items.map((_, i) => ({ id: `l${i}`, log_group_id: 'g-sugg', source: 'suggestion' })),
      });
    }
    if (path === '/api/suggestions/save-meal') {
      calls.saved.push(body);
      return r.fulfill({ status: 201, json: { id: 'm1', name: body.name } });
    }
    calls.asked.push(body);
    const shown = (body.exclude_sets as string[][]).length;
    return r.fulfill({
      json: answer?.(body) ?? {
        date: '2026-10-17',
        state: 'ok',
        message: null,
        budget: BUDGET,
        left_today: BUDGET,
        suggestions: shown ? NEXT : FIRST,
      },
    });
  });
  await page.goto(path);
  return calls;
}

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

    test('AC: three cards, then Log at the time chip logs one block', async ({ page }) => {
      const calls = await open(page, '/');
      await page.getByRole('button', { name: 'What should I eat?' }).click();
      const sheet = page.getByTestId('suggest-sheet');
      await expect(sheet).toContainText(
        'Suggestions combine your staples to fit your numbers. They are not dietary advice.',
      );
      const cards = sheet.getByTestId('suggestion');
      await expect(cards).toHaveCount(3);
      await expect(cards.getByTestId('match')).toHaveText([
        '97.5% match',
        '97.2% match',
        '97.0% match',
      ]);
      await expect(cards.nth(0)).toContainText('Rice');
      await expect(cards.nth(0)).toContainText('300 g · 390 kcal');
      await expect(cards.nth(0)).toContainText('4 x 1 egg');
      await expect(cards.nth(0).getByTestId('leaves')).toHaveText(
        'Leaves 72 kcal, 1 g protein, 5 g carbs, 4 g fat',
      );
      await expect(cards.nth(1).getByTestId('leaves')).toHaveText(
        'Leaves 74 kcal, 9 g carbs, 2 g fat; 3 g over on protein',
      );
      expect(calls.asked[0]).toMatchObject({
        date: '2026-10-17',
        budget: { mode: 'rest_of_day' },
        max_items: 3,
        excluded_staple_ids: [],
        locked: [],
        exclude_sets: [],
      });
      await noSideScroll(page);

      await cards.nth(0).getByRole('button', { name: 'Log at 7:05 PM' }).click();
      await expect(sheet).toBeHidden();
      expect(calls.logged).toEqual([
        {
          eaten_at: '2026-10-17T23:05:00.000Z',
          items: [
            { staple_id: 'rice', units: 3 },
            { staple_id: 'egg', units: 4 },
            { staple_id: 'yog', units: 1.5 },
          ],
        },
      ]);
      await expect(page.getByText('Logged 3 items.')).toBeVisible();
    });

    test('chips change the search; Shuffle keeps locks and skips shown sets', async ({ page }) => {
      const calls = await open(page, '/log');
      await page.getByRole('button', { name: 'What should I eat?' }).click();
      const sheet = page.getByTestId('suggest-sheet');
      await expect(sheet.getByTestId('suggestion')).toHaveCount(3);
      await sheet.getByRole('button', { name: 'Next meal 50%' }).click();
      await sheet.getByRole('button', { name: 'Up to 5 items' }).click();
      await sheet.getByRole('button', { name: 'Peanut butter', exact: true }).click();
      await expect
        .poll(() => calls.asked.at(-1))
        .toMatchObject({
          budget: { mode: 'fraction', fraction: 0.5 },
          max_items: 5,
          excluded_staple_ids: ['pb'],
          exclude_sets: [],
        });

      const lock = sheet
        .getByTestId('suggestion')
        .nth(0)
        .getByRole('button', { name: 'Keep Egg, 4 x 1 egg, when shuffling' });
      await lock.click();
      await expect(lock).toHaveAttribute('aria-pressed', 'true');
      const before = calls.asked.length;
      await sheet.getByRole('button', { name: 'Shuffle' }).click();
      await expect.poll(() => calls.asked.length).toBe(before + 1);
      expect(calls.asked.at(-1)).toMatchObject({
        locked: [{ staple_id: 'egg', units: 4 }],
        exclude_sets: [
          ['rice', 'egg', 'yog'],
          ['chicken', 'rice', 'pb'],
          ['chicken', 'rice', 'egg'],
        ],
      });
      await expect(sheet.getByTestId('suggestion')).toHaveCount(1);
      await expect(sheet.getByTestId('match')).toHaveText('88.1% match');

      await sheet.getByRole('button', { name: 'Save as meal' }).click();
      await expect(sheet.getByLabel('Meal name')).toHaveValue(
        'Egg, greek yogurt and peanut butter',
      );
      await sheet.getByRole('button', { name: 'Save meal' }).click();
      await expect(
        sheet.getByText('Saved "Egg, greek yogurt and peanut butter" to your meals.'),
      ).toBeVisible();
      expect(calls.saved).toEqual([
        {
          name: 'Egg, greek yogurt and peanut butter',
          items: [
            { staple_id: 'egg', units: 4 },
            { staple_id: 'yog', units: 1.5 },
            { staple_id: 'pb', units: 0.5 },
          ],
        },
      ]);
      await noSideScroll(page);
    });

    test('logging from Log food shows the usual notice', async ({ page }) => {
      await open(page, '/log');
      await page.getByRole('button', { name: 'What should I eat?' }).click();
      await page
        .getByTestId('suggestion')
        .nth(2)
        .getByRole('button', { name: /^Log at/ })
        .click();
      await expect(page.getByText(/Logged 3 items/)).toBeVisible();
      await expect(page.getByRole('link', { name: 'See it on Today' })).toHaveAttribute(
        'href',
        '/?highlight=g-sugg',
      );
    });

    test('the meal chip starts from the time and the label shows good pairs', async ({ page }) => {
      const calls = await open(page, '/', (body) => ({
        date: '2026-10-17',
        context: body.context,
        state: 'ok',
        message: null,
        budget: BUDGET,
        left_today: BUDGET,
        suggestions: [
          { ...FIRST[2], label: 'Often eaten together at dinner' },
          { ...FIRST[0], label: null },
        ],
      }));
      await page.getByRole('button', { name: 'What should I eat?' }).click();
      const sheet = page.getByTestId('suggest-sheet');
      // 7:05 PM is dinner.
      await expect(sheet.getByRole('button', { name: 'dinner' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(calls.asked[0]).toMatchObject({ context: 'dinner' });
      await expect(sheet.getByTestId('pair-label')).toHaveText(['Often eaten together at dinner']);
      await expect(sheet).toContainText('the thumbs-down teaches it');
      await sheet.getByRole('button', { name: 'lunch' }).click();
      await expect.poll(() => calls.asked.at(-1)).toMatchObject({ context: 'lunch' });
    });

    test("thumbs-down asks which two don't go together, with Undo", async ({ page }) => {
      const calls = await open(page, '/');
      await page.getByRole('button', { name: 'What should I eat?' }).click();
      const sheet = page.getByTestId('suggest-sheet');
      const card = sheet.getByTestId('suggestion').nth(0);
      await card.getByRole('button', { name: "Don't suggest these together" }).click();
      const pick = card.getByRole('group', { name: "Which two don't go together?" });
      await pick.getByRole('button', { name: 'Rice' }).click();
      await pick.getByRole('button', { name: 'Greek yogurt' }).click();
      // Only two can be picked.
      await expect(pick.getByRole('button', { name: 'Egg' })).toBeDisabled();
      const before = calls.asked.length;
      await pick.getByRole('button', { name: "Don't suggest these together" }).click();
      await expect.poll(() => calls.never).toEqual([{ staple_ids: ['rice', 'yog'] }]);
      await expect(sheet.getByText("Won't suggest Rice and Greek yogurt together.")).toBeVisible();
      // The suggestions are asked for again without them together.
      await expect.poll(() => calls.asked.length).toBeGreaterThan(before);
      await sheet.getByRole('button', { name: 'Undo' }).click();
      await expect.poll(() => calls.undone).toEqual(['pair-1']);
      await expect(sheet.getByText("Won't suggest Rice and Greek yogurt together.")).toBeHidden();
      await noSideScroll(page);
    });

    test('thumbs-down on a plate of two needs no picking', async ({ page }) => {
      const calls = await open(page, '/', () => ({
        date: '2026-10-17',
        context: 'dinner',
        state: 'ok',
        message: null,
        budget: BUDGET,
        left_today: BUDGET,
        suggestions: [{ ...FIRST[0], items: [RICE, EGG], label: null }],
      }));
      await page.getByRole('button', { name: 'What should I eat?' }).click();
      await page.getByRole('button', { name: "Don't suggest these together" }).click();
      await expect.poll(() => calls.never).toEqual([{ staple_ids: ['rice', 'egg'] }]);
    });

    for (const [state, text, link] of [
      ['need_staples', 'Add at least 2 staples to get suggestions.', 'Manage staples'],
      ['within_100', "You're within 100 kcal of your target.", null],
      ['target_reached', "You've reached today's calorie target.", null],
      [
        'no_fit',
        'No combination fits within 5% of your calories. Try allowing more items or smaller amounts.',
        null,
      ],
    ] as const) {
      test(`empty state: ${state}`, async ({ page }) => {
        await open(page, '/', () => ({
          date: '2026-10-17',
          state,
          message: text,
          budget: null,
          left_today: null,
          suggestions: [],
        }));
        await page.getByRole('button', { name: 'What should I eat?' }).click();
        const empty = page.getByTestId('suggest-empty');
        await expect(empty).toContainText(text);
        if (link) await expect(empty.getByRole('link', { name: link })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Shuffle' })).toHaveCount(0);
      });
    }
  });
}
