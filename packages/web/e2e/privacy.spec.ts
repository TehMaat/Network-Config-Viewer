import { expect, test } from '@playwright/test';
import { fileItem, gotoApp, loadFiles, openApp, openConfigTab, samplePath } from './helpers';

test('sends the security policy that blocks connections to other sites', async ({ page }) => {
  const response = await gotoApp(page);
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
  // Every view of the firewall and of the switch, then the config.
  for (const name of [
    'fgt-campus-200f-fortios-7.6.conf',
    'sw-hq-core-c9300-iosxe-17.12-stack.txt',
  ]) {
    await fileItem(page, name).click();
    const tabs = page.locator('[data-testid^="tab-"]');
    for (let i = 0; i < (await tabs.count()); i++) await tabs.nth(i).click();
  }
  // The Excel file is made in the page: nothing is fetched from outside.
  await Promise.all([page.waitForEvent('download'), page.getByTestId('btn-export-device').click()]);
  // The map, loaded only now with its libraries, and the detail of a link (#15).
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await page.getByTestId('row-links').first().click();
  await expect(page.getByTestId('map-link-panel')).toBeVisible();
  await Promise.all([page.waitForEvent('download'), page.getByTestId('export-links').click()]);
  // The problems between the devices and the VPN of the client (#15, part 2).
  await Promise.all([page.waitForEvent('download'), page.getByTestId('export-problems').click()]);
  // The map as draw.io, PNG and SVG, made in the page (#15, part 3).
  await page.getByTestId('nav-map').click();
  for (const kind of ['drawio', 'png', 'svg']) {
    await page.getByTestId('btn-map-export').click();
    await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(`btn-export-${kind}`).click(),
    ]);
  }
  await page.getByTestId('nav-vpn').click();
  await page.getByTestId('row-vpn-tunnels').first().click();
  await expect(page.getByTestId('vpn-panel').getByTestId('map-link-panel')).toBeVisible();
  await fileItem(page, 'fgt-campus-200f-fortios-7.6.conf').click();
  await openConfigTab(page);
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
