import { describe, expect, it } from 'vitest';
import script from '../../public/color-scheme.js?raw';
import { COLOR_SCHEME_STORAGE_KEY } from './colorScheme';

describe('color scheme', () => {
  it('is read before startup with the same storage key used by the app', () => {
    expect(script).toContain(`getItem('${COLOR_SCHEME_STORAGE_KEY}')`);
  });
});
