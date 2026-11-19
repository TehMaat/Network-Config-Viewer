import { detectEol, type Eol } from '../text';

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
  /** The file starts with a byte order mark (not part of `text`). */
  bom: boolean;
  eol: Eol;
}

export type DecodeResult = { ok: true; value: DecodedText } | { ok: false; reason: 'binary' };

const SAMPLE_BYTES = 64 * 1024;

/**
 * Decodes the bytes of a text file without losing information.
 *
 * - A byte order mark selects UTF-8 or UTF-16.
 * - UTF-16 without a byte order mark is recognised from the pattern of zero bytes.
 * - Valid UTF-8 is decoded as UTF-8; anything else as Windows-1252, which maps every byte
 *   to a distinct character, so nothing is replaced or dropped.
 * - Files that look binary are refused.
 */
export function decodeBytes(bytes: Uint8Array): DecodeResult {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeUtf8(bytes.subarray(3), true);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return ok(new TextDecoder('utf-16le').decode(bytes.subarray(2)), 'utf-16le', true);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return ok(new TextDecoder('utf-16be').decode(bytes.subarray(2)), 'utf-16be', true);
  }
  const utf16 = sniffUtf16(bytes);
  if (utf16) {
    return ok(new TextDecoder(utf16).decode(bytes), utf16, false);
  }
  if (looksBinary(bytes)) {
    return { ok: false, reason: 'binary' };
  }
  return decodeUtf8(bytes, false);
}

function decodeUtf8(bytes: Uint8Array, bom: boolean): DecodeResult {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return ok(text, 'utf-8', bom);
  } catch {
    if (!bom && highByteRatio(bytes) > 0.3) {
      // Not UTF-8 and full of non-ASCII bytes: compressed or encrypted data, not text.
      return { ok: false, reason: 'binary' };
    }
    return ok(new TextDecoder('windows-1252').decode(bytes), 'windows-1252', bom);
  }
}

function ok(text: string, encoding: TextEncodingName, bom: boolean): DecodeResult {
  return { ok: true, value: { text, encoding, bom, eol: detectEol(text) } };
}

function sniffUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length, 4096) & ~1;
  if (n < 4) return null;
  let zeroEven = 0;
  let zeroOdd = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) zeroEven++;
    if (bytes[i + 1] === 0) zeroOdd++;
  }
  const pairs = n / 2;
  if (zeroOdd / pairs > 0.3 && zeroEven / pairs < 0.05) return 'utf-16le';
  if (zeroEven / pairs > 0.3 && zeroOdd / pairs < 0.05) return 'utf-16be';
  return null;
}

/**
 * Control characters are rare in text files. A few are tolerated: tab, line breaks, form feed,
 * escape (colour codes in terminal logs) and ETX (0x03), which Cisco uses as banner delimiter
 * in configs copied with TFTP.
 */
function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, SAMPLE_BYTES);
  if (n === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b === 0) return true;
    if (b < 0x20 || b === 0x7f) {
      if (
        b === 0x09 ||
        b === 0x0a ||
        b === 0x0b ||
        b === 0x0c ||
        b === 0x0d ||
        b === 0x1b ||
        b === 0x03
      ) {
        continue;
      }
      suspicious++;
    }
  }
  return suspicious / n > 0.01;
}

function highByteRatio(bytes: Uint8Array): number {
  const n = Math.min(bytes.length, SAMPLE_BYTES);
  if (n === 0) return 0;
  let high = 0;
  for (let i = 0; i < n; i++) {
    if (bytes[i]! >= 0x80) high++;
  }
  return high / n;
}
