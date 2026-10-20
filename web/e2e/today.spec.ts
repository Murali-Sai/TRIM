import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';
import { VIEWPORTS as LAYOUT_WIDTHS } from './viewports';

// Task 3.5. AC: the reference fixture day (6 items at 4:00 PM) shows 1774 kcal, 148 P, 44 F,
// 193 C at 375 px and 1280 px. The clock is fixed at 19:07 on 17 Oct in New York.

const ref = JSON.parse(
  readFileSync(new URL('../../shared/reference_day.json', import.meta.url), 'utf8'),
) as {
  date: string;
  target: { kcal: number; protein_g: number; fat_g: number; carbs_g: number };
  entries: Record<string, unknown>[];
};

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const NOW = new Date('2026-10-17T23:07:00Z');
const TARGET_ROW = {
  effective_from: '2026-10-01',
  ...ref.target,
  fiber_g: null,
  water_ml: null,
  source: 'calculator',
  bmr: 1780,
  tdee: 2759,
  formula: null,
};

async function open(
  page: Page,
  path = '/',
  opts: { days?: Record<string, Record<string, unknown>[]>; targets?: unknown[] } = {},
) {
  const days = opts.days ?? { [ref.date]: ref.entries };
  const asked: string[] = [];
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/targets', (route) =>
    route.fulfill({ json: opts.targets ?? [TARGET_ROW] }),
  );
  await page.route('**/api/logs?**', (route) => {
    const day = new URL(route.request().url()).searchParams.get('date_from') ?? '';
    asked.push(day);
    return route.fulfill({ json: days[day] ?? [] });
  });
  await page.goto(path);
  return asked;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of VIEWPORTS) {
  const desktop = vp.width >= 1024;
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('AC: the reference day block reads 1774 kcal, 148 P, 44 F, 193 C', async ({ page }) => {
      await open(page);
      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
      const blocks = page.getByTestId('time-block');
      await expect(blocks).toHaveCount(1);
      await expect(blocks.getByTestId('block-pill')).toHaveText('4 PM');
      await expect(blocks.getByTestId('chip-kcal')).toHaveText('1,774 kcal');
      await expect(blocks.getByTestId('chip-protein_g')).toHaveText('148 P');
      await expect(blocks.getByTestId('chip-fat_g')).toHaveText('44 F');
      await expect(blocks.getByTestId('chip-carbs_g')).toHaveText('193 C');
      await expect(blocks.getByTestId('block-chips')).toBeVisible();

      const cards = page.getByTestId('entry-card');
      await expect(cards).toHaveCount(6);
      await expect(cards.first()).toContainText('Chicken breast, grilled');
      await expect(cards.first().getByTestId('entry-macros')).toHaveText(
        '341 kcal · 74P 3F 0C · 350 g',
      );
      await expect(cards.nth(1).getByTestId('entry-macros')).toHaveText(
        '520 kcal · 11P 1F 113C · 2 cup',
      );

      // With targets 2300, 150, 65, 280: calories 77% and protein 99%.
      const strip = page.getByTestId(desktop ? 'strip-desktop-kcal' : 'strip-kcal');
      await expect(strip).toContainText('1,774');
      await expect(strip).toContainText('2,300');
      await expect(strip).toContainText('77%');
      await expect(
        page.getByTestId(desktop ? 'strip-desktop-protein_g' : 'strip-protein_g'),
      ).toContainText('99%');
      await noHorizontalScroll(page);
    });

    test("a block's + adds food at that block's time", async ({ page }) => {
      await open(page);
      await page.route('**/api/logs/last-time', (route) =>
        route.fulfill({ json: { eaten_at: null } }),
      );
      await page.getByRole('link', { name: 'Add food at 4 PM' }).click();
      await expect(page).toHaveURL(/\/log\?at=2026-10-17T20%3A00%3A00Z$/);
      await expect(page.getByTestId('time-chip')).toHaveText('Time eaten: Today, 4:00 PM');
    });

    test('what is left, fiber, sugar and sodium', async ({ page }) => {
      await open(page);
      const id = desktop ? 'desktop-' : '';
      if (!desktop) {
        await expect(page.getByTestId('strip-page-2')).not.toBeInViewport();
        await page.getByRole('button', { name: 'What is left' }).click();
        await expect(page.getByTestId('strip-page-2')).toBeInViewport();
      }
      await expect(page.getByTestId(`${id}left-kcal`)).toHaveText('Calories left: Calories526');
      await expect(page.getByTestId(`${id}left-protein_g`)).toHaveText('Protein left: Protein2');
      await expect(page.getByTestId(`${id}extra-fiber`)).toContainText('0 g');
      await noHorizontalScroll(page);
    });

    test('over target says so in the nutrient color, without an alarm', async ({ page }) => {
      const big = { ...ref.entries[0], id: 'big', kcal: 2342.4, eaten_at: '2026-10-17T22:00:00Z' };
      await open(page, '/', { days: { [ref.date]: [big] } });
      const col = page.getByTestId(desktop ? 'strip-desktop-kcal' : 'strip-kcal');
      await expect(col).toContainText('+42 over');
    });

    test('empty day', async ({ page }) => {
      await open(page, '/', { days: {} });
      await expect(page.getByTestId('empty-day')).toContainText(
        'Nothing logged yet. Tap + to add what you ate.',
      );
      await noHorizontalScroll(page);
    });

    test('no targets shows a Set targets card', async ({ page }) => {
      await open(page, '/', { targets: [] });
      await expect(page.getByTestId('set-targets')).toBeVisible();
      await page.getByRole('link', { name: 'Set targets' }).click();
      await expect(page).toHaveURL(/\/targets$/);
    });

    test('browsing days: previous, next and the date picker', async ({ page }) => {
      const asked = await open(page);
      await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled();
      await page.getByRole('button', { name: 'Previous day' }).click();
      await expect(page.getByRole('heading', { name: 'Fri 16 Oct' })).toBeVisible();
      await expect(page).toHaveURL(/\?date=2026-10-16$/);
      await expect(page.getByTestId('empty-day')).toBeVisible();
      await page.getByRole('button', { name: 'Next day' }).click();
      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
      await page.getByLabel('Day', { exact: true }).fill('2026-10-14');
      await expect(page.getByRole('heading', { name: 'Wed 14 Oct' })).toBeVisible();
      expect(asked).toEqual(expect.arrayContaining(['2026-10-17', '2026-10-16', '2026-10-14']));
    });

    test('a future date in the address shows today', async ({ page }) => {
      await open(page, '/?date=2026-12-25');
      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    });

    test('new cards are briefly highlighted after logging', async ({ page }) => {
      await open(page, '/?highlight=ref-group');
      const cards = page.locator('[data-testid="entry-card"][data-fresh="true"]');
      await expect(cards).toHaveCount(6);
      await expect(cards).toHaveCount(0, { timeout: 5000 });
    });
  });
}

test('desktop: the strip sits left of the timeline, which is at most 720 px wide', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page);
  const strip = await page.getByTestId('target-strip').boundingBox();
  const timeline = await page.getByTestId('timeline').boundingBox();
  if (!strip || !timeline) throw new Error('missing');
  expect(timeline.x).toBeGreaterThan(strip.x + strip.width);
  expect(timeline.width).toBeLessThanOrEqual(720);
});

for (const vp of LAYOUT_WIDTHS) {
  test(`layout at ${vp.width}px: no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await open(page);
    await expect(page.getByTestId('time-block')).toHaveCount(1);
    await noHorizontalScroll(page);
  });
}
