import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { releaseNotes } from './release-notes.mjs';

const CHANGELOG = `# Registro delle modifiche

## [Non rilasciato]

## [0.2.0] - 2026-12-01

### Aggiunto

- Una funzione nuova ([#20](https://example.invalid/20)).

### Corretto

- Un errore.

## [0.1.0] - 2026-11-21

### Aggiunto

- La fase 1.
`;

describe('release notes', () => {
  it('takes the section of a version, without its heading and without the next one', () => {
    expect(releaseNotes(CHANGELOG, '0.2.0')).toBe(
      '### Aggiunto\n\n- Una funzione nuova ([#20](https://example.invalid/20)).\n\n### Corretto\n\n- Un errore.',
    );
    expect(releaseNotes(CHANGELOG, '0.1.0')).toBe('### Aggiunto\n\n- La fase 1.');
  });

  it('finds nothing for a version that is not there, or that is empty', () => {
    expect(releaseNotes(CHANGELOG, '0.3.0')).toBeUndefined();
    expect(releaseNotes(CHANGELOG, '0.1')).toBeUndefined();
    expect(
      releaseNotes('## [Non rilasciato]\n\n## [0.0.1] - 2026-11-18\n', '0.0.1'),
    ).toBeUndefined();
  });

  it('has the notes of the version in package.json', () => {
    const root = (path) => new URL(`../${path}`, import.meta.url);
    const { version } = JSON.parse(readFileSync(root('package.json'), 'utf8'));
    const notes = releaseNotes(readFileSync(root('CHANGELOG.md'), 'utf8'), version);
    expect(notes).toMatch(/^### /);
  });
});
