/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { headersFor, parseHeaders } from './edge/headers';

/**
 * `vite preview` sends the same headers Cloudflare Pages will (public/_headers), so the
 * end-to-end tests run under the real Content-Security-Policy. Preview is plain http, so the
 * upgrade-insecure-requests directive is left out there.
 */
function pagesHeaders(): Plugin {
  return {
    name: 'trim-pages-headers',
    configurePreviewServer(server) {
      const rules = parseHeaders(readFileSync('public/_headers', 'utf8'));
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '/').split('?')[0] ?? '/';
        for (const [name, value] of Object.entries(headersFor(rules, path))) {
          res.setHeader(
            name,
            name === 'content-security-policy'
              ? value.replace(/;\s*upgrade-insecure-requests/, '')
              : value,
          );
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), pagesHeaders()],
  server: {
    // Same-origin in dev too: the browser only talks to the Vite server, which proxies /api.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'edge/**/*.test.ts'],
  },
});
