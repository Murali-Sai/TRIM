import { expect, test, type Page } from '@playwright/test';
import { openDashboard } from './dashboard-stub';

// Task 3.10: the Progress dashboard. Seven cards; phone one column, desktop three columns;
// tapping a card opens its full chart. The visual regression lives in progress.visual.spec.ts.

const headline = (page: Page, card: string) => page.getByTestId(`card-${card}-headline`);

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of [
  { name: 'phone', width: 375, height: 812, columns: 1 },
  { name: 'tablet', width: 768, height: 1024, columns: 2 },
  { name: 'desktop', width: 1280, height: 900, columns: 3 },
  { name: 'wide', width: 1920, height: 1080, columns: 3 },
] as const) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('seven cards answer their questions first', async ({ page }) => {
      await openDashboard(page, { metric: true });
      await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
      await expect(page.getByTestId('dashboard').locator(':scope > section')).toHaveCount(7);
      await expect(headline(page, 'today')).toHaveText('40 kcal over · protein target met');
      await expect(headline(page, 'calories')).toHaveText(
        'Avg 2,178 a day · on target 4 of 6 days',
      );
      await expect(headline(page, 'macros')).toHaveText('Protein 163 of 165 g a day');
      await expect(headline(page, 'weight')).toHaveText(
        /^\d\d\.\d kg trend · down 0\.\d kg a week$/,
      );
      await expect(page.getByTestId('card-calories').getByRole('img')).toHaveAttribute(
        'aria-label',
        'Calories this week chart. Avg 2,178 a day, on target 4 of 6 days.',
      );
      await noHorizontalScroll(page);
    });

    test(`${vp.columns} column${vp.columns > 1 ? 's' : ''} of cards`, async ({ page }) => {
      await openDashboard(page);
      await expect(headline(page, 'calories')).not.toHaveText(' ');
      const tops = await page
        .getByTestId('dashboard')
        .locator(':scope > section')
        .evaluateAll((els) =>
          els.slice(0, 3).map((e) => Math.round(e.getBoundingClientRect().top)),
        );
      expect(new Set(tops).size).toBe(vp.columns === 1 ? 3 : vp.columns === 2 ? 2 : 1);
    });
  });
}

test.describe('cards open their full charts', () => {
  test.use({ viewport: { width: 375, height: 812 }, locale: 'en-US' });

  test('the whole card is one link', async ({ page }) => {
    await openDashboard(page);
    // A real click on the card's text (not its link) still opens the chart.
    const text = page.getByTestId('card-weight-headline');
    await text.scrollIntoViewIfNeeded();
    const box = await text.boundingBox();
    if (!box) throw new Error('no headline');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/body$/);
    await page.goBack();
    await page.getByRole('link', { name: /^Today:/ }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('imperial users see pounds', async ({ page }) => {
    await openDashboard(page);
    await expect(headline(page, 'weight')).toHaveText(
      /^\d{3}\.\d lb trend · down \d\.\d lb a week$/,
    );
    await expect(page.getByTestId('card-weight')).toContainText('Dashed line: goal 172.0 lb');
  });
});

test('the measurements card names what changed most', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openDashboard(page, { metric: true });
  await expect(page.getByTestId('card-measurements-headline')).toHaveText(
    'Waist down 2.7 cm since 3 Oct',
  );
  const rows = page.getByTestId('card-measurements').getByTestId('change-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('down 0.6%');
});
