import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 4.2: Manage metrics. AC (archived history still exports) is covered by the API keeping
// archived readings (tests/test_measurements.py) and by the export in task 5.x; here the page
// creates, renames, reorders, switches on and off, archives and restores.

type Row = {
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
  latest: null;
};

const row = (id: string, name: string, over: Partial<Row> = {}): Row => ({
  id,
  name,
  unit: 'cm',
  precision: 1,
  side: null,
  pair_id: null,
  is_preset: true,
  is_active: false,
  sort_order: 0,
  archived_at: null,
  entries: 0,
  latest: null,
  ...over,
});

interface Calls {
  patches: { id: string; body: Record<string, unknown> }[];
  orders: string[][];
  created: unknown[];
}

async function open(page: Page, path = '/body/metrics'): Promise<Calls> {
  const calls: Calls = { patches: [], orders: [], created: [] };
  let rows: Row[] = [
    row('waist', 'Waist', { entries: 3, is_active: true }),
    row('hips', 'Hips'),
    row('thigh-l', 'Thigh', { side: 'left', pair_id: 'thigh' }),
    row('thigh-r', 'Thigh', { side: 'right', pair_id: 'thigh' }),
    row('fat', 'Body fat', { unit: '%' }),
  ];
  await page.clock.setFixedTime(new Date('2026-10-17T23:07:00Z'));
  await stubExternal(page, ME);
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
  await page.route('**/api/measurements**', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/measurement-types**', async (r) => {
    const url = new URL(r.request().url());
    const method = r.request().method();
    if (url.pathname.endsWith('/order')) {
      const ids = (r.request().postDataJSON() as { ids: string[] }).ids;
      calls.orders.push(ids);
      rows = ids.map((id) => rows.find((x) => x.id === id) as Row);
    } else if (method === 'POST') {
      const body = r.request().postDataJSON() as { name: string; unit: string; paired: boolean };
      calls.created.push(body);
      const sides = body.paired ? ['left', 'right'] : [null];
      rows = [
        ...rows,
        ...sides.map((side, i) =>
          row(`new-${i}`, body.name, {
            unit: body.unit,
            side,
            pair_id: body.paired ? 'new' : null,
            is_preset: false,
            is_active: true,
          }),
        ),
      ];
      return r.fulfill({ status: 201, json: rows });
    } else if (method === 'PATCH') {
      const id = url.pathname.split('/').pop() ?? '';
      const body = r.request().postDataJSON() as Record<string, unknown>;
      calls.patches.push({ id, body });
      const target = rows.find((x) => x.id === id);
      rows = rows.map((x) =>
        x.id === id || (target?.pair_id && x.pair_id === target.pair_id)
          ? {
              ...x,
              ...(body.name ? { name: body.name as string } : {}),
              ...(body.unit ? { unit: body.unit as string } : {}),
              ...(body.is_active !== undefined ? { is_active: body.is_active as boolean } : {}),
              ...(body.archived !== undefined
                ? { archived_at: body.archived ? '2026-10-17T23:07:00Z' : null }
                : {}),
            }
          : x,
      );
    }
    const archived = url.searchParams.get('archived');
    const out =
      archived === 'true'
        ? rows.filter((x) => x.archived_at)
        : archived === 'false'
          ? rows.filter((x) => !x.archived_at)
          : rows;
    return r.fulfill({ json: out });
  });
  await page.goto(path);
  return calls;
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

    test('Body links to Manage metrics, which lists pairs as one', async ({ page }) => {
      await open(page, '/body');
      const section = page.getByTestId('measurements-section');
      await expect(section.getByLabel('Waist (cm)')).toBeVisible();
      await section.getByRole('link', { name: 'Manage metrics' }).click();
      await expect(page.getByRole('heading', { name: 'Manage metrics' })).toBeVisible();
      const rows = page.getByTestId('metric-row');
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(2)).toContainText('Thigh · left and right');
      await expect(rows.nth(0)).toContainText('cm · 3 readings');
      await noSideScroll(page);
    });

    test('switch on, reorder, add, rename, archive and restore', async ({ page }) => {
      const calls = await open(page);
      const hips = page.getByRole('switch', { name: 'Track Hips' });
      await expect(hips).toHaveAttribute('aria-checked', 'false');
      await hips.click();
      await expect(hips).toHaveAttribute('aria-checked', 'true');
      expect(calls.patches[0]).toEqual({ id: 'hips', body: { is_active: true } });

      await page.getByRole('button', { name: 'Move Thigh up' }).click();
      await expect
        .poll(() => calls.orders)
        .toEqual([['waist', 'thigh-l', 'thigh-r', 'hips', 'fat']]);

      const add = page.getByTestId('add-metric');
      await add.getByLabel('Name').fill('Calf');
      await add.getByLabel('Left and right').check();
      await add.getByRole('button', { name: 'Add metric' }).click();
      await expect(page.getByText('Added. It is switched on and ready to log.')).toBeVisible();
      expect(calls.created).toEqual([{ name: 'Calf', unit: 'cm', paired: true, precision: 1 }]);
      await expect(page.getByTestId('metric-row').last()).toContainText('Calf · left and right');

      // Waist has readings, so its unit stays a length.
      await page.getByRole('button', { name: 'Edit Waist' }).click();
      const sheet = page.getByTestId('metric-sheet');
      const units = await sheet.getByLabel('Unit').locator('option').allTextContents();
      expect(units).toEqual(['centimeters (cm)', 'inches (in)']);
      await sheet.getByLabel('Name').fill('Belly');
      await sheet.getByLabel('Unit').selectOption('in');
      await sheet.getByRole('button', { name: 'Save' }).click();
      await expect(sheet).toBeHidden();
      expect(calls.patches.at(-1)).toEqual({ id: 'waist', body: { name: 'Belly', unit: 'in' } });

      await page.getByRole('button', { name: 'Edit Belly' }).click();
      await sheet.getByRole('button', { name: 'Archive Belly' }).click();
      await expect(sheet).toBeHidden();
      const archived = page.getByTestId('archived-row');
      await expect(archived).toContainText('Belly');
      await expect(archived).toContainText('3 readings');
      await expect(page.getByRole('button', { name: 'Edit Belly' })).toHaveCount(0);
      await archived.getByRole('button', { name: 'Restore Belly' }).click();
      await expect(page.getByRole('button', { name: 'Edit Belly' })).toBeVisible();
      await noSideScroll(page);
    });
  });
}
