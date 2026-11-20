import { expect, test, type Page } from '@playwright/test';
import { loadFiles, openApp, samplePath } from './helpers';

// Views of the Cisco switches, built from the neutral model of the synthetic samples.

const CORE = 'cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt';

async function openDevice(page: Page, rel: string) {
  await openApp(page);
  await loadFiles(page, [samplePath(rel)], 1);
  await expect(page.getByTestId('view-summary')).toBeVisible();
}

const port = (page: Page, name: string) =>
  page.locator(`[data-testid="port"][data-name="${name}"]`);

test('summarises the device, its features and the coverage of the reading', async ({ page }) => {
  await openDevice(page, CORE);
  await expect(page.getByTestId('summary-management')).toContainText('10.10.99.2 (Vlan99)');
  await expect(page.getByTestId('count-ports')).toHaveAttribute('data-value', '168');
  await expect(page.getByTestId('count-vlans')).toHaveAttribute('data-value', '10');
  for (const feature of ['ospf', 'pbr', 'stack', 'lag', 'acl']) {
    await expect(page.locator(`[data-feature="${feature}"]`)).toBeVisible();
  }
  const coverage = page.getByTestId('coverage');
  await expect(coverage).toHaveAttribute('data-unknown', /^[1-9]\d*$/);

  // A section not interpreted opens the config at its first line.
  const sections = page.getByTestId('coverage-sections');
  const first = sections.locator('tbody tr').first();
  const section = (await first.locator('td').first().textContent())!;
  await first.getByRole('button').click();
  await expect(page.getByTestId('config-panel')).toBeVisible();
  await expect(page.locator('.cm-activeLine')).toContainText(section.split(' ')[0]!);
});

test('draws the ports of every stack member and opens their lines', async ({ page }) => {
  await openDevice(page, CORE);
  await page.getByTestId('tab-ports').click();
  await expect(page.getByTestId('port-panel')).toHaveCount(3);
  // 48 front ports and 8 uplinks for each member.
  await expect(
    page.locator('[data-testid="port-panel"][data-member="2"] [data-testid="port"]'),
  ).toHaveCount(56);

  await port(page, 'TenGigabitEthernet1/1/1').click();
  const detail = page.getByTestId('port-detail');
  await expect(detail).toHaveAttribute('data-name', 'TenGigabitEthernet1/1/1');
  await expect(detail).toContainText('Port-channel1');
  // The native VLAN is not written: it is the default, shown as such.
  await expect(detail.locator('[data-default="yes"]').first()).toBeVisible();

  // Highlighting a VLAN dims the ports that do not carry it.
  await page.getByTestId('filter-vlan').click();
  await page.getByRole('option', { name: '100 · SERVER' }).click();
  await expect(port(page, 'GigabitEthernet1/0/1')).not.toHaveAttribute('data-dimmed', 'true');
  await expect(port(page, 'GigabitEthernet1/0/30')).toHaveAttribute('data-dimmed', 'true');

  // From the port to its lines in the config.
  await port(page, 'GigabitEthernet1/0/1').click();
  await page.getByTestId('port-source').click();
  await expect(page.getByTestId('config-panel')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toContain('interface GigabitEthernet1/0/1');
});

test('lists the VLANs with their ports and gateway', async ({ page }) => {
  await openDevice(page, CORE);
  await page.getByTestId('tab-vlans').click();
  await expect(page.getByTestId('table-vlans')).toHaveAttribute('data-rows', '10');
  await page.locator('[data-testid="row-vlans"][data-id="70"]').click();
  const detail = page.getByTestId('vlan-detail');
  await expect(detail).toContainText('WIFI-OSPITI');
  await expect(detail).toContainText('Po10');
  await expect(page.locator('[data-testid="row-vlans"][data-id="70"]')).toContainText(
    '10.10.70.1/24',
  );
});

test('finds an IP in the ACLs through subnets, object groups and any', async ({ page }) => {
  await openDevice(page, CORE);
  await page.getByTestId('tab-acls').click();
  await page.getByTestId('acl-ip-search').fill('10.40.100.53');
  await page.locator('[data-testid="row-acls"][data-id="ACL-OSPITI-IN"]').click();
  const entries = page.locator('[data-testid="row-acl-entries"]');
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(0).locator('[data-match="host"]')).toBeVisible();
  await expect(entries.nth(1).locator('[data-match="group"]')).toBeVisible();
  await expect(entries.nth(3).locator('[data-match="any"]')).toHaveCount(2);

  // An ACL that contains the IP only through "any" stays in the background.
  await page.getByTestId('acl-ip-search').fill('10.10.99.7');
  await expect(page.locator('[data-testid="row-acls"][data-id="ACL-PBR-OSPITI"]')).toHaveAttribute(
    'data-state',
    'dim',
  );
  await expect(page.locator('[data-testid="row-acls"][data-id="ACL-OSPITI-IN"]')).toHaveAttribute(
    'data-state',
    'match',
  );
  await expect(page.locator('[data-testid="row-acls"][data-id="MGMT-ACCESS"]')).toHaveAttribute(
    'data-state',
    'match',
  );
});

test('shows the routes, OSPF and the policy routes', async ({ page }) => {
  await openDevice(page, CORE);
  await page.getByTestId('tab-routing').click();
  await expect(page.getByTestId('table-routes')).toHaveAttribute('data-rows', '7');
  await page.getByTestId('route-lookup').fill('10.10.70.9');
  await expect(page.locator('[data-testid="row-routes"][data-state="match"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="row-routes"][data-state="match"]')).toContainText(
    'Vlan70',
  );
  await expect(page.getByTestId('ospf')).toContainText('10.10.255.2');
  await expect(page.getByTestId('policy-routes')).toContainText('PBR-OSPITI');
  await expect(page.getByTestId('route-maps')).toContainText('RM-STATICHE-OSPF');
});

test('highlights the unknown lines and follows the names to their definition', async ({ page }) => {
  await openDevice(page, CORE);
  await page.getByTestId('tab-config').click();
  await expect(page.locator('.ncv-line-unknown').first()).toBeVisible();
  await page.getByTestId('switch-unknown').click();
  await expect(page.locator('.ncv-line-unknown')).toHaveCount(0);

  // From the VLAN 70 interface to its lines, then from the ACL name to the ACL.
  await page.getByTestId('tab-ports').click();
  await page.getByTestId('filter-ports').fill('Vlan70');
  await page.locator('[data-testid="row-ports"][data-id="Vlan70"]').click();
  await page.getByTestId('port-source').click();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toContain('ip access-group ACL-OSPITI-IN in');
  await page.locator('.ncv-ref', { hasText: 'ACL-OSPITI-IN' }).first().click();
  await expect(page.locator('.cm-activeLine')).toHaveText('ip access-list extended ACL-OSPITI-IN');
  await page.getByTestId('btn-back').click();
  await expect(page.locator('.cm-activeLine')).toHaveText('ip access-group ACL-OSPITI-IN in');
});

test('reads general mode and the management ACL of the Small Business switches', async ({
  page,
}) => {
  await openDevice(page, 'cisco-sb/sw-br2-acc-sg350-28p-2.5.txt');
  await expect(page.getByTestId('warnings')).toContainText(/da verificare/);
  await page.getByTestId('tab-ports').click();
  await port(page, 'GigabitEthernet1/0/10').click();
  const detail = page.getByTestId('port-detail');
  await expect(detail).toContainText('general');
  await expect(detail).toContainText('60');
  await page.getByTestId('tab-acls').click();
  await expect(page.locator('[data-testid="row-acls"][data-id="MGMT"]')).toContainText(
    'accesso di gestione',
  );
});

test('warns when VTP keeps the VLANs out of the config', async ({ page }) => {
  await openDevice(page, 'cisco-ios/sw-br1-acc-c2960x-ios-15.2-stack.txt');
  await expect(page.locator('[data-warning="vtp-vlans-not-in-config"]')).toBeVisible();
  await page.getByTestId('tab-vlans').click();
  await expect(page.getByTestId('vlans-vtp')).toBeVisible();
});
