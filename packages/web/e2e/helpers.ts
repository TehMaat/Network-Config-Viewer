import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLES_DIR = fileURLToPath(new URL('../../../samples', import.meta.url));

export const samplePath = (rel: string) => join(SAMPLES_DIR, rel);
export const sampleBytes = (rel: string) => readFileSync(samplePath(rel));

export interface Expected {
  kind: string;
  vendor?: string;
  os?: string;
  version?: string;
  build?: string;
  model?: string;
  hostname?: string;
  stack?: number;
  vdoms?: string[];
  commands?: string[];
}

export const expectedDetections = (): Record<string, Expected> =>
  JSON.parse(readFileSync(join(SAMPLES_DIR, 'expected.json'), 'utf8')) as Record<string, Expected>;

/** Paths on disk, or files built in the test. */
export type Upload = string[] | { name: string; mimeType: string; buffer: Buffer }[];

export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('empty-state')).toBeVisible();
}

/** Loads files through the hidden file input and waits until the worker has finished. */
export async function loadFiles(page: Page, files: Upload, expectedItems: number) {
  await page.getByTestId('file-input').setInputFiles(files);
  await expect(page.getByTestId('file-item')).toHaveCount(expectedItems);
  await expect(page.getByTestId('processing')).toHaveCount(0);
}

export function fileItem(page: Page, name: string) {
  return page.locator(`[data-testid="file-item"][data-file-name="${name}"]`);
}

export async function selectFile(page: Page, name: string) {
  await fileItem(page, name).click();
  await expect(page.getByTestId('file-title')).toHaveText(name);
}

export const field = (page: Page, name: string) => page.getByTestId(`field-${name}`);

/** Devices read by a driver open on their summary: the text is in the "Config" tab. */
export async function openConfigTab(page: Page) {
  const tab = page.getByTestId('tab-config');
  if ((await tab.count()) > 0) await tab.click();
  await expect(page.getByTestId('config-editor')).toBeVisible();
}
