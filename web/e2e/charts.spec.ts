import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 3.9. AC: adherence equals the hand count on the fixture month; calorie and macro axes
// start at zero. The clock is fixed at 4 PM on Sat 31 Oct 2026 in New York.

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

interface Day {
  date: string;
}
const MONTH = JSON.parse(
  readFileSync(new URL('../../shared/fixture_month.json', import.meta.url), 'utf8'),
) as { days: Day[]; targets: Record<string, unknown>[]; expected: { on_target_days: number } };

const NOW = new Date('2026-10-31T20:00:00Z');

async function open(page: Page, path: string, days: Day[] = MONTH.days) {
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/targets', (r) =>
    r.fulfill({
      json: MONTH.targets.map((t) => ({
        ...t,
        fiber_g: null,
        water_ml: null,
        source: 'custom',
        bmr: null,
        tdee: null,
        formula: null,
      })),
    }),
  );
  await page.route('**/api/logs/days**', (r) => {
    const url = new URL(r.request().url());
    const from = url.searchParams.get('date_from') ?? '';
    const to = url.searchParams.get('date_to') ?? '';
    return r.fulfill({ json: days.filter((d) => d.date >= from && d.date <= to) });
  });
  await page.goto(path);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const headline = (page: Page) => page.getByTestId('calories-headline');

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('AC: on target matches the hand count on the fixture month', async ({ page }) => {
      await open(page, '/charts/calories');
      await page.getByRole('radio', { name: 'last 3 months' }).click();
      // 16 of the 27 logged days were within 5% of that day's target.
      await expect(headline(page)).toHaveText(
        `Avg 2,208 a day · on target ${MONTH.expected.on_target_days} of 27 days`,
      );
      const chart = page.getByTestId('calories-chart');
      await expect(chart).toHaveAttribute(
        'aria-label',
        'Calories chart, last 3 months. Avg 2,208 a day, on target 16 of 27 days.',
      );
      await expect(chart).toHaveAttribute('data-y-min', '0');

      // Weeks start on Monday; the week of 12 Oct was on target 5 of 7 days.
      await page.getByRole('radio', { name: 'Weeks', exact: true }).click();
      await page.getByRole('button', { name: 'View as table' }).click();
      const table = page.getByTestId('chart-table');
      await expect(table.getByRole('row', { name: /Week of 12 Oct/ })).toContainText('5 of 7 days');
      await expect(table.getByRole('row', { name: /Week of 28 Sep/ })).toContainText('3 of 4 days');
      await page.getByRole('radio', { name: 'Months', exact: true }).click();
      await expect(table.getByRole('row', { name: /Oct 2026/ })).toContainText('16 of 27 days');
      await noHorizontalScroll(page);
    });

    test('opens at 1W with daily bars, a 7-day average and sentence tooltips', async ({ page }) => {
      await open(page, '/charts/calories');
      await expect(page.getByRole('radio', { name: 'last week' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      // 25 to 31 Oct: 26 Oct not logged; 28 and 30 Oct off target.
      await expect(headline(page)).toHaveText('Avg 2,178 a day · on target 4 of 6 days');
      await expect(page.getByRole('radio', { name: 'Weeks', exact: true })).toHaveCount(0);
      const chart = page.getByTestId('calories-chart');
      await expect(chart.locator('canvas')).toBeVisible();

      const box = await chart.locator('.u-over').boundingBox();
      if (!box) throw new Error('no plot');
      await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
      await expect(page.getByTestId('calories-chart-tooltip')).toHaveText(
        'Sat 31 Oct: 2,240 kcal, 40 over target',
      );

      await page.getByRole('button', { name: 'View as table' }).click();
      const rows = page.getByTestId('chart-table').getByRole('row');
      await expect(rows.nth(1)).toHaveText('Sat 31 Oct2,2402,200Yes2,178');
      await expect(
        page.getByTestId('chart-table').getByRole('row', { name: /Mon 26 Oct/ }),
      ).toContainText('Not logged');
      await noHorizontalScroll(page);
    });

    test('the last range chosen is remembered', async ({ page }) => {
      await open(page, '/charts/calories');
      await page.getByRole('radio', { name: 'last month' }).click();
      await expect(headline(page)).toHaveText('Avg 2,205 a day · on target 15 of 26 days');
      await page.reload();
      await expect(page.getByRole('radio', { name: 'last month' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    test('nothing logged says what is needed, not an empty chart', async ({ page }) => {
      await open(page, '/charts/calories', []);
      await expect(page.getByTestId('too-little-data')).toHaveText(
        'Log 1 more day to see this chart',
      );
      await expect(page.getByTestId('calories-chart')).toHaveCount(0);
    });

    test('macros: one small chart per macro from zero, and the calorie split', async ({ page }) => {
      await open(page, '/charts/macros');
      const protein = page.getByTestId('macro-protein_g');
      await expect(protein).toContainText('Protein 163 of 165 g a day');
      await expect(protein).toContainText('On target 4 of 6 days');
      for (const key of ['protein_g', 'fat_g', 'carbs_g']) {
        await expect(page.getByTestId(`chart-${key}`)).toHaveAttribute('data-y-min', '0');
      }
      await expect(page.getByTestId('split-today').getByRole('img')).toHaveAttribute(
        'aria-label',
        'Today: Protein 30%, Carbs 40%, Fat 30%',
      );
      await expect(page.getByTestId('split-target').getByRole('img')).toHaveAttribute(
        'aria-label',
        'Target: Protein 30%, Carbs 40%, Fat 30%',
      );
      await noHorizontalScroll(page);
    });
  });
}

test('tapping a dashboard card opens its full chart, and back', async ({ page }) => {
  await open(page, '/charts');
  await page.getByRole('link', { name: /^Calories this week/ }).click();
  await expect(page.getByRole('heading', { name: 'Calories' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Progress' }).click();
  await page.getByRole('link', { name: /^Macros this week/ }).click();
  await expect(page.getByRole('heading', { name: 'Macros' })).toBeVisible();
});
