import { defineConfig, devices } from '@playwright/test';

// NCV_BASE_URL points to an app that is already running (for example the Docker container
// in CI). Without it, the tests start "vite preview", which sends the same security headers.
const external = process.env.NCV_BASE_URL;
const baseURL = external ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'off',
    locale: 'it-IT',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        locale: 'it-IT',
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: 'npm run preview',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
