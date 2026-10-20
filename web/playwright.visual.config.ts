import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Visual regression only. Baselines are made and checked inside
 * mcr.microsoft.com/playwright:v1.61.1-noble (keep it in step with @playwright/test), so text
 * and anti-aliasing match on every machine:
 *
 *   docker run --rm --ipc=host -v "$PWD/..":/work -w /work/web \
 *     mcr.microsoft.com/playwright:v1.61.1-noble npm run e2e:visual:update
 */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/*.visual.spec.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
});
