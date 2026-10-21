import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 5.1: Download my data. The file itself is checked cell by cell in the API tests
// (tests/test_export.py); here the page sends the right request and hands over the file.

const NOW = new Date('2026-10-17T23:07:00Z');

async function open(page: Page, path = '/account/export') {
  const bodies: unknown[] = [];
  let answer: { status: number; detail?: string } = { status: 200 };
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  await page.route('**/api/export', async (r) => {
    bodies.push(r.request().postDataJSON());
    if (answer.status !== 200) {
      return r.fulfill({ status: answer.status, json: { detail: answer.detail } });
    }
    return r.fulfill({
      status: 200,
      body: 'file bytes',
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="trim-export-2026-10-17.xlsx"',
      },
    });
  });
  await page.goto(path);
  return {
    bodies,
    answer: (a: typeof answer) => {
      answer = a;
    },
  };
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const ALL = [
  'food_log',
  'daily_totals',
  'saved_meals',
  'staples',
  'weight',
  'measurements',
  'water',
  'targets',
  'phases',
  'checkins',
  'streaks',
  'custom_foods',
  'profile',
];

for (const vp of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('Account opens it; the defaults download everything as Excel', async ({ page }) => {
      const { bodies } = await open(page, '/account');
      await page.getByRole('link', { name: 'Download my data' }).click();
      await expect(page.getByRole('heading', { name: 'Download my data' })).toBeVisible();
      await expect(page.getByLabel('Excel (.xlsx)')).toBeChecked();
      await expect(page.getByRole('combobox', { name: 'Date range' })).toHaveValue('all');
      for (const label of ['Food log', 'Weekly check-ins', 'Profile']) {
        await expect(page.getByLabel(label)).toBeChecked();
      }
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      expect((await download).suggestedFilename()).toBe('trim-export-2026-10-17.xlsx');
      await expect(page.getByText('Downloaded trim-export-2026-10-17.xlsx.')).toBeVisible();
      expect(bodies).toEqual([{ format: 'xlsx', date_from: null, date_to: null, datasets: ALL }]);
      await noSideScroll(page);
    });

    test('format, range and datasets go in the request', async ({ page }) => {
      const { bodies } = await open(page);
      await page.getByLabel('CSV').check();
      await page.getByRole('combobox', { name: 'Date range' }).selectOption('30');
      await page.getByRole('button', { name: 'Clear' }).click();
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Pick at least one dataset.');
      await page.getByLabel('Weight').check();
      await page.getByLabel('Food log').check();
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await expect(page.getByText(/^Downloaded /)).toBeVisible();
      expect(bodies).toEqual([
        {
          format: 'csv',
          date_from: '2026-09-18',
          date_to: '2026-10-17',
          datasets: ['food_log', 'weight'],
        },
      ]);

      await page.getByLabel('JSON').check();
      await page.getByRole('combobox', { name: 'Date range' }).selectOption('custom');
      await page.getByLabel('From', { exact: true }).fill('2026-10-10');
      await page.getByLabel('To', { exact: true }).fill('2026-10-01');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('The start date is after the end date.');
      expect(bodies).toHaveLength(1);
    });

    test('says when there is nothing in the range, or it is too soon', async ({ page }) => {
      const { answer } = await open(page);
      answer({ status: 404, detail: 'No data in this range.' });
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('No data in this range.');
      answer({
        status: 429,
        detail: 'You can download your data once a minute. Try again in a moment.',
      });
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText(
        'You can download your data once a minute. Try again in a moment.',
      );
    });

    test('Account imports a TRIM file and says what came in', async ({ page }) => {
      await open(page, '/account');
      const sent: string[] = [];
      let status = 200;
      await page.route('**/api/import', async (r) => {
        sent.push(r.request().postData() ?? '');
        if (status !== 200) {
          return r.fulfill({
            status,
            json: { detail: 'Import works into an empty account, and this one already has data.' },
          });
        }
        return r.fulfill({ json: { imported: { profile: 1, food_log: 1200, weight: 30 } } });
      });
      const file = {
        name: 'trim-export-2026-10-17.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{"format": "trim-export", "version": 1, "datasets": {}}'),
      };
      await page.getByLabel('TRIM JSON file').setInputFiles(file);
      await expect(page.getByText('Imported 1,200 food entries and 30 weigh-ins.')).toBeVisible();
      expect(JSON.parse(sent[0] ?? '{}')).toEqual({
        format: 'trim-export',
        version: 1,
        datasets: {},
      });
      status = 409;
      await page.getByLabel('TRIM JSON file').setInputFiles(file);
      await expect(page.getByRole('alert')).toHaveText(
        'Import works into an empty account, and this one already has data.',
      );
      await noSideScroll(page);
    });

    test('Progress has a download button', async ({ page }) => {
      await open(page, '/charts');
      await page.getByRole('link', { name: 'Download my data' }).click();
      await expect(page.getByRole('heading', { name: 'Download my data' })).toBeVisible();
    });
  });
}
