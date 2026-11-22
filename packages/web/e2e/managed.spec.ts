import { expect, test, type Page } from '@playwright/test';
import { loadFiles, openApp, samplePath, selectFile } from './helpers';

// What a FortiGate manages (#15, part 4): the synthetic campus of the samples, with two
// FortiSwitches in an MCLAG pair and four FortiAPs, and its shows.
const CAMPUS = 'fortigate/fgt-campus-200f-fortios-7.6.conf';
const SESSION = 'show/fgt-campus_sessione.txt';
const fileName = (rel: string) => rel.split('/').at(-1)!;

async function openCampus(page: Page) {
  await openApp(page);
  await loadFiles(page, [CAMPUS, SESSION].map(samplePath), 2);
  await selectFile(page, fileName(CAMPUS));
}

const managedItem = (page: Page, hostname: string) =>
  page.locator(`[data-testid="managed-item"][data-device="${hostname}"]`);

/** The colour of a VLAN in a view, as the page sets it. */
const vlanColor = (page: Page, vlan: number) =>
  page
    .locator(`[data-testid="vlan-color"][data-vlan="${vlan}"]`)
    .first()
    .evaluate((el) => (el as HTMLElement).style.background);

const linkRow = (page: Page, ...texts: string[]) => {
  let row = page.getByTestId('row-links');
  for (const text of texts) row = row.filter({ hasText: text });
  return row;
};

test('lists the FortiSwitches of the FortiGate, with their state and the MCLAG pair', async ({
  page,
}) => {
  await openCampus(page);
  await page.getByTestId('tab-fortiswitch').click();
  const view = page.getByTestId('view-fortiswitch');
  await expect(view.getByTestId('row-managed-switches')).toHaveCount(2);
  const first = view.locator('[data-testid="row-managed-switches"][data-id="S248EPTF20000001"]');
  await expect(first).toContainText('FSW-CAMPUS-01');
  await expect(first).toContainText('FortiSwitch 248E-POE');
  // The state comes from "execute switch-controller get-conn-status" in the shows.
  await expect(first.getByTestId('managed-status')).toHaveText('Authorized/Up');

  // The pair: the ICL between the two, the FortiLink trunk up and the MCLAG trunk down.
  const mclag = view.getByTestId('mclag');
  await expect(mclag).toContainText('FSW-CAMPUS-01 e FSW-CAMPUS-02 lavorano in coppia');
  await expect(mclag.locator('[data-testid="mclag-trunk"][data-role="icl"]')).toContainText(
    'ICL-CAMPUS',
  );
  await expect(mclag.locator('[data-testid="mclag-trunk"][data-role="fortilink"]')).toContainText(
    'FL-FGT-CAMPUS',
  );
  await expect(mclag.locator('[data-testid="mclag-trunk"][data-role="mclag"]')).toContainText(
    'TRUNK-AULE',
  );

  // A click opens the switch, which is also in the list under its FortiGate.
  await expect(managedItem(page, 'FSW-CAMPUS-01')).toBeVisible();
  await expect(managedItem(page, 'FSW-CAMPUS-02')).toBeVisible();
  await first.click();
  await expect(page.getByTestId('managed-switch-view')).toHaveAttribute(
    'data-serial',
    'S248EPTF20000001',
  );
});

test('lists the SSIDs, the access points and their profiles', async ({ page }) => {
  await openCampus(page);
  await page.getByTestId('tab-wifi').click();
  const view = page.getByTestId('view-wifi');
  const corp = view.locator('[data-testid="row-ssids"][data-id="WIFI-CORP"]');
  await expect(corp).toContainText('ESEMPIO-CORP');
  await expect(corp).toContainText('RADIUS-NPS');
  await expect(corp).toContainText('70');
  const guest = view.locator('[data-testid="row-ssids"][data-id="WIFI-GUEST"]');
  await expect(guest).toContainText('ESEMPIO-OSPITI');
  await expect(guest).toContainText('71');
  // The key of the guests is in the configuration only, never in the views.
  await expect(view).not.toContainText('ENC');

  await expect(view.getByTestId('row-access-points')).toHaveCount(4);
  const ap = view.locator('[data-testid="row-access-points"][data-id="FP231FTF20000001"]');
  await expect(ap).toContainText('AP-CAMPUS-01');
  await expect(ap).toContainText('FAP231F-CAMPUS');
  await expect(ap).toContainText('WIFI-CORP, WIFI-GUEST');
  const profile = view.getByTestId('ap-profile');
  await expect(profile).toHaveCount(1);
  await expect(profile).toContainText('Radio 3 · monitoraggio');

  // Every row opens its lines in the configuration: from "edit" to "next".
  await ap.getByTestId('btn-source').click();
  await expect(page.getByTestId('file-title')).toHaveText(fileName(CAMPUS));
  await expect(
    page.locator('.cm-line').filter({ hasText: 'edit "FP231FTF20000001"' }),
  ).toBeVisible();
  await expect(page.locator('.cm-activeLine')).toHaveText('    next');
});

test('opens a FortiSwitch as a device: ports, MACs of the shows, VLANs of the FortiGate', async ({
  page,
}) => {
  await openCampus(page);
  // The colours of the VLANs on the FortiGate.
  await page.getByTestId('tab-vlans').click();
  const voice = await vlanColor(page, 20);
  expect(voice).toMatch(/^var\(--mantine-color-/);

  await managedItem(page, 'FSW-CAMPUS-01').click();
  const view = page.getByTestId('managed-switch-view');
  await expect(view).toHaveAttribute('data-serial', 'S248EPTF20000001');
  await expect(view.getByTestId('managed-title')).toHaveText('FSW-CAMPUS-01');
  await expect(view.getByTestId('managed-status')).toHaveText('Authorized/Up');

  // The ports, with the colours of the VLANs of the FortiGate; the MACs from the shows.
  const port5 = view.locator('[data-testid="port"][data-name="port5"]');
  await expect(port5.locator('rect').first()).toHaveAttribute('fill', voice);
  await port5.click();
  // An access port: its MACs are listed at once.
  await expect(page.getByTestId('port-macs')).toContainText('1 MAC');
  await expect(page.getByTestId('port-macs')).toContainText('00:00:5e:00:53:33');
  // The MAC is on the line of the show of the FortiGate.
  await page.getByTestId('port-macs').getByTestId('btn-show-source').first().click();
  await expect(page.getByTestId('file-title')).toHaveText(fileName(SESSION));
  await expect(page.locator('.cm-activeLine')).toContainText('00:00:5e:00:53:33');
  await managedItem(page, 'FSW-CAMPUS-01').click();
  // A configured port without MACs is marked, as on the other switches.
  await view.locator('[data-testid="port"][data-name="port3"]').click();
  await expect(page.getByTestId('port-nomac')).toBeVisible();
  // A trunk has the MACs of its ports. The table is virtualized: the row is found through the
  // filter.
  await view.getByTestId('filter-ports').fill('TRUNK-AULE');
  await view.locator('[data-testid="row-ports"][data-id="TRUNK-AULE"]').click();
  await expect(page.getByTestId('port-macs')).toContainText('2 MAC');
  // The lines of a port are lines of the configuration of the FortiGate.
  await view.locator('[data-testid="port"][data-name="port1"]').click();
  await page.getByTestId('port-source').click();
  await expect(page.getByTestId('file-title')).toHaveText(fileName(CAMPUS));
  await expect(page.locator('.cm-activeLine')).toContainText('port1');

  // The VLANs: the same colours, and the gateway on the FortiGate through FortiLink.
  await managedItem(page, 'FSW-CAMPUS-01').click();
  await view.getByTestId('tab-vlans').click();
  expect(await vlanColor(page, 20)).toBe(voice);
  await view.locator('[data-testid="row-vlans"][data-id="10"]').click();
  const gateway = view.getByTestId('vlan-gateway-detail');
  await expect(gateway).toContainText('10.30.10.1/24 su FGT-CAMPUS (VL10-DATA)');
  await expect(gateway).toContainText('FSW-CAMPUS-01 → FGT-CAMPUS');

  // The summary: what the FortiGate knows of the switch, and its trunks.
  await view.getByTestId('tab-summary').click();
  const summary = view.getByTestId('managed-summary');
  await expect(summary).toContainText('S248EPTF20000001');
  await expect(summary).toContainText('v7.4.4 (867)');
  await expect(summary).toContainText('10.255.250.2');
  await expect(summary.getByTestId('managed-trunk')).toHaveCount(3);
  await view.getByTestId('btn-open-fortigate').click();
  await expect(page.getByTestId('file-title')).toHaveText(fileName(CAMPUS));
});

test('draws the FortiSwitches through FortiLink, the ICL and the group of the FortiAPs', async ({
  page,
}) => {
  await openCampus(page);
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('map-summary')).toHaveText(
    /^3 apparati in 1 sito, \d+ collegamenti$/,
  );
  await expect(
    page.locator('[data-testid="map-device"][data-device="FSW-CAMPUS-02"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="map-external"][data-external="aps:fgt-campus"]'),
  ).toContainText('FortiAP (4)');

  // FortiLink, verified by the state of the switch in the shows.
  const panel = page.getByTestId('map-link-panel');
  await expect(linkRow(page, 'FortiLink')).toHaveCount(2);
  await linkRow(page, 'FortiLink', 'FSW-CAMPUS-01').click();
  await expect(panel).toHaveAttribute('data-kind', 'fortilink');
  await expect(panel.getByTestId('map-link-verified')).toBeVisible();
  await expect(
    panel.locator('[data-testid="map-source"][data-kind="fortilink-state"]'),
  ).toBeVisible();

  // The ICL: one LAG between the two switches, with its two cables.
  await linkRow(page, 'LAG', 'FSW-CAMPUS-01', 'FSW-CAMPUS-02').click();
  await expect(panel).toHaveAttribute('data-kind', 'lag');
  await expect(panel.locator('[data-testid="map-source"][data-kind="mclag"]')).toBeVisible();
  await expect(panel).toContainText('ICL-CAMPUS');

  // The FortiAPs: one group under the FortiGate.
  await linkRow(page, 'FortiAP (CAPWAP)').click();
  await expect(panel).toHaveAttribute('data-kind', 'capwap');
  await expect(panel.locator('[data-testid="map-source"][data-kind="capwap"]')).toContainText(
    '4 FortiAP',
  );

  // A switch opens its own views.
  await page.locator('[data-testid="rf__node-device:fsw-campus-02"]').click();
  const node = page.getByTestId('map-node-panel');
  await expect(node).toHaveAttribute('data-node', 'fsw-campus-02');
  await node.getByTestId('map-open-device').click();
  await expect(page.getByTestId('managed-switch-view')).toHaveAttribute(
    'data-serial',
    'S248EPTF20000002',
  );
});
