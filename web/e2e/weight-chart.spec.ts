import { expect, test, type Page } from '@playwright/test';
import { stubExternal } from './fixtures';
import { stubWeights, type Entry } from './weights-stub';

const DAY = 86_400_000;

/**
 * One weigh-in a day for `days` days at 11:00 UTC, drifting down with daily swings. The last
 * one is the latest 11:00 UTC that has passed, so it is never in the future (before 11:00 UTC
 * it is yesterday's).
 */
function seed(days: number): Entry[] {
  const out: Entry[] = [];
  const last = new Date();
  last.setUTCHours(11, 0, 0, 0);
  if (last.getTime() > Date.now()) last.setTime(last.getTime() - DAY);
  for (let i = days - 1; i >= 0; i--) {
    const at = new Date(last.getTime() - i * DAY);
    const iso = at.toISOString();
    const kg = 82 - (days - i) * 0.02 + Math.sin(i * 1.7) * 0.5;
    out.push({
      id: `s${i}`,
      measured_at: iso,
      day: iso.slice(0, 10),
      kg: Math.round(kg * 1000) / 1000,
      note: null,
    });
  }
  return out;
}

async function openChart(page: Page, entries: Entry[], goalKg: number | null = null) {
  await stubExternal(page);
  const api = await stubWeights(page, entries, goalKg);
  await page.goto('/body');
  const chart = page.getByTestId('weight-chart');
  await expect(chart.locator('canvas')).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  return { api, chart };
}

const over = (page: Page) => page.locator('[data-testid=weight-chart] .u-over');

/** Synthetic touch pointers, so two-finger pinch can be tested without a device. */
async function pinch(page: Page, from: number, to: number) {
  await over(page).evaluate(
    (el, [from, to]) => {
      const box = el.getBoundingClientRect();
      const mid = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const fire = (type: string, id: number, x: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        );
      fire('pointerdown', 1, mid - from);
      fire('pointerdown', 2, mid + from);
      fire('pointermove', 1, mid - to);
      fire('pointermove', 2, mid + to);
      fire('pointerup', 1, mid - to);
      fire('pointerup', 2, mid + to);
    },
    [from, to] as const,
  );
}

for (const vp of [
  { name: 'phone', width: 375, height: 812, touch: true },
  { name: 'desktop', width: 1280, height: 900, touch: false },
] as const) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      locale: 'en-US',
      hasTouch: vp.touch,
    });

    test('renders a year of weigh-ins in under 300 ms', async ({ page }) => {
      const { chart } = await openChart(page, seed(365));
      await expect(chart).toHaveAttribute('data-render-ms', /^\d+$/);
      const ms = Number(await chart.getAttribute('data-render-ms'));
      console.log(`weight chart, 365 points: ${ms} ms`);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(300);
      await expect(chart).toHaveAttribute(
        'aria-label',
        /^Weight chart, last month\. Trend 1\d\d\.\d lb, (down|up) \d\.\d lb a week\. \d+ weigh-ins shown\.$/,
      );
    });

    test('range chips switch and are remembered', async ({ page }) => {
      const { chart } = await openChart(page, seed(200));
      await expect(page.getByRole('radio', { name: 'last month' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await page.getByRole('radio', { name: 'last year' }).click();
      await expect(chart).toHaveAttribute(
        'aria-label',
        /^Weight chart, last year\. .* 200 weigh-ins shown\./,
      );
      await page.reload();
      await expect(page.getByRole('radio', { name: 'last year' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    test('tooltip speaks in a sentence', async ({ page }) => {
      await openChart(page, seed(30));
      const box = await over(page).boundingBox();
      if (!box) throw new Error('no chart');
      const x = box.x + box.width * 0.5;
      const y = box.y + box.height * 0.5;
      if (vp.touch) await page.touchscreen.tap(x, y);
      else await page.mouse.move(x, y);
      await expect(page.getByTestId('weight-tooltip')).toHaveText(
        /^\w{3}, \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M: 1\d\d\.\d lb, trend 1\d\d\.\d lb$/,
      );
    });

    test('wheel and pinch zoom, then reset', async ({ page }) => {
      await openChart(page, seed(60));
      const reset = page.getByRole('button', { name: 'Reset zoom' });
      await expect(reset).toBeHidden();
      if (vp.touch) {
        await pinch(page, 20, 80);
      } else {
        const box = await over(page).boundingBox();
        if (!box) throw new Error('no chart');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -200);
      }
      await expect(reset).toBeVisible();
      await reset.click();
      await expect(reset).toBeHidden();
    });

    test('view as table lists what the chart shows', async ({ page }) => {
      await openChart(page, seed(10));
      await page.getByRole('button', { name: 'View as table' }).click();
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader', { name: 'Excluded as outlier' })).toBeVisible();
      await expect(table.locator('tbody tr')).toHaveCount(10);
      await expect(page.getByTestId('weight-chart')).toBeHidden();
      await page.getByRole('button', { name: 'View as chart' }).click();
      await expect(page.getByTestId('weight-chart')).toBeVisible();
    });

    test('goal weight is set, labeled and removable', async ({ page }) => {
      const { api, chart } = await openChart(page, seed(14));
      await page.getByRole('button', { name: 'Set a goal weight' }).click();
      await page.getByLabel('Goal weight (lb)').fill('165');
      await page.getByRole('button', { name: 'Save goal' }).click();
      await expect(page.getByText('Goal 165.0 lb')).toBeVisible();
      expect(api.state.goal).toBeCloseTo(74.843, 3);
      await expect(chart).toHaveAttribute('aria-label', /Goal 165\.0 lb\.$/);
      await page.getByRole('button', { name: 'Remove goal weight' }).click();
      await expect(page.getByRole('button', { name: 'Set a goal weight' })).toBeVisible();
    });

    test('explains the trend once, and the info button brings it back', async ({ page }) => {
      await openChart(page, seed(14));
      const note = page.getByRole('note');
      await expect(note).toContainText('The line shows the real direction.');
      await note.getByRole('button', { name: 'Got it' }).click();
      await expect(note).toBeHidden();
      await page.reload();
      await expect(page.getByTestId('weight-chart').locator('canvas')).toBeVisible();
      await expect(page.getByRole('note')).toBeHidden();
      await page.getByRole('button', { name: 'What the trend line means' }).click();
      await expect(page.getByRole('note')).toBeVisible();
    });

    test('a long list shows the newest 20 first', async ({ page }) => {
      await openChart(page, seed(30));
      await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(20);
      await page.getByRole('button', { name: 'Show all 30 weigh-ins' }).click();
      await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(30);
    });
  });
}
