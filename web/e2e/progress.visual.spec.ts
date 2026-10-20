import { expect, test } from '@playwright/test';
import { openDashboard } from './dashboard-stub';

// Task 3.10 AC: visual regression at 375 and 1280 px. Runs only in the pinned Playwright
// image (playwright.visual.config.ts and the "visual" CI job), so fonts and rendering match
// the committed baselines. Update them with `npm run e2e:visual:update`.

for (const vp of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const) {
  for (const scheme of ['dark', 'light'] as const) {
    test(`Progress dashboard, ${vp.name} ${vp.width}px, ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // The app is dark first; light is the user's saved choice.
      await page.addInitScript((t) => localStorage.setItem('trim.theme', t), scheme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openDashboard(page, { metric: true });
      await expect(page.getByTestId('card-weight').locator('svg')).toBeVisible();
      await expect(page.getByTestId('card-calories-headline')).not.toHaveText(' ');
      await expect(page).toHaveScreenshot(`progress-${vp.name}-${scheme}.png`, { fullPage: true });
    });
  }
}
