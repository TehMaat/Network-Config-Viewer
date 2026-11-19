import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { field, loadFiles, openApp, samplePath, selectFile } from './helpers';

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

    test('FortiGate with VDOMs', async ({ page }) => {
      await openApp(page);
      await loadFiles(page, files.map(samplePath), files.length);
      await selectFile(page, 'fgt-hq-100f-fortios-7.2-vdom.conf');
      await expect(field(page, 'vdoms')).toBeVisible();
      await page.getByTestId('outline').locator('[data-testid="outline-entry"]').nth(4).click();
      await expect(page.locator('.cm-activeLine span').first()).toBeVisible();
      await page.screenshot({ path: `${DOCS_IMG}app-fortigate${suffix}.png` });
    });

    test('Cisco stack', async ({ page }) => {
      await openApp(page);
      await loadFiles(page, files.map(samplePath), files.length);
      await selectFile(page, 'sw-hq-core-c9300-iosxe-17.12-stack.txt');
      await page.getByTestId('outline').getByRole('textbox').fill('Port-channel');
      await expect(page.getByTestId('outline-entry')).toHaveCount(3);
      await page.getByTestId('outline-entry').first().click();
      await expect(page.locator('.cm-activeLine')).toHaveText('interface Port-channel1');
      // Highlighting is applied right after scrolling: wait for the coloured tokens.
      await expect(page.locator('.cm-activeLine span').first()).toBeVisible();
      await page.screenshot({ path: `${DOCS_IMG}app-cisco${suffix}.png` });
    });

    test('start page', async ({ page }) => {
      await page.setViewportSize({ width: 1200, height: 700 });
      await openApp(page);
      await page.screenshot({ path: `${DOCS_IMG}app-avvio${suffix}.png` });
    });
  });
}
