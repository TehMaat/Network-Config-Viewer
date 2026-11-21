// Archive of the clients on disk: one folder per client, with the original files exactly as
// they were loaded and an index in JSON that can also be read by hand.
//
//   <data>/clients/<client id>/client.json
//   <data>/clients/<client id>/files/<file id>
//
// File names on disk are chosen here, never by who uploads: the names and paths given by the
// user are kept only in the index, so no file can end up outside the archive.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

/** Corrections of the recognition typed by the user, as the app sends them. */
export type Overrides = Partial<Record<(typeof OVERRIDE_KEYS)[number], string>>;

export interface FileRecord {
  id: string;
  /** Where the file was: ["backup.zip", "sede/fgt.conf"], or just ["fgt.conf"]. */
  path: string[];
  size: number;
  sha256: string;
  addedAt: string;
  /** Date of the file on the user's computer, when the browser gave it. */
  modifiedAt?: string;
  overrides: Overrides;
  /** When the user chose this file as the current configuration of its device. */
  pinnedAt?: string;
}

export interface ClientIndex {
  format: 'ncv-client';
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  files: FileRecord[];
}

export interface ClientSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  files: number;
  size: number;
}

export interface ArchiveLimits {
  /** Largest single file, as in the reading of the app. */
  maxFileBytes: number;
  /** Files in a client, as the entries of the archives read by the app. */
  maxFiles: number;
  /** Total bytes of the files of a client imported from a zip file. */
  maxImportBytes: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxFileBytes: 256 * 1024 * 1024,
  maxFiles: 10_000,
  maxImportBytes: 1024 * 1024 * 1024,
};

/** Format of the zip file of an exported client. */
export const EXPORT_FORMAT = 'ncv-client-export';

export class ArchiveError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const OVERRIDE_KEYS = ['kind', 'os', 'version', 'model', 'hostname'] as const;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Control characters have no place in names, paths and corrections.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

const now = () => new Date().toISOString();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function assertId(id: string): void {
  if (!ID.test(id)) throw new ArchiveError(404, 'not-found');
}

function cleanText(value: unknown, max: number, code: string): string {
  if (typeof value !== 'string') throw new ArchiveError(400, code);
  const text = value.trim();
  if (text.length === 0 || text.length > max || CONTROL.test(text)) {
    throw new ArchiveError(400, code);
  }
  return text;
}

export const cleanName = (value: unknown) => cleanText(value, 100, 'invalid-name');

export function cleanPath(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw new ArchiveError(400, 'invalid-path');
  }
  return value.map((part) => cleanText(part, 1000, 'invalid-path'));
}

export function cleanOverrides(value: unknown): Overrides {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveError(400, 'invalid-overrides');
  }
  const out: Overrides = {};
  for (const [key, item] of Object.entries(value)) {
    if (!(OVERRIDE_KEYS as readonly string[]).includes(key)) {
      throw new ArchiveError(400, 'invalid-overrides');
    }
    // An empty string is a correction too: it clears a recognised value.
    if (typeof item !== 'string' || item.length > 200 || CONTROL.test(item)) {
      throw new ArchiveError(400, 'invalid-overrides');
    }
    out[key as keyof Overrides] = item;
  }
  return out;
}

function cleanDate(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) {
    throw new ArchiveError(400, code);
  }
  return new Date(value).toISOString();
}

const summary = (index: ClientIndex): ClientSummary => ({
  id: index.id,
  name: index.name,
  createdAt: index.createdAt,
  updatedAt: index.updatedAt,
  files: index.files.length,
  size: index.files.reduce((total, f) => total + f.size, 0),
});

/** A short, safe name for a file inside the exported zip. */
function entryName(n: number, path: string[]): string {
  const last = path[path.length - 1]!.split(/[\\/]/).pop() ?? 'file';
  const safe = last.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 100) || 'file';
  return `files/${String(n).padStart(4, '0')}-${safe}`;
}

export class Archive {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    readonly root: string,
    readonly limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
  ) {}

  private get clientsDir() {
    return join(this.root, 'clients');
  }

  private clientDir(id: string) {
    assertId(id);
    return join(this.clientsDir, id);
  }

  async init(): Promise<void> {
    await mkdir(this.clientsDir, { recursive: true });
  }

  /** All the clients, by name. A folder without a valid index is not a client. */
  async list(): Promise<ClientSummary[]> {
    const out: ClientSummary[] = [];
    for (const entry of await readdir(this.clientsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID.test(entry.name)) continue;
      try {
        out.push(summary(await this.readIndex(entry.name)));
      } catch {
        // Half-written or damaged: left alone, not shown.
      }
    }
    return out.sort(
      (a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt),
    );
  }

  async create(name: unknown): Promise<ClientSummary> {
    const index: ClientIndex = {
      format: 'ncv-client',
      version: 1,
      id: randomUUID(),
      name: cleanName(name),
      createdAt: now(),
      updatedAt: now(),
      files: [],
    };
    await mkdir(join(this.clientDir(index.id), 'files'), { recursive: true });
    await this.writeIndex(index);
    return summary(index);
  }

  get(id: string): Promise<ClientIndex> {
    return this.readIndex(id);
  }

  rename(id: string, name: unknown): Promise<ClientSummary> {
    const clean = cleanName(name);
    return this.change(id, (index) => {
      index.name = clean;
      return summary(index);
    });
  }

  async remove(id: string): Promise<void> {
    await this.withLock(id, async () => {
      await this.readIndex(id);
      await rm(this.clientDir(id), { recursive: true, force: true });
    });
  }

  /**
   * Saves a file exactly as it is. A file already in the client, byte for byte, is not
   * saved twice: the existing one is returned.
   */
  async addFile(
    id: string,
    bytes: Uint8Array,
    path: unknown,
    modifiedAt?: unknown,
  ): Promise<{ record: FileRecord; duplicate: boolean }> {
    const cleanedPath = cleanPath(path);
    const modified = modifiedAt === undefined ? undefined : cleanDate(modifiedAt, 'invalid-date');
    if (bytes.length > this.limits.maxFileBytes) throw new ArchiveError(413, 'too-large');
    const hash = sha256(bytes);
    return this.withLock(id, async () => {
      const index = await this.readIndex(id);
      const existing = index.files.find((f) => f.sha256 === hash && f.size === bytes.length);
      if (existing) return { record: existing, duplicate: true };
      if (index.files.length >= this.limits.maxFiles) throw new ArchiveError(413, 'too-many-files');
      const record: FileRecord = {
        id: randomUUID(),
        path: cleanedPath,
        size: bytes.length,
        sha256: hash,
        addedAt: now(),
        ...(modified ? { modifiedAt: modified } : {}),
        overrides: {},
      };
      await this.writeFileAtomic(join(this.clientDir(id), 'files', record.id), bytes);
      index.files.push(record);
      index.updatedAt = now();
      await this.writeIndex(index);
      return { record, duplicate: false };
    });
  }

  /** The original bytes of a file. */
  async readFileBytes(id: string, fileId: string): Promise<Uint8Array> {
    assertId(fileId);
    const index = await this.readIndex(id);
    if (!index.files.some((f) => f.id === fileId)) throw new ArchiveError(404, 'not-found');
    return new Uint8Array(await readFile(join(this.clientDir(id), 'files', fileId)));
  }

  /** Corrections of a file: recognition, and the choice of the current configuration. */
  updateFile(
    id: string,
    fileId: string,
    changes: { overrides?: unknown; pinnedAt?: unknown },
  ): Promise<FileRecord> {
    assertId(fileId);
    const overrides =
      changes.overrides === undefined ? undefined : cleanOverrides(changes.overrides);
    const pinnedAt =
      changes.pinnedAt === undefined || changes.pinnedAt === null
        ? changes.pinnedAt
        : cleanDate(changes.pinnedAt, 'invalid-date');
    return this.change(id, (index) => {
      const record = index.files.find((f) => f.id === fileId);
      if (!record) throw new ArchiveError(404, 'not-found');
      if (overrides !== undefined) record.overrides = overrides;
      if (pinnedAt === null) delete record.pinnedAt;
      else if (pinnedAt !== undefined) record.pinnedAt = pinnedAt;
      return { ...record };
    });
  }

  async removeFile(id: string, fileId: string): Promise<void> {
    assertId(fileId);
    await this.change(id, (index) => {
      const at = index.files.findIndex((f) => f.id === fileId);
      if (at < 0) throw new ArchiveError(404, 'not-found');
      index.files.splice(at, 1);
    });
    await rm(join(this.clientDir(id), 'files', fileId), { force: true });
  }

  /** The client in a single zip file: the original files and an index with the corrections. */
  async exportZip(id: string): Promise<{ name: string; zip: Uint8Array }> {
    const index = await this.readIndex(id);
    const entries: Zippable = {};
    const files = [];
    let n = 0;
    for (const record of index.files) {
      const entry = entryName(++n, record.path);
      const bytes = new Uint8Array(await readFile(join(this.clientDir(id), 'files', record.id)));
      const mtime = new Date(record.modifiedAt ?? record.addedAt);
      entries[entry] = [bytes, { mtime }];
      // File ids belong to this archive: a new one is given on import.
      const { id: _id, ...rest } = record;
      files.push({ entry, ...rest });
    }
    const manifest = {
      format: EXPORT_FORMAT,
      version: 1,
      name: index.name,
      createdAt: index.createdAt,
      exportedAt: now(),
      files,
    };
    entries['client.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
    return { name: index.name, zip: zipSync(entries, { level: 6 }) };
  }

  /** A client exported by this app, as a new client. Every file is checked byte for byte. */
  async importZip(zip: Uint8Array): Promise<ClientSummary> {
    let total = 0;
    let unpacked: Record<string, Uint8Array>;
    try {
      unpacked = unzipSync(zip, {
        filter: (file) => {
          total += file.originalSize;
          if (file.originalSize > this.limits.maxFileBytes || total > this.limits.maxImportBytes) {
            throw new ArchiveError(413, 'too-large');
          }
          return file.name === 'client.json' || file.name.startsWith('files/');
        },
      });
    } catch (error) {
      if (error instanceof ArchiveError) throw error;
      throw new ArchiveError(400, 'invalid-zip');
    }
    const manifestBytes = unpacked['client.json'];
    if (!manifestBytes) throw new ArchiveError(400, 'invalid-zip');
    let manifest: {
      format?: unknown;
      version?: unknown;
      name?: unknown;
      createdAt?: unknown;
      files?: unknown;
    };
    try {
      manifest = JSON.parse(strFromU8(manifestBytes)) as typeof manifest;
    } catch {
      throw new ArchiveError(400, 'invalid-zip');
    }
    if (manifest.format !== EXPORT_FORMAT || manifest.version !== 1) {
      throw new ArchiveError(400, 'invalid-zip');
    }
    if (!Array.isArray(manifest.files) || manifest.files.length > this.limits.maxFiles) {
      throw new ArchiveError(400, 'invalid-zip');
    }
    const name = cleanName(manifest.name);
    const createdAt =
      manifest.createdAt === undefined ? now() : cleanDate(manifest.createdAt, 'invalid-zip');
    const files: { record: FileRecord; bytes: Uint8Array }[] = [];
    for (const item of manifest.files as Record<string, unknown>[]) {
      const bytes = typeof item.entry === 'string' ? unpacked[item.entry] : undefined;
      // The same bytes as when exported, or nothing is imported.
      if (!bytes || bytes.length !== item.size || sha256(bytes) !== item.sha256) {
        throw new ArchiveError(400, 'corrupt-file');
      }
      files.push({
        bytes,
        record: {
          id: randomUUID(),
          path: cleanPath(item.path),
          size: bytes.length,
          sha256: item.sha256 as string,
          addedAt: item.addedAt === undefined ? now() : cleanDate(item.addedAt, 'invalid-zip'),
          ...(item.modifiedAt !== undefined
            ? { modifiedAt: cleanDate(item.modifiedAt, 'invalid-zip') }
            : {}),
          overrides: item.overrides === undefined ? {} : cleanOverrides(item.overrides),
          ...(item.pinnedAt !== undefined
            ? { pinnedAt: cleanDate(item.pinnedAt, 'invalid-zip') }
            : {}),
        },
      });
    }
    const index: ClientIndex = {
      format: 'ncv-client',
      version: 1,
      id: randomUUID(),
      name,
      createdAt,
      updatedAt: now(),
      files: files.map((f) => f.record),
    };
    const dir = this.clientDir(index.id);
    try {
      await mkdir(join(dir, 'files'), { recursive: true });
      for (const { record, bytes } of files) {
        await this.writeFileAtomic(join(dir, 'files', record.id), bytes);
      }
      // The index comes last: until it is written, the client does not exist.
      await this.writeIndex(index);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    return summary(index);
  }

  private async readIndex(id: string): Promise<ClientIndex> {
    let text: string;
    try {
      text = await readFile(join(this.clientDir(id), 'client.json'), 'utf8');
    } catch {
      throw new ArchiveError(404, 'not-found');
    }
    const index = JSON.parse(text) as ClientIndex;
    if (index.format !== 'ncv-client' || index.id !== id) throw new ArchiveError(500, 'damaged');
    return index;
  }

  private async writeIndex(index: ClientIndex): Promise<void> {
    await this.writeFileAtomic(
      join(this.clientDir(index.id), 'client.json'),
      strToU8(`${JSON.stringify(index, null, 2)}\n`),
    );
  }

  /** Written next to its place and then renamed: a file is never seen half-written. */
  private async writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, path);
  }

  /** Reads the index, changes it and writes it back, one change at a time per client. */
  private change<T>(id: string, fn: (index: ClientIndex) => T): Promise<T> {
    return this.withLock(id, async () => {
      const index = await this.readIndex(id);
      const result = fn(index);
      index.updatedAt = now();
      await this.writeIndex(index);
      return result;
    });
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    assertId(id);
    const previous = this.queues.get(id) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.queues.set(id, tail);
    try {
      return await run;
    } finally {
      if (this.queues.get(id) === tail) this.queues.delete(id);
    }
  }
}
