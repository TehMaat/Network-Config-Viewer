import type { Detection, Evidence, FileKind } from '@ncv/core';
import { describe, expect, it } from 'vitest';
import type { TextEntry } from './files';
import { deviceGroups, fileDate } from './groups';

const evidence = { rule: 'hostname', line: 1 } as unknown as Evidence;

/** A file as the page keeps it, with only what the grouping reads. */
function entry(
  id: string,
  options: {
    kind?: FileKind;
    hostname?: string;
    name?: string;
    configDate?: string;
    modifiedAt?: string;
    addedAt?: string;
    pinnedAt?: string;
    overrides?: TextEntry['overrides'];
  } = {},
): TextEntry {
  const detection = {
    kind: { value: options.kind ?? 'config', evidence },
    ...(options.hostname ? { hostname: { value: options.hostname, evidence } } : {}),
    syntax: 'indent',
  } as unknown as Detection;
  return {
    type: 'text',
    id,
    path: [options.name ?? `${id}.txt`],
    name: options.name ?? `${id}.txt`,
    size: 1,
    encoding: 'utf-8',
    bom: false,
    eol: 'lf',
    lineCount: 1,
    detection,
    overrides: options.overrides ?? {},
    family: 'indent',
    diagnostics: [],
    structureVersion: 0,
    ...(options.configDate ? { configDate: options.configDate } : {}),
    ...(options.modifiedAt ? { modifiedAt: options.modifiedAt } : {}),
    ...(options.addedAt ? { archived: { fileId: `a-${id}`, addedAt: options.addedAt } } : {}),
    ...(options.pinnedAt ? { pinnedAt: options.pinnedAt } : {}),
  } as TextEntry;
}

describe('dates of the versions', () => {
  it('prefers the date in the config, then the file name, the file, the upload', () => {
    expect(
      fileDate(entry('a', { configDate: '2025-10-22T18:30:12.000Z', name: 'x_2025-01-01.txt' })),
    ).toEqual({ date: '2025-10-22T18:30:12.000Z', source: 'config' });
    expect(
      fileDate(entry('b', { name: 'fgt_2025-05-12.conf', modifiedAt: '2026-01-01T00:00:00Z' })),
    ).toEqual({ date: '2025-05-12T00:00:00.000Z', source: 'file-name' });
    expect(
      fileDate(
        entry('c', { modifiedAt: '2025-11-03T09:00:00.000Z', addedAt: '2026-11-21T00:00:00Z' }),
      ),
    ).toEqual({ date: '2025-11-03T09:00:00.000Z', source: 'file' });
    expect(fileDate(entry('d', { addedAt: '2026-11-21T00:00:00.000Z' }))).toEqual({
      date: '2026-11-21T00:00:00.000Z',
      source: 'added',
    });
    expect(fileDate(entry('e'))).toBeNull();
  });
});

describe('devices', () => {
  it('groups the configurations by hostname, the most recent first', () => {
    const groups = deviceGroups([
      entry('old', { hostname: 'SW-CORE', configDate: '2025-06-30T00:00:00.000Z' }),
      entry('new', { hostname: 'sw-core.esempio.example', configDate: '2025-10-22T00:00:00.000Z' }),
      entry('fgt', { hostname: 'FGT-HQ' }),
      entry('show', { kind: 'show', hostname: 'SW-CORE' }),
      entry('notes', { kind: 'unknown' }),
    ]);
    expect(groups.map((g) => [g.hostname, g.current.id, g.versions.map((v) => v.id)])).toEqual([
      ['FGT-HQ', 'fgt', []],
      ['SW-CORE', 'new', ['old']],
    ]);
    expect(groups[1]!.pinned).toBe(false);
  });

  it('keeps the version chosen by hand, the last one chosen', () => {
    const groups = deviceGroups([
      entry('a', { hostname: 'SW', configDate: '2025-10-22T00:00:00.000Z' }),
      entry('b', {
        hostname: 'SW',
        configDate: '2025-06-30T00:00:00.000Z',
        pinnedAt: '2026-01-01T00:00:00Z',
      }),
      entry('c', {
        hostname: 'SW',
        configDate: '2025-01-01T00:00:00.000Z',
        pinnedAt: '2026-02-01T00:00:00Z',
      }),
    ]);
    expect(groups[0]).toMatchObject({ current: { id: 'c' }, pinned: true });
    expect(groups[0]!.versions.map((v) => v.id)).toEqual(['a', 'b']);
  });

  it('follows the hostname corrected by hand, and the one loaded last without dates', () => {
    const groups = deviceGroups([
      entry('first', { hostname: 'SW-A' }),
      entry('second', { hostname: 'SW-B', overrides: { hostname: 'SW-A' } }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ hostname: 'SW-A', current: { id: 'second' } });
  });
});
