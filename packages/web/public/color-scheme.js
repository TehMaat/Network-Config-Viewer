// Applies the saved theme before the app starts, so the page never shows the wrong theme
// first. It is a separate file, not an inline script, because the Content Security Policy
// allows only scripts from the app itself. Keep the key in sync with
// src/theme/colorScheme.ts (COLOR_SCHEME_STORAGE_KEY): a unit test checks it.
(() => {
  let scheme = 'auto';
  try {
    const saved = window.localStorage.getItem('ncv.colorScheme');
    if (saved === 'light' || saved === 'dark' || saved === 'auto') scheme = saved;
  } catch {
    // Storage not available: follow the system.
  }
  if (scheme === 'auto') {
    scheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-mantine-color-scheme', scheme);
})();
