import { expect, test, type Page } from '@playwright/test';
import { fileItem, loadFiles, openApp, samplePath, selectFile } from './helpers';

// The map of the infrastructure (#15): the devices of the page put together, with their sites
// and the links between them, each with its two sides and the lines it comes from.

const HQ = 'fortigate/fgt-hq-100f-fortios-7.2-vdom.conf';
const CORE = 'cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt';
const ACC1 = 'cisco-ios/sw-hq-acc1-c3850-iosxe-16.12-stack.txt';
const BR1 = 'fortigate/fgt-br1-60f-fortios-7.0.conf';
const SHOWS = [
  'show/sw-hq-core_sessione.txt',
  'show/sw-hq-core_show-cdp-lldp-neighbors.txt',
  'show/fgt-hq_sessione.txt',
  'show/fgt-br1_sessione.txt',
];
const FILES = [HQ, CORE, ACC1, BR1, ...SHOWS];

const fileName = (rel: string) => rel.split('/').at(-1)!;

async function openMap(page: Page, files = FILES) {
  await openApp(page);
  await loadFiles(page, files.map(samplePath), files.length);
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
}

/** The chip of a layer, by its label: the checkbox inside it is hidden. */
const layer = (page: Page, label: string) => page.getByTestId('map-layers').getByText(label);

/** A row of the list of the links, by the text of its cells. */
const linkRow = (page: Page, ...texts: string[]) => {
  let row = page.getByTestId('row-links');
  for (const text of texts) row = row.filter({ hasText: text });
  return row;
};

test('draws the devices of the page in their sites, with the links between them', async ({
  page,
}) => {
  await openMap(page);
  await expect(page.getByTestId('map-summary')).toHaveText(
    /^4 apparati in 2 siti, \d+ collegamenti$/,
  );
  await expect(page.getByTestId('map-device')).toHaveCount(4);
  await expect(page.getByTestId('map-site')).toHaveCount(2);
  await expect(page.locator('[data-testid="map-site"][data-site="Sede"]')).toBeVisible();
  // The list on the left follows the sites; the map comes first.
  await expect(page.getByTestId('site-header')).toHaveText(['Filiale 1', 'Sede']);
  await expect(page.getByTestId('nav-map')).toContainText('4 apparati');
  // Internet and the providers are outside the client.
  await expect(
    page.locator('[data-testid="map-external"][data-external="internet"]'),
  ).toBeVisible();
  await expect(page.locator('.react-flow__edge')).not.toHaveCount(0);
});

test('shows the two sides of a LAG verified by LLDP, with the lines it comes from', async ({
  page,
}) => {
  await openMap(page);
  await linkRow(page, 'LAG', 'FGT-HQ').click();
  const panel = page.getByTestId('map-link-panel');
  await expect(panel).toHaveAttribute('data-kind', 'lag');
  await expect(page.getByTestId('map-link-verified')).toHaveText('verificato');
  await expect(panel.locator('[data-row="interface"]')).toContainText('LAG-CORE');
  await expect(panel.locator('[data-row="interface"]')).toContainText('Port-channel1');
  await expect(panel.locator('[data-row="cables"]')).toContainText('x1, x2');
  await expect(panel.locator('[data-row="cables"]')).toContainText('Te1/1/1, Te2/1/1');
  await expect(panel.locator('[data-row="state"]')).toContainText('su');
  await expect(panel.locator('[data-testid="map-source"][data-kind="lldp"]').first()).toContainText(
    'Verificato con LLDP su SW-HQ-CORE',
  );
  // The evidence opens the file of shows at the line of the neighbour.
  await panel
    .locator('[data-testid="map-source"][data-kind="lldp"]')
    .first()
    .getByTestId('map-evidence')
    .click();
  await expect(page.getByTestId('file-title')).toHaveText('sw-hq-core_sessione.txt');
});

test('pairs a spoke with the hub: tunnel, BGP session in the neighbour range, state', async ({
  page,
}) => {
  await openMap(page);
  await linkRow(page, 'Sessione BGP', 'FGT-BR1 · 10.255.1.21').click();
  const panel = page.getByTestId('map-link-panel');
  await expect(panel.locator('[data-row="peer"]')).toContainText(
    'range 10.255.1.0/24 (SPOKES-WAN1)',
  );
  await expect(panel.locator('[data-row="state"]')).toContainText('su (Established');
  await expect(panel.locator('[data-row="transport"]')).toContainText('HUB-WAN1');
  await expect(panel.locator('[data-row="transport"]')).toContainText('ADVPN-WAN1');
  // From the session to the tunnel that carries it.
  await page.getByTestId('map-link-via').click();
  await expect(panel).toHaveAttribute('data-kind', 'ipsec');
  await expect(panel.locator('[data-row="type"]')).toContainText('statico → 203.0.113.2');
  await expect(panel.locator('[data-row="type"]')).toContainText('dial-up');
  await expect(panel.locator('[data-row="sdwan"]')).toContainText('overlay #3');
  // The ADVPN shortcut that the branch shows towards branch 2 has a side outside the page.
  await expect(page.getByTestId('map-layers')).toBeVisible();
});

test('opens the views of a device from the map', async ({ page }) => {
  await openMap(page);
  await page.locator('[data-testid="rf__node-device:sw-hq-core"]').click();
  const panel = page.getByTestId('map-node-panel');
  await expect(panel).toHaveAttribute('data-node', 'sw-hq-core');
  await expect(panel).toContainText('Sede');
  await panel.getByTestId('map-open-device').click();
  await expect(page.getByTestId('file-title')).toHaveText(fileName(CORE));
  await expect(page.getByTestId('view-summary')).toBeVisible();
  // And back to the map.
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
});

test('turns the layers on and off, and remembers them', async ({ page }) => {
  await openMap(page);
  const edges = page.locator('.react-flow__edge');
  const all = await edges.count();
  await layer(page, 'Sessioni BGP e OSPF').click();
  await expect(edges).not.toHaveCount(all);
  const withoutRouting = await edges.count();
  expect(withoutRouting).toBeLessThan(all);
  // The shared subnets are off at first: on, the management network of the site appears.
  await layer(page, 'Subnet condivise').click();
  await expect(
    page.locator('[data-testid="map-external"][data-external="net:10.10.99.0/24"]'),
  ).toBeVisible();
  await page.reload();
  await page.getByTestId('empty-state').or(page.getByTestId('file-item').first()).waitFor();
  await openMap(page);
  await expect(page.locator('[data-testid="map-layer"][data-layer="routing"]')).not.toBeChecked();
  await expect(page.locator('[data-testid="map-layer"][data-layer="subnets"]')).toBeChecked();
});

test('shows the other side of a port, a tunnel and a BGP session in the views', async ({
  page,
}) => {
  await openApp(page);
  await loadFiles(page, FILES.map(samplePath), FILES.length);
  // A port of the core: the uplink to the HQ firewall, verified by LLDP.
  await selectFile(page, fileName(CORE));
  await page.getByTestId('tab-ports').click();
  await page.locator('[data-testid="port"][data-name="TenGigabitEthernet1/1/1"]').click();
  const peers = page.getByTestId('port-detail').getByTestId('peer-link');
  await expect(peers).toContainText('FGT-HQ');
  await expect(peers).toContainText('verificato');
  // A tunnel of the branch: the hub on the other side.
  await selectFile(page, fileName(BR1));
  await page.getByTestId('tab-vpn').click();
  await page.locator('[data-testid="row-tunnels"][data-id="HUB-WAN1"]').click();
  await expect(page.getByTestId('tunnel-detail').getByTestId('peer-link').first()).toContainText(
    'FGT-HQ',
  );
  // A BGP session: the click opens the hub.
  await page.getByTestId('tab-routing').click();
  await page.getByTestId('table-bgp-neighbors').getByTestId('peer-open').first().click();
  await expect(page.getByTestId('file-title')).toHaveText(fileName(HQ));
});

test('exports the list of the links to Excel, and works on a large client', async ({
  page,
}, testInfo) => {
  // 150 synthetic devices: 30 sites with a FortiGate and four switches each.
  const files: { name: string; mimeType: string; buffer: Buffer }[] = [];
  for (let s = 1; s <= 30; s++) {
    files.push({
      name: `fgt-s${s}.conf`,
      mimeType: 'text/plain',
      buffer: Buffer.from(
        [
          '#config-version=FG100F-7.4.4-FW-build2662-240514:opmode=0:vdom=0:user=admin',
          'config system global',
          `    set hostname "FGT-S${s}"`,
          'end',
          'config system snmp sysinfo',
          `    set location "Sito ${s} - armadio"`,
          'end',
          'config system interface',
          '    edit "wan1"',
          `        set ip 198.18.${s}.2 255.255.255.252`,
          '        set role wan',
          '    next',
          '    edit "lan"',
          `        set ip 10.${s}.0.1 255.255.255.0`,
          `        set description "SW-S${s}-CORE"`,
          '    next',
          'end',
          '',
        ].join('\n'),
      ),
    });
    for (let n = 0; n < 4; n++) {
      const name = n === 0 ? `SW-S${s}-CORE` : `SW-S${s}-ACC${n}`;
      const uplink = n === 0 ? `FGT-S${s}` : `SW-S${s}-CORE`;
      files.push({
        name: `${name.toLowerCase()}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from(
          [
            'version 17.9',
            `hostname ${name}`,
            '!',
            'interface GigabitEthernet1/0/48',
            ` description UPLINK-${uplink}`,
            ' switchport mode trunk',
            '!',
            'interface Vlan99',
            ` ip address 10.${s}.99.${n + 2} 255.255.255.0`,
            '!',
            'end',
            '',
          ].join('\n'),
        ),
      });
    }
  }
  // Reading the 150 files is not what is measured: on the runners of the CI Firefox takes about
  // 20 seconds, the default timeout of an expectation.
  test.slow();
  await openApp(page);
  await loadFiles(page, files, files.length, 60_000);
  const started = Date.now();
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('map-device')).toHaveCount(150);
  const drawn = Date.now() - started;
  testInfo.annotations.push({ type: 'timing', description: `map of 150 devices in ${drawn} ms` });
  expect(drawn).toBeLessThan(15_000);
  await expect(page.getByTestId('map-summary')).toContainText('150 apparati in 30 siti');
  // A click on a link answers at once.
  const clicked = Date.now();
  // The list is virtualized: the row is found through the filter.
  await page.getByTestId('filter-links').fill('SW-S7-ACC2');
  await linkRow(page, 'Cavo', 'SW-S7-ACC2').first().click();
  await expect(page.getByTestId('map-link-panel')).toBeVisible();
  expect(Date.now() - clicked).toBeLessThan(3_000);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-links').click(),
  ]);
  expect(download.suggestedFilename().replace(/_/g, ' ')).toBe('mappa-links.xlsx');
});

test('without devices read by a driver there is nothing to draw', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [samplePath('show/fgt-hq_get-system-status.txt')], 1);
  await expect(page.getByTestId('nav-map')).toHaveCount(0);
  await expect(fileItem(page, 'fgt-hq_get-system-status.txt')).toBeVisible();
});
