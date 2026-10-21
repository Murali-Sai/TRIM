import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 5.3: weekly check-ins in the app. Generation in three timezones, the DST week and the
// under-4-days sentence are tested in the API (tests/test_checkins.py); here the list, the
// unread dot, the week itself and the Progress card, at 375 and 1280 px.

const NOW = new Date('2026-11-03T15:00:00Z');

const LINES = [
  'Only 3 days logged, so averages may be off.',
  'You averaged 2,150 kcal a day against a 2,300 kcal target, on target on 2 of 3 logged days.',
  'Protein averaged 120 g a day against a 140 g target.',
  'You logged food on 3 of 7 days.',
];

const WEEKS = [
  {
    week_start: '2026-10-26',
    week_end: '2026-11-01',
    headline: 'Avg 2,150 kcal, on target 2 of 3 days',
    read: false,
    preview: LINES.slice(0, 3),
  },
  {
    week_start: '2026-10-19',
    week_end: '2026-10-25',
    headline: 'Avg 2,310 kcal, on target 5 of 7 days',
    read: true,
    preview: ['You averaged 2,310 kcal a day against a 2,300 kcal target.'],
  },
];

async function open(page: Page, path: string, weeks = WEEKS) {
  const opened: string[] = [];
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/checkins**', async (r) => {
    const url = new URL(r.request().url());
    const week = url.pathname.split('/').pop() ?? '';
    if (week === 'checkins') return r.fulfill({ json: weeks });
    const found = weeks.find((w) => w.week_start === week);
    if (!found) return r.fulfill({ status: 404, json: { detail: 'Check-in not found' } });
    opened.push(week);
    found.read = true;
    return r.fulfill({
      json: { ...found, lines: week === '2026-10-26' ? LINES : found.preview, stats: {} },
    });
  });
  await page.goto(path);
  return opened;
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('no check-ins yet', async ({ page }) => {
      await open(page, '/checkins', []);
      await expect(page.getByTestId('checkins-empty')).toContainText(
        'Your first check-in arrives next Monday',
      );
      await page.goto('/charts');
      await expect(page.getByTestId('card-checkin-headline')).toHaveText(
        'Your first check-in arrives next Monday',
      );
    });

    test('the Progress card opens the latest week', async ({ page }) => {
      const weeks = structuredClone(WEEKS);
      const opened = await open(page, '/charts', weeks);
      const card = page.getByTestId('card-checkin');
      await expect(page.getByTestId('card-checkin-headline')).toHaveText(
        'Avg 2,150 kcal, on target 2 of 3 days',
      );
      await expect(card).toContainText('Only 3 days logged, so averages may be off.');
      await expect(card).toContainText('Protein averaged 120 g a day');
      await expect(card).not.toContainText('You logged food on 3 of 7 days.');
      expect(opened).toEqual([]); // seeing the card does not mark it read
      await card.getByRole('link').click();
      await expect(page).toHaveURL(/\/checkins\/2026-10-26$/);
      const article = page.getByTestId('checkin');
      await expect(article.getByRole('heading')).toHaveText('Week of 26 Oct to 1 Nov 2026');
      await expect(article.getByRole('listitem')).toHaveCount(4);
      await expect(article).toContainText('You logged food on 3 of 7 days.');
      await noSideScroll(page);
    });

    test('the list shows unread weeks and opens each', async ({ page }) => {
      const weeks = structuredClone(WEEKS);
      await open(page, '/checkins', weeks);
      const list = page.getByTestId('checkin-list');
      if (vp.width < 1024) {
        await expect(page.getByTestId('checkin')).toBeHidden();
      } else {
        // Desktop: the latest week opens beside the list.
        await expect(page.getByTestId('checkin')).toContainText('Week of 26 Oct to 1 Nov 2026');
      }
      const first = list.getByRole('link').first();
      await expect(first).toContainText('Week of 26 Oct to 1 Nov 2026');
      await expect(list.getByText('Unread')).toHaveCount(vp.width < 1024 ? 1 : 0);
      await list.getByRole('link', { name: /19 Oct/ }).click();
      await expect(page.getByTestId('checkin')).toContainText('Week of 19 Oct to 25 Oct 2026');
      if (vp.width < 1024) {
        await expect(list).toBeHidden();
        await page.getByRole('link', { name: 'All check-ins' }).click();
        await expect(list).toBeVisible();
      } else {
        await expect(list).toBeVisible();
      }
      await noSideScroll(page);
    });
  });
}
