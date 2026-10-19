/**
 * Static files: the built game (`packages/game/dist`, which already contains the baked content)
 * and, as a fallback, the baked content itself (`packages/content/dist`). Paths are resolved
 * inside the roots only; content-addressed chunks are cached for good.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mid': 'audio/midi',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function staticHandler(roots: string[]) {
  const abs = roots.map((r) => resolve(r));
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const rel = normalize(path).replace(/^([/\\])+/, '');
    for (const root of abs) {
      const file = resolve(join(root, rel));
      if (!file.startsWith(root + sep) && file !== root) continue;
      if (!existsSync(file) || !statSync(file).isFile()) continue;
      const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
      const immutable = rel.startsWith('chunks/') || rel.startsWith('assets/');
      res.writeHead(200, {
        'content-type': type,
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  };
}
