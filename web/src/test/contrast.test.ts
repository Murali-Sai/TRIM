import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guards design-system/MASTER.md: every text token meets WCAG 2.2 AA (4.5:1) on the surfaces
// it sits on, in both themes. Reads the real tokens from index.css (tests run from web/).

const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing ${selector}`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r ?? 0) + 0.7152 * f(g ?? 0) + 0.0722 * f(b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const dark = block(':root');
const light = { ...dark, ...block(":root[data-theme='light']") };
const system = { ...dark, ...block(":root[data-theme='system']") };

const TEXT = [
  'text',
  'text-secondary',
  'accent',
  'error',
  'kcal-text',
  'protein-text',
  'fat-text',
  'carbs-text',
];

describe.each([
  ['dark (default)', dark],
  ['light', light],
])('%s theme', (_, t) => {
  test.each(TEXT)('%s meets 4.5:1 on surface and surface-2', (name) => {
    for (const bg of ['surface', 'surface-2', 'bg']) {
      expect(contrast(t[name] ?? '', t[bg] ?? ''), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('button text meets 4.5:1 on the accent', () => {
    expect(contrast(t['accent-contrast'] ?? '', t.accent ?? '')).toBeGreaterThanOrEqual(4.5);
  });
});

test('Match device on a light device uses exactly the light tokens', () => {
  expect(system).toEqual(light);
});

test('bars keep the exact Okabe-Ito colors in both themes', () => {
  for (const t of [dark, light]) {
    expect([t.kcal, t.protein, t.fat, t.carbs]).toEqual([
      '#56b4e9',
      '#d55e00',
      '#e69f00',
      '#009e73',
    ]);
  }
});
