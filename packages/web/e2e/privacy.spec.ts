import { expect, test } from '@playwright/test';
import { loadFiles, openApp, samplePath } from './helpers';

test('sends the security policy that blocks connections to other sites', async ({ page }) => {
  const response = await page.goto('/');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/https?:/);
  expect(response?.headers()['x-content-type-options']).toBe('nosniff');
});

test('never contacts another site, and cannot', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'))
      foreign.push(url);
  });

  await openApp(page);
  await loadFiles(
    page,
    [
      samplePath('fortigate/fgt-campus-200f-fortios-7.6.conf'),
      samplePath('cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt'),
      samplePath('show/fgt-hq_get-system-status.txt'),
    ],
    3,
  );
  await page.getByTestId('btn-search').click();
  await page.getByTestId('language-switch').getByText('EN').click();

  // Even code running in the page cannot reach the network: the browser blocks it.
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
  expect(foreign).toEqual([]);
});
