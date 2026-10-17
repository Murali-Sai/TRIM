import { expect, test, type Page } from '@playwright/test';
import { COLOR_SCHEMES, VIEWPORTS } from './viewports';

const ROUTES = ['/', '/log', '/body', '/charts', '/account'];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }));
});

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of VIEWPORTS) {
  for (const scheme of COLOR_SCHEMES) {
    test.describe(`${vp.name} ${vp.width}px ${scheme}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme });

      for (const route of ROUTES) {
        test(`no horizontal scroll on ${route}`, async ({ page }, testInfo) => {
          await page.goto(route);
          await expect(page.locator('main')).toBeVisible();
          await expectNoHorizontalScroll(page);
          await testInfo.attach('screenshot', {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
        });
      }

      test('shows the right navigation for the width', async ({ page }) => {
        await page.goto('/');
        const tabbar = page.getByTestId('tabbar');
        const sidebar = page.getByRole('complementary', { name: 'Main' });
        if (vp.width < 1024) {
          await expect(tabbar).toBeVisible();
          await expect(sidebar).toBeHidden();
          await expect(page.getByRole('link', { name: 'Add food' })).toBeVisible();
        } else {
          await expect(sidebar).toBeVisible();
          await expect(tabbar).toBeHidden();
        }
      });
    });
  }
}

test.describe('phone behaviour', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('tab bar navigates between sections', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tabbar').getByRole('link', { name: 'Body' }).click();
    await expect(page).toHaveURL(/\/body$/);
    await expect(page.getByRole('heading', { name: 'Body' })).toBeVisible();
  });

  test('tab targets are at least 44 px on touch screens', async ({ page }) => {
    await page.goto('/');
    for (const link of await page.getByTestId('tabbar').getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test('form fields use 16 px text', async ({ page }) => {
    await page.goto('/account');
    const size = await page
      .getByLabel('Appearance')
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(size).toBe('16px');
  });
});

test('manual dark theme overrides a light device setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/account');
  await page.getByLabel('Appearance').selectOption('dark');
  await page.reload();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(18, 18, 17)');
});
