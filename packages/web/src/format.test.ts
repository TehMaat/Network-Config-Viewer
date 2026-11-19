import { describe, expect, it } from 'vitest';
import { formatBytes, formatOrigin, normalizeDroppedPath } from './format';

describe('formatOrigin', () => {
  it('shows the archive and the folders inside it', () => {
    expect(formatOrigin(['backup.zip', 'sede/fgt.conf'], 'fgt.conf')).toBe('backup.zip › sede');
    expect(formatOrigin(['a.tgz', 'x/switch.zip', 'sw.txt'], 'sw.txt')).toBe(
      'a.tgz › x/switch.zip',
    );
  });

  it('shows the folder of a file dropped with its folder', () => {
    expect(formatOrigin(['cliente/sede/fgt.conf'], 'fgt.conf')).toBe('cliente/sede');
  });

  it('shows the compressed file a decompressed file comes from', () => {
    expect(formatOrigin(['fgt.conf.gz'], 'fgt.conf')).toBe('fgt.conf.gz');
  });

  it('shows nothing for a file dropped on its own', () => {
    expect(formatOrigin(['fgt.conf'], 'fgt.conf')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats sizes in the user language', () => {
    // ICU versions differ in the kind of space they use.
    const size = (bytes: number, language: string) =>
      formatBytes(bytes, language).replace(/\s/g, ' ');
    expect(size(512, 'en')).toBe('512 byte');
    expect(size(15_118, 'it')).toBe('15,1 kB');
    expect(size(21_000_000, 'en')).toBe('21 MB');
  });

  it('cleans the relative path of dropped files', () => {
    expect(normalizeDroppedPath('./cliente/fgt.conf')).toBe('cliente/fgt.conf');
    expect(normalizeDroppedPath('/cliente/fgt.conf')).toBe('cliente/fgt.conf');
  });
});
