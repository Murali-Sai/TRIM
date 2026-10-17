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

export async function stubExternal(page: Page) {
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  );
}
