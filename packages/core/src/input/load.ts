import { gunzipSync, unzipSync } from 'fflate';
import { decodeBytes, type DecodedText } from './decode';
import { isTar, readTar } from './tar';

/** A file as received from the user: a name (possibly with folders) and its exact bytes. */
export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

/** A readable text file, found directly or inside archives. */
export interface LoadedText {
  /** Where the file comes from: the dropped file, then each archive entry. */
  path: string[];
  /** File name without folders; for a decompressed .gz file, the name of the content. */
  name: string;
  /** The original bytes, never modified. */
  bytes: Uint8Array;
  decoded: DecodedText;
}

export type LoadIssueCode =
  | 'binary'
  | 'fortigate-encrypted'
  | 'empty'
  | 'too-large'
  | 'archive-corrupt'
  | 'archive-encrypted'
  | 'archive-unsupported'
  | 'archive-too-deep'
  | 'archive-limit';

/** A file that cannot be shown, with the reason. */
export interface LoadIssue {
  path: string[];
  code: LoadIssueCode;
  size?: number;
}

export interface LoadLimits {
  /** How many archives can be nested inside each other. */
  maxDepth: number;
  /** Total number of entries extracted from archives. */
  maxEntries: number;
  /** Largest single file, also after decompression. */
  maxFileBytes: number;
  /** Total bytes extracted from archives. */
  maxTotalBytes: number;
}

export const DEFAULT_LIMITS: LoadLimits = {
  maxDepth: 5,
  maxEntries: 10_000,
  maxFileBytes: 256 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
};

export interface LoadSink {
  text(file: LoadedText): void;
  issue(issue: LoadIssue): void;
}

export interface LoadResult {
  texts: LoadedText[];
  issues: LoadIssue[];
}

/** Reads the given files, opening archives (zip, tar, gzip, also nested) and decoding text. */
export function loadFiles(inputs: InputFile[], limits: LoadLimits = DEFAULT_LIMITS): LoadResult {
  const result: LoadResult = { texts: [], issues: [] };
  const sink: LoadSink = {
    text: (file) => result.texts.push(file),
    issue: (issue) => result.issues.push(issue),
  };
  for (const input of inputs) loadFile(input, sink, limits);
  return result;
}

/** Same as {@link loadFiles} for a single input, reporting each result as soon as it is ready. */
export function loadFile(
  input: InputFile,
  sink: LoadSink,
  limits: LoadLimits = DEFAULT_LIMITS,
): void {
  const budget = { entries: 0, bytes: 0 };
  expand(input.name, input.bytes, [input.name], 0, { sink, limits, budget });
}

interface Context {
  sink: LoadSink;
  limits: LoadLimits;
  budget: { entries: number; bytes: number };
}

function expand(
  name: string,
  bytes: Uint8Array,
  path: string[],
  depth: number,
  ctx: Context,
): void {
  if (bytes.length > ctx.limits.maxFileBytes) {
    ctx.sink.issue({ path, code: 'too-large', size: bytes.length });
    return;
  }
  const kind = sniffArchive(bytes);
  if (kind !== null) {
    if (depth >= ctx.limits.maxDepth) {
      ctx.sink.issue({ path, code: 'archive-too-deep', size: bytes.length });
      return;
    }
    if (kind === 'zip') expandZip(bytes, path, depth, ctx);
    else if (kind === 'gzip') expandGzip(name, bytes, path, depth, ctx);
    else expandTar(bytes, path, depth, ctx);
    return;
  }
  if (bytes.length === 0) {
    ctx.sink.issue({ path, code: 'empty', size: 0 });
    return;
  }
  const decoded = decodeBytes(bytes);
  if (!decoded.ok) {
    ctx.sink.issue({
      path,
      code: isFortiGateHeader(bytes) ? 'fortigate-encrypted' : 'binary',
      size: bytes.length,
    });
    return;
  }
  ctx.sink.text({ path, name: baseName(name), bytes, decoded: decoded.value });
}

function baseName(name: string): string {
  return name.split(/[\\/]/).filter(Boolean).at(-1) ?? name;
}

export type ArchiveKind = 'zip' | 'gzip' | 'tar';

export function sniffArchive(bytes: Uint8Array): ArchiveKind | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6)) return 'zip';
  }
  if (bytes.length >= 18 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 8) return 'gzip';
  if (isTar(bytes)) return 'tar';
  return null;
}

/** Encrypted FortiGate backups keep the "#config-version=" header in clear text. */
function isFortiGateHeader(bytes: Uint8Array): boolean {
  const prefix = '#config-version=';
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** Files that operating systems add to archives and that are never configurations. */
export function isJunkPath(entry: string): boolean {
  const segments = entry.split(/[\\/]/).filter(Boolean);
  if (segments.includes('__MACOSX')) return true;
  const base = segments.at(-1) ?? '';
  return base.startsWith('._') || JUNK_NAMES.has(base);
}

function reserve(ctx: Context, bytes: number): boolean {
  if (ctx.budget.entries + 1 > ctx.limits.maxEntries) return false;
  if (ctx.budget.bytes + bytes > ctx.limits.maxTotalBytes) return false;
  ctx.budget.entries += 1;
  ctx.budget.bytes += bytes;
  return true;
}

function expandZip(bytes: Uint8Array, path: string[], depth: number, ctx: Context): void {
  const flags = zipEntryFlags(bytes);
  const names: string[] = [];
  const skipped: LoadIssue[] = [];
  let index = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (info) => {
        const flag = flags[index++] ?? 0;
        if (info.name.endsWith('/') || isJunkPath(info.name)) return false;
        const entryPath = [...path, info.name];
        if ((flag & 1) !== 0) {
          skipped.push({ path: entryPath, code: 'archive-encrypted', size: info.originalSize });
          return false;
        }
        if (info.compression !== 0 && info.compression !== 8) {
          skipped.push({ path: entryPath, code: 'archive-unsupported', size: info.originalSize });
          return false;
        }
        if (info.originalSize > ctx.limits.maxFileBytes) {
          skipped.push({ path: entryPath, code: 'too-large', size: info.originalSize });
          return false;
        }
        if (!reserve(ctx, info.originalSize)) {
          skipped.push({ path: entryPath, code: 'archive-limit', size: info.originalSize });
          return false;
        }
        names.push(info.name);
        return true;
      },
    });
  } catch {
    ctx.sink.issue({ path, code: 'archive-corrupt', size: bytes.length });
    return;
  }
  for (const issue of skipped) ctx.sink.issue(issue);
  for (const name of names) {
    const data = files[name];
    if (data) expand(name, data, [...path, name], depth + 1, ctx);
  }
}

/** General purpose bit flags of each entry, in central directory order (bit 0 = encrypted). */
function zipEntryFlags(data: Uint8Array): number[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = data.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) {
    end--;
    if (data.length - end > 65558) return [];
  }
  if (end < 0) return [];
  let count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (end >= 20 && view.getUint32(end - 20, true) === 0x07064b50) {
    const z64 = Number(view.getBigUint64(end - 12, true));
    if (z64 + 56 <= data.length && view.getUint32(z64, true) === 0x06064b50) {
      count = Number(view.getBigUint64(z64 + 32, true));
      offset = Number(view.getBigUint64(z64 + 48, true));
    }
  }
  const flags: number[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || view.getUint32(offset, true) !== 0x02014b50) break;
    flags.push(view.getUint16(offset + 8, true));
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return flags;
}

function expandGzip(
  name: string,
  bytes: Uint8Array,
  path: string[],
  depth: number,
  ctx: Context,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredSize = view.getUint32(bytes.length - 4, true);
  if (declaredSize > ctx.limits.maxFileBytes) {
    ctx.sink.issue({ path, code: 'too-large', size: declaredSize });
    return;
  }
  if (!reserve(ctx, declaredSize)) {
    ctx.sink.issue({ path, code: 'archive-limit', size: declaredSize });
    return;
  }
  let data: Uint8Array;
  try {
    data = gunzipSync(bytes);
  } catch {
    ctx.sink.issue({ path, code: 'archive-corrupt', size: bytes.length });
    return;
  }
  const innerName = gzipOriginalName(bytes) ?? stripGzipExtension(name);
  // The decompressed stream replaces the .gz file: no extra path segment.
  expand(innerName, data, path, depth + 1, ctx);
}

function expandTar(bytes: Uint8Array, path: string[], depth: number, ctx: Context): void {
  let entries;
  try {
    entries = readTar(bytes);
  } catch {
    ctx.sink.issue({ path, code: 'archive-corrupt', size: bytes.length });
    return;
  }
  for (const entry of entries) {
    if (isJunkPath(entry.path)) continue;
    const entryPath = [...path, entry.path];
    if (!reserve(ctx, entry.data.length)) {
      ctx.sink.issue({ path: entryPath, code: 'archive-limit', size: entry.data.length });
      continue;
    }
    expand(entry.path, entry.data, entryPath, depth + 1, ctx);
  }
}

/** The original file name stored in the gzip header (FNAME), if any. */
function gzipOriginalName(bytes: Uint8Array): string | null {
  const flags = bytes[3]!;
  let offset = 10;
  if ((flags & 4) !== 0) {
    const extraLength = bytes[offset]! | (bytes[offset + 1]! << 8);
    offset += 2 + extraLength;
  }
  if ((flags & 8) === 0) return null;
  const end = bytes.indexOf(0, offset);
  if (end <= offset) return null;
  return String.fromCharCode(...bytes.subarray(offset, Math.min(end, offset + 255)));
}

function stripGzipExtension(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? name;
  if (/\.tgz$/i.test(base)) return base.replace(/\.tgz$/i, '.tar');
  return base.replace(/\.gz$/i, '');
}
