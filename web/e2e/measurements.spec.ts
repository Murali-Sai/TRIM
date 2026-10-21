import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 4.3: quick-log, per-metric charts with left and right, the overlay, small multiples
// and the change table. AC (90.0 to 87.3 is -3.0%) is unit tested in lib/measureSeries.test.ts
// and tests/test_measure_math.py.

const NOW = new Date('2026-10-17T23:07:00Z');

type Type = {
  id: string;
  name: string;
  unit: string;
  precision: number;
  side: string | null;
  pair_id: string | null;
  is_preset: boolean;
  is_active: boolean;
  sort_order: number;
  archived_at: string | null;
  entries: number;
  latest: { value: number | null; value_text: string | null; measured_at: string } | null;
};
type Entry = {
  id: string;
  type_id: string;
  value: number | null;
  value_text: string | null;
  measured_at: string;
  note: string | null;
};

const type = (id: string, name: string, over: Partial<Type> = {}): Type => ({
  id,
  name,
  unit: 'cm',
  precision: 1,
  side: null,
  pair_id: null,
  is_preset: true,
  is_active: true,
  sort_order: 0,
  archived_at: null,
  entries: 0,
  latest: null,
  ...over,
});
const at = (day: string) => `${day}T12:00:00Z`;
const entry = (type_id: string, day: string, value: number): Entry => ({
  id: `${type_id}-${day}`,
  type_id,
  value,
  value_text: null,
  measured_at: at(day),
  note: null,
});

function baseline() {
  const types: Type[] = [
    type('waist', 'Waist'),
    type('thigh-l', 'Thigh', { side: 'left', pair_id: 'thigh' }),
    type('thigh-r', 'Thigh', { side: 'right', pair_id: 'thigh' }),
    type('hips', 'Hips', { is_active: false }),
  ];
  const entries: Entry[] = [
    entry('waist', '2026-09-20', 90),
    entry('waist', '2026-09-30', 88.6),
    entry('waist', '2026-10-13', 87.3),
    entry('thigh-l', '2026-09-20', 56),
    entry('thigh-l', '2026-10-13', 55.4),
    entry('thigh-r', '2026-09-20', 56.5),
    entry('thigh-r', '2026-10-13', 56.1),
  ];
  return { types, entries };
}

async function open(
  page: Page,
  path: string,
  state = baseline(),
): Promise<{ posted: unknown[]; state: ReturnType<typeof baseline> }> {
  const posted: unknown[] = [];
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, { ...ME, unit_system: 'metric' });
  await page.route('**/api/weights', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/me/body-stats', (r) =>
    r.fulfill({
      json: {
        sex: 'female',
        age: 41,
        height_cm: 170,
        activity_level: 'light',
        unit_system: 'metric',
        latest_weight_kg: 70,
        goal_weight_kg: null,
      },
    }),
  );
  const withLatest = () =>
    state.types.map((t) => {
      const mine = state.entries.filter((e) => e.type_id === t.id);
      const last = mine.at(-1);
      return {
        ...t,
        entries: mine.length,
        latest: last
          ? { value: last.value, value_text: last.value_text, measured_at: last.measured_at }
          : null,
      };
    });
  await page.route('**/api/measurement-types**', async (r) => {
    const method = r.request().method();
    if (method === 'POST') {
      const body = r.request().postDataJSON() as { name: string; unit: string };
      state.types.push(type('new', body.name, { unit: body.unit, is_preset: false }));
      return r.fulfill({ status: 201, json: withLatest() });
    }
    const archived = new URL(r.request().url()).searchParams.get('archived');
    return r.fulfill({ json: archived === 'true' ? [] : withLatest() });
  });
  await page.route('**/api/measurements**', async (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON() as {
        items: { type_id: string; value: number }[];
      };
      posted.push(body);
      const made = body.items.map((it, i) => ({
        id: `new-${state.entries.length + i}`,
        type_id: it.type_id,
        value: it.value,
        value_text: null,
        measured_at: NOW.toISOString(),
        note: null,
      }));
      state.entries.push(...made);
      return r.fulfill({ status: 201, json: made });
    }
    return r.fulfill({ json: state.entries });
  });
  await page.goto(path);
  return { posted, state };
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

    test('quick-log saves every filled metric at once', async ({ page }) => {
      const { posted } = await open(page, '/body');
      const form = page.getByTestId('quick-log');
      await expect(form.getByLabel('Waist (cm)')).toHaveAttribute('placeholder', '87.3');
      await expect(form.getByLabel('Hips (cm)')).toHaveCount(0);
      await form.getByLabel('Waist (cm)').fill('87');
      await form.getByLabel('Thigh, left (cm)').fill('55.2');
      await form.getByRole('button', { name: 'Save measurements' }).click();
      await expect(page.getByText('Saved 2 measurements.')).toBeVisible();
      expect(posted).toEqual([
        {
          items: [
            { type_id: 'waist', value: 87 },
            { type_id: 'thigh-l', value: 55.2 },
          ],
        },
      ]);
      const rows = page.getByTestId('change-row');
      await expect(rows.first()).toContainText('Waist');
      await expect(rows.first()).toContainText('87.0 cm');
      await expect(rows.first()).toContainText('down 3.0 cm');
      await noSideScroll(page);
    });

    test('a metric shown in inches is saved in cm', async ({ page }) => {
      const state = baseline();
      state.types = [
        type('waist', 'Waist', { unit: 'in' }),
        type('fat', 'Body fat', { unit: '%' }),
      ];
      state.entries = [];
      const { posted } = await open(page, '/body', state);
      await page.getByLabel('Waist (in)').fill('35.5');
      await page.getByLabel('Body fat (%)').fill('18,4');
      await page.getByRole('button', { name: 'Save measurements' }).click();
      await expect
        .poll(() => posted)
        .toEqual([
          {
            items: [
              { type_id: 'waist', value: 90.17 },
              { type_id: 'fat', value: 18.4 },
            ],
          },
        ]);
    });

    test('charts: small multiples, left and right, the overlay and the table', async ({ page }) => {
      await open(page, '/charts/measurements');
      const charts = page.getByTestId('metric-chart');
      await expect(charts).toHaveCount(2);
      await expect(charts.nth(0).getByTestId('metric-headline')).toHaveText(
        'Waist down 2.7 cm since 20 Sep',
      );
      await expect(charts.nth(1)).toContainText('Thigh (left and right)');
      await expect(charts.nth(1)).toContainText('Solid line is left, dashed is right.');
      await expect(charts.nth(0).getByTestId('measure-chart')).toHaveAttribute(
        'aria-label',
        /Waist down 2\.7 cm since 20 Sep/,
      );
      const table = page.getByTestId('change-table');
      await expect(table.getByTestId('change-row')).toHaveCount(3);
      await expect(table.getByTestId('change-row').nth(1)).toContainText('Thigh, left');
      await expect(table.getByTestId('change-row').nth(1)).toContainText('down 0.6 cm');

      await page.getByRole('tab', { name: 'Compare' }).click();
      const overlay = page.getByTestId('overlay-chart');
      await expect(overlay).toHaveAttribute('aria-label', /Waist down 3%/);
      await page.getByLabel('Change since', { exact: true }).fill('2026-09-30');
      await expect(overlay).toHaveAttribute('aria-label', /percent change since 2026-09-30/);
      await expect(overlay).toHaveAttribute('aria-label', /Waist down 1\.5%/);
      await noSideScroll(page);
    });

    test('the dashboard card names the biggest change', async ({ page }) => {
      await open(page, '/charts');
      await expect(page.getByTestId('card-measurements-headline')).toHaveText(
        'Waist down 2.7 cm since 20 Sep',
      );
      await expect(page.getByTestId('card-measurements').getByTestId('change-row')).toHaveCount(3);
    });
  });
}
