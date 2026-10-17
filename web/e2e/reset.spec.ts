import { expect, test, type Page } from '@playwright/test';
import { stubExternal } from './fixtures';

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubExternal(page, null);
    });

    test('login links to forgot password, which sends the request', async ({ page }) => {
      let sent: unknown = null;
      await page.route('**/api/auth/forgot', async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({ status: 202, json: { status: 'check_email' } });
      });
      await page.goto('/login');
      await page.getByRole('link', { name: 'Forgot password?' }).click();
      await expect(page).toHaveURL(/\/forgot$/);
      await expect(page).toHaveTitle('Reset password, TRIM');
      await noHorizontalScroll(page);

      await page.getByLabel('Email').fill('sam@example.com');
      await page.getByRole('button', { name: 'Send reset link' }).click();
      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
      expect(sent).toEqual({ email: 'sam@example.com', turnstile_token: 'XXXX.DUMMY.TOKEN.XXXX' });
      await noHorizontalScroll(page);
    });

    test('reset page sets the new password and clears the token', async ({ page }) => {
      let sent: unknown = null;
      await page.route('**/api/auth/reset', async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({ json: { status: 'password_reset' } });
      });
      await page.goto('/reset#token=reset-abc');
      expect(page.url()).not.toContain('reset-abc');
      await noHorizontalScroll(page);
      await page.getByLabel('New password').fill('a brand new passphrase');
      await page.getByLabel('Type it again').fill('a brand new passphrase');
      await page.getByRole('button', { name: 'Save new password' }).click();
      await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
      await expect(page.getByText('You are signed out on every device.')).toBeVisible();
      expect(sent).toEqual({ token: 'reset-abc', password: 'a brand new passphrase' });
    });

    test('reset form checks length and that both entries match', async ({ page }) => {
      let calls = 0;
      await page.route('**/api/auth/reset', (route) => {
        calls += 1;
        return route.fulfill({ json: { status: 'password_reset' } });
      });
      await page.goto('/reset#token=t');
      await page.getByLabel('New password').fill('short');
      await page.getByRole('button', { name: 'Save new password' }).click();
      await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
      await page.getByLabel('New password').fill('a brand new passphrase');
      await page.getByLabel('Type it again').fill('a different passphrase');
      await page.getByRole('button', { name: 'Save new password' }).click();
      await expect(page.getByText('The passwords do not match.')).toBeVisible();
      expect(calls).toBe(0);
    });

    test('an expired reset link offers a new one', async ({ page }) => {
      await page.route('**/api/auth/reset', (route) =>
        route.fulfill({
          status: 400,
          json: { detail: 'This link has expired or was already used.' },
        }),
      );
      await page.goto('/reset#token=old');
      await page.getByLabel('New password').fill('a brand new passphrase');
      await page.getByLabel('Type it again').fill('a brand new passphrase');
      await page.getByRole('button', { name: 'Save new password' }).click();
      await expect(page.getByRole('heading', { name: 'Link expired' })).toBeVisible();
      await page.getByRole('link', { name: 'Get a new link' }).click();
      await expect(page).toHaveURL(/\/forgot$/);
    });

    test('a breached password shows the reason and keeps the form', async ({ page }) => {
      await page.route('**/api/auth/reset', (route) =>
        route.fulfill({
          status: 422,
          json: { detail: 'This password has appeared in a data breach. Choose a different one.' },
        }),
      );
      await page.goto('/reset#token=t');
      await page.getByLabel('New password').fill('password1234');
      await page.getByLabel('Type it again').fill('password1234');
      await page.getByRole('button', { name: 'Save new password' }).click();
      await expect(page.getByRole('alert')).toContainText('data breach');
      await expect(page.getByLabel('New password')).toBeVisible();
    });
  });
}
