import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, MODIFIED_HEADER, PATH_HEADER, type AppOptions } from '../src/app.js';
import type { ClientIndex, ClientSummary, FileRecord } from '../src/archive.js';
import { hostName, isLocalHost, SECURITY_HEADERS } from '../src/security.js';

// Synthetic content only. Bytes that must survive unchanged: BOM, CRLF, a byte that is not
// valid UTF-8, trailing spaces.
const CONFIG = Uint8Array.from([
  0xef,
  0xbb,
  0xbf,
  ...strToU8('hostname SW-ESEMPIO\r\ninterface Gi1/0/1 \r\n description caf'),
  0xe8,
  ...strToU8('\r\n'),
]);
const OTHER = strToU8('config system global\n    set hostname "FGT-ESEMPIO"\nend\n');

const apps: FastifyInstance[] = [];
const HOST = 'localhost:8080';
const CHANGE = { host: HOST, 'x-ncv-request': '1' };

async function start(
  options: Partial<AppOptions> = {},
  dataDir = mkdtempSync(join(tmpdir(), 'ncv-')),
) {
  const app = await buildApp({ dataDir, ...options });
  apps.push(app);
  return { app, dataDir };
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

async function createClient(app: FastifyInstance, name = 'Cliente di prova') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/clients',
    headers: CHANGE,
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return res.json<ClientSummary>();
}

async function upload(
  app: FastifyInstance,
  client: string,
  bytes: Uint8Array,
  path: string[],
  extra: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: `/api/clients/${client}/files`,
    headers: {
      ...CHANGE,
      'content-type': 'application/octet-stream',
      [PATH_HEADER]: encodeURIComponent(JSON.stringify(path)),
      ...extra,
    },
    payload: Buffer.from(bytes),
  });
}

describe('protections', () => {
  it('knows the names of this computer', () => {
    expect(hostName('LOCALHOST:8080')).toBe('localhost');
    expect(hostName('[::1]:8080')).toBe('[::1]');
    expect(isLocalHost('127.0.0.1:9090')).toBe(true);
    expect(isLocalHost('localhost.evil.example')).toBe(false);
    expect(isLocalHost('evil.example:8080')).toBe(false);
    expect(isLocalHost(undefined)).toBe(false);
  });

  it('answers only to localhost and 127.0.0.1, against DNS rebinding', async () => {
    const { app } = await start();
    for (const host of ['localhost:8080', '127.0.0.1:8080', '[::1]:8080']) {
      const res = await app.inject({ url: '/api/clients', headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
    for (const host of ['evil.example', 'evil.example:8080', 'localhost.evil.example']) {
      const res = await app.inject({ url: '/api/clients', headers: { host } });
      expect(res.statusCode, host).toBe(403);
    }
  });

  it('accepts changes only from the app', async () => {
    const { app } = await start();
    const post = (headers: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/api/clients', headers, payload: { name: 'X' } });
    expect((await post({ host: HOST })).statusCode).toBe(403);
    expect((await post({ ...CHANGE, origin: 'http://evil.example' })).statusCode).toBe(403);
    expect((await post({ ...CHANGE, origin: 'null' })).statusCode).toBe(403);
    expect((await post({ ...CHANGE, origin: 'http://localhost:9999' })).statusCode).toBe(403);
    expect((await post({ ...CHANGE, 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await post({ ...CHANGE, origin: `http://${HOST}` })).statusCode).toBe(201);
    expect((await post({ ...CHANGE, 'sec-fetch-site': 'same-origin' })).statusCode).toBe(201);
    // No CORS: a preflight from another site gets no permission.
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/clients',
      headers: {
        host: HOST,
        origin: 'http://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-ncv-request',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-headers']).toBeUndefined();
  });

  it('sends the security headers, and never keeps the archive in a cache', async () => {
    const { app } = await start();
    const res = await app.inject({ url: '/api/clients', headers: { host: HOST } });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers[name.toLowerCase()]).toBe(value);
    }
    expect(res.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('chooses the names of the files on disk', async () => {
    const { app, dataDir } = await start();
    const client = await createClient(app);
    const res = await upload(app, client.id, CONFIG, ['../../../etc/passwd', '..\\..\\x.conf']);
    expect(res.statusCode).toBe(201);
    const record = res.json<{ record: FileRecord }>().record;
    expect(record.path).toEqual(['../../../etc/passwd', '..\\..\\x.conf']);
    expect(readdirSync(join(dataDir, 'clients', client.id, 'files'))).toEqual([record.id]);
    expect(readdirSync(dataDir)).toEqual(['clients']);
    // Ids that are not the server's own reach nothing.
    for (const url of [
      `/api/clients/..%2F..%2Fetc/files/${record.id}`,
      `/api/clients/${client.id}/files/..%2Fclient.json`,
    ]) {
      expect((await app.inject({ url, headers: { host: HOST } })).statusCode).toBe(404);
    }
  });

  it('limits the size of what it receives', async () => {
    const { app } = await start({ limits: { maxFileBytes: 16, maxFiles: 1 } });
    const client = await createClient(app);
    expect((await upload(app, client.id, CONFIG, ['big.txt'])).statusCode).toBe(413);
    expect((await upload(app, client.id, strToU8('hostname A\n'), ['a.txt'])).statusCode).toBe(201);
    expect((await upload(app, client.id, strToU8('hostname B\n'), ['b.txt'])).statusCode).toBe(413);
  });
});

describe('clients', () => {
  it('creates, lists, renames and deletes clients', async () => {
    const { app } = await start();
    const b = await createClient(app, 'Beta Srl');
    const a = await createClient(app, '  Alfa SpA  ');
    expect(a.name).toBe('Alfa SpA');
    const list = await app.inject({ url: '/api/clients', headers: { host: HOST } });
    expect(list.json<{ clients: ClientSummary[] }>().clients.map((c) => c.name)).toEqual([
      'Alfa SpA',
      'Beta Srl',
    ]);
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/clients/${b.id}`,
      headers: CHANGE,
      payload: { name: 'Gamma Srl' },
    });
    expect(renamed.json<ClientSummary>().name).toBe('Gamma Srl');
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/clients/${a.id}`,
      headers: CHANGE,
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (await app.inject({ url: `/api/clients/${a.id}`, headers: { host: HOST } })).statusCode,
    ).toBe(404);
  });

  it('refuses empty, long or strange names', async () => {
    const { app } = await start();
    for (const name of ['', '   ', 'x'.repeat(101), 'a\nb', 42, undefined]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/clients',
        headers: CHANGE,
        payload: { name },
      });
      expect(res.statusCode, String(name)).toBe(400);
    }
  });
});

describe('files', () => {
  it('keeps every file byte for byte, once', async () => {
    const { app } = await start();
    const client = await createClient(app);
    const res = await upload(app, client.id, CONFIG, ['backup.zip', 'sede/sw.txt'], {
      [MODIFIED_HEADER]: '2025-11-03T10:21:33.000Z',
    });
    expect(res.statusCode).toBe(201);
    const { record } = res.json<{ record: FileRecord }>();
    expect(record).toMatchObject({
      path: ['backup.zip', 'sede/sw.txt'],
      size: CONFIG.length,
      modifiedAt: '2025-11-03T10:21:33.000Z',
      overrides: {},
    });
    const download = await app.inject({
      url: `/api/clients/${client.id}/files/${record.id}`,
      headers: { host: HOST },
    });
    expect(download.headers['content-type']).toBe('application/octet-stream');
    expect(download.headers['content-disposition']).toContain("filename*=UTF-8''sede%2Fsw.txt");
    expect(new Uint8Array(download.rawPayload)).toEqual(CONFIG);

    // The same bytes again: the file already there.
    const again = await upload(app, client.id, CONFIG, ['copia.txt']);
    expect(again.statusCode).toBe(200);
    expect(again.json<{ record: FileRecord; duplicate: boolean }>()).toMatchObject({
      duplicate: true,
      record: { id: record.id },
    });
    const index = await app.inject({ url: `/api/clients/${client.id}`, headers: { host: HOST } });
    expect(index.json<ClientIndex>().files).toHaveLength(1);
  });

  it('keeps the corrections and the choice of the current configuration', async () => {
    const { app } = await start();
    const client = await createClient(app);
    const { record } = (await upload(app, client.id, OTHER, ['fgt.conf'])).json<{
      record: FileRecord;
    }>();
    const patch = (payload: object) =>
      app.inject({
        method: 'PATCH',
        url: `/api/clients/${client.id}/files/${record.id}`,
        headers: CHANGE,
        payload,
      });
    const changed = await patch({
      overrides: { hostname: 'FGT-SEDE', os: '' },
      pinnedAt: '2026-11-21T10:00:00Z',
    });
    expect(changed.json<FileRecord>()).toMatchObject({
      overrides: { hostname: 'FGT-SEDE', os: '' },
      pinnedAt: '2026-11-21T10:00:00.000Z',
    });
    expect((await patch({ pinnedAt: null })).json<FileRecord>().pinnedAt).toBeUndefined();
    expect((await patch({ overrides: { password: 'x' } })).statusCode).toBe(400);
    expect((await patch({ overrides: { hostname: 'a\u0000b' } })).statusCode).toBe(400);
    expect((await patch({ pinnedAt: 'ieri' })).statusCode).toBe(400);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/clients/${client.id}/files/${record.id}`,
      headers: CHANGE,
    });
    expect(removed.statusCode).toBe(204);
    const index = await app.inject({ url: `/api/clients/${client.id}`, headers: { host: HOST } });
    expect(index.json<ClientIndex>().files).toEqual([]);
  });

  it('keeps everything after a restart', async () => {
    const first = await start();
    const client = await createClient(first.app);
    const { record } = (await upload(first.app, client.id, CONFIG, ['sw.txt'])).json<{
      record: FileRecord;
    }>();
    await first.app.close();
    apps.length = 0;

    const { app } = await start({}, first.dataDir);
    const list = await app.inject({ url: '/api/clients', headers: { host: HOST } });
    expect(list.json<{ clients: ClientSummary[] }>().clients).toMatchObject([
      { id: client.id, name: client.name, files: 1, size: CONFIG.length },
    ]);
    const download = await app.inject({
      url: `/api/clients/${client.id}/files/${record.id}`,
      headers: { host: HOST },
    });
    expect(new Uint8Array(download.rawPayload)).toEqual(CONFIG);
  });

  it('accepts only bytes as the content of a file', async () => {
    const { app } = await start();
    const client = await createClient(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/clients/${client.id}/files`,
      headers: { ...CHANGE, [PATH_HEADER]: encodeURIComponent('["a.txt"]') },
      payload: { text: 'hostname A' },
    });
    expect(res.statusCode).toBe(415);
    const noPath = await app.inject({
      method: 'POST',
      url: `/api/clients/${client.id}/files`,
      headers: { ...CHANGE, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('hostname A'),
    });
    expect(noPath.statusCode).toBe(400);
  });
});

describe('export and import', () => {
  async function exported(app: FastifyInstance, client: string) {
    const res = await app.inject({ url: `/api/clients/${client}/export`, headers: { host: HOST } });
    expect(res.headers['content-type']).toBe('application/zip');
    return new Uint8Array(res.rawPayload);
  }

  const importZip = (app: FastifyInstance, zip: Uint8Array) =>
    app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { ...CHANGE, 'content-type': 'application/zip' },
      payload: Buffer.from(zip),
    });

  it('exports a client in a zip file and imports it back, byte for byte', async () => {
    const { app } = await start();
    const client = await createClient(app, 'Esempio Srl');
    const one = (await upload(app, client.id, CONFIG, ['backup.zip', 'sede/sw.txt'])).json<{
      record: FileRecord;
    }>().record;
    await upload(app, client.id, OTHER, ['fgt.conf']);
    await app.inject({
      method: 'PATCH',
      url: `/api/clients/${client.id}/files/${one.id}`,
      headers: CHANGE,
      payload: { overrides: { hostname: 'SW-SEDE' }, pinnedAt: '2026-11-21T10:00:00Z' },
    });

    const zip = await exported(app, client.id);
    // Readable also by hand: an index and the original files with their names.
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual([
      'client.json',
      'files/0001-sw.txt',
      'files/0002-fgt.conf',
    ]);
    expect(entries['files/0001-sw.txt']).toEqual(CONFIG);
    expect(JSON.parse(strFromU8(entries['client.json']!))).toMatchObject({
      format: 'ncv-client-export',
      name: 'Esempio Srl',
    });

    const imported = await importZip(app, zip);
    expect(imported.statusCode).toBe(201);
    const copy = imported.json<ClientSummary>();
    expect(copy.id).not.toBe(client.id);
    expect(copy).toMatchObject({ name: 'Esempio Srl', files: 2 });
    const index = (
      await app.inject({ url: `/api/clients/${copy.id}`, headers: { host: HOST } })
    ).json<ClientIndex>();
    expect(index.files.map((f) => f.path)).toEqual([['backup.zip', 'sede/sw.txt'], ['fgt.conf']]);
    expect(index.files[0]).toMatchObject({
      overrides: { hostname: 'SW-SEDE' },
      pinnedAt: '2026-11-21T10:00:00.000Z',
    });
    for (const [record, bytes] of [
      [index.files[0]!, CONFIG],
      [index.files[1]!, OTHER],
    ] as const) {
      const download = await app.inject({
        url: `/api/clients/${copy.id}/files/${record.id}`,
        headers: { host: HOST },
      });
      expect(new Uint8Array(download.rawPayload)).toEqual(bytes);
    }
  });

  it('refuses a damaged or foreign zip file, and keeps nothing of it', async () => {
    const { app, dataDir } = await start();
    const client = await createClient(app);
    await upload(app, client.id, CONFIG, ['sw.txt']);
    const entries = unzipSync(await exported(app, client.id));
    const before = readdirSync(join(dataDir, 'clients'));

    const changed = { ...entries, 'files/0001-sw.txt': strToU8('hostname ALTRO\n') };
    const corrupt = await importZip(app, zipSync(changed));
    expect(corrupt.statusCode).toBe(400);
    expect(corrupt.json()).toEqual({ error: 'corrupt-file' });

    const foreign = zipSync({ 'client.json': strToU8('{"format":"altro"}') });
    expect((await importZip(app, foreign)).statusCode).toBe(400);
    expect((await importZip(app, strToU8('non sono uno zip'))).statusCode).toBe(400);
    expect(readdirSync(join(dataDir, 'clients'))).toEqual(before);
  });
});

describe('the app', () => {
  it('serves the files of the app with the same headers', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'ncv-web-'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>NCV</title>');
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1);');
    const { app } = await start({ webDir });

    const page = await app.inject({ url: '/', headers: { host: HOST } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>NCV</title>');
    expect(page.headers['content-security-policy']).toBe(
      SECURITY_HEADERS['Content-Security-Policy'],
    );
    expect(page.headers['cache-control']).toBe('no-cache');

    const asset = await app.inject({ url: '/assets/index-abc123.js', headers: { host: HOST } });
    expect(asset.headers['content-type']).toContain('javascript');
    expect(asset.headers['cache-control']).toContain('immutable');

    const other = await app.inject({ url: '/qualsiasi', headers: { host: HOST } });
    expect(other.body).toContain('<title>NCV</title>');
    const api = await app.inject({ url: '/api/niente', headers: { host: HOST } });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'not-found' });

    const foreign = await app.inject({ url: '/', headers: { host: 'evil.example' } });
    expect(foreign.statusCode).toBe(403);
  });
});
