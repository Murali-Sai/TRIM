import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

interface Entry {
  id: string;
  measured_at: string;
  day: string;
  kg: number;
  note: string | null;
}

/** An in-memory /api/weights, so the page runs against something that behaves like the API. */
async function stubWeights(page: Page, initial: Entry[] = []) {
  const live = [...initial];
  const deleted = new Map<string, Entry>();
  let next = 1;
  const sorted = () => [...live].sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  const dayOf = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: ME.timezone }).format(new Date(iso));

  await page.route('**/api/me/body-stats', (route) =>
    route.fulfill({
      json: {
        sex: 'male',
        age: 30,
        height_cm: 180,
        activity_level: 'moderate',
        unit_system: ME.unit_system,
        latest_weight_kg: sorted().at(-1)?.kg ?? null,
      },
    }),
  );
  await page.route('**/api/weights**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const id = path.split('/')[3];
    if (req.method() === 'GET') return route.fulfill({ json: sorted() });
    if (req.method() === 'POST' && path === '/api/weights') {
      const body = req.postDataJSON() as { kg: number; measured_at?: string; note?: string };
      const at = body.measured_at ?? new Date().toISOString();
      const entry = {
        id: `w${next++}`,
        measured_at: at,
        day: dayOf(at),
        kg: body.kg,
        note: body.note ?? null,
      };
      live.push(entry);
      return route.fulfill({ status: 201, json: entry });
    }
    if (req.method() === 'POST' && path.endsWith('/restore')) {
      const entry = deleted.get(id ?? '');
      if (!entry) return route.fulfill({ status: 404, json: { detail: 'Not found' } });
      deleted.delete(entry.id);
      live.push(entry);
      return route.fulfill({ json: entry });
    }
    const index = live.findIndex((e) => e.id === id);
    if (index < 0) return route.fulfill({ status: 404, json: { detail: 'Not found' } });
    const entry = live[index] as Entry;
    if (req.method() === 'DELETE') {
      live.splice(index, 1);
      deleted.set(entry.id, entry);
      return route.fulfill({ status: 204, body: '' });
    }
    const patch = req.postDataJSON() as Partial<Entry>;
    Object.assign(entry, patch);
    entry.day = dayOf(entry.measured_at);
    return route.fulfill({ json: entry });
  });
  return { live };
}

function weighIns(days: number, startKg = 80): Entry[] {
  return Array.from({ length: days }, (_, i) => {
    const day = `2026-10-${String(1 + i).padStart(2, '0')}`;
    return {
      id: `seed${i}`,
      day,
      measured_at: `${day}T11:00:00.000Z`,
      kg: startKg - 0.1 * i,
      note: null,
    };
  });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('logs a weigh-in in under 3 seconds', async ({ page }) => {
      await stubExternal(page);
      const api = await stubWeights(page);
      await page.goto('/body');
      const input = page.getByLabel('Weight (lb)');
      await expect(input).toBeFocused();

      const started = Date.now();
      await input.fill('176.4');
      await input.press('Enter');
      await expect(page.getByRole('status').getByText('Saved 176.4 lb.')).toBeVisible();
      expect(Date.now() - started).toBeLessThan(3000);

      expect(api.live).toHaveLength(1);
      expect(api.live[0]?.kg).toBeCloseTo(80.014, 3);
      await expect(input).toHaveValue('');
      await expect(page.getByTestId('trend-sentence')).toHaveText(
        'Log 4 more weigh-ins to see your trend.',
      );
      await noHorizontalScroll(page);
    });

    test('shows the trend sentence once there is enough data', async ({ page }) => {
      await stubExternal(page);
      await stubWeights(page, weighIns(10));
      await page.goto('/body');
      await expect(page.getByTestId('trend-sentence')).toHaveText(
        'Trend 175.6 lb, down 0.6 lb a week',
      );
      await expect(page.getByLabel('Weight (lb)')).toHaveAttribute('placeholder', '174.4');
      await noHorizontalScroll(page);
      const entry = await page.getByRole('heading', { name: 'Weight', exact: true }).boundingBox();
      const list = await page.getByRole('heading', { name: 'Weigh-ins' }).boundingBox();
      if (vp.width >= 1024) {
        expect(list?.x ?? 0).toBeGreaterThan((entry?.x ?? 0) + 200); // side by side
      } else {
        expect(list?.y ?? 0).toBeGreaterThan(entry?.y ?? 0); // stacked
      }
    });

    test('rejects an out-of-range weight without saving', async ({ page }) => {
      await stubExternal(page);
      const api = await stubWeights(page);
      await page.goto('/body');
      await page.getByLabel('Weight (lb)').fill('700');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(
        page.getByText('Enter a weight from 30 to 300 kg (66 to 661 lb).'),
      ).toBeVisible();
      expect(api.live).toHaveLength(0);
    });

    test('logs at another time with a note', async ({ page }) => {
      await stubExternal(page);
      const api = await stubWeights(page);
      await page.goto('/body');
      await page.getByRole('button', { name: 'Change time or add a note' }).click();
      await page.getByLabel('When').fill('2026-10-15T07:30');
      await page.getByLabel('Note (optional)').fill('after a long run');
      await page.getByLabel('Weight (lb)').fill('175');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('after a long run')).toBeVisible();
      // 07:30 in New York (the profile timezone) is 11:30 UTC.
      expect(api.live[0]?.measured_at).toBe('2026-10-15T11:30:00.000Z');
    });

    test('edits, deletes and undoes', async ({ page }) => {
      await stubExternal(page);
      const api = await stubWeights(page, weighIns(2));
      await page.goto('/body');
      await page.getByRole('button', { name: /^Edit 176\.4 lb/ }).click();
      await page.getByLabel('Weight (lb)').last().fill('175.0');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('175.0 lb', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: /^Delete 175\.0 lb/ }).click();
      await expect(page.getByRole('status').getByText('Deleted 175.0 lb.')).toBeVisible();
      expect(api.live).toHaveLength(1);
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByText('175.0 lb', { exact: true })).toBeVisible();
      expect(api.live).toHaveLength(2);
    });
  });
}
