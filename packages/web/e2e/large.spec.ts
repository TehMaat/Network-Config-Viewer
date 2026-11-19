import { expect, test } from '@playwright/test';
import { statSync, writeFileSync } from 'node:fs';
import { field, openApp } from './helpers';

/** A synthetic FortiOS configuration of about 20 MB, with tens of thousands of policies. */
function bigConfig(): string {
  const parts = [
    '#config-version=FG100F-7.4.4-FW-build2662-240514:opmode=0:vdom=0:user=admin',
    'config system global',
    '    set hostname "FGT-GRANDE"',
    'end',
    'config firewall policy',
  ];
  let size = 0;
  for (let id = 1; size < 20 * 1024 * 1024; id++) {
    const block = [
      `    edit ${id}`,
      `        set name "regola-${id}"`,
      `        set uuid 5e1e0000-0000-51ef-8000-${id.toString(16).padStart(12, '0')}`,
      '        set srcintf "port1"',
      '        set dstintf "port2"',
      '        set action accept',
      `        set srcaddr "net-${id % 500}"`,
      '        set dstaddr "all"',
      '        set schedule "always"',
      '        set service "HTTPS"',
      '        set logtraffic all',
      '    next',
    ].join('\n');
    parts.push(block);
    size += block.length + 1;
  }
  parts.push('end', '');
  return parts.join('\n');
}

test('opens a 20 MB configuration without freezing the interface', async ({ page }, testInfo) => {
  const path = testInfo.outputPath('fgt-grande.conf');
  writeFileSync(path, bigConfig());
  expect(statSync(path).size).toBeGreaterThan(20 * 1024 * 1024);

  await openApp(page);
  // Measure the longest pause between two animation frames while the file is processed.
  await page.evaluate(() => {
    const w = window as unknown as { __maxGap: number; __stop: boolean };
    w.__maxGap = 0;
    w.__stop = false;
    let last = performance.now();
    const tick = (now: number) => {
      w.__maxGap = Math.max(w.__maxGap, now - last);
      last = now;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const started = Date.now();
  await page.getByTestId('file-input').setInputFiles(path);
  await expect(field(page, 'hostname')).toHaveAttribute('data-value', 'FGT-GRANDE', {
    timeout: 60_000,
  });
  await expect(page.locator('.cm-line').first()).toBeVisible();
  const elapsed = Date.now() - started;
  const maxGap = await page.evaluate(() => {
    const w = window as unknown as { __maxGap: number; __stop: boolean };
    w.__stop = true;
    return w.__maxGap;
  });
  testInfo.annotations.push({
    type: 'timing',
    description: `opened in ${elapsed} ms, longest frame gap ${Math.round(maxGap)} ms`,
  });
  expect(elapsed).toBeLessThan(45_000);
  // Parsing runs in the worker: the page keeps drawing. Only creating the editor for a
  // 20 MB document takes a short moment on the page itself.
  expect(maxGap).toBeLessThan(2_000);

  // The structure is there: the policy table can be folded.
  await expect(page.getByTestId('outline-entry')).toHaveText([
    'config system global',
    'config firewall policy',
  ]);
});
