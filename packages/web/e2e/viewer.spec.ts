import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  expectedDetections,
  field,
  fileItem,
  loadFiles,
  openApp,
  openConfigTab,
  sampleBytes,
  samplePath,
  selectFile,
} from './helpers';

test('recognises every sample configuration and command output', async ({ page }) => {
  const expected = expectedDetections();
  const paths = Object.keys(expected);
  await openApp(page);
  await loadFiles(page, paths.map(samplePath), paths.length);

  for (const [rel, exp] of Object.entries(expected)) {
    const name = rel.split('/').at(-1)!;
    await selectFile(page, name);
    await expect(field(page, 'kind'), rel).toHaveAttribute('data-value', exp.kind);
    await expect(field(page, 'vendor'), rel).toHaveAttribute('data-value', exp.vendor ?? '');
    await expect(field(page, 'os'), rel).toHaveAttribute('data-value', exp.os ?? '');
    await expect(field(page, 'version'), rel).toHaveAttribute('data-value', exp.version ?? '');
    await expect(field(page, 'model'), rel).toHaveAttribute('data-value', exp.model ?? '');
    await expect(field(page, 'hostname'), rel).toHaveAttribute('data-value', exp.hostname ?? '');
    if (exp.stack)
      await expect(field(page, 'stack'), rel).toHaveAttribute('data-value', String(exp.stack));
    else await expect(field(page, 'stack'), rel).toHaveCount(0);
    if (exp.vdoms)
      await expect(field(page, 'vdoms'), rel).toHaveAttribute('data-value', exp.vdoms.join(','));
    if (exp.commands) {
      await expect(field(page, 'commands'), rel).toHaveAttribute(
        'data-value',
        exp.commands.join('|'),
      );
    }
  }
});

test.describe('the text is the original, byte for byte', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  for (const rel of [
    'cisco-ios/sw-br1-acc-c2960x-ios-15.2-stack.txt',
    'fortigate/fgt-campus-200f-fortios-7.6.conf',
  ]) {
    test(`copies ${rel} exactly`, async ({ page }) => {
      const original = readFileSync(samplePath(rel), 'utf8');
      await openApp(page);
      await loadFiles(page, [samplePath(rel)], 1);
      await openConfigTab(page);

      await page.getByTestId('btn-copy').click();
      await expect(page.getByTestId('copy-feedback')).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(original);

      // Selecting everything in the viewer and copying gives the same text.
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.getByTestId('config-editor').click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('ControlOrMeta+c');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(original);
    });
  }

  test('downloads the original bytes', async ({ page }) => {
    const rel = 'cisco-ios/sw-br1-acc-c2960x-ios-15.2-stack.txt';
    await openApp(page);
    await loadFiles(page, [samplePath(rel)], 1);
    await expect(page.getByTestId('badge-eol')).toHaveAttribute('data-value', 'crlf');
    await openConfigTab(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('btn-download').click(),
    ]);
    expect(download.suggestedFilename()).toBe('sw-br1-acc-c2960x-ios-15.2-stack.txt');
    expect(readFileSync(await download.path())).toEqual(sampleBytes(rel));
  });
});

test('folds, searches and navigates the outline', async ({ page }) => {
  const rel = 'fortigate/fgt-hq-100f-fortios-7.2-vdom.conf';
  const lines = readFileSync(samplePath(rel), 'utf8').split('\n');
  // The second "edit OFFICE" opens the VDOM content (the first one only declares it).
  const officeLine = lines.findIndex((l, i) => l === 'edit OFFICE' && i > 20) + 1;

  await openApp(page);
  await loadFiles(page, [samplePath(rel)], 1);

  const outline = page.getByTestId('outline');
  await expect(outline.getByTestId('outline-entry').first()).toHaveText('config vdom');
  await outline.locator(`[data-testid="outline-entry"][data-line="${officeLine}"]`).click();
  await expect(page.locator('.cm-activeLine')).toHaveText('edit OFFICE');

  // Two VDOMs have a policy table; "root" has none.
  await outline.getByRole('textbox').fill('firewall policy');
  await expect(outline.getByTestId('outline-entry')).toHaveCount(2);

  await page.getByTestId('btn-fold-all').click();
  await expect(page.locator('.cm-foldPlaceholder').first()).toBeVisible();
  await page.getByTestId('btn-unfold-all').click();
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);

  await page.getByTestId('btn-search').click();
  const searchField = page.locator('.cm-search input[name="search"]');
  await expect(searchField).toHaveAttribute('placeholder', 'Trova');
  await searchField.fill('set hostname');
  await searchField.press('Enter');
  await expect(page.locator('.cm-searchMatch').first()).toBeVisible();
});

test('jumps to the line a detected value comes from', async ({ page }) => {
  const rel = 'cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt';
  await openApp(page);
  await loadFiles(page, [samplePath(rel)], 1);
  await field(page, 'hostname').getByRole('button').click();
  await expect(page.locator('.cm-activeLine')).toHaveText('hostname SW-HQ-CORE');
});

test('lets the user correct the recognition and restore it', async ({ page }) => {
  await openApp(page);
  await loadFiles(
    page,
    [
      {
        name: 'appunti.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('vlan database\nvlan 10\nexit\n'),
      },
    ],
    1,
  );
  await expect(field(page, 'kind')).toHaveAttribute('data-value', 'unknown');

  await page.getByTestId('btn-edit').click();
  await page.getByTestId('input-kind').click();
  await page.getByRole('option', { name: 'Configurazione' }).click();
  await page.getByTestId('input-os').click();
  await page.getByRole('option', { name: 'Cisco Small Business' }).click();
  await page.getByTestId('input-hostname').fill('SW-PROVA');
  await page.getByTestId('btn-apply').click();

  await expect(field(page, 'kind')).toHaveAttribute('data-value', 'config');
  await expect(field(page, 'os')).toHaveAttribute('data-value', 'cisco-sb');
  await expect(field(page, 'os')).toHaveAttribute('data-source', 'manual');
  await expect(field(page, 'vendor')).toHaveAttribute('data-value', 'cisco');
  await expect(field(page, 'hostname')).toHaveAttribute('data-value', 'SW-PROVA');
  await expect(page.getByTestId('edited-badge')).toBeVisible();
  // With the Small Business syntax, "vlan database ... exit" becomes a block of the outline.
  await expect(page.getByTestId('outline-entry')).toHaveText(['vlan database']);
  await expect(fileItem(page, 'appunti.txt')).toContainText('Cisco Small Business');

  await page.getByTestId('btn-reset').click();
  await expect(field(page, 'kind')).toHaveAttribute('data-value', 'unknown');
  await expect(page.getByTestId('edited-badge')).toHaveCount(0);
});
