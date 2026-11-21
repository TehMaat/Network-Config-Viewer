import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const rootPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

/**
 * The security headers of the server, from their single source, applied also to
 * "vite preview": a quick look at the build follows the same Content Security Policy.
 */
function securityHeaders(): Record<string, string> {
  const file = new URL('../server/src/security-headers.json', import.meta.url);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
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
