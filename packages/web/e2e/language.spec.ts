import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('starts in the browser language and remembers the choice', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.getByTestId('btn-choose')).toHaveText('Scegli i file');

  await page.getByTestId('language-switch').getByText('EN').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByTestId('btn-choose')).toHaveText('Choose files');

  await page.reload();
  await expect(page.getByTestId('btn-choose')).toHaveText('Choose files');
});

test.describe('with an English browser', () => {
  test.use({ locale: 'en-GB' });

  test('starts in English', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('btn-choose')).toHaveText('Choose files');
  });
});

test.describe('with a browser in another language', () => {
  test.use({ locale: 'de-DE' });

  test('falls back to English', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('btn-choose')).toHaveText('Choose files');
  });
});
