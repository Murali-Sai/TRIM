import { expect, test, type Locator } from '@playwright/test';
import { stubExternal } from './fixtures';
import { COLOR_SCHEMES } from './viewports';

const FULL_FORM = 'Track, Record, Inspect, Measure';

// The 1.2b acceptance widths: 360 is the narrowest supported phone.
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
});

interface Measured {
  fontSize: number;
  lines: number;
  overflows: boolean;
  contrast: number;
}

/** Font size, rendered line count, clipping and WCAG contrast against the nearest painted background. */
async function measure(el: Locator): Promise<Measured> {
  return el.evaluate((node) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r = 0, g = 0, b = 0]: number[]) => {
      const ch = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    let bgEl: Element | null = node;
    let bg = 'rgba(0, 0, 0, 0)';
    while (bgEl) {
      const c = getComputedStyle(bgEl).backgroundColor;
      const alpha = parse(c)[3];
      if (alpha === undefined || alpha > 0) {
        bg = c;
        break;
      }
      bgEl = bgEl.parentElement;
    }
    const style = getComputedStyle(node);
    const range = document.createRange();
    range.selectNodeContents(node);
    const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
    const fg = lum(parse(style.color));
    const back = lum(parse(bg));
    const rect = node.getBoundingClientRect();
    return {
      fontSize: parseFloat(style.fontSize),
      lines: tops.size,
      overflows:
        node.scrollWidth > node.clientWidth + 1 ||
        rect.right > document.documentElement.clientWidth + 1,
      contrast: (Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05),
    };
  });
}

async function expectTitleBlock(block: Locator, titlePx: number, fullFormPx: number) {
  await expect(block).toBeVisible();
  // Measure with the real web font, not a fallback that is swapped out later.
  await block.page().evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await block.page().evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(
    true,
  );
  const title = block.getByRole('heading', { level: 1, name: 'TRIM' });
  const fullForm = block.getByText(FULL_FORM, { exact: true });
  await expect(title).toBeVisible();
  await expect(fullForm).toBeVisible();

  const t = await measure(title);
  const f = await measure(fullForm);
  expect(t.fontSize).toBe(titlePx);
  expect(f.fontSize).toBe(fullFormPx);
  expect(f.lines).toBe(1);
  expect(f.overflows).toBe(false);
  expect(t.overflows).toBe(false);
  // WCAG AA: 4.5:1 for small text, 3:1 for large text.
  expect(f.contrast).toBeGreaterThanOrEqual(4.5);
  expect(t.contrast).toBeGreaterThanOrEqual(titlePx >= 24 ? 3 : 4.5);
}

for (const vp of WIDTHS) {
  for (const scheme of COLOR_SCHEMES) {
    test.describe(`${vp.width}px ${scheme}`, () => {
      test.use({ viewport: vp, colorScheme: scheme });

      test('app pages show the title block', async ({ page }) => {
        await page.goto('/');
        if (vp.width < 1024) {
          await expectTitleBlock(page.getByTestId('title-block-header'), 20, 11);
          await expect(page.getByTestId('title-block-sidebar')).toBeHidden();
        } else {
          await expectTitleBlock(page.getByTestId('title-block-sidebar'), 24, 12);
          await expect(page.getByTestId('title-block-header')).toBeHidden();
        }
      });

      for (const route of ['/welcome', '/signup', '/login']) {
        test(`${route} shows the centered title block`, async ({ page }) => {
          await page.goto(route);
          const block = page.getByTestId('title-block-auth');
          await expectTitleBlock(block, 40, 16);
          const box = await block.boundingBox();
          const center = (box?.x ?? 0) + (box?.width ?? 0) / 2;
          expect(Math.abs(center - vp.width / 2)).toBeLessThanOrEqual(2);
        });
      }
    });
  }
}

test('a single title block is announced on each page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

test('page titles', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page).toHaveTitle('TRIM: Track, Record, Inspect, Measure');
  await page.goto('/');
  await expect(page).toHaveTitle('Today, TRIM');
  await page.goto('/account');
  await expect(page).toHaveTitle('Account, TRIM');
});

test('install names', async ({ page, request }) => {
  await page.goto('/welcome');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'TRIM',
  );
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = (await (await request.get(href ?? '')).json()) as Record<string, unknown>;
  expect(manifest.name).toBe('TRIM: Track, Record, Inspect, Measure');
  expect(manifest.short_name).toBe('TRIM');
  for (const icon of ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']) {
    expect((await request.get(icon)).ok()).toBe(true);
  }
});
