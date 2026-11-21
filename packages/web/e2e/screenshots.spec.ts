import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { loadFiles, openApp, samplePath, selectFile } from './helpers';

// Screenshots for the documentation, made only from the synthetic samples.
// Run with: NCV_SCREENSHOTS=1 npm run test:e2e -- screenshots
const DOCS_IMG = fileURLToPath(new URL('../../../docs/img/', import.meta.url));

test.skip(!process.env.NCV_SCREENSHOTS, 'only when updating the documentation');
test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

const files = [
  'fortigate/fgt-hq-100f-fortios-7.2-vdom.conf',
  'fortigate/fgt-br1-60f-fortios-7.0.conf',
  'cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt',
  'cisco-sb/sw-br3-acc-cbs350-48p-3.4-stack.txt',
  'show/sw-hq-core_show-version.txt',
];

// Every screenshot in the light theme, and again in the dark one with the "-scuro" suffix.
for (const [colorScheme, suffix] of [
  ['light', ''],
  ['dark', '-scuro'],
] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test('FortiGate policies', async ({ page }) => {
      await openApp(page);
      await loadFiles(page, files.map(samplePath), files.length);
      await selectFile(page, 'fgt-hq-100f-fortios-7.2-vdom.conf');
      await page.getByTestId('tab-policies').click();
      await page.getByTestId('policy-ip-search').fill('10.10.100.25');
      await expect(
        page.locator('[data-testid="row-policies"][data-state="match"]').first(),
      ).toBeVisible();
      await page.locator('[data-testid="row-policies"][data-id="6"]').click();
      await expect(page.getByTestId('policy-detail')).toBeVisible();
      await page.screenshot({ path: `${DOCS_IMG}app-fortigate${suffix}.png` });
    });

    test('Cisco stack', async ({ page }) => {
      await openApp(page);
      await loadFiles(page, files.map(samplePath), files.length);
      await selectFile(page, 'sw-hq-core-c9300-iosxe-17.12-stack.txt');
      await page.getByTestId('tab-ports').click();
      await page.locator('[data-testid="port"][data-name="TenGigabitEthernet1/1/1"]').click();
      await expect(page.getByTestId('port-detail')).toBeVisible();
      await page.screenshot({ path: `${DOCS_IMG}app-cisco${suffix}.png` });
    });

    test('real state of a switch', async ({ page }) => {
      const withShows = [
        'cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt',
        'show/sw-hq-core_sessione.txt',
        'show/sw-hq-core_show-cdp-lldp-neighbors.txt',
      ];
      await openApp(page);
      await loadFiles(page, withShows.map(samplePath), withShows.length);
      await selectFile(page, 'sw-hq-core-c9300-iosxe-17.12-stack.txt');
      await page.getByTestId('tab-ports').click();
      await page.locator('[data-testid="port"][data-name="GigabitEthernet1/0/25"]').click();
      await expect(page.getByTestId('port-macs')).toBeVisible();
      await page.getByTestId('port-detail').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DOCS_IMG}app-stato${suffix}.png` });
    });

    test('linked config', async ({ page }) => {
      await openApp(page);
      await loadFiles(page, files.map(samplePath), files.length);
      await selectFile(page, 'sw-hq-core-c9300-iosxe-17.12-stack.txt');
      await page.getByTestId('tab-ports').click();
      await page.getByTestId('filter-ports').fill('Vlan70');
      await page.locator('[data-testid="row-ports"][data-id="Vlan70"]').click();
      await page.getByTestId('port-source').click();
      await expect(page.locator('.ncv-ref').first()).toBeVisible();
      await expect(page.locator('.ncv-line-unknown').first()).toBeVisible();
      // Syntax highlighting is applied right after scrolling: wait for the coloured tokens.
      await expect(page.locator('.cm-line span:not(.ncv-ref)').first()).toBeVisible();
      await page.screenshot({ path: `${DOCS_IMG}app-config${suffix}.png` });
    });

    test('start page', async ({ page }) => {
      await page.setViewportSize({ width: 1200, height: 700 });
      await openApp(page);
      await page.screenshot({ path: `${DOCS_IMG}app-avvio${suffix}.png` });
    });
  });
}
