import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = (path: string) => new URL(`../../../${path}`, import.meta.url);

describe('repository conventions', () => {
  it('keeps the version of package.json equal to the latest version in CHANGELOG.md', () => {
    const changelog = readFileSync(root('CHANGELOG.md'), 'utf8');
    const latest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1];
    const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8')) as { version: string };
    expect(latest).toBeDefined();
    expect(pkg.version).toBe(latest);
  });

  it('keeps an "unreleased" section at the top of CHANGELOG.md', () => {
    const changelog = readFileSync(root('CHANGELOG.md'), 'utf8');
    const headings = [...changelog.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings[0]).toBe('[Non rilasciato]');
  });
});
