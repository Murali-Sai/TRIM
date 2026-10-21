import { expect, test, type Page } from '@playwright/test';
import { gradeHeaders } from '../edge/headers';
import { openDashboard } from './dashboard-stub';
import { ME, stubExternal } from './fixtures';
import { stubWeights } from './weights-stub';

// Task 5.4 AC: a securityheaders.com-style check passes. The preview server sends the site's
// real headers (public/_headers, via vite.config.ts), so this grades what Pages will send and
// proves the Content-Security-Policy blocks nothing the app itself needs. The API's headers
// are graded in api/tests/test_security_headers.py.

test('every page and asset grades A+', async ({ request }) => {
  for (const path of ['/', '/charts', '/signup', '/theme-init.js', '/manifest.webmanifest']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(gradeHeaders(res.headers()), path).toEqual([]);
  }
});

async function watchCsp(page: Page): Promise<string[]> {
  const seen: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) seen.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Refused to load ${e.blockedURI} (${e.violatedDirective})`);
    });
  });
  return seen;
}

test('the policy blocks nothing on the main screens', async ({ page }) => {
  const seen = await watchCsp(page);
  await openDashboard(page, { metric: true });
  await expect(page.getByTestId('card-weight').locator('svg')).toBeVisible();
  await page.getByRole('link', { name: /^Calories this week/ }).click();
  await expect(page.getByTestId('calories-chart').locator('canvas')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  expect(seen).toEqual([]);
});

test('the weight chart and sign-up (with the captcha) load under it', async ({ page }) => {
  const seen = await watchCsp(page);
  await stubExternal(page, ME);
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await stubWeights(
    page,
    Array.from({ length: 10 }, (_, i) => ({
      id: `w${i}`,
      measured_at: `${day}T0${i % 10}:00:00Z`,
      day,
      kg: 80 + i / 10,
      note: null,
    })),
  );
  await page.goto('/body');
  await expect(page.getByRole('heading', { name: 'Body' })).toBeVisible();
  await stubExternal(page, null);
  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: /sign up|create/i }).first()).toBeVisible();
  expect(seen).toEqual([]);
});

test('an inline script is blocked, and the watcher sees it', async ({ page }) => {
  const seen = await watchCsp(page);
  await stubExternal(page, null);
  await page.goto('/welcome');
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__ran = true';
    document.body.append(s);
  });
  expect(
    await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran),
  ).toBeUndefined();
  await expect.poll(() => seen.length).toBeGreaterThan(0);
});
