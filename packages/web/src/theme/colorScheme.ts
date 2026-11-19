import { localStorageColorSchemeManager, type MantineColorScheme } from '@mantine/core';

export const COLOR_SCHEMES = ['light', 'dark', 'auto'] as const satisfies MantineColorScheme[];

/**
 * Where the user's choice is saved. public/color-scheme.js reads the same key to apply
 * the theme before the app starts, so the page never shows the wrong theme first.
 */
export const COLOR_SCHEME_STORAGE_KEY = 'ncv.colorScheme';

/** Until the user chooses, the app follows the operating system. */
export const DEFAULT_COLOR_SCHEME: MantineColorScheme = 'auto';

export const colorSchemeManager = localStorageColorSchemeManager({
  key: COLOR_SCHEME_STORAGE_KEY,
});
