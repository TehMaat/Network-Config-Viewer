import { describe, expect, it } from 'vitest';
import { configDate, fileNameDate, splitLines } from '../src';
import { readSampleText } from './helpers';

describe('dates of the configurations', () => {
  it('reads the date of the last change written by Cisco', () => {
    const lines = splitLines(readSampleText('cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt'));
    expect(configDate(lines)).toBe('2025-10-22T18:30:12.000Z');
    expect(configDate(['!', '! NVRAM config last updated at 7:05:09.123 UTC Sat Feb 1 2025'])).toBe(
      '2025-02-01T07:05:09.000Z',
    );
    expect(configDate(['config system global', '    set hostname "FGT"', 'end'])).toBeUndefined();
    expect(
      configDate(['! Last configuration change at 25:99:00 CET Mon Foo 3 2025']),
    ).toBeUndefined();
  });

  it('reads a date in the name of the file', () => {
    expect(fileNameDate('fgt-hq_2025-11-03.conf')).toBe('2025-11-03T00:00:00.000Z');
    expect(fileNameDate('sw-core-20251103-1405.txt')).toBe('2025-11-03T14:05:00.000Z');
    expect(fileNameDate('backup_2025_11_03_140512.txt')).toBe('2025-11-03T14:05:12.000Z');
    expect(fileNameDate('backup 03.11.2025.txt')).toBe('2025-11-03T00:00:00.000Z');
    expect(fileNameDate('archivio.zip/sede/sw 2025-06-30.txt')).toBe('2025-06-30T00:00:00.000Z');
    // Models, versions and addresses are not dates.
    for (const name of [
      'sw-hq-core-c9300-iosxe-17.12-stack.txt',
      'fgt-br1-60f-fortios-7.0.conf',
      'rete 10.10.20.30.txt',
      'sw-2025-13-45.txt',
      'fgt-20250231.conf',
    ]) {
      expect(fileNameDate(name), name).toBeUndefined();
    }
  });
});
