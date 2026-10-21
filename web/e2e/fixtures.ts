import type { Page } from '@playwright/test';

/** Stand-in for Cloudflare's script: renders nothing and hands back the dummy test token. */
const TURNSTILE_STUB = `
(() => {
  let opts = null;
  const issue = () => setTimeout(() => opts && opts.callback('XXXX.DUMMY.TOKEN.XXXX'), 0);
  window.turnstile = {
    render(el, o) { opts = o; el.dataset.rendered = 'yes'; issue(); return 'w1'; },
    reset() { issue(); },
    remove() { opts = null; },
  };
})();
`;

export const ME = {
  email: 'sam@example.com',
  display_name: 'Sam',
  timezone: 'America/New_York',
  unit_system: 'imperial',
  theme: 'system',
  email_verified: true,
  verify_deadline: null as string | null,
  verify_required: false,
  setup: 'done' as 'body_stats' | 'targets' | 'done',
};

export type MeState = typeof ME | null;

/**
 * Stubs the API and third parties. `me` is the signed-in user (null for signed out); pass a
 * function to change it during a test, for example after logging in.
 */
export async function stubExternal(page: Page, me: MeState | (() => MeState) = ME) {
  await page
    .context()
    .addCookies([{ name: 'trim_csrf', value: 'csrf-test-token', domain: '127.0.0.1', path: '/' }]);
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  // No diet phases unless a test adds its own route (later routes win).
  await page.route('**/api/phases**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/checkins**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/me', (route) => {
    const current = typeof me === 'function' ? me() : me;
    return current
      ? route.fulfill({ json: current })
      : route.fulfill({ status: 401, json: { detail: 'Not signed in' } });
  });
  await page.route('**/api/me/sessions', (route) =>
    route.fulfill({
      json: [
        {
          id: 'session-this',
          created_at: '2026-10-17T12:00:00Z',
          last_seen_at: '2026-10-17T12:00:00Z',
          user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36',
          persistent: true,
          current: true,
        },
      ],
    }),
  );
  await page.route('**/api/me/profile', (route) =>
    route.fulfill({
      json: {
        display_name: ME.display_name,
        timezone: ME.timezone,
        unit_system: 'imperial',
        theme: 'system',
      },
    }),
  );
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  );
}
