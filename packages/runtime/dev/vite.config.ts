/**
 * The renderer's dev harness: `npx vite packages/runtime/dev --port 5181`. Baked content
 * (`packages/content/dist`) is the public directory when it exists, so the harness loads
 * `world.json`, chunks, art, skins and clips by relative URLs; otherwise it builds a synthetic
 * world. Content sources (`packages/content`, e.g. the exported clips and skin layers) are served
 * under `/content/`, so they show up before the baker copies them.
 */
import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT = normalize(fileURLToPath(new URL('../../content/', import.meta.url)));
const TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json',
  '.png': 'image/png',
};

const contentSources: Plugin = {
  name: 'content-sources',
  configureServer(server) {
    server.middlewares.use('/content/', (req, res, next) => {
      const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? ''),
        path = normalize(join(CONTENT, rel)),
        type = TYPES[extname(path)];
      if (!path.startsWith(CONTENT) || !type) return next();
      readFile(path).then(
        (data) => {
          res.setHeader('Content-Type', type);
          res.end(data);
        },
        () => next(),
      );
    });
  },
};

export default defineConfig({
  publicDir: fileURLToPath(new URL('../../content/dist', import.meta.url)),
  plugins: [contentSources],
  server: { port: 5181 },
});
