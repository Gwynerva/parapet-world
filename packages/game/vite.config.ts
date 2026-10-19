/**
 * The game's dev server and build. Baked content (`packages/content/dist`, written by
 * `npm run bake`) is served as the public directory, so the game fetches `world.json`, chunks,
 * atlases, clips and skins by relative URLs. In development `/ws` is proxied to the game server.
 *
 * Two development-only additions: the content sources are served under `/content/` (skins,
 * clips, rules and marker sprites before the baker copies them), and `POST /__dev/bots` saves a
 * bot route recorded with `?dev` to `packages/content/bots/<district>-<n>.bot.json`.
 */
import { defineConfig, type Plugin } from 'vite';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT = normalize(fileURLToPath(new URL('../content/', import.meta.url)));
const TYPES: Readonly<Record<string, string>> = {
  '.json': 'application/json',
  '.png': 'image/png',
};

const contentSources: Plugin = {
  name: 'content-sources',
  apply: 'serve',
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

const devBots: Plugin = {
  name: 'dev-bots',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__dev/bots', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        void (async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              district?: unknown;
              file?: { format?: unknown; runs?: unknown; start?: { x?: unknown; y?: unknown } };
            };
            const district = String(body.district ?? '');
            const file = body.file;
            if (
              !/^[a-z0-9-]+$/.test(district) ||
              !file ||
              file.format !== 1 ||
              !Array.isArray(file.runs) ||
              typeof file.start?.x !== 'number' ||
              typeof file.start?.y !== 'number'
            ) {
              throw new Error('not a bot route');
            }
            const dir = join(CONTENT, 'bots');
            await mkdir(dir, { recursive: true });
            const taken = new Set(await readdir(dir));
            let n = 1;
            while (taken.has(`${district}-${n}.bot.json`)) n++;
            const name = `${district}-${n}.bot.json`;
            await writeFile(join(dir, name), JSON.stringify(file, null, 1) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ file: `content/bots/${name}` }));
          } catch (e) {
            res.statusCode = 400;
            res.end(e instanceof Error ? e.message : String(e));
          }
        })();
      });
    });
  },
};

export default defineConfig({
  base: './',
  publicDir: fileURLToPath(new URL('../content/dist', import.meta.url)),
  plugins: [contentSources, devBots],
  server: {
    port: 5180,
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
  build: { target: 'es2022', assetsInlineLimit: 0, outDir: 'dist' },
});
