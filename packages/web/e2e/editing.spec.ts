import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loadFiles, openApp, samplePath } from './helpers';

// The map changed by hand (#15, part 3): nodes and links added by hand, inferred links
// confirmed, discarded and corrected, sites renamed and merged, devices moved; everything kept
// in the client (map.json), or in the tab without a client. And the map as a draw.io file, a
// PNG and an SVG.

const HQ = 'fortigate/fgt-hq-100f-fortios-7.2-vdom.conf';
const CORE = 'cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt';
const ACC3 = 'cisco-sb/sw-hq-acc3-c1300-48p-4.1-stack.txt';
const BR1 = 'fortigate/fgt-br1-60f-fortios-7.0.conf';
const BR1_SWITCH = 'cisco-ios/sw-br1-acc-c2960x-ios-15.2-stack.txt';
const BR2 = 'fortigate/fgt-br2-60f-fortios-7.4.conf';

/** A name that no other test uses, also when the browsers run side by side. */
function uniqueName(label: string): string {
  const info = test.info();
  return `${label} ${info.project.name} ${info.workerIndex}-${Date.now()}`;
}

async function createClient(page: Page, name: string) {
  await page.getByTestId('btn-start-new').click();
  await page.getByTestId('input-client-name').fill(name);
  await page.getByTestId('btn-client-confirm').click();
  await expect(page.getByTestId('client-menu')).toHaveAttribute('data-client', name);
}

async function openMap(page: Page) {
  await page.getByTestId('nav-map').click();
  await expect(page.getByTestId('map-canvas')).toBeVisible();
}

/** The map of the client is written when the server has answered. */
const mapSaved = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/map'));

/** Types in a field with suggestions and picks one of them. */
async function pick(page: Page, field: Locator, text: string, option = text) {
  await field.fill(text);
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function addNode(page: Page, label: string, site: string) {
  await page.getByTestId('btn-map-add-node').click();
  await page.getByTestId('input-external-label').fill(label);
  await pick(page, page.getByTestId('input-external-site'), site);
  await page.getByTestId('btn-external-save').click();
}

async function addLink(page: Page, a: string, port: string, b: string, note: string) {
  await page.getByTestId('btn-map-add-link').click();
  await page.getByTestId('select-link-a').click();
  await page.getByRole('option', { name: a, exact: true }).click();
  await page.getByTestId('input-link-a-interface').fill(port);
  await page.getByTestId('select-link-b').click();
  await page.getByRole('option', { name: b, exact: true }).click();
  await page.getByTestId('input-link-note').fill(note);
  await page.getByTestId('btn-link-save').click();
}

const external = (page: Page, id: string) =>
  page.locator(`[data-testid="map-external"][data-external="${id}"]`);

const linkRow = (page: Page, ...texts: string[]) => {
  let row = page.getByTestId('row-links');
  for (const text of texts) row = row.filter({ hasText: text });
  return row;
};

test('adds a node and a link by hand, kept in the client and seen from another browser', async ({
  page,
  browser,
  request,
}) => {
  const name = uniqueName('Mappa');
  await openApp(page);
  await createClient(page, name);
  await loadFiles(page, [HQ, CORE].map(samplePath), 2);
  await expect(page.locator('[data-testid="file-item"][data-saved="yes"]')).toHaveCount(2);
  await openMap(page);
  await expect(page.getByTestId('map-save-state')).toHaveAttribute('data-state', 'saved');

  const nodeSaved = mapSaved(page);
  await addNode(page, 'NAS backup', 'Sede');
  expect((await nodeSaved).ok()).toBe(true);
  await expect(external(page, 'manual:nas-backup')).toBeVisible();
  const linkSaved = mapSaved(page);
  await addLink(page, 'SW-HQ-CORE', 'Gi1/0/10', 'NAS backup', 'Visto in sede');
  expect((await linkSaved).ok()).toBe(true);
  await expect(page.getByTestId('map-save-state')).toHaveAttribute('data-state', 'saved');
  await linkRow(page, 'NAS backup').click();
  const panel = page.getByTestId('map-link-panel');
  await expect(panel.getByTestId('map-link-manual')).toHaveText('a mano');
  await expect(panel.getByTestId('map-link-note')).toHaveText('Visto in sede');
  await expect(panel.locator('[data-row="interface"]')).toContainText('GigabitEthernet1/0/10');

  // In the archive of the client, readable by hand.
  const { clients } = (await (await request.get('/api/clients')).json()) as {
    clients: { id: string; name: string }[];
  };
  const id = clients.find((c) => c.name === name)!.id;
  const map = (await (await request.get(`/api/clients/${id}/map`)).json()) as {
    externals: unknown[];
    links: unknown[];
  };
  expect(map.externals).toEqual([{ id: 'nas-backup', label: 'NAS backup', site: 'Sede' }]);
  expect(map.links).toEqual([
    {
      id: 'link-1',
      kind: 'cable',
      a: { device: 'SW-HQ-CORE', interface: 'Gi1/0/10' },
      b: { external: 'nas-backup' },
      note: 'Visto in sede',
    },
  ]);

  // Another browser, with nothing saved in it: the same map.
  const context = await browser.newContext({ locale: 'it-IT' });
  const other = await context.newPage();
  await openApp(other);
  await other.locator(`[data-testid="client-card"][data-client="${name}"]`).click();
  await expect(other.locator('[data-testid="file-item"][data-saved="yes"]')).toHaveCount(2);
  await openMap(other);
  await expect(external(other, 'manual:nas-backup')).toBeVisible();
  await expect(linkRow(other, 'NAS backup')).toContainText('a mano');
  await context.close();

  // Deleted, the node takes its link away with it.
  await external(page, 'manual:nas-backup').click();
  const deleted = mapSaved(page);
  await page.getByTestId('btn-external-delete').click();
  expect((await deleted).ok()).toBe(true);
  await expect(external(page, 'manual:nas-backup')).toHaveCount(0);
  await expect(linkRow(page, 'NAS backup')).toHaveCount(0);
});

test('confirms, discards, restores and corrects the inferred links', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [HQ, CORE, ACC3].map(samplePath), 3);
  await openMap(page);
  // Without a client, the changes stay in the tab, and the page says so.
  await expect(page.getByTestId('map-save-state')).toHaveAttribute('data-state', 'tab');
  const lag = 'lag:sw-hq-acc3/default/port-channel1|sw-hq-core/default/port-channel12';
  const row = page.locator(`[data-testid="row-links"][data-id="${lag}"]`);
  await page.getByTestId('filter-links').fill('SW-HQ-ACC3');
  await row.click();
  const panel = page.getByTestId('map-link-panel');
  await expect(panel).toHaveAttribute('data-link', lag);

  await panel.getByTestId('btn-link-confirm').click();
  await expect(panel.getByTestId('map-link-confirmed')).toHaveText('confermato a mano');
  await expect(row).toContainText('confermato a mano');
  await panel.getByTestId('btn-link-unconfirm').click();
  await expect(panel.getByTestId('map-link-confirmed')).toHaveCount(0);

  // Discarded: off the map and the list, among the discarded ones, until restored.
  await panel.getByTestId('btn-link-discard').click();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('map-link-panel')).toHaveCount(0);
  const discarded = page.getByTestId('discarded-link');
  await expect(discarded).toHaveAttribute('data-link', lag);
  await discarded.getByTestId('btn-link-restore').click();
  await expect(row).toHaveCount(1);
  await expect(page.getByTestId('map-discarded')).toHaveCount(0);

  // Corrected: a link by hand takes its place; deleted, the inferred one is back.
  await row.click();
  await page.getByTestId('btn-link-correct').click();
  await expect(page.getByTestId('select-link-a')).toHaveValue('SW-HQ-ACC3');
  await expect(page.getByTestId('input-link-b-interface')).toHaveValue('Port-channel12');
  await page.getByTestId('input-link-b-interface').fill('Port-channel10');
  await page.getByTestId('btn-link-save').click();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('discarded-link')).toHaveAttribute('data-link', lag);
  await page.getByTestId('filter-links').fill('a mano');
  await page.getByTestId('row-links').first().click();
  await expect(page.getByTestId('map-link-panel').locator('[data-row="interface"]')).toContainText(
    'Port-channel10',
  );
  await page.getByTestId('btn-link-delete').click();
  await page.getByTestId('filter-links').fill('SW-HQ-ACC3');
  await expect(row).toHaveCount(1);
});

test('renames and merges sites, and moves a device to another site', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [BR1, BR1_SWITCH, BR2].map(samplePath), 3);
  await openMap(page);
  const site = (name: string) => page.locator(`[data-testid="map-site"][data-site="${name}"]`);
  await expect(site('Filiale 1')).toBeVisible();
  await expect(site('Filiale 2')).toBeVisible();

  // The same name merges two sites.
  await page.getByTestId('btn-map-sites').click();
  await page.locator('[data-testid="input-site-name"][data-site="Filiale 2"]').fill('Filiali');
  await page.locator('[data-testid="input-site-name"][data-site="Filiale 1"]').fill('Filiali');
  await page.getByTestId('btn-sites-save').click();
  await expect(site('Filiali')).toBeVisible();
  await expect(page.getByTestId('map-site')).toHaveCount(1);
  await expect(page.getByTestId('site-header')).toHaveText(['Filiali']);

  // A device in a site of its own, then back where it was.
  await page.locator('[data-testid="map-device"][data-device="FGT-BR2"]').click();
  await page.getByTestId('input-device-site').fill('Magazzino');
  await page.getByTestId('btn-device-site').click();
  await expect(site('Magazzino')).toBeVisible();
  await expect(page.getByTestId('site-header')).toHaveText(['Filiali', 'Magazzino']);
  await page.getByTestId('btn-device-site-reset').click();
  await expect(site('Magazzino')).toHaveCount(0);
});

test('moves a device on the map, and goes back to the automatic layout', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [HQ, CORE].map(samplePath), 2);
  await openMap(page);
  const device = page.locator('[data-testid="map-device"][data-device="SW-HQ-CORE"]');
  const before = (await device.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 90, before.y + before.height / 2 + 40, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByTestId('btn-map-reset-layout')).toBeVisible();
  const after = (await device.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(20);
  await page.getByTestId('btn-map-reset-layout').click();
  await expect(page.getByTestId('btn-map-reset-layout')).toHaveCount(0);
  await expect
    .poll(async () => Math.abs((await device.boundingBox())!.x - before.x))
    .toBeLessThan(3);
});

test('keeps the changes of the tab when its files are saved in a client', async ({
  page,
  request,
}) => {
  const name = uniqueName('Scheda');
  await openApp(page);
  await loadFiles(page, [HQ, CORE].map(samplePath), 2);
  await openMap(page);
  await addNode(page, 'Router MPLS', 'Sede');
  await expect(external(page, 'manual:router-mpls')).toBeVisible();

  await page.getByTestId('btn-save-to-client').click();
  await page.getByTestId('input-client-name').fill(name);
  await page.getByTestId('btn-client-confirm').click();
  await expect(page.getByTestId('client-menu')).toHaveAttribute('data-client', name);
  await expect(page.locator('[data-testid="file-item"][data-saved="yes"]')).toHaveCount(2);
  await openMap(page);
  await expect(page.getByTestId('map-save-state')).toHaveAttribute('data-state', 'saved');
  await expect(external(page, 'manual:router-mpls')).toBeVisible();

  const { clients } = (await (await request.get('/api/clients')).json()) as {
    clients: { id: string; name: string }[];
  };
  const id = clients.find((c) => c.name === name)!.id;
  const map = (await (await request.get(`/api/clients/${id}/map`)).json()) as {
    externals: { label: string }[];
  };
  expect(map.externals.map((e) => e.label)).toEqual(['Router MPLS']);
});

test('exports the map to draw.io, PNG and SVG', async ({ page }) => {
  await openApp(page);
  await loadFiles(page, [HQ, CORE, ACC3].map(samplePath), 3);
  await openMap(page);
  const download = async (kind: string) => {
    await page.getByTestId('btn-map-export').click();
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(`btn-export-${kind}`).click(),
    ]);
    return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
  };

  const drawio = await download('drawio');
  expect(drawio.name).toBe('mappa-map.drawio');
  // Read as draw.io reads it: sites, devices and links, with their labels.
  const read = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    const cells = [...doc.querySelectorAll('mxCell')];
    return {
      diagram: doc.querySelector('diagram')?.getAttribute('name'),
      sites: cells.filter((c) => c.getAttribute('style')?.includes('container=1')).length,
      values: cells.map((c) => c.getAttribute('value') ?? '').join('\n'),
      edges: cells.filter((c) => c.getAttribute('edge') === '1').length,
    };
  }, drawio.bytes.toString('utf8'));
  expect(read).not.toBeNull();
  expect(read!.diagram).toBe('mappa');
  expect(read!.sites).toBe(1);
  for (const host of ['FGT-HQ', 'SW-HQ-CORE', 'SW-HQ-ACC3', 'Internet']) {
    expect(read!.values).toContain(host);
  }
  expect(read!.edges).toBeGreaterThan(4);

  const png = await download('png');
  expect(png.name).toBe('mappa-map.png');
  expect(png.bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const svg = await download('svg');
  expect(svg.name).toBe('mappa-map.svg');
  expect(svg.bytes.toString('utf8')).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  await expect(page.getByTestId('map-export-error')).toHaveCount(0);
});

test('keeps a link by hand towards a device that is no longer in the client, and says so', async ({
  page,
}) => {
  await openApp(page);
  await page.getByTestId('btn-start-import').click();
  await page.getByTestId('client-import-input').setInputFiles(samplePath('cliente-esempio.zip'));
  await expect(page.locator('[data-testid="file-item"][data-saved="yes"]')).toHaveCount(24);
  await openMap(page);
  // The map of the example client: nodes and links added by hand, a LAG confirmed.
  await expect(external(page, 'manual:sw-dc')).toBeVisible();
  await expect(external(page, 'manual:server-dmz')).toBeVisible();
  const missing = external(page, 'missing:sw-hq-mag');
  await expect(missing).toBeVisible();
  await page.locator('[data-testid="row-problems"]').filter({ hasText: 'SW-HQ-MAG' }).click();
  const panel = page.getByTestId('map-link-panel');
  await expect(panel.getByTestId('map-link-manual')).toBeVisible();
  await expect(panel.getByTestId('map-link-problem-list').getByTestId('problem')).toHaveAttribute(
    'data-code',
    'manual-orphan',
  );
  await missing.click();
  await expect(page.getByTestId('map-node-missing')).toBeVisible();
});
