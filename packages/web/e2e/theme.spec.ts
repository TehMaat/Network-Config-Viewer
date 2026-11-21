import { expect, test, type Page } from '@playwright/test';
import { loadFiles, openApp, samplePath } from './helpers';

const html = (page: Page) => page.locator('html');
const scheme = (page: Page) => html(page).getAttribute('data-mantine-color-scheme');

/** Clicks one of the three choices of the theme switch. */
async function choose(page: Page, choice: 'light' | 'dark' | 'auto') {
  await page.getByTestId('theme-switch').locator(`label:has([data-scheme="${choice}"])`).click();
}

const editorBackground = (page: Page) =>
  page.locator('.cm-gutters').evaluate((el) => getComputedStyle(el).backgroundColor);

for (const system of ['light', 'dark'] as const) {
  test.describe(`at first start, with the system in ${system} mode`, () => {
    test.use({ colorScheme: system });

    test('follows the system until the user chooses', async ({ page }) => {
      // Firefox does not give the theme of the context to the first page it loads (the page
      // changes process): the theme is set on the page, which is then loaded again, and the
      // app reads it when it starts, as in the other browsers.
      await page.goto('/');
      await page.emulateMedia({ colorScheme: system });
      await page.reload();
      await expect(page.getByTestId('empty-state')).toBeVisible();
      await expect(html(page)).toHaveAttribute('data-mantine-color-scheme', system);
      await expect(
        page.getByTestId('theme-switch').getByRole('radio', { name: 'Sistema' }),
      ).toBeChecked();
    });
  });
}

test.describe('with the system in light mode', () => {
  test.use({ colorScheme: 'light' });

  test('switches to dark and light, config text included, and remembers the choice', async ({
    page,
  }) => {
    await openApp(page);
    await loadFiles(page, [samplePath('fortigate/fgt-br1-60f-fortios-7.0.conf')], 1);
    const lightEditor = await editorBackground(page);

    await choose(page, 'dark');
    await expect(html(page)).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await expect.poll(() => editorBackground(page)).not.toBe(lightEditor);
    const darkEditor = await editorBackground(page);

    await page.reload();
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await expect(
      page.getByTestId('theme-switch').getByRole('radio', { name: 'Scuro' }),
    ).toBeChecked();

    await choose(page, 'light');
    await expect(html(page)).toHaveAttribute('data-mantine-color-scheme', 'light');
    await loadFiles(page, [samplePath('fortigate/fgt-br1-60f-fortios-7.0.conf')], 1);
    expect(await editorBackground(page)).toBe(lightEditor);
    expect(lightEditor).not.toBe(darkEditor);
  });

  test('in system mode, follows the system when it changes', async ({ page }) => {
    await openApp(page);
    await choose(page, 'dark');
    await choose(page, 'auto');
    await expect(html(page)).toHaveAttribute('data-mantine-color-scheme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html(page)).toHaveAttribute('data-mantine-color-scheme', 'light');
  });

  test('applies the saved theme before the app starts', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('ncv.colorScheme', 'dark'));
    // Without the app code, only the small startup script can set the theme.
    await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
    const violations: string[] = [];
    page.on('console', (msg) => {
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    await page.goto('/');
    expect(await scheme(page)).toBe('dark');
    expect(violations).toEqual([]);
  });

  test('has labels in both languages', async ({ page }) => {
    await openApp(page);
    const themeSwitch = page.getByTestId('theme-switch');
    for (const name of ['Chiaro', 'Scuro', 'Sistema']) {
      await expect(themeSwitch.getByRole('radio', { name })).toBeAttached();
    }
    await page.getByTestId('language-switch').getByText('EN').click();
    for (const name of ['Light', 'Dark', 'System']) {
      await expect(themeSwitch.getByRole('radio', { name })).toBeAttached();
    }
  });
});

test.describe('on a phone screen', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the header still shows the theme and language switches', async ({ page }) => {
    await openApp(page);
    await loadFiles(page, [samplePath('fortigate/fgt-br1-60f-fortios-7.0.conf')], 1);
    for (const id of ['theme-switch', 'language-switch', 'btn-add-compact']) {
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
