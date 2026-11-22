import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { openApp, samplePath, selectFile } from './helpers';

// Screenshots for the documentation, made only from the synthetic samples: the example client
// of samples/, imported in an empty archive. They empty the archive of the server, so they run
// alone and one at a time: NCV_SCREENSHOTS=1 npm run test:e2e -- screenshots
const DOCS_IMG = fileURLToPath(new URL('../../../docs/img/', import.meta.url));

test.skip(!process.env.NCV_SCREENSHOTS, 'only when updating the documentation');

// The number of the version changes with every release (#13): it is left out of the
// screenshots, which then change only when what they show changes.
const style = '[data-testid="app-version"] { display: none !important; }';
test.describe.configure({ mode: 'serial' });
test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

/** Empties the archive, then imports the example client and waits for all its files. */
async function exampleClient(page: Page, request: APIRequestContext) {
  const { clients } = (await (await request.get('/api/clients')).json()) as {
    clients: { id: string }[];
  };
  for (const client of clients) {
    await request.delete(`/api/clients/${client.id}`, { headers: { 'x-ncv-request': '1' } });
  }
  await openApp(page);
  await page.getByTestId('client-import-input').setInputFiles(samplePath('cliente-esempio.zip'));
  await expect(page.locator('[data-testid="file-item"][data-saved="yes"]')).toHaveCount(23);
}

// Every screenshot in the light theme, and again in the dark one with the "-scuro" suffix.
for (const [colorScheme, suffix] of [
  ['light', ''],
  ['dark', '-scuro'],
] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test('FortiGate policies', async ({ page, request }) => {
      await exampleClient(page, request);
      await selectFile(page, 'fgt-hq-100f-fortios-7.2-vdom.conf');
      await page.getByTestId('tab-policies').click();
      await page.getByTestId('policy-ip-search').fill('10.10.100.25');
      await expect(
        page.locator('[data-testid="row-policies"][data-state="match"]').first(),
      ).toBeVisible();
      await page.locator('[data-testid="row-policies"][data-id="6"]').click();
      await expect(page.getByTestId('policy-detail')).toBeVisible();
      await page.screenshot({ path: `${DOCS_IMG}app-fortigate${suffix}.png`, style });
    });

    test('Cisco stack', async ({ page, request }) => {
      await exampleClient(page, request);
      await selectFile(page, 'sw-hq-core-c9300-iosxe-17.12-stack.txt');
      await page.getByTestId('tab-ports').click();
      await page.locator('[data-testid="port"][data-name="TenGigabitEthernet1/1/1"]').click();
      await expect(page.getByTestId('port-detail')).toBeVisible();
      await page.screenshot({ path: `${DOCS_IMG}app-cisco${suffix}.png`, style });
    });

    test('real state of a switch', async ({ page, request }) => {
      await exampleClient(page, request);
      await selectFile(page, 'sw-hq-core-c9300-iosxe-17.12-stack.txt');
      await page.getByTestId('tab-ports').click();
      await page.locator('[data-testid="port"][data-name="GigabitEthernet1/0/25"]').click();
      await expect(page.getByTestId('port-macs')).toBeVisible();
      await page.getByTestId('port-detail').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DOCS_IMG}app-stato${suffix}.png`, style });
    });

    test('linked config', async ({ page, request }) => {
      await exampleClient(page, request);
      await selectFile(page, 'sw-hq-core-c9300-iosxe-17.12-stack.txt');
      await page.getByTestId('tab-ports').click();
      await page.getByTestId('filter-ports').fill('Vlan70');
      await page.locator('[data-testid="row-ports"][data-id="Vlan70"]').click();
      await page.getByTestId('port-source').click();
      await expect(page.locator('.ncv-ref').first()).toBeVisible();
      await expect(page.locator('.ncv-line-unknown').first()).toBeVisible();
      // Syntax highlighting is applied right after scrolling: wait for the coloured tokens.
      await expect(page.locator('.cm-line span:not(.ncv-ref)').first()).toBeVisible();
      await page.screenshot({ path: `${DOCS_IMG}app-config${suffix}.png`, style });
    });

    test('map of the infrastructure', async ({ page, request }) => {
      await exampleClient(page, request);
      await page.getByTestId('nav-map').click();
      await expect(page.getByTestId('map-device')).toHaveCount(12);
      // A problem of the list: the LAG between the core and an access switch, with the two
      // protocols that do not agree.
      await page.locator('[data-testid="row-problems"][data-id^="lag-mode|"]').click();
      await expect(page.getByTestId('map-link-panel')).toHaveAttribute('data-kind', 'lag');
      // The layout is fitted to the canvas once the nodes have their size.
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${DOCS_IMG}app-mappa${suffix}.png`, style });
    });

    test('VPN of the client', async ({ page, request }) => {
      await exampleClient(page, request);
      await page.getByTestId('nav-vpn').click();
      // The tunnel of branch 2 on WAN2: no phase 1 proposal and no DH group in common.
      await page
        .getByTestId('row-vpn-tunnels')
        .filter({ hasText: 'FGT-BR2' })
        .filter({ hasText: 'HUB-WAN2' })
        .click();
      await expect(page.getByTestId('map-link-comparison')).toHaveText('2 incoerenze');
      await page.screenshot({ path: `${DOCS_IMG}app-vpn${suffix}.png`, style });
    });

    test('start page', async ({ page, request }) => {
      await page.setViewportSize({ width: 1200, height: 760 });
      await exampleClient(page, request);
      await page.getByTestId('client-menu').click();
      await page.getByTestId('btn-client-close').click();
      await expect(page.getByTestId('client-card')).toHaveCount(1);
      await page.screenshot({ path: `${DOCS_IMG}app-avvio${suffix}.png`, style });
    });
  });
}
