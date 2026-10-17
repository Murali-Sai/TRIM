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
  await page.route('**/api/me', (route) => {
    const current = typeof me === 'function' ? me() : me;
    return current
      ? route.fulfill({ json: current })
      : route.fulfill({ status: 401, json: { detail: 'Not signed in' } });
  });
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  );
}
