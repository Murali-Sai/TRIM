import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 4.5: diet phases. AC: an overlapping phase is rejected (the API test proves the server
// rule; here the page shows its message) and targets are unchanged unless the separate "Also
// update targets" button is pressed. Chart tints and the toggle: e2e/measurements.spec.ts.

const NOW = new Date('2026-10-17T23:07:00Z');

type Phase = {
  id: string;
  kind: string;
  label: string | null;
  name: string;
  start_date: string;
  end_date: string | null;
  note: string | null;
  status: string;
  summary: unknown;
};

const SUMMARY = {
  days: 28,
  logged_days: 24,
  avg_kcal: 1948,
  avg_target_kcal: 2000,
  days_on_target: 18,
  weight: { start_kg: 80, end_kg: 78.8, change_kg: -1.2, weekly_kg: -0.31 },
  measurements: [
    { type_id: 'w', name: 'Waist', side: null, unit: 'cm', start: 90, end: 87.3, change: -2.7 },
  ],
};

const NAMES: Record<string, string> = { cut: 'Cut', maintain: 'Maintain', bulk: 'Bulk' };

interface Calls {
  posts: unknown[];
  patches: unknown[];
  deletes: string[];
  targetWrites: string[];
}

async function open(page: Page, phases: Phase[] = []): Promise<Calls> {
  const calls: Calls = { posts: [], patches: [], deletes: [], targetWrites: [] };
  await page.clock.setFixedTime(NOW);
  await stubExternal(page, { ...ME, unit_system: 'metric' });
  page.on('request', (r) => {
    if (r.url().includes('/api/targets') && r.method() !== 'GET') calls.targetWrites.push(r.url());
  });
  await page.route('**/api/phases**', async (r) => {
    const req = r.request();
    const method = req.method();
    if (method === 'POST') {
      const body = req.postDataJSON() as Phase & { end_current?: boolean };
      calls.posts.push(body);
      if (
        phases.some(
          (p) =>
            p.start_date <= body.start_date &&
            (p.end_date ?? '9999') >= body.start_date &&
            !body.end_current,
        )
      ) {
        return r.fulfill({
          status: 422,
          json: {
            detail: 'This overlaps your Cut from 1 Sep 2026 to 28 Sep 2026. Phases cannot overlap.',
          },
        });
      }
      const made: Phase = {
        ...body,
        id: `p${phases.length + 1}`,
        name: body.label ?? NAMES[body.kind] ?? 'Phase',
        status: body.end_date && body.end_date < '2026-10-17' ? 'ended' : 'ongoing',
        summary: SUMMARY,
        note: body.note ?? null,
        end_date: body.end_date ?? null,
        label: body.label ?? null,
      };
      phases.unshift(made);
      return r.fulfill({ status: 201, json: made });
    }
    const id = new URL(req.url()).pathname.split('/').pop() ?? '';
    if (method === 'PATCH') {
      const body = req.postDataJSON() as Partial<Phase>;
      calls.patches.push({ id, body });
      const i = phases.findIndex((p) => p.id === id);
      const next = { ...phases[i], ...body } as Phase;
      next.name = next.label ?? NAMES[next.kind] ?? 'Phase';
      phases[i] = next;
      return r.fulfill({ json: next });
    }
    if (method === 'DELETE') {
      calls.deletes.push(id);
      phases.splice(
        phases.findIndex((p) => p.id === id),
        1,
      );
      return r.fulfill({ status: 204 });
    }
    return r.fulfill({ json: phases });
  });
  await page.goto('/phases');
  return calls;
}

const cut = (): Phase => ({
  id: 'cut',
  kind: 'cut',
  label: null,
  name: 'Cut',
  start_date: '2026-09-01',
  end_date: '2026-09-28',
  note: 'Before the trip',
  status: 'ended',
  summary: SUMMARY,
});

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
    const list = vp.width < 1024 ? 'phase-card' : 'phase-row';

    test('empty state, then add a phase without touching targets', async ({ page }) => {
      const calls = await open(page);
      await expect(page.getByTestId('phases-empty')).toContainText('No phases yet');
      await page.getByRole('button', { name: 'New phase' }).click();
      const sheet = page.getByTestId('phase-sheet');
      await sheet.getByLabel('Bulk').check();
      await sheet.getByLabel('Start').fill('2026-10-01');
      await sheet.getByLabel('Note (optional)').fill('Strength block');
      await sheet.getByRole('button', { name: 'Add phase' }).click();
      await expect(sheet).toContainText('Your targets have not changed.');
      expect(calls.posts).toEqual([
        {
          kind: 'bulk',
          label: null,
          start_date: '2026-10-01',
          end_date: null,
          note: 'Strength block',
        },
      ]);
      await expect(sheet.getByRole('link', { name: 'Also update targets' })).toHaveAttribute(
        'href',
        '/targets',
      );
      await sheet.getByRole('button', { name: 'Done' }).click();
      await expect(sheet).toBeHidden();
      const row = page.getByTestId(list);
      await expect(row).toContainText('Bulk');
      await expect(row).toContainText('1 Oct 2026 to now');
      await expect(row).toContainText('Avg 1,948 kcal, target 2,000');
      expect(calls.targetWrites).toEqual([]);
      await noSideScroll(page);
    });

    test('AC: an overlapping phase is rejected with a clear message', async ({ page }) => {
      const calls = await open(page, [cut()]);
      await page.getByRole('button', { name: 'New phase' }).click();
      const sheet = page.getByTestId('phase-sheet');
      await sheet.getByLabel('Maintain').check();
      await sheet.getByLabel('Start').fill('2026-09-20');
      await sheet.getByRole('button', { name: 'Add phase' }).click();
      await expect(sheet.getByRole('alert')).toHaveText(
        'This overlaps your Cut from 1 Sep 2026 to 28 Sep 2026. Phases cannot overlap.',
      );
      await expect(page.getByTestId(list)).toHaveCount(1);
      expect(calls.targetWrites).toEqual([]);
    });

    test('a summary, an edit and a delete', async ({ page }) => {
      const calls = await open(page, [cut()]);
      const row = page.getByTestId(list);
      await expect(row).toContainText('1 Sep to 28 Sep 2026');
      await expect(row).toContainText('Ended');
      await expect(row).toContainText('18 of 24 logged days');
      await expect(row).toContainText('down 1.2 kg, 0.31 kg a week');
      await expect(row).toContainText('down 2.7 cm');
      await expect(row).toContainText('Before the trip');

      await row.getByRole('button', { name: 'Edit Cut' }).click();
      const sheet = page.getByTestId('phase-sheet');
      await sheet.getByLabel('Your own name').check();
      await sheet.getByRole('button', { name: 'Save' }).click();
      await expect(sheet.getByRole('alert')).toHaveText('Give your phase a name.');
      await sheet.getByLabel('Name', { exact: true }).fill('Summer cut');
      await sheet.getByRole('button', { name: 'Save' }).click();
      await expect(sheet).toContainText('Your targets have not changed.');
      expect(calls.patches).toEqual([
        {
          id: 'cut',
          body: {
            kind: 'custom',
            label: 'Summer cut',
            start_date: '2026-09-01',
            end_date: '2026-09-28',
            note: 'Before the trip',
          },
        },
      ]);
      await sheet.getByRole('button', { name: 'Done' }).click();
      await expect(row).toContainText('Summer cut');

      await row.getByRole('button', { name: 'Edit Summer cut' }).click();
      await sheet.getByRole('button', { name: 'Delete Summer cut' }).click();
      await sheet.getByRole('button', { name: 'Delete phase' }).click();
      await expect(sheet).toBeHidden();
      expect(calls.deletes).toEqual(['cut']);
      await expect(page.getByTestId('phases-empty')).toBeVisible();
      expect(calls.targetWrites).toEqual([]);
    });

    test('a new phase can end the one still going', async ({ page }) => {
      const going = { ...cut(), end_date: null, status: 'ongoing', note: null };
      const calls = await open(page, [going]);
      await page.getByRole('button', { name: 'New phase' }).click();
      const sheet = page.getByTestId('phase-sheet');
      await sheet.getByLabel('Maintain').check();
      await sheet.getByLabel('Start').fill('2026-10-05');
      await expect(sheet.getByLabel('End your Cut on 4 Oct')).toBeChecked();
      await sheet.getByRole('button', { name: 'Add phase' }).click();
      await expect(sheet).toContainText('Your targets have not changed.');
      expect(calls.posts).toEqual([
        {
          kind: 'maintain',
          label: null,
          start_date: '2026-10-05',
          end_date: null,
          note: null,
          end_current: true,
        },
      ]);
    });

    test('Progress links to the phases', async ({ page }) => {
      await open(page);
      await page.goto('/charts');
      await page.getByRole('link', { name: 'Diet phases' }).click();
      await expect(page.getByRole('heading', { name: 'Diet phases' })).toBeVisible();
    });
  });
}
