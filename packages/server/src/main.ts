/**
 * The game server: `npm run serve` (node packages/server/src/main.ts).
 *
 * Options: `--port 8080`, `--data data` (profiles and leaderboards), `--dist
 * packages/content/dist`, `--game packages/game/dist`, `--world world.json` (the index to load
 * from dist; `gym.json` serves the move gym), `--headless` (no HTTP, bots only, prints a status
 * line every 10 s; with `--minutes N` it runs N minutes of game time as fast as it can).
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadContent } from './content.ts';
import { GameServer, type Connection } from './game.ts';
import { staticHandler } from './http.ts';
import { FileStorage } from './storage.ts';
import { STEP_MS } from './clock.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const port = Number(opt('port', process.env.PORT ?? '8080'));
const dataDir = resolve(root, opt('data', 'data'));
const dist = resolve(root, opt('dist', 'packages/content/dist'));
const gameDist = resolve(root, opt('game', 'packages/game/dist'));
const headless = args.includes('--headless');

const content = loadContent(dist, undefined, opt('world', 'world.json'));
const storage = new FileStorage(dataDir);
const game = new GameServer({
  index: content.index,
  world: content.world,
  rules: content.rules,
  statics: content.statics,
  storage,
  bots: content.bots,
  log: (line) => console.log(line),
});
console.log(
  `world ${content.index.chunks.length} chunks, ${content.bots.length} bots, rules ${content.rules.hash.toString(16)}`,
);

const flush = () => storage.flush();
setInterval(flush, 2000).unref();
process.on('SIGINT', () => {
  flush();
  process.exit(0);
});

if (headless) {
  const minutes = Number(opt('minutes', '0'));
  if (minutes > 0) {
    const steps = minutes * 60 * 30;
    const t0 = Date.now();
    for (let i = 0; i < steps; i++) game.tick();
    console.log(`${steps} steps of ${game.runnerCount} runners in ${Date.now() - t0} ms`);
    flush();
  } else {
    startClock();
  }
} else {
  const http = createServer(staticHandler([gameDist, dist]));
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });
  wss.on('connection', (ws: WebSocket, req) => {
    const address =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      '?';
    const conn: Connection = {
      address,
      send: (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close: () => ws.close(),
    };
    const session = game.connect(conn);
    if (!session) return;
    ws.on('message', (data, isBinary) => {
      const bytes = Buffer.isBuffer(data)
        ? data
        : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data as ArrayBuffer)]);
      game.receive(
        session,
        isBinary
          ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          : bytes.toString('utf8'),
      );
    });
    ws.on('close', () => game.disconnect(session));
    ws.on('error', () => game.disconnect(session));
  });
  http.listen(port, () => console.log(`Parapet World server on http://localhost:${port} (ws /ws)`));
  startClock();
}

/** Steps the global clock at 30 per second with drift correction (never more than 5 at once). */
function startClock(): void {
  const t0 = performance.now();
  let lastLog = 0;
  setInterval(() => {
    const due = Math.floor((performance.now() - t0) / STEP_MS);
    let n = 0;
    while (game.step < due && n < 5) {
      game.tick();
      n++;
    }
    if (game.step < due - 30) {
      // Fell far behind (a stall): skip ahead rather than spiral.
      while (game.step < due) game.tick();
    }
    if (headless && performance.now() - lastLog > 10000) {
      lastLog = performance.now();
      console.log(`step ${game.step}, ${game.runnerCount} runners, ${game.sessions.size} sessions`);
    }
  }, STEP_MS / 2);
}
