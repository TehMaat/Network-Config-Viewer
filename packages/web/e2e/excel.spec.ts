import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { loadFiles, openApp, samplePath, selectFile } from './helpers';

// Excel files made in the browser (#10): the file of a device, with a sheet for every view,
// and the export of a single table as it is shown.

const CORE = 'cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt';
const CORE_SESSION = 'show/sw-hq-core_sessione.txt';
const FGT_HQ = 'fortigate/fgt-hq-100f-fortios-7.2-vdom.conf';
const FGT_BR1 = 'fortigate/fgt-br1-60f-fortios-7.0.conf';
const FGT_BR1_SESSION = 'show/fgt-br1_sessione.txt';

const fileName = (rel: string) => rel.split('/').at(-1)!;

async function download(page: Page, testId: string) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await file.path());
  return { name: file.suggestedFilename(), workbook };
}

/** The values of a sheet, row by row, without the empty first cell of ExcelJS. */
function rowsOf(workbook: ExcelJS.Workbook, sheet: string): unknown[][] {
  const ws = workbook.getWorksheet(sheet);
  if (!ws) throw new Error(`no sheet ${sheet}`);
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    rows.push((row.values as unknown[]).slice(1).map((v) => v ?? ''));
  });
  return rows;
}

test('exports a switch to Excel, a sheet for every view with the real state', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [CORE, CORE_SESSION].map(samplePath), 2);
  await selectFile(page, fileName(CORE));
  const { name, workbook } = await download(page, 'btn-export-device');
  expect(name).toBe('SW-HQ-CORE.xlsx');
  expect(workbook.worksheets.map((w) => w.name)).toEqual([
    'Porte',
    'VLAN',
    'ACL',
    'Routing',
    'MAC',
  ]);

  const ports = rowsOf(workbook, 'Porte');
  expect(ports[0]).toEqual([
    'Porta',
    'Descrizione',
    'Stato',
    'Modalità',
    'VLAN',
    'Voce',
    'Port-channel',
    'PoE',
    '802.1X',
    'IP',
    'Stato reale',
    'MAC',
  ]);
  // The same interfaces as the table of the view.
  expect(ports).toHaveLength(182);
  const gi25 = ports.find((r) => r[0] === 'Gi1/0/25')!;
  expect(gi25).toMatchObject({ 1: 'PDL-025', 2: 'attiva', 10: 'connected', 11: 2 });

  const macs = rowsOf(workbook, 'MAC').filter((r) => r[0] === 'Gi1/0/25');
  expect(macs).toHaveLength(2);
  expect(String(macs[0]![2])).toMatch(/^00:00:5e:00:53:[0-9a-f]{2}$/);
  // The IP of a MAC, from the ARP table of the same switch.
  const po10 = rowsOf(workbook, 'MAC').filter((r) => r[0] === 'Po10');
  expect(po10.map((r) => r[5])).toContain('10.10.99.11');
});

test('exports a FortiGate with a sheet for every view of every VDOM', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [samplePath(FGT_HQ)], 1);
  const { name, workbook } = await download(page, 'btn-export-device');
  expect(name).toBe('FGT-HQ.xlsx');
  const sheets = workbook.worksheets.map((w) => w.name);
  expect(sheets.slice(0, 2)).toEqual(['Interfacce', 'VLAN']);
  for (const sheet of ['Policy OFFICE', 'Oggetti OFFICE', 'Routing OFFICE', 'VPN OFFICE']) {
    expect(sheets).toContain(sheet);
  }
  const policies = rowsOf(workbook, 'Policy OFFICE');
  // The same policies as the view, in the order of evaluation.
  expect(policies).toHaveLength(12);
  expect(policies.find((r) => r[1] === 6)).toMatchObject({
    2: 'Posta-in-ingresso',
    6: 'VIP-MAIL-SMTP',
    8: 'accept',
  });
  const objects = rowsOf(workbook, 'Oggetti OFFICE');
  expect(objects[0]).toEqual(['Categoria', 'Nome', 'Tipo', 'Contenuto', 'Commento']);
  expect(objects.some((r) => r[0] === 'VIP' && r[1] === 'VIP-MAIL-SMTP')).toBe(true);
});

test('exports the SD-WAN of a FortiGate with the member each rule uses', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [FGT_BR1, FGT_BR1_SESSION].map(samplePath), 2);
  await selectFile(page, fileName(FGT_BR1));
  const { workbook } = await download(page, 'btn-export-device');
  const rules = rowsOf(workbook, 'SD-WAN regole');
  expect(rules[0]).toContain('In uso');
  expect(rules.find((r) => r[1] === 'CORPORATE')?.at(-1)).toBe('HUB-WAN1');
  expect(rowsOf(workbook, 'Routing reale').length).toBeGreaterThan(1);
});

test('exports a table as it is shown, filtered and sorted', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [samplePath(FGT_HQ)], 1);
  await page.getByTestId('tab-policies').click();
  await page.getByTestId('filter-policies').fill('OVERLAY');
  const table = page.getByTestId('table-policies');
  const shown = Number(await table.getAttribute('data-rows'));
  expect(shown).toBeGreaterThan(0);
  const headers = (await table.locator('thead th').allInnerTexts())
    .map((h) => h.trim())
    .filter(Boolean);

  const { name, workbook } = await download(page, 'export-policies');
  expect(name).toBe('FGT-HQ-policies.xlsx');
  const rows = rowsOf(workbook, 'policies');
  expect(rows[0]).toEqual(headers);
  expect(rows).toHaveLength(shown + 1);
  for (const row of rows.slice(1)) expect(row.join(' ')).toContain('OVERLAY');
});
