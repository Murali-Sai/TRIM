import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';
import { VIEWPORTS as LAYOUT_WIDTHS } from './viewports';

// Task 3.4. AC: food logged at 19:00 for 16:00 lands in the 4 PM block and on the correct
// local date. The browser clock is fixed at 19:07 in New York (the test user's timezone).

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const NOW = new Date('2026-10-17T23:07:00Z');

const RICE = {
  id: 'food-rice',
  name: 'White rice, cooked',
  brand: null,
  source: 'fdc',
  tier: 'cache',
  kcal_100: 130,
  protein_100: 2.7,
  carbs_100: 28.2,
  fat_100: 0.3,
  fiber_100: null,
  sugar_100: null,
  sodium_mg_100: null,
  density_g_ml: null,
  kcal_mismatch: false,
  servings: [] as { label: string; grams: number; is_default: boolean }[],
};

const YOGURT = {
  ...RICE,
  id: 'food-yogurt',
  name: 'Greek yogurt, plain',
  brand: 'Dairy Co',
  kcal_100: 97,
  protein_100: 9,
  carbs_100: 3.6,
  fat_100: 5,
  servings: [{ label: '1 cup', grams: 200, is_default: true }],
};

interface Posted {
  eaten_at: string;
  items: Record<string, unknown>[];
}

async function stubLogging(page: Page, lastUsed: string | null = null) {
  const posted: Posted[] = [];
  await page.route('**/api/foods/search**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const results = [RICE, YOGURT].filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
    return route.fulfill({ json: { results, notice: null } });
  });
  await page.route('**/api/logs/last-time', (route) =>
    route.fulfill({ json: { eaten_at: lastUsed } }),
  );
  await page.route('**/api/logs', (route) => {
    const body = route.request().postDataJSON() as Posted;
    posted.push(body);
    const rows = body.items.map((item, i) => ({
      id: `log${posted.length}-${i}`,
      log_group_id: `group${posted.length}`,
      eaten_at: body.eaten_at,
      ...item,
    }));
    return route.fulfill({ status: 201, json: rows });
  });
  return posted;
}

async function open(page: Page, path = '/log', lastUsed: string | null = null) {
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  const posted = await stubLogging(page, lastUsed);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Log food' })).toBeVisible();
  return posted;
}

async function pick(page: Page, query: string, name: string) {
  await page.getByLabel('Find a food').fill(query);
  await page.getByRole('button', { name: new RegExp(name) }).click();
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const chip = (page: Page) => page.getByTestId('time-chip');

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('AC: at 19:00, food logged for 16:00 goes in at 4 PM on today', async ({ page }) => {
      const posted = await open(page);
      // Now, rounded down to 5 minutes.
      await expect(chip(page)).toHaveText('Time eaten: Today, 7:05 PM');

      await chip(page).click();
      await page.getByLabel('Time', { exact: true }).fill('16:00');
      await expect(chip(page)).toHaveText('Time eaten: Today, 4:00 PM');

      await pick(page, 'rice', 'White rice');
      await page.getByLabel('Amount').fill('150');
      await expect(page.getByTestId('detail-preview')).toHaveText('195 kcal · 4P 0F 42C · 150 g');
      await page.getByRole('button', { name: 'Add to list' }).click();
      await noHorizontalScroll(page);
      await page.getByRole('button', { name: 'Log it' }).click();

      await expect(page.getByText('Logged 1 item at 4 PM today.')).toBeVisible();
      expect(posted).toEqual([
        {
          eaten_at: '2026-10-17T20:00:00.000Z',
          items: [{ food_id: 'food-rice', grams: 150, source: 'search' }],
        },
      ]);
      await expect(page.getByTestId('to-log')).toHaveCount(0);
      await page.getByRole('link', { name: 'See it on Today' }).click();
      await expect(page).toHaveURL(/\/\?highlight=group1$/);
    });

    test('quick chips: Now, -30 min, -1 h and the last time used', async ({ page }) => {
      // Last add was eaten at 8:30 AM New York time yesterday.
      await open(page, '/log', '2026-10-16T12:30:00Z');
      await chip(page).click();
      await page.getByRole('button', { name: '-30 min' }).click();
      await expect(chip(page)).toHaveText('Time eaten: Today, 6:35 PM');
      await page.getByRole('button', { name: '-1 h' }).click();
      await expect(chip(page)).toHaveText('Time eaten: Today, 6:05 PM');
      await page.getByRole('button', { name: '8:30 AM (last used)' }).click();
      await expect(chip(page)).toHaveText('Time eaten: Today, 8:30 AM');
      await expect(page.getByRole('button', { name: '8:30 AM (last used)' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('button', { name: 'Now' }).click();
      await expect(chip(page)).toHaveText('Time eaten: Today, 7:05 PM');
      await noHorizontalScroll(page);
    });

    test('backdating to a past day', async ({ page }) => {
      const posted = await open(page);
      await chip(page).click();
      const date = page.getByLabel('Date', { exact: true });
      await expect(date).toHaveAttribute('max', '2026-10-17');
      await date.fill('2026-10-14');
      await expect(chip(page)).toHaveText('Time eaten: Wed 14 Oct, 7:05 PM');
      await page.getByLabel('Time', { exact: true }).fill('08:15');
      await pick(page, 'rice', 'White rice');
      await page.getByRole('button', { name: 'Add to list' }).click();
      await page.getByRole('button', { name: 'Log it' }).click();
      await expect(page.getByText('Logged 1 item at 8:15 AM on Wed 14 Oct.')).toBeVisible();
      expect(posted[0]?.eaten_at).toBe('2026-10-14T12:15:00.000Z');
      await page.getByRole('link', { name: 'See it on that day' }).click();
      await expect(page).toHaveURL(/\/\?date=2026-10-14&highlight=group1$/);
    });

    test('several foods log together as one add, in grams or servings', async ({ page }) => {
      const posted = await open(page);
      await pick(page, 'rice', 'White rice');
      await page.getByLabel('Amount').fill('150');
      await page.getByRole('button', { name: 'Add to list' }).click();

      await pick(page, 'yogurt', 'Greek yogurt');
      await expect(page.getByLabel('Unit')).toHaveValue('1 cup');
      await page.getByLabel('Amount').fill('2');
      await expect(page.getByTestId('detail-preview')).toHaveText('388 kcal · 36P 20F 14C · 400 g');
      await page.getByRole('button', { name: 'Add to list' }).click();

      await expect(page.getByTestId('to-log').locator('li')).toHaveCount(2);
      await expect(page.getByTestId('to-log-total')).toHaveText('Total 583 kcal · 40P 20F 57C');
      await noHorizontalScroll(page);
      await page.getByRole('button', { name: 'Log 2 items' }).click();
      await expect(page.getByText('Logged 2 items at 7:05 PM today.')).toBeVisible();
      expect(posted).toHaveLength(1);
      expect(posted[0]?.items).toEqual([
        { food_id: 'food-rice', grams: 150, source: 'search' },
        { food_id: 'food-yogurt', quantity: 2, unit_label: '1 cup', source: 'search' },
      ]);
    });

    test('removing an item before logging', async ({ page }) => {
      const posted = await open(page);
      await pick(page, 'rice', 'White rice');
      await page.getByRole('button', { name: 'Add to list' }).click();
      await page.getByRole('button', { name: 'Remove White rice, cooked' }).click();
      await expect(page.getByRole('button', { name: 'Log it' })).toBeDisabled();
      expect(posted).toHaveLength(0);
    });

    test("a time block's + opens Log food at that block's time", async ({ page }) => {
      await open(page, '/log?at=2026-10-17T20:30:00Z');
      await expect(chip(page)).toHaveText('Time eaten: Today, 4:30 PM');
    });

    test('no results and bad amounts are explained', async ({ page }) => {
      const posted = await open(page);
      await page.getByLabel('Find a food').fill('zzz');
      await expect(page.getByText('No foods match “zzz”.')).toBeVisible();
      await pick(page, 'rice', 'White rice');
      await page.getByLabel('Amount').fill('0');
      await page.getByRole('button', { name: 'Add to list' }).click();
      await expect(page.getByText('Enter an amount above 0, up to 5,000 g.')).toBeVisible();
      expect(posted).toHaveLength(0);
    });
  });
}

for (const vp of LAYOUT_WIDTHS) {
  test(`layout at ${vp.width}px: no sideways scroll; search beside the list on wide screens`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await open(page);
    await pick(page, 'rice', 'White rice');
    await noHorizontalScroll(page);
    const search = await page.getByTestId('find-panel').boundingBox();
    const amount = await page.getByRole('heading', { name: 'How much' }).boundingBox();
    if (!search || !amount) throw new Error('missing sections');
    if (vp.width >= 1024) {
      expect(amount.x).toBeGreaterThan(search.x + search.width / 2);
    } else {
      expect(amount.y).toBeGreaterThan(search.y);
    }
  });
}
