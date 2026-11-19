import { expect, test } from '@playwright/test';
import { gzipSync, zipSync } from 'fflate';
import { makeTar } from '../../core/test/helpers';
import { field, fileItem, loadFiles, openApp, sampleBytes, selectFile } from './helpers';

test('opens nested archives and shows where each file comes from', async ({ page }) => {
  const inner = zipSync({
    'switch/sw-br2.txt': sampleBytes('cisco-sb/sw-br2-acc-sg350-28p-2.5.txt'),
    '__MACOSX/switch/._sw-br2.txt': Buffer.from('junk'),
  });
  const tar = makeTar([
    {
      name: 'clienti/esempio/fgt-br1.conf',
      data: sampleBytes('fortigate/fgt-br1-60f-fortios-7.0.conf'),
    },
    { name: 'clienti/esempio/switch.zip', data: inner },
  ]);
  await openApp(page);
  await loadFiles(
    page,
    [
      { name: 'backup.tgz', mimeType: 'application/gzip', buffer: Buffer.from(gzipSync(tar)) },
      {
        name: 'fgt-br2.conf.gz',
        mimeType: 'application/gzip',
        buffer: Buffer.from(gzipSync(sampleBytes('fortigate/fgt-br2-60f-fortios-7.4.conf'))),
      },
    ],
    3,
  );

  await expect(fileItem(page, 'fgt-br1.conf')).toContainText('backup.tgz › clienti/esempio');
  await expect(fileItem(page, 'sw-br2.txt')).toContainText(
    'backup.tgz › clienti/esempio/switch.zip',
  );
  await selectFile(page, 'sw-br2.txt');
  await expect(field(page, 'os')).toHaveAttribute('data-value', 'cisco-sb');
  await selectFile(page, 'fgt-br2.conf');
  await expect(field(page, 'hostname')).toHaveAttribute('data-value', 'FGT-BR2');
});

test('reports unreadable files without stopping the others', async ({ page }) => {
  const encryptedBackup = Buffer.concat([
    Buffer.from('#config-version=FGT60F-7.4.4-FW-build2662-240514:opmode=0:vdom=0:user=admin\n'),
    Buffer.from([0x00, 0x9f, 0x13, 0x00, 0xfe, 0x01, 0x42, 0x00]),
  ]);
  const zip = zipSync({ 'a.conf': Buffer.from('config system global\nend\n') });
  await openApp(page);
  await loadFiles(
    page,
    [
      {
        name: 'foto.png',
        mimeType: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
      },
      { name: 'fgt-cifrato.conf', mimeType: 'application/octet-stream', buffer: encryptedBackup },
      {
        name: 'rotto.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from(zip.subarray(0, zip.length - 30)),
      },
      { name: 'vuoto.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
      {
        name: 'sw.txt',
        mimeType: 'text/plain',
        buffer: sampleBytes('cisco-ios/sw-hq-acc2-c9200-iosxe-17.9.txt'),
      },
    ],
    5,
  );
  const codes: Record<string, string> = {
    'foto.png': 'binary',
    'fgt-cifrato.conf': 'fortigate-encrypted',
    'rotto.zip': 'archive-corrupt',
    'vuoto.txt': 'empty',
  };
  for (const [name, code] of Object.entries(codes)) {
    await expect(fileItem(page, name)).toHaveAttribute('data-status', 'issue');
    await fileItem(page, name).click();
    await expect(page.getByTestId('issue-alert')).toHaveAttribute('data-code', code);
  }
  await expect(fileItem(page, 'sw.txt')).toHaveAttribute('data-status', 'text');
});

test('removes files from the list and clears it', async ({ page }) => {
  await openApp(page);
  await loadFiles(
    page,
    [
      { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hostname A\n') },
      { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('hostname B\n') },
    ],
    2,
  );
  await fileItem(page, 'a.txt').getByTestId('btn-remove').click();
  await expect(page.getByTestId('file-item')).toHaveCount(1);
  await page.getByTestId('btn-clear').click();
  await expect(page.getByTestId('empty-state')).toBeVisible();
});
