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

async function fillForm(page: Page) {
  await page.getByLabel('Name').fill('Sam');
  await page.getByLabel('Email').fill('sam@example.com');
  await page.getByLabel('Password').fill('correct horse battery');
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test.beforeEach(async ({ page }) => {
      await stubExternal(page);
    });

    test('sign up sends the form and shows check your email', async ({ page }) => {
      let sent: Record<string, unknown> | null = null;
      await page.route('**/api/auth/signup', async (route) => {
        sent = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ status: 202, json: { status: 'check_email' } });
      });
      await page.goto('/signup');
      await expect(page).toHaveTitle('Sign up, TRIM');
      await noHorizontalScroll(page);
      // US locale defaults to imperial.
      await expect(page.getByLabel('Imperial (lb, in)')).toBeChecked();

      await fillForm(page);
      await page.getByRole('button', { name: 'Sign up' }).click();

      await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
      await noHorizontalScroll(page);
      expect(sent).toMatchObject({
        email: 'sam@example.com',
        password: 'correct horse battery',
        display_name: 'Sam',
        unit_system: 'imperial',
        turnstile_token: 'XXXX.DUMMY.TOKEN.XXXX',
      });
      expect(typeof (sent as unknown as { timezone: string }).timezone).toBe('string');
    });

    test('shows inline errors and does not submit an invalid form', async ({ page }) => {
      let calls = 0;
      await page.route('**/api/auth/signup', (route) => {
        calls += 1;
        return route.fulfill({ status: 202, json: { status: 'check_email' } });
      });
      await page.goto('/signup');
      await page.getByLabel('Email').fill('not-an-email');
      await page.getByLabel('Password').fill('short');
      await page.getByRole('button', { name: 'Sign up' }).click();
      await expect(page.getByText('Enter a name.')).toBeVisible();
      await expect(page.getByText('Enter a valid email.')).toBeVisible();
      await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
      await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
      await noHorizontalScroll(page);
      expect(calls).toBe(0);
    });

    test('shows the server message for a breached password', async ({ page }) => {
      await page.route('**/api/auth/signup', (route) =>
        route.fulfill({
          status: 422,
          json: { detail: 'This password has appeared in a data breach. Choose a different one.' },
        }),
      );
      await page.goto('/signup');
      await fillForm(page);
      await page.getByRole('button', { name: 'Sign up' }).click();
      await expect(page.getByRole('alert')).toHaveText(
        'This password has appeared in a data breach. Choose a different one.',
      );
    });

    test('verify link confirms the email and clears the token from the URL', async ({ page }) => {
      let token: unknown = null;
      await page.route('**/api/auth/verify', async (route) => {
        token = (route.request().postDataJSON() as { token: string }).token;
        await route.fulfill({ json: { status: 'verified' } });
      });
      await page.goto('/verify#token=abc123');
      await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
      expect(token).toBe('abc123');
      expect(page.url()).not.toContain('abc123');
      await noHorizontalScroll(page);
    });

    test('expired verify link offers a way to get a new one', async ({ page }) => {
      let calls = 0;
      await page.route('**/api/auth/verify', (route) => {
        calls += 1;
        return route.fulfill({
          status: 400,
          json: { detail: 'This link has expired or was already used.' },
        });
      });
      await page.goto('/verify#token=old');
      await expect(page.getByRole('heading', { name: 'Link expired' })).toBeVisible();
      await expect(page.getByText('Log in to get a new link.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
      expect(calls).toBe(1);
    });
  });
}

test('metric is the default outside the US', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-GB' });
  const page = await context.newPage();
  await stubExternal(page);
  await page.goto('/signup');
  await expect(page.getByLabel('Metric (kg, cm)')).toBeChecked();
  await context.close();
});
