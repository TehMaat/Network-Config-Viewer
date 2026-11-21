import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// NCV_BASE_URL points to an app that is already running (for example the Docker container
// in CI). Without it, the tests start the server of the app on the build ("npm run build"
// first), with an empty archive in a temporary folder.
const external = process.env.NCV_BASE_URL;
const baseURL = external ?? 'http://127.0.0.1:4173';
// The workers read this file again: the folder is chosen once, by the main process.
process.env.NCV_E2E_DATA ??= mkdtempSync(join(tmpdir(), 'ncv-e2e-'));

const viewport = { width: 1440, height: 900 };

// Chromium always; with NCV_ALL_BROWSERS=1 (as in CI) also Firefox and WebKit, the engine
// of Safari.
const browsers = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'], locale: 'it-IT', viewport } },
  ...(process.env.NCV_ALL_BROWSERS
    ? [
        { name: 'firefox', use: { ...devices['Desktop Firefox'], locale: 'it-IT', viewport } },
        { name: 'webkit', use: { ...devices['Desktop Safari'], locale: 'it-IT', viewport } },
      ]
    : []),
];

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
  projects: browsers,
  webServer: external
    ? undefined
    : {
        command: 'node ../server/dist/main.js',
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
          HOST: '127.0.0.1',
          PORT: '4173',
          NCV_DATA_DIR: process.env.NCV_E2E_DATA,
          NCV_WEB_DIR: 'dist',
        },
      },
});
