import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 3.12. AC: users in UTC-5 and UTC+9 at 23:30 local. The browser runs in Los Angeles on
// purpose: only the user's timezone setting decides what "today" is.

const CASES = [
  { name: 'UTC-5', tz: 'America/New_York', now: '2026-01-16T04:30:00Z', day: '2026-01-15' },
  { name: 'UTC+9', tz: 'Asia/Tokyo', now: '2026-01-15T14:30:00Z', day: '2026-01-15' },
] as const;

async function open(page: Page, c: (typeof CASES)[number], path: string) {
  const asked: string[] = [];
  const posted: string[] = [];
  await page.clock.setFixedTime(new Date(c.now));
  await stubExternal(page, { ...ME, timezone: c.tz });
  await page.route('**/api/targets', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/logs/last-time', (r) => r.fulfill({ json: { eaten_at: null } }));
  await page.route('**/api/foods/quick', (r) =>
    r.fulfill({ json: { favourites: [], recents: [], frequents: [] } }),
  );
  await page.route('**/api/meals**', (r) => r.fulfill({ json: [] }));
  await page.route(
    (url) => url.pathname === '/api/logs',
    (r) => {
      if (r.request().method() === 'POST') {
        const body = r.request().postDataJSON() as { eaten_at: string };
        posted.push(body.eaten_at);
        return r.fulfill({ status: 201, json: [{ id: 'l1', log_group_id: 'g1' }] });
      }
      asked.push(new URL(r.request().url()).searchParams.get('date_from') ?? '');
      return r.fulfill({ json: [] });
    },
  );
  await page.goto(path);
  return { asked, posted };
}

for (const vp of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const) {
  for (const c of CASES) {
    test.describe(`${vp.name} ${vp.width}px, user in ${c.name} at 23:30`, () => {
      test.use({
        viewport: { width: vp.width, height: vp.height },
        locale: 'en-US',
        timezoneId: 'America/Los_Angeles',
      });

      test('Today is the local date and asks for that day', async ({ page }) => {
        const calls = await open(page, c, '/');
        await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
        await expect(page.getByLabel('Day', { exact: true })).toHaveValue(c.day);
        await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled();
        await expect.poll(() => calls.asked).toContain(c.day);
      });

      test('Log food starts at 11:30 PM today and saves that instant', async ({ page }) => {
        const calls = await open(page, c, '/log');
        await expect(page.getByTestId('time-chip')).toHaveText('Time eaten: Today, 11:30 PM');
        await page.getByRole('tab', { name: 'Quick add' }).click();
        await page.getByLabel('Calories (kcal)').fill('200');
        await page.getByRole('button', { name: 'Add to list' }).click();
        await page.getByRole('button', { name: 'Log it' }).click();
        await expect.poll(() => calls.posted).toEqual([new Date(c.now).toISOString()]);
        await expect(page.getByText('Logged 1 item at 11:30 PM today.')).toBeVisible();
      });
    });
  }
}
