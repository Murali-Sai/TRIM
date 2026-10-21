import { expect, test, type Page } from '@playwright/test';
import { GOALS, NOW, STREAKS, openDashboard } from './dashboard-stub';
import { ME, stubExternal } from './fixtures';

// Task 3.17. AC: reduced motion skips the animations; off hides every element at 375 and
// 1280 px.

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const BADGES = [
  {
    key: 'streak_7',
    name: '7-day streak',
    how: 'Log food 7 days in a row.',
    earned_at: '2026-10-15T20:00:00Z',
  },
  { key: 'streak_30', name: '30-day streak', how: 'Log food 30 days in a row.', earned_at: null },
];

/** A page with streaks stubbed; `state.logged` flips when a log is posted. */
async function open(page: Page, path: string, opts: { on?: boolean; current?: number } = {}) {
  const state = { logged: false };
  const on = opts.on ?? true;
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/me/settings', (r) =>
    r.fulfill({
      json: { track_water: false, track_fiber: true, water_unit: 'ml', gamification: on },
    }),
  );
  await page.route('**/api/streaks**', (r) =>
    r.fulfill({
      json: {
        ...STREAKS,
        current_days: (opts.current ?? 23) - (state.logged ? 0 : 1),
        longest_days: opts.current ?? 23,
        today_logged: state.logged,
      },
    }),
  );
  await page.route('**/api/goals', (r) => r.fulfill({ json: GOALS }));
  await page.route('**/api/badges', (r) => r.fulfill({ json: BADGES }));
  await page.route('**/api/logs/last-time', (r) => r.fulfill({ json: { eaten_at: null } }));
  await page.route('**/api/foods/quick', (r) =>
    r.fulfill({ json: { favourites: [], recents: [], frequents: [] } }),
  );
  await page.route('**/api/meals**', (r) => r.fulfill({ json: [] }));
  await page.route(
    (u) => u.pathname === '/api/logs',
    (r) => {
      if (r.request().method() === 'POST') {
        state.logged = true;
        return r.fulfill({ status: 201, json: [{ id: 'l1', log_group_id: 'g1' }] });
      }
      return r.fulfill({ json: [] });
    },
  );
  await page.goto(path);
  return state;
}

const flame = (page: Page, w: number) =>
  page.getByTestId(`streak-flame-${w < 1024 ? 'header' : 'sidebar'}`);

async function logSomething(page: Page) {
  await page.getByRole('tab', { name: 'Quick add' }).click();
  await page.getByLabel('Calories (kcal)').fill('200');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await page.getByRole('button', { name: 'Log it' }).click();
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('the flame is grey until today is logged, then pops and ticks up', async ({ page }) => {
      await open(page, '/log');
      const f = flame(page, vp.width);
      await expect(f).toHaveAttribute('data-logged', 'false');
      await expect(f).toContainText('22');
      await logSomething(page);
      await expect(f).toHaveAttribute('data-logged', 'true');
      await expect(f).toContainText('23');
      await expect(f).toHaveAttribute('data-pop', 'true');
      const name = await f
        .getByTestId('flame-icon')
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(name).toBe('flame-pop');
    });

    test('AC: reduced motion skips the animation', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, '/log');
      const f = flame(page, vp.width);
      await logSomething(page);
      await expect(f).toHaveAttribute('data-pop', 'true');
      const name = await f
        .getByTestId('flame-icon')
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(name).toBe('none');
    });

    test('the streak sheet: streaks, freezes, the month, goals and the next badge', async ({
      page,
    }) => {
      const state = await open(page, '/');
      state.logged = true;
      await page.reload();
      await flame(page, vp.width).click();
      const sheet = page.getByTestId('streak-sheet');
      await expect(sheet).toContainText('23 days');
      await expect(sheet.getByLabel('1 of 2 freezes held')).toBeVisible();
      await expect(sheet).toContainText('4 weeks');
      await expect(
        sheet.getByTestId('streak-calendar').locator('[data-state="freeze"]'),
      ).toHaveCount(1);
      await expect(sheet.getByRole('img', { name: 'Weigh in 3 times: 2 of 3' })).toBeVisible();
      await expect(sheet).toContainText('7 days to the 30-day badge');
      await sheet.getByRole('link', { name: 'Badges' }).click();
      await expect(page.getByRole('heading', { name: 'Badges' })).toBeVisible();
      await expect(page.getByTestId('badge').first()).toHaveAttribute('data-earned', 'true');
      await expect(page.getByTestId('badge').nth(1)).toContainText('Log food 30 days in a row.');
    });

    test('a 7-day milestone shows its card once', async ({ page }) => {
      const state = await open(page, '/log', { current: 7 });
      await logSomething(page);
      const card = page.getByTestId('milestone-card');
      await expect(card).toContainText('7-day streak');
      await card.getByRole('button', { name: 'Close' }).click();
      await expect(card).toHaveCount(0);
      expect(state.logged).toBe(true);
      await page.reload();
      await expect(flame(page, vp.width)).toHaveAttribute('data-logged', 'true');
      await expect(page.getByTestId('milestone-card')).toHaveCount(0);
    });

    test('the Progress card answers first', async ({ page }) => {
      await openDashboard(page, { metric: true });
      await expect(page.getByTestId('card-streak-headline')).toHaveText(
        '23-day streak · 2 of 3 goals done',
      );
    });

    test('AC: off hides every streak element', async ({ page }) => {
      await open(page, '/', { on: false });
      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
      await expect(page.locator('[data-testid^="streak-flame"]')).toHaveCount(0);
      await page.goto('/charts');
      await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
      await expect(page.getByTestId('card-streak')).toHaveCount(0);
      await expect(page.locator('[data-testid^="streak-flame"]')).toHaveCount(0);
      await page.goto('/account');
      await expect(page.getByRole('switch', { name: 'Streaks and badges' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      await expect(page.getByRole('link', { name: 'See your badges' })).toHaveCount(0);
      await page.goto('/account/badges');
      await expect(page.getByText('Streaks and badges are off.')).toBeVisible();
      await expect(page.getByTestId('badge')).toHaveCount(0);
      // No milestone card either, even on a milestone day.
      await page.goto('/log');
      await logSomething(page);
      await expect(page.getByTestId('milestone-card')).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
