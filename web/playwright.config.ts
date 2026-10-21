import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  // Visual regression runs on its own, in a pinned image (playwright.visual.config.ts).
  testIgnore: '**/*.visual.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Safari's engine for the flows SPEC page 5 names: sign up to first log, password reset,
    // custom metric to chart, and export.
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: ['signup.spec.ts', 'reset.spec.ts', 'measurements.spec.ts', 'export.spec.ts'],
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
