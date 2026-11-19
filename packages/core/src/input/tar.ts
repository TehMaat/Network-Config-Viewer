export interface TarEntry {
  path: string;
  data: Uint8Array;
}

export class TarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TarError';
  }
}

const BLOCK = 512;
const utf8 = new TextDecoder('utf-8');

/** True when the first block is a tar header with a valid checksum (ustar, GNU or old v7). */
export function isTar(bytes: Uint8Array): boolean {
  if (bytes.length < BLOCK) return false;
  const header = bytes.subarray(0, BLOCK);
  if (header.every((b) => b === 0)) return false;
  return checksumMatches(header);
}

/**
 * Reads the regular files of a tar archive (ustar, GNU long names and pax paths).
 * Directories, links and special files are skipped.
 */
export function readTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;

  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;
    if (!checksumMatches(header)) {
      throw new TarError(`invalid header checksum at offset ${offset}`);
    }
    const size = readSize(header);
    const type = String.fromCharCode(header[156]!);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) {
      throw new TarError(`entry at offset ${offset} goes past the end of the archive`);
    }
    const data = bytes.subarray(dataStart, dataEnd);

    if (type === 'L') {
      longName = readString(data);
    } else if (type === 'x') {
      paxPath = readPaxPath(data) ?? paxPath;
    } else if (type === 'g') {
      // Global pax header: no per-file information we need.
    } else {
      const path = paxPath ?? longName ?? headerPath(header);
      longName = null;
      paxPath = null;
      if (type === '0' || type === '\0' || type === '7') {
        entries.push({ path, data });
      }
    }
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

function checksumMatches(header: Uint8Array): boolean {
  const stored = parseOctal(header.subarray(148, 156));
  if (stored === null) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  }
  return sum === stored;
}

function readSize(header: Uint8Array): number {
  const field = header.subarray(124, 136);
  if ((field[0]! & 0x80) !== 0) {
    // GNU base-256 encoding for large files.
    let value = 0;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i]!;
    return value;
  }
  return parseOctal(field) ?? 0;
}

function parseOctal(field: Uint8Array): number | null {
  const text = readString(field).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) return null;
  return parseInt(text, 8);
}

function readString(field: Uint8Array): string {
  const end = field.indexOf(0);
  return utf8.decode(end === -1 ? field : field.subarray(0, end));
}

function headerPath(header: Uint8Array): string {
  const name = readString(header.subarray(0, 100));
  const magic = readString(header.subarray(257, 263));
  if (magic.startsWith('ustar')) {
    const prefix = readString(header.subarray(345, 500));
    if (prefix) return `${prefix}/${name}`;
  }
  return name;
}

function readPaxPath(data: Uint8Array): string | null {
  // Records look like "<length> <key>=<value>\n".
  const text = utf8.decode(data);
  for (const record of text.split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match) return match[1]!;
  }
  return null;
}
