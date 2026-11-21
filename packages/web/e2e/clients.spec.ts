import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  field,
  fileItem,
  loadFiles,
  openApp,
  openConfigTab,
  sampleBytes,
  samplePath,
  selectFile,
} from './helpers';

// The archive of the clients (#10): files kept by the server of the app, grouped by device.
// The tests share the archive of one server: every test works on clients of its own.

const CORE = 'cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt';
const CORE_OLD = 'versioni/sw-hq-core-c9300-iosxe-17.12-stack_2025-06-30.txt';
const CORE_SESSION = 'show/sw-hq-core_sessione.txt';
const BR1 = 'fortigate/fgt-br1-60f-fortios-7.0.conf';
const BR1_OLD = 'versioni/fgt-br1-60f-fortios-7.0_2025-05-12.conf';

const fileName = (rel: string) => rel.split('/').at(-1)!;

/** A name that no other test uses, also when the browsers run side by side. */
function uniqueName(label: string): string {
  const info = test.info();
  return `${label} ${info.project.name} ${info.workerIndex}-${Date.now()}`;
}

async function createClient(page: Page, name: string) {
  const start = page.getByTestId('btn-start-new');
  if (await start.isVisible()) {
    await start.click();
  } else {
    await page.getByTestId('client-menu').click();
    await page.getByTestId('btn-client-new').click();
  }
  await page.getByTestId('input-client-name').fill(name);
  await page.getByTestId('btn-client-confirm').click();
  await expect(page.getByTestId('client-menu')).toHaveAttribute('data-client', name);
}

async function clientMenu(page: Page, item: string) {
  await page.getByTestId('client-menu').click();
  await page.getByTestId(item).click();
}

const saved = (page: Page) => page.locator('[data-testid="file-item"][data-saved="yes"]');

/** A change is saved in the archive when the server has answered it. */
const fileSaved = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/files/'));

interface ClientRow {
  id: string;
  name: string;
}

async function filesOf(request: APIRequestContext, name: string) {
  const { clients } = (await (await request.get('/api/clients')).json()) as {
    clients: ClientRow[];
  };
  const out: { client: string; path: string[]; bytes: Buffer }[] = [];
  for (const client of clients.filter((c) => c.name === name)) {
    const index = (await (await request.get(`/api/clients/${client.id}`)).json()) as {
      files: { id: string; path: string[] }[];
    };
    for (const file of index.files) {
      const bytes = await (await request.get(`/api/clients/${client.id}/files/${file.id}`)).body();
      out.push({ client: client.id, path: file.path, bytes });
    }
  }
  return out;
}

test('creates a client and finds its files again, also from another browser', async ({
  page,
  browser,
}) => {
  const name = uniqueName('Alfa');
  await openApp(page);
  await createClient(page, name);
  await expect(page.getByTestId('empty-state')).toContainText(name);
  await loadFiles(page, [CORE, CORE_SESSION].map(samplePath), 2);
  await expect(saved(page)).toHaveCount(2);

  // The page loaded again: the client opens by itself, with its files.
  await page.reload();
  await expect(page.getByTestId('client-menu')).toHaveAttribute('data-client', name);
  await expect(saved(page)).toHaveCount(2);

  // A browser with nothing saved in it: the client is in the list of the start page.
  const context = await browser.newContext({ locale: 'it-IT' });
  const other = await context.newPage();
  await openApp(other);
  await other.locator(`[data-testid="client-card"][data-client="${name}"]`).click();
  const device = other.locator('[data-testid="device-group"][data-device="SW-HQ-CORE"]');
  await expect(device.getByTestId('file-item')).toHaveCount(2);
  await expect(device.locator('[data-role="show"]')).toHaveAttribute(
    'data-file-name',
    fileName(CORE_SESSION),
  );
  await context.close();
});

test('keeps the corrections, and the files byte for byte', async ({ page }) => {
  await openApp(page);
  await createClient(page, uniqueName('Beta'));
  await loadFiles(page, [samplePath(BR1)], 1);
  await expect(saved(page)).toHaveCount(1);

  await page.getByTestId('btn-edit').click();
  await page.getByTestId('input-hostname').fill('FGT-FILIALE-UNO');
  const patched = fileSaved(page);
  await page.getByTestId('btn-apply').click();
  await patched;

  await page.reload();
  await expect(saved(page)).toHaveCount(1);
  await selectFile(page, fileName(BR1));
  await page.getByTestId('tab-summary').click();
  await expect(field(page, 'hostname')).toHaveAttribute('data-value', 'FGT-FILIALE-UNO');
  await expect(page.getByTestId('edited-badge')).toBeVisible();

  // What comes back from the archive is the original file.
  await openConfigTab(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('btn-download').click(),
  ]);
  expect(readFileSync(await download.path())).toEqual(sampleBytes(BR1));
});

test('groups the versions of a device and lets the user choose the current one', async ({
  page,
}) => {
  await openApp(page);
  await createClient(page, uniqueName('Gamma'));
  await loadFiles(page, [CORE_OLD, CORE, CORE_SESSION].map(samplePath), 3);
  await expect(saved(page)).toHaveCount(3);

  const device = page.locator('[data-testid="device-group"][data-device="SW-HQ-CORE"]');
  const current = device.locator('[data-role="current"]');
  const previous = device.locator('[data-role="version"]');
  // The most recent by the date written in the config.
  await expect(current).toHaveAttribute('data-file-name', fileName(CORE));
  await expect(current.getByTestId('version-date')).toHaveAttribute(
    'data-date',
    '2025-10-22T18:30:12.000Z',
  );
  await expect(previous).toHaveAttribute('data-file-name', fileName(CORE_OLD));
  // The shows go with the current version.
  await current.click();
  await expect(page.getByTestId('summary-show')).toHaveCount(1);

  // The previous one chosen by hand: it becomes the current one, also after a reload.
  const patched = fileSaved(page);
  await previous.getByTestId('btn-pin').click();
  await patched;
  await expect(current).toHaveAttribute('data-file-name', fileName(CORE_OLD));
  await expect(current.getByTestId('version-badge')).toHaveText('attuale, scelta a mano');
  await page.reload();
  await expect(saved(page)).toHaveCount(3);
  await expect(current).toHaveAttribute('data-file-name', fileName(CORE_OLD));
  await current.click();
  await expect(page.getByTestId('summary-show')).toHaveCount(1);

  // Back to the most recent.
  await current.getByTestId('btn-unpin').click();
  await expect(current).toHaveAttribute('data-file-name', fileName(CORE));
});

test('saves the files loaded without a client in a new client or in an existing one', async ({
  page,
}) => {
  const name = uniqueName('Delta');
  await openApp(page);
  await loadFiles(page, [samplePath(BR1)], 1);
  await expect(page.getByTestId('unsaved-notice')).toContainText('1 file non salvato');
  await page.getByTestId('btn-save-to-client').click();
  await expect(page.getByTestId('check-keep-files')).toBeChecked();
  await page.getByTestId('input-client-name').fill(name);
  await page.getByTestId('btn-client-confirm').click();
  await expect(page.getByTestId('client-menu')).toHaveAttribute('data-client', name);
  await expect(saved(page)).toHaveCount(1);

  // Closed, then files loaded without a client and added to it when it opens.
  await clientMenu(page, 'btn-client-close');
  await expect(page.getByTestId('clients-start')).toBeVisible();
  await loadFiles(page, [samplePath(BR1_OLD)], 1);
  await page.getByTestId('client-menu').click();
  await page.locator(`[data-testid="client-option"][data-client="${name}"]`).click();
  await page.getByTestId('btn-switch-add').click();
  await expect(page.getByTestId('client-menu')).toHaveAttribute('data-client', name);
  await expect(saved(page)).toHaveCount(2);
  const device = page.locator('[data-testid="device-group"][data-device="FGT-BR1"]');
  await expect(device.locator('[data-role="version"]')).toHaveAttribute(
    'data-file-name',
    fileName(BR1_OLD),
  );
});

test('exports a client to a zip file and imports it back, byte for byte', async ({
  page,
  request,
}) => {
  const name = uniqueName('Epsilon');
  await openApp(page);
  await createClient(page, name);
  await loadFiles(page, [CORE, BR1_OLD].map(samplePath), 2);
  await expect(saved(page)).toHaveCount(2);

  await page.getByTestId('client-menu').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('btn-client-export').click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${name}.zip`);

  await page.getByTestId('client-import-input').setInputFiles(await download.path());
  await expect(page.getByTestId('client-menu')).toHaveAttribute('data-client', name);
  await expect(saved(page)).toHaveCount(2);

  // Two clients with the same files: the original and the one imported.
  const files = await filesOf(request, name);
  expect(new Set(files.map((f) => f.client)).size).toBe(2);
  expect(files).toHaveLength(4);
  for (const file of files) {
    const rel = [CORE, BR1_OLD].find((r) => fileName(r) === file.path.at(-1))!;
    expect(file.bytes.equals(Buffer.from(sampleBytes(rel))), rel).toBe(true);
  }
});

test('deletes a file and then the client, after asking', async ({ page }) => {
  const name = uniqueName('Zeta');
  await openApp(page);
  await createClient(page, name);
  await loadFiles(page, [CORE, BR1].map(samplePath), 2);
  await expect(saved(page)).toHaveCount(2);

  await fileItem(page, fileName(BR1)).getByTestId('btn-remove').click();
  await page.getByTestId('btn-file-delete-confirm').click();
  await expect(page.getByTestId('file-item')).toHaveCount(1);
  await page.reload();
  await expect(saved(page)).toHaveCount(1);

  await clientMenu(page, 'btn-client-delete');
  await page.getByTestId('btn-client-delete-confirm').click();
  await expect(page.getByTestId('clients-start')).toBeVisible();
  await expect(page.locator(`[data-testid="client-card"][data-client="${name}"]`)).toHaveCount(0);
});

test('imports the example client of the samples, ready to try', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('btn-start-import').click();
  await page.getByTestId('client-import-input').setInputFiles(samplePath('cliente-esempio.zip'));
  await expect(page.getByTestId('client-menu')).toHaveAttribute('data-client', 'Esempio Rete Srl');
  await expect(saved(page)).toHaveCount(23);
  await expect(page.getByTestId('device-group')).toHaveCount(12);
  const core = page.locator('[data-testid="device-group"][data-device="SW-HQ-CORE"]');
  await expect(core.locator('[data-role="version"]')).toHaveCount(1);
  await expect(core.locator('[data-role="show"]')).toHaveCount(3);
});

test('accepts changes to the archive only from the app', async ({ page }) => {
  await openApp(page);
  const status = await page.evaluate(async () => {
    const response = await fetch('api/clients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Senza intestazione' }),
    });
    return response.status;
  });
  expect(status).toBe(403);
});
