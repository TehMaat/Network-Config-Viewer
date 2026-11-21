// Starts the server. In Docker: HOST=0.0.0.0 inside the container, while compose.yaml opens
// the port only on 127.0.0.1 of the computer. Outside Docker it listens on 127.0.0.1.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8080);
const dataDir = resolve(process.env.NCV_DATA_DIR ?? 'data');
const webDir = resolve(
  process.env.NCV_WEB_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url)),
);

const app = await buildApp({
  dataDir,
  webDir,
  logger: { level: process.env.NCV_LOG_LEVEL ?? 'warn' },
});

// Docker stops the container with SIGTERM: the requests in progress end first.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host, port });
console.log(`Network Config Viewer: http://localhost:${port} (archivio: ${dataDir})`);
