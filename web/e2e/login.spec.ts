import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal, type MeState } from './fixtures';

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

    test('logs in with the CSRF header and lands on Today', async ({ page }) => {
      let me: MeState = null;
      await stubExternal(page, () => me);
      let sent: { body: unknown; csrf: string | null } | null = null;
      await page.route('**/api/auth/login', async (route) => {
        sent = {
          body: route.request().postDataJSON(),
          csrf: route.request().headers()['x-csrf-token'] ?? null,
        };
        me = ME;
        await route.fulfill({ json: { status: 'ok' } });
      });

      await page.goto('/login');
      await expect(page).toHaveTitle('Log in, TRIM');
      await noHorizontalScroll(page);
      await page.getByLabel('Email').fill('sam@example.com');
      await page.getByLabel('Password').fill('correct horse battery');
      await page.getByLabel('Keep me signed in').check();
      await page.getByRole('button', { name: 'Log in' }).click();

      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
      expect(sent).toEqual({
        body: { email: 'sam@example.com', password: 'correct horse battery', keep_signed_in: true },
        csrf: 'csrf-test-token',
      });
    });

    test('wrong password shows the generic message', async ({ page }) => {
      await stubExternal(page, null);
      await page.route('**/api/auth/login', (route) =>
        route.fulfill({ status: 401, json: { detail: 'Email or password is incorrect.' } }),
      );
      await page.goto('/login');
      await page.getByLabel('Email').fill('sam@example.com');
      await page.getByLabel('Password').fill('nope');
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
      await noHorizontalScroll(page);
    });

    test('a locked account shows the wait message', async ({ page }) => {
      await stubExternal(page, null);
      await page.route('**/api/auth/login', (route) =>
        route.fulfill({
          status: 429,
          headers: { 'Retry-After': '900' },
          json: { detail: 'Too many attempts. Try again in 15 minutes.' },
        }),
      );
      await page.goto('/login');
      await page.getByLabel('Email').fill('sam@example.com');
      await page.getByLabel('Password').fill('anything');
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page.getByRole('alert')).toHaveText(
        'Too many attempts. Try again in 15 minutes.',
      );
    });

    test('signed-out visitors are sent to the landing page', async ({ page }) => {
      await stubExternal(page, null);
      await page.goto('/charts');
      await expect(page).toHaveURL(/\/welcome$/);
      await expect(page.getByTestId('title-block-auth')).toBeVisible();
    });

    test('log out ends the session and returns to the landing page', async ({ page }) => {
      let me: MeState = ME;
      await stubExternal(page, () => me);
      let csrf: string | undefined;
      await page.route('**/api/auth/logout', async (route) => {
        csrf = route.request().headers()['x-csrf-token'];
        me = null;
        await route.fulfill({ status: 204, body: '' });
      });
      await page.goto('/account');
      await page.getByRole('button', { name: 'Log out' }).click();
      await expect(page).toHaveURL(/\/welcome$/);
      expect(csrf).toBe('csrf-test-token');
      await page.goto('/');
      await expect(page).toHaveURL(/\/welcome$/);
    });

    test('unverified users see the banner and can resend the link', async ({ page }) => {
      await stubExternal(page, {
        ...ME,
        email_verified: false,
        verify_deadline: '2026-10-24T12:00:00Z',
      });
      await page.route('**/api/auth/resend-verify', (route) =>
        route.fulfill({ status: 202, json: { status: 'sent' } }),
      );
      await page.goto('/');
      const banner = page.getByTestId('verify-banner');
      await expect(banner).toContainText('Confirm your email by');
      await noHorizontalScroll(page);
      await banner.getByRole('button', { name: 'Send a new link' }).click();
      await expect(banner.getByRole('status')).toHaveText('Sent. Check your inbox.');
    });

    test('after 7 days unverified, the app asks for confirmation', async ({ page }) => {
      await stubExternal(page, {
        ...ME,
        email_verified: false,
        verify_deadline: '2026-10-10T12:00:00Z',
        verify_required: true,
      });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Today' })).toHaveCount(0);
      await noHorizontalScroll(page);
    });
  });
}
