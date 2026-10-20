import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('missing fixture row');
  return x;
}

// Task 3.6. AC: moving a card updates both blocks' subtotals.
// The clock is fixed at 19:30 on 17 Oct in New York.

type Entry = Record<string, unknown> & {
  id: string;
  eaten_at: string;
  logged_on: string;
  log_group_id: string;
  grams: number | null;
  quantity: number | null;
  unit_label: string | null;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

const ref = JSON.parse(
  readFileSync(new URL('../../shared/reference_day.json', import.meta.url), 'utf8'),
) as { target: Record<string, number>; entries: Entry[] };

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const NOW = new Date('2026-10-17T23:30:00Z');
const APPLE: Entry = {
  ...must(ref.entries[3]),
  id: 'apple',
  log_group_id: 'g-apple',
  name: 'Apple',
  brand: null,
  eaten_at: '2026-10-17T23:00:00Z', // 7 PM
  grams: 182,
  quantity: 1,
  unit_label: '1 medium',
  kcal: 95,
  protein_g: 0.5,
  fat_g: 0.3,
  carbs_g: 25,
};
const LUNCH: Entry[] = [
  {
    ...APPLE,
    id: 'y1',
    log_group_id: 'g-y',
    name: 'Tomato soup',
    eaten_at: '2026-10-16T16:30:00Z',
    logged_on: '2026-10-16',
  },
  {
    ...APPLE,
    id: 'y2',
    log_group_id: 'g-y',
    name: 'Rye bread',
    eaten_at: '2026-10-16T16:30:00Z',
    logged_on: '2026-10-16',
  },
];

const dayOf = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ME.timezone }).format(new Date(iso));

interface Calls {
  patch: { id: string; body: Record<string, unknown> }[];
  deleted: string[];
  restored: string[];
  moved: { ids: string[]; eaten_at: string }[];
  copied: { ids: string[]; eaten_at: string }[];
}

/** An in-memory /api/logs that behaves like the API for edit, delete, move and copy. */
async function stubLogs(page: Page) {
  const live: Entry[] = [...ref.entries.map((e) => ({ ...e })), { ...APPLE }, ...LUNCH];
  const gone = new Map<string, Entry>();
  const calls: Calls = { patch: [], deleted: [], restored: [], moved: [], copied: [] };
  let next = 1;
  const at = (iso: string, e: Entry) =>
    Object.assign(e, {
      eaten_at: new Date(iso).toISOString().replace('.000', ''),
      logged_on: dayOf(iso),
    });

  await page.route('**/api/targets', (r) =>
    r.fulfill({
      json: [
        {
          effective_from: '2026-10-01',
          ...ref.target,
          fiber_g: null,
          water_ml: null,
          source: 'custom',
          bmr: null,
          tdee: null,
          formula: null,
        },
      ],
    }),
  );
  await page.route('**/api/logs**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    if (method === 'GET' && path === '/api/logs') {
      const day = url.searchParams.get('date_from');
      return route.fulfill({ json: live.filter((e) => e.logged_on === day) });
    }
    const body = (req.postData() ? req.postDataJSON() : {}) as Record<string, unknown>;
    if (path === '/api/logs/move' || path === '/api/logs/copy') {
      const { ids, eaten_at } = body as { ids: string[]; eaten_at: string };
      const rows = ids.map((id) => must(live.find((e) => e.id === id)));
      if (path.endsWith('move')) {
        calls.moved.push({ ids, eaten_at });
        rows.forEach((e) => at(eaten_at, e));
        return route.fulfill({ json: rows });
      }
      calls.copied.push({ ids, eaten_at });
      const group = `copy${next}`;
      const copies = rows.map((e) => at(eaten_at, { ...e, id: `c${next++}`, log_group_id: group }));
      live.push(...copies);
      return route.fulfill({ status: 201, json: copies });
    }
    const id = path.split('/')[3] ?? '';
    if (path.endsWith('/restore')) {
      calls.restored.push(id);
      const e = must(gone.get(id));
      live.push(e);
      return route.fulfill({ json: e });
    }
    const i = live.findIndex((e) => e.id === id);
    const e = must(live[i]);
    if (method === 'DELETE') {
      calls.deleted.push(id);
      live.splice(i, 1);
      gone.set(id, e);
      return route.fulfill({ status: 204, body: '' });
    }
    calls.patch.push({ id, body });
    if (typeof body.eaten_at === 'string') at(body.eaten_at, e);
    const grams =
      typeof body.grams === 'number'
        ? body.grams
        : typeof body.quantity === 'number' && e.grams && e.quantity
          ? (e.grams / e.quantity) * body.quantity
          : null;
    if (grams !== null && e.grams) {
      const f = grams / e.grams;
      for (const k of ['kcal', 'protein_g', 'fat_g', 'carbs_g'] as const)
        e[k] = Math.round(e[k] * f * 100) / 100;
      e.grams = grams;
      if (typeof body.grams === 'number') Object.assign(e, { quantity: null, unit_label: null });
      else e.quantity = body.quantity as number;
    }
    return route.fulfill({ json: e });
  });
  return calls;
}

async function open(page: Page, path = '/') {
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, ME);
  const calls = await stubLogs(page);
  await page.goto(path);
  await expect(page.getByTestId('time-block').first()).toBeVisible();
  return calls;
}

const block = (page: Page, label: string) =>
  page
    .getByTestId('time-block')
    .filter({ has: page.getByTestId('block-pill').getByText(label, { exact: true }) });
const card = (page: Page, name: string) => page.getByTestId('entry-card').filter({ hasText: name });

async function chips(b: Locator) {
  return b.getByTestId('chip-kcal').innerText();
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of VIEWPORTS) {
  const desktop = vp.width >= 1024;
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('AC: changing a card time moves it and updates both blocks', async ({ page }) => {
      const calls = await open(page);
      expect(await chips(block(page, '4 PM'))).toBe('1,774 kcal');
      expect(await chips(block(page, '7 PM'))).toBe('95 kcal');

      await page.getByRole('button', { name: 'Edit Chicken breast, grilled' }).click();
      const sheet = page.getByTestId('edit-sheet');
      await expect(sheet.getByRole('heading', { name: 'Chicken breast, grilled' })).toBeVisible();
      await expect(sheet.getByLabel('Amount')).toBeFocused();
      await sheet.getByLabel('Time').fill('19:00');
      await noHorizontalScroll(page);
      await sheet.getByRole('button', { name: 'Save' }).click();

      await expect(sheet).toHaveCount(0);
      expect(calls.patch).toEqual([
        { id: 'ref-1', body: { eaten_at: '2026-10-17T23:00:00.000Z' } },
      ]);
      // 1774.39 - 341.25 = 1433.14, and 95 + 341.25 = 436.25.
      await expect(block(page, '4 PM').getByTestId('chip-kcal')).toHaveText('1,433 kcal');
      await expect(block(page, '7 PM').getByTestId('chip-kcal')).toHaveText('436 kcal');
      await expect(block(page, '7 PM').getByTestId('entry-card')).toHaveCount(2);
      await expect(page.getByTestId('toast')).toHaveText('Saved.');
    });

    test('changing the amount scales the entry', async ({ page }) => {
      const calls = await open(page);
      await page.getByRole('button', { name: 'Edit Chicken breast, grilled' }).click();
      const sheet = page.getByTestId('edit-sheet');
      await sheet.getByLabel('Amount').fill('175');
      await expect(sheet.getByTestId('edit-preview')).toHaveText('171 kcal · 37P 2F 0C · 175 g');
      await sheet.getByRole('button', { name: 'Save' }).click();
      expect(calls.patch).toEqual([{ id: 'ref-1', body: { grams: 175 } }]);
      await expect(card(page, 'Chicken breast').getByTestId('entry-macros')).toHaveText(
        '171 kcal · 37P 2F 0C · 175 g',
      );
    });

    test('a serving entry keeps its unit, and can switch to grams', async ({ page }) => {
      const calls = await open(page);
      await page.getByRole('button', { name: 'Edit White rice, cooked' }).click();
      const sheet = page.getByTestId('edit-sheet');
      await expect(sheet.getByLabel('Unit')).toHaveValue('1 cup');
      await sheet.getByLabel('Amount').fill('3');
      await expect(sheet.getByTestId('edit-preview')).toContainText('600 g');
      await sheet.getByLabel('Unit').selectOption('g');
      await expect(sheet.getByLabel('Amount')).toHaveValue('600');
      await sheet.getByRole('button', { name: 'Save' }).click();
      expect(calls.patch[0]?.body).toEqual({ grams: 600 });
    });

    test('delete, then undo from the toast', async ({ page }) => {
      const calls = await open(page);
      await page.getByRole('button', { name: 'Edit Olive oil' }).click();
      await page.getByTestId('edit-sheet').getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByTestId('toast')).toContainText('Deleted Olive oil.');
      await expect(card(page, 'Olive oil')).toHaveCount(0);
      expect(calls.deleted).toEqual(['ref-5']);
      await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click();
      await expect(card(page, 'Olive oil')).toHaveCount(1);
      expect(calls.restored).toEqual(['ref-5']);
    });

    test('duplicate copies the entry at the same time', async ({ page }) => {
      const calls = await open(page);
      await page.getByRole('button', { name: 'Edit Banana' }).click();
      await page.getByTestId('edit-sheet').getByRole('button', { name: 'Duplicate' }).click();
      await expect(block(page, '4 PM').getByTestId('entry-card')).toHaveCount(7);
      expect(calls.copied).toEqual([{ ids: ['ref-4'], eaten_at: '2026-10-17T20:00:00Z' }]);
    });

    test('Escape closes the sheet and focus returns to the card', async ({ page }) => {
      await open(page);
      const opener = page.getByRole('button', { name: 'Edit Banana' });
      await opener.click();
      await expect(page.getByTestId('edit-sheet')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('edit-sheet')).toHaveCount(0);
      await expect(opener).toBeFocused();
    });

    test('select several cards and move them to a new time', async ({ page }) => {
      const calls = await open(page);
      if (desktop) {
        await page.getByLabel('Select Banana').check();
        await page.getByLabel('Select Olive oil').check();
      } else {
        // Long-press starts selecting; then tapping another card adds it.
        const banana = card(page, 'Banana').getByTestId('entry-open');
        await banana.dispatchEvent('pointerdown', { pointerType: 'touch' });
        await page.waitForTimeout(650);
        await banana.dispatchEvent('pointerup', { pointerType: 'touch' });
        await banana.click();
        await expect(page.getByLabel('Select Banana')).toBeChecked();
        await card(page, 'Olive oil').getByTestId('entry-open').click();
        await expect(page.getByLabel('Select Olive oil')).toBeChecked();
      }
      const bar = page.getByTestId('selection-bar');
      await expect(bar).toContainText('2 selected');
      await noHorizontalScroll(page);
      await bar.getByRole('button', { name: 'Move' }).click();
      const sheet = page.getByTestId('move-copy-sheet');
      await expect(sheet.getByRole('heading', { name: 'Move 2 items' })).toBeVisible();
      await sheet.getByLabel('Time').fill('19:00');
      await sheet.getByRole('button', { name: 'Move to today' }).click();

      expect(calls.moved).toEqual([
        { ids: ['ref-4', 'ref-5'], eaten_at: '2026-10-17T23:00:00.000Z' },
      ]);
      // 1774.39 - 106.6 - 119.34 = 1548.45; 95 + 225.94 = 320.94.
      await expect(block(page, '4 PM').getByTestId('chip-kcal')).toHaveText('1,548 kcal');
      await expect(block(page, '7 PM').getByTestId('chip-kcal')).toHaveText('321 kcal');
      await expect(page.getByTestId('selection-bar')).toHaveCount(0);
    });

    test("copy yesterday's lunch block to today at a chosen time", async ({ page }) => {
      const calls = await open(page, '/?date=2026-10-16');
      await expect(page.getByRole('heading', { name: 'Fri 16 Oct' })).toBeVisible();
      await page.getByRole('button', { name: 'Options for the 12:30 PM block' }).click();
      await page.getByRole('menuitem', { name: 'Copy to another day' }).click();
      const sheet = page.getByTestId('move-copy-sheet');
      await expect(sheet.getByLabel('Date')).toHaveValue('2026-10-17');
      await expect(sheet.getByLabel('Time')).toHaveValue('12:30');
      await sheet.getByLabel('Time').fill('13:00');
      await sheet.getByRole('button', { name: 'Copy to today' }).click();
      expect(calls.copied).toEqual([{ ids: ['y1', 'y2'], eaten_at: '2026-10-17T17:00:00.000Z' }]);
      await expect(page.getByTestId('toast')).toHaveText('Copied 2 items.');
      // The originals stay on the 16th.
      await expect(block(page, '12:30 PM').getByTestId('entry-card')).toHaveCount(2);
    });
  });
}

test.describe('desktop only', () => {
  test.use({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });

  test('dragging a card onto another block moves it there', async ({ page }) => {
    const calls = await open(page);
    await card(page, 'Banana').dragTo(block(page, '7 PM'));
    expect(calls.moved).toEqual([{ ids: ['ref-4'], eaten_at: '2026-10-17T23:00:00Z' }]);
    await expect(block(page, '4 PM').getByTestId('chip-kcal')).toHaveText('1,668 kcal');
    await expect(block(page, '7 PM').getByTestId('chip-kcal')).toHaveText('202 kcal');
  });

  test('hovering a card shows delete', async ({ page }) => {
    const calls = await open(page);
    await card(page, 'Banana').hover();
    await page.getByRole('button', { name: 'Delete Banana' }).click();
    expect(calls.deleted).toEqual(['ref-4']);
  });

  test('the edit sheet is a side panel on the right', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await page.getByRole('button', { name: 'Edit Banana' }).click();
    const box = await page.getByTestId('edit-sheet').boundingBox();
    expect(box?.x).toBeGreaterThan(800);
    expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(1280);
    expect(Math.round(box?.height ?? 0)).toBe(900);
  });
});

test('phone: the edit sheet comes up from the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.getByRole('button', { name: 'Edit Banana' }).click();
  const box = await page.getByTestId('edit-sheet').boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(375);
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(812);
  await noHorizontalScroll(page);
});
