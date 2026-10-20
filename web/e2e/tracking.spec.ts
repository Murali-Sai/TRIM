import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 3.13: water and fiber. AC: 2,759 kcal gives 39 g fiber; fl oz conversion (unit tests
// in src/lib/water.test.ts; here, the +8 fl oz button stores 237 ml). Clock: 7 PM, 17 Oct.

const NOW = new Date('2026-10-17T23:00:00Z');
const TARGET = {
  effective_from: '2026-10-01',
  kcal: 2759,
  protein_g: 150,
  carbs_g: 350,
  fat_g: 85,
  fiber_g: 39,
  water_ml: 2000 as number | null,
  source: 'custom',
  bmr: null,
  tdee: null,
  tolerance_pct: 5,
  formula: null,
};
const ENTRY = {
  log_group_id: 'g1',
  eaten_at: '2026-10-17T16:00:00Z',
  logged_on: '2026-10-17',
  brand: null,
  grams: 100,
  quantity: null,
  unit_label: null,
  protein_g: 10,
  carbs_g: 20,
  fat_g: 5,
  sugar_g: null,
  sodium_mg: null,
  source: 'search',
  saved_meal_id: null,
  meal_name: null,
};
const DAY = [
  { ...ENTRY, id: 'a', food_id: 'f1', name: 'Oats', kcal: 380, fiber_g: 10 },
  { ...ENTRY, id: 'b', food_id: 'f2', name: 'Shop sandwich', kcal: 450, fiber_g: null },
  { ...ENTRY, id: 'c', food_id: null, name: 'Quick add', kcal: 200, fiber_g: null },
];

type Settings = { track_water: boolean; track_fiber: boolean; water_unit: 'ml' | 'fl_oz' };

interface Calls {
  settings: Partial<Settings>[];
  water: { ml: number }[];
  undone: string[];
  targets: Record<string, unknown>[];
}

async function open(page: Page, path: string, start: Settings, target = TARGET) {
  const calls: Calls = { settings: [], water: [], undone: [], targets: [] };
  let settings = { ...start };
  const water = [{ id: 'w0', logged_at: '2026-10-17T13:00:00Z', logged_on: '2026-10-17', ml: 750 }];
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/me/settings', (r) => {
    if (r.request().method() === 'PATCH') {
      const body = r.request().postDataJSON() as Partial<Settings>;
      calls.settings.push(body);
      settings = { ...settings, ...body };
    }
    return r.fulfill({ json: settings });
  });
  await page.route('**/api/targets', (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      calls.targets.push(body);
      return r.fulfill({ status: 201, json: { ...target, ...body } });
    }
    return r.fulfill({ json: [target] });
  });
  await page.route(
    (u) => u.pathname === '/api/logs',
    (r) => r.fulfill({ json: DAY }),
  );
  await page.route('**/api/logs/days**', (r) =>
    r.fulfill({
      json: [
        {
          date: '2026-10-17',
          entries: 3,
          kcal: 1030,
          protein_g: 30,
          carbs_g: 60,
          fat_g: 15,
          fiber_g: 10,
          fiber_unknown: 2,
        },
      ],
    }),
  );
  await page.route('**/api/water**', (r) => {
    const req = r.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { ml: number };
      calls.water.push(body);
      const row = {
        id: `w${water.length}`,
        logged_at: NOW.toISOString(),
        logged_on: '2026-10-17',
        ...body,
      };
      water.push(row);
      return r.fulfill({ status: 201, json: row });
    }
    if (req.method() === 'DELETE') {
      const id = new URL(req.url()).pathname.split('/')[3] ?? '';
      calls.undone.push(id);
      water.splice(
        water.findIndex((w) => w.id === id),
        1,
      );
      return r.fulfill({ status: 204, body: '' });
    }
    return r.fulfill({ json: water });
  });
  await page.route('**/api/water/days**', (r) =>
    r.fulfill({ json: [{ date: '2026-10-17', ml: water.reduce((s, w) => s + w.ml, 0) }] }),
  );
  await page.goto(path);
  return calls;
}

const ON = { track_water: true, track_fiber: true, water_unit: 'ml' } as const;

async function noHorizontalScroll(page: Page) {
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

    test('Account: water is off until turned on; fiber is on', async ({ page }) => {
      const calls = await open(page, '/account', { ...ON, track_water: false });
      const water = page.getByRole('switch', { name: 'Track water' });
      await expect(water).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByRole('switch', { name: 'Track fiber' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect(page.getByLabel('Water unit')).toHaveCount(0);
      await water.click();
      await expect(water).toHaveAttribute('aria-checked', 'true');
      await page.getByLabel('Water unit').selectOption('fl_oz');
      await expect
        .poll(() => calls.settings)
        .toEqual([{ track_water: true }, { water_unit: 'fl_oz' }]);
      await noHorizontalScroll(page);
    });

    test('Today: the water row adds in one tap, with Undo', async ({ page }) => {
      const calls = await open(page, '/', ON);
      const row = page.getByTestId('water-row');
      await expect(row.getByTestId('water-total')).toHaveText('750 ml / 2,000 ml');
      await row.getByRole('button', { name: 'Add 250 ml of water' }).click();
      await expect(row.getByTestId('water-total')).toHaveText('1,000 ml / 2,000 ml');
      await expect(page.getByTestId('toast')).toContainText('Added 250 ml of water.');
      await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click();
      await expect(row.getByTestId('water-total')).toHaveText('750 ml / 2,000 ml');
      expect(calls.water).toEqual([{ ml: 250 }]);
      expect(calls.undone).toEqual(['w1']);

      await row.getByRole('button', { name: 'Custom' }).click();
      await row.getByLabel('Amount (ml)').fill('9000');
      await row.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(row.getByRole('alert')).toHaveText('Enter 1 to 5,000 ml.');
      await row.getByLabel('Amount (ml)').fill('330');
      await row.getByRole('button', { name: 'Add', exact: true }).click();
      await expect.poll(() => calls.water.at(-1)).toEqual({ ml: 330 });
      await noHorizontalScroll(page);
    });

    test('Today in fl oz: +8 fl oz stores 237 ml', async ({ page }) => {
      const calls = await open(page, '/', { ...ON, water_unit: 'fl_oz' });
      const row = page.getByTestId('water-row');
      await expect(row.getByTestId('water-total')).toHaveText('25 fl oz / 68 fl oz');
      await row.getByRole('button', { name: 'Add 8 fl oz of water' }).click();
      await expect.poll(() => calls.water).toEqual([{ ml: 237 }]);
    });

    test('Today: fiber against its target, and foods with no fiber data counted', async ({
      page,
    }) => {
      await open(page, '/', { ...ON, track_water: false });
      await expect(page.getByTestId('water-row')).toHaveCount(0);
      const fiber = page.locator('[data-testid$="extra-fiber"]:visible');
      if (vp.width < 1024) await page.getByRole('button', { name: 'What is left' }).click();
      await expect(fiber).toContainText('10 / 39 g');
      await expect(fiber).toContainText('fiber unknown for 2 foods');
    });

    test('Today: fiber hidden when not tracked', async ({ page }) => {
      await open(page, '/', { ...ON, track_fiber: false });
      await expect(page.getByTestId('target-strip')).toBeVisible();
      await expect(page.locator('[data-testid$="extra-fiber"]')).toHaveCount(0);
    });

    test('Targets: fiber starts at 14 g per 1,000 kcal; water is optional', async ({ page }) => {
      const calls = await open(page, '/targets', ON, { ...TARGET, fiber_g: 30, water_ml: null });
      const form = page.getByTestId('fiber-water');
      await expect(form.getByLabel('Fiber (g)')).toHaveValue('30');
      await form.getByRole('button', { name: 'Use the default (39 g)' }).click();
      await expect(form.getByLabel('Fiber (g)')).toHaveValue('39');
      await form.getByLabel('Water (ml)').fill('100');
      await form.getByRole('button', { name: 'Save fiber and water' }).click();
      await expect(form).toContainText('Enter 250 to 5,000 ml, or leave it empty.');
      await form.getByLabel('Water (ml)').fill('2500');
      await form.getByRole('button', { name: 'Save fiber and water' }).click();
      await expect
        .poll(() => calls.targets)
        .toEqual([
          { kcal: 2759, protein_g: 150, fat_g: 85, carbs_g: 350, fiber_g: 39, water_ml: 2500 },
        ]);
      await noHorizontalScroll(page);
    });

    test('Macros page: fiber and water daily bars with their targets', async ({ page }) => {
      await open(page, '/charts/macros', ON);
      await expect(page.getByTestId('fiber-headline')).toHaveText('Fiber 10 of 39 g a day');
      await expect(page.getByTestId('fiber-note')).toHaveText(
        'Fiber unknown for 2 foods in this range, so the totals may be low.',
      );
      await expect(page.getByTestId('water-headline')).toHaveText('Water 750 of 2,000 ml a day');
      await expect(page.getByTestId('chart-water')).toHaveAttribute('data-y-min', '0');
    });
  });
}
