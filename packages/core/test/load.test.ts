import { gzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, isJunkPath, loadFiles, sniffArchive } from '../src';
import { bytes, makeTar, paxPathRecord } from './helpers';

const FGT =
  '#config-version=FGT60F-7.4.3-FW-build2573-240201:opmode=0:vdom=0:user=admin\nconfig system global\n    set hostname "FGT-01"\nend\n';
const SW = 'hostname SW-01\n!\ninterface GigabitEthernet1/0/1\n description PC\n!\nend\n';

describe('loadFiles', () => {
  it('reads plain text files and keeps their original bytes', () => {
    const input = bytes(FGT);
    const { texts, issues } = loadFiles([{ name: 'fgt.conf', bytes: input }]);
    expect(issues).toEqual([]);
    expect(texts).toHaveLength(1);
    expect(texts[0]!.path).toEqual(['fgt.conf']);
    expect(texts[0]!.bytes).toEqual(input);
    expect(texts[0]!.decoded.text).toBe(FGT);
  });

  it('opens zip archives, skipping folders and operating system files', () => {
    const zip = zipSync({
      'sede/fgt.conf': bytes(FGT),
      'sede/sw.txt': bytes(SW),
      'sede/': new Uint8Array(0),
      '__MACOSX/sede/._fgt.conf': bytes('junk'),
      'sede/.DS_Store': bytes('junk'),
    });
    const { texts, issues } = loadFiles([{ name: 'backup.zip', bytes: zip }]);
    expect(issues).toEqual([]);
    expect(texts.map((t) => t.path)).toEqual([
      ['backup.zip', 'sede/fgt.conf'],
      ['backup.zip', 'sede/sw.txt'],
    ]);
    expect(texts[1]!.decoded.text).toBe(SW);
  });

  it('opens tar, tar.gz and nested archives', () => {
    const inner = zipSync({ 'sw.txt': bytes(SW) });
    const tar = makeTar([
      { name: 'filiale/fgt.conf', data: FGT },
      { name: 'filiale/switch.zip', data: inner },
    ]);
    const { texts, issues } = loadFiles([{ name: 'clienti.tar.gz', bytes: gzipSync(tar) }]);
    expect(issues).toEqual([]);
    expect(texts.map((t) => t.path)).toEqual([
      ['clienti.tar.gz', 'filiale/fgt.conf'],
      ['clienti.tar.gz', 'filiale/switch.zip', 'sw.txt'],
    ]);
  });

  it('reads tar entries with GNU long names and pax paths', () => {
    const longName = `${'cartella-molto-lunga/'.repeat(6)}fgt.conf`;
    const tar = makeTar([
      { name: '././@LongLink', data: `${longName}\0`, type: 'L' },
      { name: longName.slice(0, 99), data: FGT },
      { name: 'PaxHeaders/sw', data: paxPathRecord('pax/percorso/sw.txt'), type: 'x' },
      { name: 'sw.txt', data: SW },
      { name: 'cartella/', data: '', type: '5' },
    ]);
    const { texts } = loadFiles([{ name: 'a.tar', bytes: tar }]);
    expect(texts.map((t) => t.path[1])).toEqual([longName, 'pax/percorso/sw.txt']);
  });

  it('decompresses a single gzip file using the name stored in the header', () => {
    const { texts } = loadFiles([
      { name: 'x.gz', bytes: gzipSync(bytes(SW), { filename: 'sw-01.txt' }) },
    ]);
    expect(texts).toHaveLength(1);
    expect(texts[0]!.path).toEqual(['x.gz']);
    expect(texts[0]!.name).toBe('sw-01.txt');
    expect(texts[0]!.decoded.text).toBe(SW);

    const unnamed = loadFiles([{ name: 'fgt.conf.gz', bytes: gzipSync(bytes(FGT)) }]);
    expect(unnamed.texts[0]!.name).toBe('fgt.conf');
  });

  it('reports damaged archives without stopping the other files', () => {
    const zip = zipSync({ 'a.conf': bytes(FGT) });
    const truncatedZip = zip.subarray(0, zip.length - 30);
    // The header is valid, but the entry goes past the end of the file.
    const brokenTar = makeTar([{ name: 'b.conf', data: FGT.repeat(5) }]).subarray(0, 700);
    const { texts, issues } = loadFiles([
      { name: 'rotto.zip', bytes: truncatedZip },
      { name: 'rotto.tar', bytes: brokenTar },
      { name: 'buono.conf', bytes: bytes(SW) },
    ]);
    expect(issues).toEqual([
      { path: ['rotto.zip'], code: 'archive-corrupt', size: truncatedZip.length },
      { path: ['rotto.tar'], code: 'archive-corrupt', size: 700 },
    ]);
    expect(texts.map((t) => t.path)).toEqual([['buono.conf']]);
  });

  it('reports encrypted zip entries and unsupported compression methods', () => {
    const zip = zipSync(
      { 'segreto.conf': bytes(FGT), 'bzip2.conf': bytes(SW), 'libero.conf': bytes(SW) },
      { level: 0 },
    );
    const view = new DataView(zip.buffer);
    // Walk the central directory and patch the first two entries.
    let offset = view.getUint32(zip.length - 22 + 16, true);
    for (let i = 0; i < 3; i++) {
      if (i === 0) view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true);
      if (i === 1) view.setUint16(offset + 10, 12, true);
      offset +=
        46 +
        view.getUint16(offset + 28, true) +
        view.getUint16(offset + 30, true) +
        view.getUint16(offset + 32, true);
    }
    const { texts, issues } = loadFiles([{ name: 'misto.zip', bytes: zip }]);
    expect(issues.map((i) => [i.path, i.code])).toEqual([
      [['misto.zip', 'segreto.conf'], 'archive-encrypted'],
      [['misto.zip', 'bzip2.conf'], 'archive-unsupported'],
    ]);
    expect(texts.map((t) => t.path)).toEqual([['misto.zip', 'libero.conf']]);
  });

  it('stops at the maximum nesting depth', () => {
    let data: Uint8Array = bytes(SW);
    for (let i = 0; i < 7; i++) data = zipSync({ [`livello-${i}.zip`]: data });
    const { texts, issues } = loadFiles([{ name: 'matrioska.zip', bytes: data }]);
    expect(texts).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('archive-too-deep');
    expect(issues[0]!.path).toHaveLength(DEFAULT_LIMITS.maxDepth + 1);
  });

  it('respects the limits on entries and sizes', () => {
    const zip = zipSync({ 'a.txt': bytes(SW), 'b.txt': bytes(SW), 'c.txt': bytes(SW) });
    const limited = loadFiles([{ name: 'tre.zip', bytes: zip }], {
      ...DEFAULT_LIMITS,
      maxEntries: 2,
    });
    expect(limited.texts).toHaveLength(2);
    expect(limited.issues).toEqual([
      { path: ['tre.zip', 'c.txt'], code: 'archive-limit', size: SW.length },
    ]);

    const big = loadFiles([{ name: 'grande.txt', bytes: bytes(SW) }], {
      ...DEFAULT_LIMITS,
      maxFileBytes: 10,
    });
    expect(big.issues).toEqual([{ path: ['grande.txt'], code: 'too-large', size: SW.length }]);
  });

  it('recognises binary files, empty files and encrypted FortiGate backups', () => {
    const encrypted = new Uint8Array([
      ...bytes('#config-version=FGT60F-7.4.3-FW-build2573-240201:opmode=0:vdom=0:user=admin\n'),
      0x00,
      0x9f,
      0x13,
      0x00,
      0xfe,
      0x01,
    ]);
    const { texts, issues } = loadFiles([
      {
        name: 'immagine.png',
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
      },
      { name: 'vuoto.txt', bytes: new Uint8Array(0) },
      { name: 'fgt-cifrato.conf', bytes: encrypted },
    ]);
    expect(texts).toEqual([]);
    expect(issues.map((i) => i.code)).toEqual(['binary', 'empty', 'fortigate-encrypted']);
  });
});

describe('archive helpers', () => {
  it('sniffs archive formats from their first bytes', () => {
    expect(sniffArchive(zipSync({ 'a.txt': bytes('a') }))).toBe('zip');
    expect(sniffArchive(gzipSync(bytes('a')))).toBe('gzip');
    expect(sniffArchive(makeTar([{ name: 'a.txt', data: 'a' }]))).toBe('tar');
    expect(sniffArchive(bytes(SW))).toBeNull();
  });

  it('knows the files added by operating systems', () => {
    expect(isJunkPath('__MACOSX/a/b.conf')).toBe(true);
    expect(isJunkPath('a/._b.conf')).toBe(true);
    expect(isJunkPath('a/Thumbs.db')).toBe(true);
    expect(isJunkPath('a/b.conf')).toBe(false);
  });
});
