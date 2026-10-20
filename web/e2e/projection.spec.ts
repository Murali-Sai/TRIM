import { expect, test, type Page } from '@playwright/test';
import { formatLongDate, projectionFor, trendFor } from '../src/pages/body/weightFormat';
import { stubExternal } from './fixtures';
import { stubWeights, type Entry } from './weights-stub';

const TODAY = new Date('2026-10-17T16:00:00Z'); // noon in New York, the profile timezone

/** A weigh-in each morning for the 21 days up to TODAY, changing `perDay` kg a day. */
function readings(perDay: number, endKg = 79.8): Entry[] {
  return Array.from({ length: 21 }, (_, n) => {
    const i = 20 - n;
    const at = new Date(TODAY.getTime() - i * 86_400_000);
    at.setUTCHours(11, 0, 0, 0);
    const iso = at.toISOString();
    return {
      id: `r${n}`,
      measured_at: iso,
      day: iso.slice(0, 10),
      kg: Math.round((endKg - perDay * i) * 1000) / 1000,
      note: null,
    };
  });
}

async function open(page: Page, entries: Entry[], goalKg: number | null) {
  await page.clock.setFixedTime(TODAY);
  await stubExternal(page);
  await stubWeights(page, entries, goalKg);
  await page.goto('/body');
  await expect(page.getByTestId('trend-sentence')).toBeVisible();
}

for (const vp of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('shows the goal date when the trend heads toward the goal', async ({ page }) => {
      // -0.064 kg a day is about -0.45 kg a week (SPEC page 3).
      const entries = readings(-0.064);
      const expected = projectionFor(trendFor(entries), 75, '2026-10-17');
      if (expected.kind !== 'projection') throw new Error('fixture should project');
      await open(page, entries, 75);
      await expect(page.getByTestId('projection-sentence')).toHaveText(
        `165.3 lb goal around ${formatLongDate(expected.date)} if your current rate continues.`,
      );
      await expect(page.getByTestId('weight-chart')).toHaveAttribute(
        'aria-label',
        /165\.3 lb goal around .* if your current rate continues\./,
      );
    });

    test('flat trend: no projection', async ({ page }) => {
      await open(page, readings(0), 75);
      await expect(page.getByTestId('projection-sentence')).toHaveText(
        'No projection: your trend is flat or moving away from your goal.',
      );
    });

    test('moving away from the goal: no projection', async ({ page }) => {
      await open(page, readings(0.05), 75);
      await expect(page.getByTestId('projection-sentence')).toHaveText(
        'No projection: your trend is flat or moving away from your goal.',
      );
    });

    test('no goal: no projection sentence at all', async ({ page }) => {
      await open(page, readings(-0.064), null);
      await expect(page.getByTestId('projection-sentence')).toHaveCount(0);
    });

    test('trend not visible yet: no projection sentence', async ({ page }) => {
      await open(page, readings(-0.064).slice(-3), 75);
      await expect(page.getByTestId('trend-sentence')).toHaveText(
        'Log 2 more weigh-ins to see your trend.',
      );
      await expect(page.getByTestId('projection-sentence')).toHaveCount(0);
    });
  });
}
