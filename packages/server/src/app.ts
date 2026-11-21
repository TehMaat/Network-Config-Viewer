// The server of Network Config Viewer: it serves the app and keeps the archive of the clients.
// It never reads the configurations: they are read in the browser, as before.

import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { Archive, ArchiveError, DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from './archive.js';
import { REFUSAL_MESSAGES, refusal, SECURITY_HEADERS } from './security.js';

export interface AppOptions {
  /** Folder of the archive: in Docker, the volume of the data. */
  dataDir: string;
  /** Built files of the app; without them only the archive is served (tests). */
  webDir?: string;
  logger?: FastifyServerOptions['logger'];
  limits?: Partial<ArchiveLimits>;
}

/** Header names carrying the metadata of an uploaded file, whose body is the bytes. */
export const PATH_HEADER = 'x-ncv-path';
export const MODIFIED_HEADER = 'x-ncv-modified';

type IdParams = { id: string };
type FileParams = { id: string; fileId: string };

/** A file name for Content-Disposition, readable also by browsers without RFC 5987. */
function disposition(name: string): string {
  const ascii = name.replace(/[^A-Za-z0-9._ -]/g, '_') || 'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.limits };
  const archive = new Archive(options.dataDir, limits);
  await archive.init();

  const app = Fastify({ logger: options.logger ?? false, trustProxy: false });

  // Every request: only this computer; every change: only from the app.
  app.addHook('onRequest', async (request, reply) => {
    const why = refusal(request.method, request.headers);
    if (why) {
      reply.code(403).type('text/plain; charset=utf-8').send(REFUSAL_MESSAGES[why]);
      return reply;
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    return payload;
  });

  // Files arrive as they are, without any encoding: what is saved is what was loaded.
  app.addContentTypeParser(
    ['application/octet-stream', 'application/zip'],
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ArchiveError) {
      return reply.code(error.status).send({ error: error.code });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) return reply.code(413).send({ error: 'too-large' });
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad-request' });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/clients', async () => ({ clients: await archive.list() }));

  app.post<{ Body: { name?: unknown } }>('/api/clients', async (request, reply) => {
    reply.code(201);
    return archive.create(request.body?.name);
  });

  app.get<{ Params: IdParams }>('/api/clients/:id', async (request) =>
    archive.get(request.params.id),
  );

  app.patch<{ Params: IdParams; Body: { name?: unknown } }>('/api/clients/:id', async (request) =>
    archive.rename(request.params.id, request.body?.name),
  );

  app.delete<{ Params: IdParams }>('/api/clients/:id', async (request, reply) => {
    await archive.remove(request.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: IdParams; Body: Buffer }>(
    '/api/clients/:id/files',
    { bodyLimit: limits.maxFileBytes },
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) throw new ArchiveError(415, 'bytes-expected');
      let path: unknown;
      try {
        path = JSON.parse(decodeURIComponent(header(request.headers[PATH_HEADER]) ?? ''));
      } catch {
        throw new ArchiveError(400, 'invalid-path');
      }
      const modified = header(request.headers[MODIFIED_HEADER]);
      const bytes = new Uint8Array(
        request.body.buffer,
        request.body.byteOffset,
        request.body.length,
      );
      const result = await archive.addFile(request.params.id, bytes, path, modified);
      reply.code(result.duplicate ? 200 : 201);
      return result;
    },
  );

  app.get<{ Params: FileParams }>('/api/clients/:id/files/:fileId', async (request, reply) => {
    const index = await archive.get(request.params.id);
    const record = index.files.find((f) => f.id === request.params.fileId);
    if (!record) throw new ArchiveError(404, 'not-found');
    const bytes = await archive.readFileBytes(request.params.id, request.params.fileId);
    return reply
      .type('application/octet-stream')
      .header('content-disposition', disposition(record.path[record.path.length - 1]!))
      .send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length));
  });

  app.patch<{ Params: FileParams; Body: { overrides?: unknown; pinnedAt?: unknown } }>(
    '/api/clients/:id/files/:fileId',
    async (request) =>
      archive.updateFile(request.params.id, request.params.fileId, request.body ?? {}),
  );

  app.delete<{ Params: FileParams }>('/api/clients/:id/files/:fileId', async (request, reply) => {
    await archive.removeFile(request.params.id, request.params.fileId);
    return reply.code(204).send();
  });

  app.get<{ Params: IdParams }>('/api/clients/:id/export', async (request, reply) => {
    const { name, zip } = await archive.exportZip(request.params.id);
    return reply
      .type('application/zip')
      .header('content-disposition', disposition(`${name}.zip`))
      .send(Buffer.from(zip.buffer, zip.byteOffset, zip.length));
  });

  app.post<{ Body: Buffer }>(
    '/api/import',
    { bodyLimit: limits.maxImportBytes },
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) throw new ArchiveError(415, 'bytes-expected');
      const zip = new Uint8Array(request.body.buffer, request.body.byteOffset, request.body.length);
      reply.code(201);
      return archive.importZip(zip);
    },
  );

  const webDir = options.webDir && existsSync(options.webDir) ? options.webDir : undefined;
  if (webDir) {
    await app.register(fastifyStatic, {
      root: webDir,
      index: ['index.html'],
      // File names under assets/ contain a hash of their content: cached forever.
      setHeaders: (res, path) => {
        res.header(
          'cache-control',
          path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || !webDir || request.method !== 'GET') {
      return reply.code(404).send({ error: 'not-found' });
    }
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });

  return app;
}
