import { describe, expect, it } from 'vitest';
import { decodeBytes, detectEol, splitLines } from '../src';
import { bytes, readSample, sampleFiles } from './helpers';

function decoded(input: Uint8Array) {
  const result = decodeBytes(input);
  if (!result.ok) throw new Error('expected text');
  return result.value;
}

describe('decodeBytes', () => {
  it('decodes UTF-8 and keeps every character', () => {
    const value = decoded(bytes('hostname SW-01\ndescription Stampante 2° piano – è\n'));
    expect(value.encoding).toBe('utf-8');
    expect(value.bom).toBe(false);
    expect(value.text).toBe('hostname SW-01\ndescription Stampante 2° piano – è\n');
  });

  it('removes the UTF-8 byte order mark from the text and reports it', () => {
    const value = decoded(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('config system global\n')]));
    expect(value.bom).toBe(true);
    expect(value.text).toBe('config system global\n');
  });

  it('decodes UTF-16 with and without byte order mark', () => {
    const text = 'hostname SW-01\r\n';
    const le = new Uint8Array(text.length * 2);
    const be = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      le[i * 2] = text.charCodeAt(i);
      be[i * 2 + 1] = text.charCodeAt(i);
    }
    expect(decoded(new Uint8Array([0xff, 0xfe, ...le]))).toMatchObject({
      text,
      encoding: 'utf-16le',
      bom: true,
    });
    expect(decoded(new Uint8Array([0xfe, 0xff, ...be]))).toMatchObject({
      text,
      encoding: 'utf-16be',
      bom: true,
    });
    expect(decoded(le)).toMatchObject({ text, encoding: 'utf-16le', bom: false });
    expect(decoded(be)).toMatchObject({ text, encoding: 'utf-16be', bom: false });
  });

  it('decodes non UTF-8 text as Windows-1252 without losing any byte', () => {
    // Some configuration text, "Libertà" in Windows-1252, then every byte from 0x80 to 0xFF.
    const config = 'interface GigabitEthernet1/0/1\n description Ufficio\n!\n'.repeat(10);
    const input = new Uint8Array([
      ...bytes(`${config}banner Libert`),
      0xe0,
      0x0a,
      ...Array.from({ length: 128 }, (_, i) => 0x80 + i),
    ]);
    const value = decoded(input);
    expect(value.encoding).toBe('windows-1252');
    expect(value.text.startsWith(`${config}banner Libertà\n`)).toBe(true);
    expect(value.text).not.toContain('�');
    expect(new Set(value.text.slice(-128)).size).toBe(128);
  });

  it('accepts the ETX banner delimiter of configs copied with TFTP', () => {
    const value = decoded(bytes('banner motd \u0003\nAccesso riservato\n\u0003\n'));
    expect(value.text).toContain('\u0003');
  });

  it('refuses binary files', () => {
    expect(decodeBytes(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x00, 0x00]))).toEqual({
      ok: false,
      reason: 'binary',
    });
    const noise = new Uint8Array(4096);
    let seed = 42;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = 0x80 + (seed % 0x7f);
    }
    expect(decodeBytes(noise)).toEqual({ ok: false, reason: 'binary' });
  });

  it('decodes every sample exactly: re-encoding gives back the original bytes', () => {
    for (const rel of sampleFiles()) {
      const original = readSample(rel);
      const value = decoded(original);
      expect(value.encoding, rel).toBe('utf-8');
      expect(new TextEncoder().encode(value.text), rel).toEqual(original);
    }
  });
});

describe('line endings', () => {
  it('detects the line ending style', () => {
    expect(detectEol('a\nb\n')).toBe('lf');
    expect(detectEol('a\r\nb\r\n')).toBe('crlf');
    expect(detectEol('a\rb\r')).toBe('cr');
    expect(detectEol('a\r\nb\n')).toBe('mixed');
    expect(detectEol('abc')).toBe('none');
  });

  it('recognises the Windows line endings of the 2960 sample', () => {
    const value = decoded(readSample('cisco-ios/sw-br1-acc-c2960x-ios-15.2-stack.txt'));
    expect(value.eol).toBe('crlf');
  });

  it('splits lines like an editor, including the empty line after the final break', () => {
    expect(splitLines('a\r\nb\rc\nd\n')).toEqual(['a', 'b', 'c', 'd', '']);
  });
});
