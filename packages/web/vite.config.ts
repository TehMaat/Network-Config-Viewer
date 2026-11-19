import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const rootPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

/**
 * The security headers of the Docker image (nginx), applied also to "vite preview":
 * the browser tests then check the same Content Security Policy used in production.
 * The file is not needed to build the app (and is not copied in the Docker build stage).
 */
function securityHeaders(): Record<string, string> {
  const file = new URL('../../docker/security-headers.conf', import.meta.url);
  if (!existsSync(file)) return {};
  const conf = readFileSync(file, 'utf8');
  const headers: Record<string, string> = {};
  for (const match of conf.matchAll(/^add_header\s+(\S+)\s+"([^"]*)"\s+always;/gm)) {
    headers[match[1]!] = match[2]!;
  }
  return headers;
}

export default defineConfig({
  // Relative URLs: the app works from any path, also behind a reverse proxy.
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPackage.version),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    headers: securityHeaders(),
  },
});
