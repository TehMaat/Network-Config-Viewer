import { expect, test, type Page } from '@playwright/test';
import { fileItem, loadFiles, openApp, samplePath, selectFile } from './helpers';

// Shows of the synthetic samples: each file goes with its device, whose views show the real
// state next to the configuration.

const CORE = 'cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt';
const CORE_SESSION = 'show/sw-hq-core_sessione.txt';
const CORE_NEIGHBORS = 'show/sw-hq-core_show-cdp-lldp-neighbors.txt';
const BR1 = 'cisco-ios/sw-br1-acc-c2960x-ios-15.2-stack.txt';
const BR1_SESSION = 'show/sw-br1-acc_sessione.txt';
const BR1_VLANS = 'show/sw-br1-acc_show-vlan-brief-senza-prompt.txt';
const BR3 = 'cisco-sb/sw-br3-acc-cbs350-48p-3.4-stack.txt';
const BR3_SESSION = 'show/sw-br3-acc_sessione.txt';
const FGT_HQ = 'fortigate/fgt-hq-100f-fortios-7.2-vdom.conf';
const FGT_HQ_SESSION = 'show/fgt-hq_sessione.txt';
const FGT_BR1 = 'fortigate/fgt-br1-60f-fortios-7.0.conf';
const FGT_BR1_SESSION = 'show/fgt-br1_sessione.txt';

const fileName = (rel: string) => rel.split('/').at(-1)!;

const port = (page: Page, name: string) =>
  page.locator(`[data-testid="port"][data-name="${name}"]`);

async function openWithShows(page: Page, device: string, shows: string[]) {
  await openApp(page);
  await loadFiles(page, [device, ...shows].map(samplePath), shows.length + 1);
  await selectFile(page, fileName(device));
  await expect(page.getByTestId('view-summary')).toBeVisible();
}

test('assigns a file of shows to its device by hostname', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [CORE, CORE_SESSION, CORE_NEIGHBORS].map(samplePath), 3);
  await selectFile(page, fileName(CORE_SESSION));

  const device = page.getByTestId('show-device');
  await expect(device).toHaveAttribute('data-device', fileName(CORE));
  await expect(device).toContainText("dall'hostname");
  const commands = page.getByTestId('show-command');
  await expect(commands).toHaveCount(7);
  await expect(commands.filter({ hasText: 'show mac address-table' })).toHaveAttribute(
    'data-read',
    'true',
  );
  // Every command opens its output.
  await commands.filter({ hasText: 'show power inline' }).getByRole('button').click();
  await expect(page.locator('.cm-activeLine')).toHaveText('SW-HQ-CORE#show power inline');

  await page.getByTestId('btn-open-device').click();
  await expect(page.getByTestId('file-title')).toHaveText(fileName(CORE));
  await expect(page.getByTestId('summary-show')).toHaveCount(2);
  const neighbors = page.locator(
    `[data-testid="summary-show"][data-file="${fileName(CORE_NEIGHBORS)}"]`,
  );
  await expect(neighbors).toContainText('show cdp neighbors detail');

  // A command of the summary opens the file of shows at its line.
  await neighbors
    .getByTestId('summary-show-command')
    .filter({ hasText: 'show lldp neighbors detail' })
    .click();
  await expect(page.getByTestId('file-title')).toHaveText(fileName(CORE_NEIGHBORS));
  await expect(page.locator('.cm-activeLine')).toContainText('show lldp neighbors detail');
});

test('assigns a file without prompt by its name and lets the user correct it', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [CORE, BR1, BR1_VLANS].map(samplePath), 3);
  await selectFile(page, fileName(BR1_VLANS));
  const device = page.getByTestId('show-device');
  await expect(device).toHaveAttribute('data-device', fileName(BR1));
  await expect(device).toContainText('dal nome del file');

  // The hostname corrected by hand moves the file to another device.
  await page.getByTestId('btn-edit').click();
  await page.getByTestId('input-hostname').fill('SW-HQ-CORE');
  await page.getByTestId('btn-apply').click();
  await expect(device).toHaveAttribute('data-device', fileName(CORE));
  await expect(device).toContainText('indicato a mano');

  // A hostname that no device has: the file stays alone, and says so.
  await page.getByTestId('btn-edit').click();
  await page.getByTestId('input-hostname').fill('SW-INESISTENTE');
  await page.getByTestId('btn-apply').click();
  await expect(device).toHaveAttribute('data-device', '');

  await page.getByTestId('btn-reset').click();
  await expect(device).toHaveAttribute('data-device', fileName(BR1));
});

test('shows the real state of the ports and the MACs of every configured port (#6)', async ({
  page,
}) => {
  await openWithShows(page, CORE, [CORE_SESSION, CORE_NEIGHBORS]);
  // A single warning for the device, with the number of ports. One of them is Po12, the
  // port-channel down of the LAG problem of the samples (#15): the panel shows only ports.
  await expect(
    page.getByTestId('warnings').locator('[data-warning="ports-without-mac"]'),
  ).toHaveAttribute('data-count', '21');

  await page.getByTestId('tab-ports').click();
  await expect(page.getByTestId('mark-nomac')).toHaveCount(20);

  // An access port with a telephone and a PC behind it.
  await port(page, 'GigabitEthernet1/0/25').click();
  await expect(page.getByTestId('port-live-status')).toContainText('connected');
  const live = page.getByTestId('port-live');
  // Numbers in the format of the language: 4,1 in Italian.
  await expect(live).toContainText('PoE: on · 4,1 W · IP Phone 8845');
  await expect(page.getByTestId('port-macs')).toContainText('2 MAC');
  await expect(page.getByTestId('port-macs')).toContainText(/00:00:5e:00:53:[0-9a-f]{2}/);

  // Configured but silent: marked. Shut down: not marked.
  await port(page, 'GigabitEthernet1/0/31').click();
  await expect(page.getByTestId('port-nomac')).toBeVisible();
  await port(page, 'GigabitEthernet1/0/41').click();
  await expect(page.getByTestId('port-live-status')).toContainText('disabled');
  await expect(page.getByTestId('port-nomac')).toHaveCount(0);

  // A member of a port-channel: its MACs are on the port-channel, its neighbour from CDP.
  await port(page, 'TenGigabitEthernet1/1/2').click();
  await expect(live).toContainText('Port-channel10');
  await expect(live).toContainText('SW-HQ-ACC1');
  await expect(page.getByTestId('port-nomac')).toHaveCount(0);

  // The table: the real state and the MACs of every interface.
  const po10 = page.locator('[data-testid="row-ports"][data-id="Port-channel10"]');
  await expect(po10).toContainText('connected');
  await po10.click();
  await expect(page.getByTestId('port-macs')).toContainText('10 MAC');
  await page.getByTestId('btn-all-macs').click();
  await expect(page.getByTestId('btn-all-macs')).toHaveCount(0);
  // The IP of a MAC, from the ARP table of the same switch.
  await expect(page.getByTestId('mac-ip')).toContainText(['10.10.99.11']);

  // The source of a MAC is the line of the show.
  await page.getByTestId('port-macs').getByTestId('btn-show-source').first().click();
  await expect(page.getByTestId('file-title')).toHaveText(fileName(CORE_SESSION));
  await expect(page.locator('.cm-activeLine')).toContainText('Po10');
});

test('without the MAC table, says it once for the switch', async ({ page }) => {
  await openWithShows(page, CORE, [CORE_NEIGHBORS]);
  await expect(
    page.getByTestId('warnings').locator('[data-warning="mac-table-missing"]'),
  ).toBeVisible();
  await page.getByTestId('tab-ports').click();
  await expect(page.getByTestId('mark-nomac')).toHaveCount(0);
  // Every configured port says it, the members of a port-channel do not.
  await port(page, 'GigabitEthernet1/0/1').click();
  await expect(page.getByTestId('port-no-mac-table')).toBeVisible();
  await port(page, 'TenGigabitEthernet1/1/2').click();
  await expect(page.getByTestId('port-live')).toContainText('SW-HQ-ACC1');
  await expect(page.getByTestId('port-no-mac-table')).toHaveCount(0);
  // No column for what the shows do not have.
  await expect(page.getByRole('columnheader', { name: 'MAC', exact: true })).toHaveCount(0);
});

test('takes from the shows the names of the VLANs kept by VTP', async ({ page }) => {
  await openWithShows(page, BR1, [BR1_SESSION, BR1_VLANS]);
  await expect(fileItem(page, fileName(BR1_SESSION))).toContainText('SW-BR1-ACC');
  await page.getByTestId('tab-vlans').click();
  await expect(page.getByTestId('vlan-name-show')).toHaveCount(4);
  await expect(page.locator('[data-testid="row-vlans"][data-id="10"]')).toContainText('DATI');
});

test('reads the Small Business shows: neighbours, PoE and MACs', async ({ page }) => {
  await openWithShows(page, BR3, [BR3_SESSION]);
  await page.getByTestId('tab-ports').click();
  await port(page, 'GigabitEthernet1/0/10').click();
  const live = page.getByTestId('port-live');
  await expect(live).toContainText('AP-BR3-01');
  // The Small Business table of PoE has no watts per port: they are left out.
  await expect(live).toContainText('PoE: on · Access point');
  await expect(page.getByTestId('port-macs')).toContainText('1 MAC');
});

test('shows tunnels, routes and BGP sessions of a FortiGate with VDOMs', async ({ page }) => {
  await openWithShows(page, FGT_HQ, [FGT_HQ_SESSION]);
  await expect(page.getByTestId('summary-show')).toContainText('(OFFICE)');

  await page.getByTestId('tab-vpn').click();
  // The dial-up tunnels of the hub, one instance per spoke, and the static one to the
  // datacenter (#15).
  await expect(page.getByTestId('tunnel-live')).toHaveText([
    '3 su, 0 giù',
    '1 su, 1 giù',
    '1 su, 0 giù',
  ]);
  await page.locator('[data-testid="row-tunnels"][data-id="ADVPN-WAN2"]').click();
  const instances = page.getByTestId('tunnel-instances');
  await expect(instances.locator('tbody tr')).toHaveCount(2);
  await expect(instances.locator('tbody tr[data-up="false"]')).toHaveCount(1);

  await page.getByTestId('tab-routing').click();
  const routes = page.getByTestId('live-routes');
  await expect(routes).toBeVisible();
  // The route used for an IP, also when it is learned with OSPF.
  await page.getByTestId('live-route-lookup').fill('10.10.60.25');
  await expect(page.locator('[data-testid="row-live-routes"][data-state="match"]')).toContainText(
    '10.10.60.0/24',
  );
  await expect(page.getByTestId('bgp-peer-state').first()).toContainText('stabilita');
});

test('shows the SD-WAN health checks and the member each rule uses', async ({ page }) => {
  await openWithShows(page, FGT_BR1, [FGT_BR1_SESSION]);
  await page.getByTestId('tab-sdwan').click();
  await expect(page.getByTestId('sdwan-live-row')).toHaveCount(4);
  await expect(page.getByTestId('sdwan-live-row').first()).toContainText('latenza 14,521 ms');
  await expect(page.locator('[data-testid="sdwan-live-row"][data-ok="false"]')).toContainText(
    'wan2',
  );
  await expect(page.getByTestId('sdwan-rule-used')).toHaveText([
    'in uso: HUB-WAN1',
    'in uso: wan1',
  ]);
  await page.getByTestId('tab-vpn').click();
  // HUB-WAN1 has also the ADVPN shortcut to branch 2 (#15).
  await expect(page.getByTestId('tunnel-live')).toHaveText(['2 su, 0 giù', '1 su, 0 giù']);
});
