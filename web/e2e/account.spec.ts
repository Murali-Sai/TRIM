import { expect, test, type Page } from '@playwright/test';
import { ME, stubExternal, type MeState } from './fixtures';

const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

const PHONE_SESSION = {
  id: 'session-phone',
  created_at: '2026-10-10T08:00:00Z',
  last_seen_at: '2026-10-16T20:00:00Z',
  user_agent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  persistent: true,
  current: false,
};
const THIS_SESSION = {
  id: 'session-this',
  created_at: '2026-10-17T12:00:00Z',
  last_seen_at: '2026-10-17T12:00:00Z',
  user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36',
  persistent: true,
  current: true,
};

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, locale: 'en-US' });

    test('shows every section without sideways scrolling', async ({ page }) => {
      await stubExternal(page);
      await page.goto('/account');
      for (const name of ['Profile', 'Appearance', 'Devices', 'Password', 'Delete account']) {
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      }
      await expect(page.getByText(ME.email)).toBeVisible();
      await noHorizontalScroll(page);
      const profile = await page.getByRole('heading', { name: 'Profile' }).boundingBox();
      const password = await page.getByRole('heading', { name: 'Password' }).boundingBox();
      if (vp.width >= 1024) {
        expect(password?.x ?? 0).toBeGreaterThan((profile?.x ?? 0) + 200); // two columns
      } else {
        expect(password?.y ?? 0).toBeGreaterThan(profile?.y ?? 0); // stacked
      }
    });

    test('saves the profile', async ({ page }) => {
      await stubExternal(page);
      let sent: unknown = null;
      await page.route('**/api/me/profile', async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({
          json: {
            display_name: 'Sam R',
            timezone: 'Asia/Tokyo',
            unit_system: 'metric',
            theme: 'system',
          },
        });
      });
      await page.goto('/account');
      await page.getByLabel('Name').fill('Sam R');
      await page.getByLabel('Timezone').selectOption('Asia/Tokyo');
      await page.getByText('Metric (kg, cm)').click();
      await page.getByRole('button', { name: 'Save profile' }).click();
      await expect(page.getByText('Profile saved.')).toBeVisible();
      expect(sent).toEqual({
        display_name: 'Sam R',
        timezone: 'Asia/Tokyo',
        unit_system: 'metric',
      });
    });

    test('changes the password', async ({ page }) => {
      await stubExternal(page);
      let sent: unknown = null;
      let csrf: string | undefined;
      await page.route('**/api/me/password', async (route) => {
        sent = route.request().postDataJSON();
        csrf = route.request().headers()['x-csrf-token'];
        await route.fulfill({ json: { status: 'password_changed' } });
      });
      await page.goto('/account');
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(page.getByText('Enter your current password.')).toBeVisible();
      await page.getByLabel('Current password').fill('correct horse battery');
      await page.getByLabel('New password').fill('a brand new passphrase');
      await page.getByLabel('Type it again').fill('a brand new passphrase');
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(
        page.getByText('Password changed. Your other devices are signed out.'),
      ).toBeVisible();
      expect(sent).toEqual({
        current_password: 'correct horse battery',
        new_password: 'a brand new passphrase',
        keep_signed_in: true,
      });
      expect(csrf).toBe('csrf-test-token');
    });

    test('shows the wrong-password message', async ({ page }) => {
      await stubExternal(page);
      await page.route('**/api/me/password', (route) =>
        route.fulfill({ status: 403, json: { detail: 'That password is not right.' } }),
      );
      await page.goto('/account');
      await page.getByLabel('Current password').fill('nope');
      await page.getByLabel('New password').fill('a brand new passphrase');
      await page.getByLabel('Type it again').fill('a brand new passphrase');
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(page.getByRole('alert')).toHaveText('That password is not right.');
    });

    test('lists devices and signs one out', async ({ page }) => {
      await stubExternal(page);
      let sessions = [THIS_SESSION, PHONE_SESSION];
      let revoked: string | null = null;
      await page.route('**/api/me/sessions', (route) => route.fulfill({ json: sessions }));
      await page.route('**/api/me/sessions/*', async (route) => {
        revoked = route.request().url().split('/').pop() ?? null;
        sessions = [THIS_SESSION];
        await route.fulfill({ status: 204, body: '' });
      });
      await page.goto('/account');
      const devices = page.getByTestId('devices');
      await expect(devices.getByText('Chrome on Windows')).toBeVisible();
      await expect(devices.getByText('This device')).toBeVisible();
      await expect(devices.getByText('Safari on iPhone')).toBeVisible();
      await devices.getByRole('button', { name: 'Sign out Safari on iPhone' }).click();
      await expect(devices.getByText('Safari on iPhone')).toHaveCount(0);
      expect(revoked).toBe('session-phone');
      await expect(devices.getByRole('button', { name: 'Sign out everywhere else' })).toHaveCount(
        0,
      );
    });

    test('deleting needs the password and the word DELETE', async ({ page }) => {
      let me: MeState = ME;
      await stubExternal(page, () => me);
      let sent: unknown = null;
      await page.route('**/api/me', async (route) => {
        if (route.request().method() === 'DELETE') {
          sent = route.request().postDataJSON();
          me = null;
          return route.fulfill({ status: 204, body: '' });
        }
        return route.fallback();
      });
      await page.goto('/account');
      const section = page.getByTestId('delete-account');
      await section.getByRole('button', { name: 'Delete account' }).click();
      const confirm = section.getByRole('button', { name: 'Delete my account' });
      await expect(confirm).toBeDisabled();
      await section.getByLabel('Your password').fill('correct horse battery');
      await section.getByLabel('Type DELETE to confirm').fill('delete');
      await expect(confirm).toBeDisabled();
      await section.getByLabel('Type DELETE to confirm').fill('DELETE');
      await expect(confirm).toBeEnabled();
      await noHorizontalScroll(page);
      await confirm.click();
      await expect(page).toHaveURL(/\/welcome$/);
      expect(sent).toEqual({ password: 'correct horse battery', confirm: 'DELETE' });
    });
  });
}
