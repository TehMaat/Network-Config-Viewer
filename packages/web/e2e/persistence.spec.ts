import { expect, test } from '@playwright/test';
import { field, loadFiles, openApp, sampleBytes, samplePath } from './helpers';

// The archive survives a restart and an update of the container (#10). CI runs this file in
// two steps, around "docker compose down" and "docker compose up --build":
//   NCV_PERSISTENCE=prepare npx playwright test persistence --project=chromium
//   NCV_PERSISTENCE=verify npx playwright test persistence --project=chromium

const step = process.env.NCV_PERSISTENCE;
const NAME = 'Persistenza dopo il riavvio';
const CONFIG = 'cisco-ios/sw-br1-acc-c2960x-ios-15.2-stack.txt';
const SHOW = 'show/sw-br1-acc_sessione.txt';
const MODEL = 'WS-C2960X-PROVA';

test.skip(!step, 'only around a restart of the container');

/** A node added by hand to the map of the client (#15, part 3). */
const NODE = 'NAS dopo il riavvio';

test('before the restart: a client with its files, a correction and its map', async ({ page }) => {
  test.skip(step !== 'prepare', 'first step');
  await openApp(page);
  await page.getByTestId('btn-start-new').click();
  await page.getByTestId('input-client-name').fill(NAME);
  await page.getByTestId('btn-client-confirm').click();
  await loadFiles(page, [CONFIG, SHOW].map(samplePath), 2);
  await expect(page.locator('[data-testid="file-item"][data-saved="yes"]')).toHaveCount(2);
  await page.locator('[data-testid="file-item"][data-role="current"]').click();
  await page.getByTestId('btn-edit').click();
  await page.getByTestId('input-model').fill(MODEL);
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH');
  await page.getByTestId('btn-apply').click();
  expect((await saved).ok()).toBe(true);

  await page.getByTestId('nav-map').click();
  await page.getByTestId('btn-map-add-node').click();
  await page.getByTestId('input-external-label').fill(NODE);
  const mapSaved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith('/map'),
  );
  await page.getByTestId('btn-external-save').click();
  expect((await mapSaved).ok()).toBe(true);
});

test('after the restart: everything is still there, byte for byte', async ({ page, request }) => {
  test.skip(step !== 'verify', 'second step');
  // A browser with nothing saved in it, as after cleaning it.
  await openApp(page);
  await page.locator(`[data-testid="client-card"][data-client="${NAME}"]`).click();
  await expect(page.locator('[data-testid="file-item"][data-saved="yes"]')).toHaveCount(2);
  await page.locator('[data-testid="file-item"][data-role="current"]').click();
  await expect(field(page, 'model')).toHaveAttribute('data-value', MODEL);

  const { clients } = (await (await request.get('/api/clients')).json()) as {
    clients: { id: string; name: string }[];
  };
  const client = clients.find((c) => c.name === NAME)!;
  const index = (await (await request.get(`/api/clients/${client.id}`)).json()) as {
    files: { id: string; path: string[] }[];
  };
  for (const rel of [CONFIG, SHOW]) {
    const file = index.files.find((f) => f.path.at(-1) === rel.split('/').at(-1))!;
    const bytes = await (await request.get(`/api/clients/${client.id}/files/${file.id}`)).body();
    expect(bytes.equals(Buffer.from(sampleBytes(rel))), rel).toBe(true);
  }

  // The map changed by hand is there too.
  const map = (await (await request.get(`/api/clients/${client.id}/map`)).json()) as {
    externals?: { label: string }[];
  };
  expect(map.externals?.map((e) => e.label)).toEqual([NODE]);
  await page.getByTestId('nav-map').click();
  await expect(
    page.locator('[data-testid="map-external"]').filter({ hasText: NODE }),
  ).toBeVisible();
});
