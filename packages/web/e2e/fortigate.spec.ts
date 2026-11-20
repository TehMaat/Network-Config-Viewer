import { expect, test, type Page } from '@playwright/test';
import { loadFiles, openApp, samplePath } from './helpers';

// Views of the FortiGates, built from the neutral model of the synthetic samples.

const HQ = 'fortigate/fgt-hq-100f-fortios-7.2-vdom.conf';

async function openDevice(page: Page, rel: string) {
  await openApp(page);
  await loadFiles(page, [samplePath(rel)], 1);
  await expect(page.getByTestId('view-summary')).toBeVisible();
}

const policyRow = (page: Page, id: number) =>
  page.locator(`[data-testid="row-policies"][data-id="${id}"]`);

test('summarises a FortiGate with VDOMs and groups its warnings', async ({ page }) => {
  await openDevice(page, HQ);
  await expect(page.getByTestId('summary-vdoms')).toContainText('root · OFFICE · DMZ');
  await expect(page.getByTestId('count-policies')).toHaveAttribute('data-value', '12');
  for (const feature of ['vdom', 'ha', 'ospf', 'bgp', 'advpn', 'vip', 'pbr']) {
    await expect(page.locator(`[data-feature="${feature}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-warning="policy-disabled"]')).toHaveAttribute('data-count', '1');
  await expect(page.locator('[data-warning="policy-all-management"]')).toBeVisible();
});

test('finds an IP in the policies through subnets, groups, VIPs and all', async ({ page }) => {
  await openDevice(page, HQ);
  await page.getByTestId('tab-policies').click();
  // The VDOM with the policies is shown first.
  await expect(page.getByTestId('vdom-select')).toHaveValue('OFFICE');
  await expect(page.getByTestId('table-policies')).toHaveAttribute('data-rows', '11');

  await page.getByTestId('policy-ip-search').fill('10.10.100.25');
  await expect(policyRow(page, 6).locator('[data-match="vip"]')).toBeVisible();
  await expect(policyRow(page, 4).locator('[data-match="subnet"]')).toBeVisible();
  await expect(policyRow(page, 3).locator('[data-match="group"]')).toHaveCount(2);
  // The guest policy contains the IP only through "all": it stays in the background.
  await expect(policyRow(page, 2)).not.toHaveAttribute('data-state', 'match');

  await page.getByTestId('policy-ip-search').fill('');
  await page.getByTestId('policy-only-warnings').click();
  await expect(page.getByTestId('table-policies')).toHaveAttribute('data-rows', '2');
  await expect(policyRow(page, 9).locator('[data-warning="policy-disabled"]')).toBeVisible();
});

test('shows a policy with its objects expanded and opens its lines', async ({ page }) => {
  await openDevice(page, HQ);
  await page.getByTestId('tab-policies').click();
  await policyRow(page, 7).click();
  const detail = page.getByTestId('policy-detail');
  await expect(detail).toContainText('10.10.0.0/16');
  // GRP-WEB: built-in services and a custom one.
  await expect(detail).toContainText('tcp/80');
  await expect(detail).toContainText('tcp/8443');
  await page.getByTestId('policy-source').click();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toContain('set name "Sede-verso-DMZ"');
});

test('groups the policies by interface pair and switches VDOM', async ({ page }) => {
  await openDevice(page, HQ);
  await page.getByTestId('tab-policies').click();
  await page.getByTestId('policy-mode').getByText('Per coppia di interfacce').click();
  await expect(
    page.locator('[data-testid="row-policies"][data-group-start]').first(),
  ).toBeVisible();
  await page.getByTestId('vdom-select').click();
  await page.getByRole('option', { name: 'DMZ' }).click();
  await expect(page.getByTestId('table-policies')).toHaveAttribute('data-rows', '1');
});

test('lists objects with where they are used', async ({ page }) => {
  await openDevice(page, HQ);
  await page.getByTestId('tab-objects').click();
  await page
    .getByTestId('objects-kind')
    .getByText(/^Gruppi \(/)
    .click();
  await page.locator('[data-testid="row-objects"][data-id="GRP-CORPORATE"]').click();
  await expect(page.getByTestId('object-expanded')).toContainText('LAN-BR1: 10.21.0.0/16');
  await expect(page.getByTestId('object-usage')).toContainText('policy 3');
  await expect(page.locator('[data-testid="row-objects"][data-id="GRP-DNS"]')).toContainText(
    'non usato',
  );
});

test('shows interfaces, routing, VPN and the defaults to check', async ({ page }) => {
  await openDevice(page, HQ);
  await page.getByTestId('tab-interfaces').click();
  await expect(page.locator('[data-testid="row-interfaces"][data-id="VL900-CORE"]')).toContainText(
    '10.10.254.1/29',
  );
  await expect(page.getByTestId('zones')).toContainText('OVERLAY');

  await page.getByTestId('tab-routing').click();
  await expect(page.getByTestId('ospf')).toContainText('VL900-CORE');
  await expect(page.getByTestId('policy-routes')).toContainText('VL50-GUEST');
  await expect(page.getByTestId('bgp')).toContainText('SPOKES-WAN1');
  await page.getByTestId('route-lookup').fill('172.16.10.5');
  await expect(page.locator('[data-testid="row-routes"][data-state="match"]')).toContainText(
    'vlod0',
  );

  await page.getByTestId('tab-vpn').click();
  await page.locator('[data-testid="row-tunnels"][data-id="ADVPN-WAN1"]').click();
  const tunnel = page.getByTestId('tunnel-detail');
  await expect(tunnel).toContainText('hub (sender)');
  await expect(tunnel.locator('[data-default="unverified"]').first()).toBeVisible();
});

test('shows SD-WAN members, health checks and rules with the implicit one', async ({ page }) => {
  await openDevice(page, 'fortigate/fgt-br1-60f-fortios-7.0.conf');
  await page.getByTestId('tab-sdwan').click();
  await expect(page.getByTestId('sdwan-members').locator('tbody tr')).toHaveCount(4);
  await expect(page.getByTestId('sdwan-health-checks')).toContainText('latenza 150 ms');
  await expect(page.getByTestId('sdwan-rule')).toHaveCount(2);
  await expect(page.getByTestId('sdwan-implicit-rule')).toBeVisible();
});
