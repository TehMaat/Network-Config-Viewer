import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadFiles, openApp, SAMPLES_DIR, samplePath, selectFile } from './helpers';

// The consistency checks between the devices of a client (#15, part 2): the problems on the map
// and in the list under it, in the summary of every device, the VPN of the client with ADVPN,
// and the gateway of a VLAN on another device.

/** Every configuration and file of shows of the samples: the whole example client. */
const ALL = ['fortigate', 'cisco-ios', 'cisco-sb', 'show'].flatMap((dir) =>
  readdirSync(join(SAMPLES_DIR, dir)).map((f) => `${dir}/${f}`),
);

async function openClient(page: Page, files = ALL) {
  await openApp(page);
  await loadFiles(page, files.map(samplePath), files.length);
}

/** A row of the list of the problems, by the code of its check. */
const problemRow = (page: Page, code: string) =>
  page.locator(`[data-testid="row-problems"][data-id^="${code}|"]`);

const deviceMark = (page: Page, hostname: string) =>
  page
    .locator(`[data-testid="map-device"][data-device="${hostname}"]`)
    .getByTestId('map-device-problems');

test('marks the problems on the map and lists them under it', async ({ page }) => {
  await openClient(page);
  await expect(page.getByTestId('nav-map-problems')).toHaveAttribute('data-count', '12');
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  await expect(page.getByTestId('map-problems-summary')).toHaveText(
    '4 errori, 7 avvisi, 1 informazione',
  );
  // On the devices: the most serious problem gives the colour.
  await expect(deviceMark(page, 'FGT-BR2')).toHaveAttribute('data-severity', 'error');
  await expect(deviceMark(page, 'FGT-BR2')).toHaveAttribute('data-count', '4');
  await expect(deviceMark(page, 'SW-BR2-ACC')).toHaveAttribute('data-severity', 'info');
  await expect(deviceMark(page, 'SW-HQ-ACC1')).toHaveCount(0);
  await expect(page.getByTestId('map-edge-problems')).not.toHaveCount(0);
  // In the list: the most serious first.
  await expect(page.getByTestId('table-problems')).toHaveAttribute('data-rows', '12');
  await expect(page.getByTestId('row-problems').first()).toContainText('Errore');
  await expect(page.getByTestId('row-problems').last()).toContainText('Informazione');

  // A problem of a link: the two sides, with the values that do not agree.
  await problemRow(page, 'lag-mode').click();
  const panel = page.getByTestId('map-link-panel');
  await expect(panel).toHaveAttribute('data-kind', 'lag');
  await expect(panel.locator('[data-row="lacp"]')).toHaveAttribute('data-problem', 'error');
  const item = page.getByTestId('map-link-problem-list').getByTestId('problem');
  await expect(item).toHaveAttribute('data-code', 'lag-mode');
  await expect(item.getByTestId('problem-title')).toHaveText(
    'SW-HQ-ACC3 Port-channel1 ↔ SW-HQ-CORE Port-channel12: protocollo del LAG incompatibile',
  );
  await expect(item.getByTestId('problem-why')).toContainText(
    'SW-HQ-ACC3 usa statico (on), SW-HQ-CORE usa LACP active',
  );
  await expect(item.getByTestId('problem-fix')).toContainText('LACP');
  // The lines of both sides open the configuration of each device.
  await expect(item.getByTestId('map-evidence')).toHaveCount(2);
  await item.getByTestId('map-evidence').first().click();
  await expect(page.getByTestId('file-title')).toHaveText('sw-hq-acc3-c1300-48p-4.1-stack.txt');
  await expect(page.getByTestId('config-editor')).toBeVisible();

  // A problem of addresses has no link: it shows its first device.
  await page.getByTestId('nav-map').click();
  await problemRow(page, 'ip-duplicate').click();
  await expect(page.getByTestId('map-node-panel')).toHaveAttribute('data-node', 'fgt-br2');
  await expect(
    page.getByTestId('map-node-problem-list').locator('[data-code="ip-duplicate"]'),
  ).toContainText('Indirizzo 10.10.10.1 duplicato');
});

test('says what is to be checked, and exports the problems to Excel', async ({ page }) => {
  await openClient(page);
  await page.getByTestId('nav-map').click();
  // A default of FortiOS not confirmed yet: a warning to check, never an error.
  const dh = problemRow(page, 'ipsec-dhgrp');
  await expect(dh.getByTestId('problem-severity')).toHaveText('Avviso');
  await expect(dh.getByTestId('problem-unverified')).toHaveText('da verificare');
  await dh.click();
  await expect(page.getByTestId('map-link-panel').locator('[data-row="dhgrp"]')).toContainText(
    '14 5 (predefinito, da verificare)',
  );
  await expect(page.getByTestId('map-link-comparison')).toHaveText('2 incoerenze');

  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-problems').click(),
  ]);
  expect(file.suggestedFilename()).toBe('mappa-problems.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await file.path());
  const rows: string[][] = [];
  workbook.getWorksheet('problems')!.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? '')));
  });
  // The explanation and the fix are only in the file.
  expect(rows[0]).toEqual([
    'Gravità',
    'Problema',
    'Apparati',
    'Collegamento',
    'Perché',
    'Come sistemare',
  ]);
  expect(rows).toHaveLength(13);
  const lag = rows.find((r) => r[1]!.includes('protocollo del LAG'))!;
  expect(lag[0]).toBe('Errore');
  expect(lag[2]).toBe('SW-HQ-ACC3, SW-HQ-CORE');
  expect(lag[5]).toContain('LACP');
  expect(rows.find((r) => r[1]!.includes('gruppo DH'))![0]).toBe('Avviso (da verificare)');
});

test('shows the problems of a device in its summary, and opens them on the map', async ({
  page,
}) => {
  await openClient(page);
  // In the list of the files, a mark on the devices with problems.
  const mark = (hostname: string) =>
    page
      .locator(`[data-testid="device-group"][data-device="${hostname}"]`)
      .getByTestId('device-problems');
  await expect(mark('FGT-BR2')).toHaveAttribute('data-severity', 'error');
  await expect(mark('FGT-CAMPUS')).toHaveAttribute('data-severity', 'warning');
  await expect(mark('SW-HQ-ACC1')).toHaveCount(0);

  await selectFile(page, 'fgt-br2-60f-fortios-7.4.conf');
  const summary = page.getByTestId('summary-problems');
  await expect(summary).toContainText('3 errori, 1 avviso');
  await expect(summary.getByTestId('problem')).toHaveCount(4);
  await summary.locator('[data-code="ipsec-proposals"]').getByTestId('problem-show-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
  const panel = page.getByTestId('map-link-panel');
  await expect(panel).toHaveAttribute('data-kind', 'ipsec');
  await expect(panel.locator('[data-row="proposals"]')).toHaveAttribute('data-problem', 'error');

  // A device without problems has none in its summary.
  await selectFile(page, 'sw-hq-acc1-c3850-iosxe-16.12-stack.txt');
  await expect(page.getByTestId('view-summary')).toBeVisible();
  await expect(page.getByTestId('summary-problems')).toHaveCount(0);
});

test('shows the VPN of the client: tunnels, comparison and ADVPN', async ({ page }) => {
  await openClient(page);
  await page.getByTestId('nav-vpn').click();
  await expect(page.getByTestId('vpn-view')).toBeVisible();
  await expect(page.getByTestId('vpn-summary')).toHaveText(
    '6 tunnel IPsec tra gli apparati, 1 scorciatoia ADVPN negli show',
  );
  await expect(page.getByTestId('table-vpn-tunnels')).toHaveAttribute('data-rows', '7');
  const tunnel = (...texts: string[]) => {
    let row = page.getByTestId('row-vpn-tunnels');
    for (const text of texts) row = row.filter({ hasText: text });
    return row;
  };
  await expect(tunnel('FGT-DC', 'VPN-HQ')).toContainText('Statico');
  await expect(tunnel('FGT-DC', 'VPN-HQ').getByTestId('vpn-comparison')).toHaveText(
    '8 parametri coerenti',
  );
  await expect(tunnel('FGT-BR1', 'HUB-WAN1').getByTestId('vpn-comparison')).toHaveText(
    '9 parametri coerenti',
  );
  await expect(tunnel('Scorciatoia ADVPN')).toContainText('FGT-BR1');

  // The detail is the one of the map.
  await tunnel('FGT-BR2', 'HUB-WAN2').click();
  const panel = page.getByTestId('vpn-panel').getByTestId('map-link-panel');
  await expect(panel.getByTestId('map-link-comparison')).toHaveText('2 incoerenze');
  await expect(panel.locator('[data-row="proposals"]')).toHaveAttribute('data-problem', 'error');
  await expect(panel.locator('[data-row="dhgrp"]')).toHaveAttribute('data-problem', 'warning');

  // ADVPN: roles, checks and every pair of branches.
  const roles = page.getByTestId('advpn-role');
  await expect(roles).toHaveCount(4);
  await expect(page.locator('[data-testid="advpn-role"][data-role="hub"]')).toHaveAttribute(
    'data-device',
    'FGT-HQ',
  );
  await expect(
    page.getByTestId('advpn-checks').locator('[data-code="advpn-spoke-policy"]'),
  ).toContainText('FGT-CAMPUS: nessuna policy verso le altre filiali');
  await expect(page.getByTestId('advpn-pair-status')).toHaveText([
    'attiva',
    'non possibile',
    'non possibile',
  ]);
  await expect(page.getByTestId('row-advpn-pairs').nth(1)).toContainText(
    'FGT-CAMPUS: nessuna policy verso le altre filiali',
  );
  // The active pair opens its shortcut.
  await page.getByTestId('row-advpn-pairs').first().click();
  await expect(page.getByTestId('vpn-panel').getByTestId('map-link-panel')).toHaveAttribute(
    'data-kind',
    'shortcut',
  );
});

test('finds the gateway of a VLAN on another device, along the trunks', async ({ page }) => {
  await openClient(page, [
    'cisco-ios/sw-hq-acc1-c3850-iosxe-16.12-stack.txt',
    'cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt',
    'fortigate/fgt-hq-100f-fortios-7.2-vdom.conf',
  ]);
  await selectFile(page, 'sw-hq-acc1-c3850-iosxe-16.12-stack.txt');
  await page.getByTestId('tab-vlans').click();
  const vlan = (id: number) => page.locator(`[data-testid="row-vlans"][data-id="${id}"]`);
  await expect(vlan(10).getByTestId('vlan-remote-gateway')).toHaveText('su FGT-HQ');
  await expect(vlan(10)).toContainText('10.10.10.1/24');
  await expect(vlan(70).getByTestId('vlan-remote-gateway')).toHaveText('su SW-HQ-CORE');
  await vlan(10).click();
  await expect(page.getByTestId('vlan-gateway-detail')).toContainText(
    'Gateway: 10.10.10.1/24 su FGT-HQ (VL10-DATA), attraverso SW-HQ-ACC1 → SW-HQ-CORE → FGT-HQ.',
  );
  await page.getByTestId('vlan-gateway-open').click();
  await expect(page.getByTestId('file-title')).toHaveText('fgt-hq-100f-fortios-7.2-vdom.conf');
});

test('explains the problems in English too', async ({ page }) => {
  await openClient(page);
  await page.getByTestId('language-switch').getByText('EN').click();
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('map-problems-summary')).toHaveText('4 errors, 7 warnings, 1 note');
  await problemRow(page, 'trunk-native').click();
  const item = page.getByTestId('map-link-problem-list').getByTestId('problem');
  await expect(item.getByTestId('problem-title')).toHaveText(
    'SW-HQ-ACC2 Port-channel1 ↔ SW-HQ-CORE Port-channel11: different native VLAN',
  );
  await expect(item.getByTestId('problem-why')).toHaveText(
    'The native VLAN is 999 on SW-HQ-ACC2 and 1 on SW-HQ-CORE: untagged traffic ends up in different VLANs on the two sides.',
  );
});
