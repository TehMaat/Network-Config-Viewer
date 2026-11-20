import { expect, test } from '@playwright/test';
import { statSync, writeFileSync } from 'node:fs';
import { field, openApp, openConfigTab } from './helpers';

/**
 * A synthetic FortiOS configuration with 500 addresses and, by default, enough policies to
 * reach about 20 MB (tens of thousands).
 */
function bigConfig(policies = Infinity): string {
  const parts = [
    '#config-version=FG100F-7.4.4-FW-build2662-240514:opmode=0:vdom=0:user=admin',
    'config system global',
    '    set hostname "FGT-GRANDE"',
    'end',
    'config firewall address',
  ];
  for (let i = 0; i < 500; i++) {
    parts.push(
      `    edit "net-${i}"`,
      `        set subnet 10.${Math.floor(i / 250)}.${i % 250}.0 255.255.255.0`,
      '    next',
    );
  }
  parts.push('end', 'config firewall policy');
  let size = 0;
  for (let id = 1; id <= policies && size < 20 * 1024 * 1024; id++) {
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
  await openConfigTab(page);
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
    'config firewall address',
    'config firewall policy',
  ]);
});

test('keeps the policy table fluid with 10,000 policies', async ({ page }, testInfo) => {
  const path = testInfo.outputPath('fgt-10000.conf');
  writeFileSync(path, bigConfig(10_000));
  await openApp(page);
  await page.getByTestId('file-input').setInputFiles(path);
  await expect(page.getByTestId('view-summary')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('count-policies')).toHaveAttribute('data-value', '10000');

  await page.getByTestId('tab-policies').click();
  const table = page.getByTestId('table-policies');
  await expect(table).toHaveAttribute('data-rows', '10000');
  // Only the visible rows exist in the page.
  expect(await page.getByTestId('row-policies').count()).toBeLessThan(100);

  // Scroll to the end while measuring the longest pause between two frames.
  const maxGap = await table.locator('.ncv-table-scroll').evaluate(async (scroller) => {
    let max = 0;
    let last = performance.now();
    // The rows are measured while they appear, so the height grows: scroll until the end.
    for (let step = 0; step < 400; step++) {
      scroller.scrollTop += Math.max(scroller.clientHeight, scroller.scrollHeight / 40);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      max = Math.max(max, now - last);
      last = now;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) break;
    }
    return max;
  });
  testInfo.annotations.push({
    type: 'timing',
    description: `longest frame while scrolling ${Math.round(maxGap)} ms`,
  });
  expect(maxGap).toBeLessThan(500);
  await expect(page.locator('[data-testid="row-policies"][data-id="10000"]')).toBeVisible();

  // Text filter and IP search on the whole table.
  await page.getByTestId('filter-policies').fill('regola-9999');
  await expect(table).toHaveAttribute('data-rows', '1');
  await page.getByTestId('filter-policies').fill('');
  await page.getByTestId('policy-ip-search').fill('10.0.7.20');
  // net-7 is the source of every 500th policy, starting from policy 7.
  await expect(
    page.locator('[data-testid="row-policies"][data-state="match"]').first(),
  ).toBeVisible();
});
