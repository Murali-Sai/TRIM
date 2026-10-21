import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal } from './fixtures';

// Task 3.18: streak reminder opt-in. The browser's Push API is faked: CI cannot receive real
// pushes. Delivery on desktop Chrome and on an iPhone Home Screen install is checked by hand.

const FAKE_PUSH = `
(() => {
  const sub = {
    endpoint: 'https://push.example.com/e2e',
    getKey: () => new Uint8Array([1, 2, 3]).buffer,
    unsubscribe: async () => true,
  };
  let subscribed = null;
  const pushManager = {
    getSubscription: async () => subscribed,
    subscribe: async () => (subscribed = sub),
  };
  const reg = { pushManager };
  window.PushManager = function () {};
  window.Notification = { requestPermission: async () => window.__permission || 'granted' };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: async () => reg, getRegistration: async () => reg },
  });
})();
`;

interface Calls {
  settings: Record<string, unknown>[];
  subscribed: unknown[];
  removed: string[];
}

async function open(page: Page, opts: { key?: string | null; permission?: string } = {}) {
  const calls: Calls = { settings: [], subscribed: [], removed: [] };
  let settings: Record<string, unknown> = {
    track_water: false,
    track_fiber: true,
    water_unit: 'ml',
    gamification: true,
    streak_reminder: null,
  };
  await page.addInitScript(FAKE_PUSH);
  if (opts.permission) {
    await page.addInitScript(
      (p) => ((window as unknown as Record<string, unknown>).__permission = p),
      opts.permission,
    );
  }
  await stubExternal(page, ME);
  await page.route('**/api/me/settings', (r) => {
    if (r.request().method() === 'PATCH') {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      calls.settings.push(body);
      settings = { ...settings, ...body };
    }
    return r.fulfill({ json: settings });
  });
  await page.route('**/api/push/config', (r) =>
    r.fulfill({ json: { public_key: opts.key === undefined ? 'AQID' : opts.key } }),
  );
  await page.route('**/api/push/subscriptions**', (r) => {
    if (r.request().method() === 'POST') calls.subscribed.push(r.request().postDataJSON());
    else calls.removed.push(new URL(r.request().url()).searchParams.get('endpoint') ?? '');
    return r.fulfill({ status: 204, body: '' });
  });
  await page.goto('/account');
  return calls;
}

for (const vp of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('turning reminders on subscribes this browser at 20:00; off removes it', async ({
      page,
    }) => {
      const calls = await open(page);
      const toggle = page.getByRole('switch', { name: 'Streak reminder' });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(() => calls.subscribed)
        .toEqual([
          { endpoint: 'https://push.example.com/e2e', keys: { p256dh: 'AQID', auth: 'AQID' } },
        ]);
      await expect.poll(() => calls.settings).toEqual([{ streak_reminder: '20:00' }]);

      await page.getByLabel('Remind me at').fill('07:30');
      await expect.poll(() => calls.settings.at(-1)).toEqual({ streak_reminder: '07:30' });

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect.poll(() => calls.removed).toEqual(['https://push.example.com/e2e']);
      await expect.poll(() => calls.settings.at(-1)).toEqual({ streak_reminder: null });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('blocked notifications say how to fix it', async ({ page }) => {
      const calls = await open(page, { permission: 'denied' });
      await page.getByRole('switch', { name: 'Streak reminder' }).click();
      await expect(page.getByTestId('reminder-controls')).toContainText(
        'Notifications are blocked for TRIM.',
      );
      expect(calls.subscribed).toEqual([]);
    });

    test('a server without push keys says so', async ({ page }) => {
      await open(page, { key: null });
      await page.getByRole('switch', { name: 'Streak reminder' }).click();
      await expect(page.getByTestId('reminder-controls')).toContainText(
        'Reminders are not set up on this server yet.',
      );
    });
  });
}

test.describe('iPhone outside the Home Screen', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  });

  test('explains Add to Home Screen and keeps the switch off', async ({ page }) => {
    await stubExternal(page, ME);
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).PushManager;
    });
    await page.route('**/api/me/settings', (r) =>
      r.fulfill({
        json: {
          track_water: false,
          track_fiber: true,
          water_unit: 'ml',
          gamification: true,
          streak_reminder: null,
        },
      }),
    );
    await page.goto('/account');
    await expect(page.getByTestId('reminder-controls')).toContainText(
      'add TRIM to your Home Screen',
    );
    await expect(page.getByRole('switch', { name: 'Streak reminder' })).toBeDisabled();
  });
});
