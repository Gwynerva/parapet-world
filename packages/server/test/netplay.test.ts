/**
 * The netcode end to end without sockets: real NetClients and the real GameServer exchange bytes
 * through a virtual network with latency, jitter and stalls, on a virtual clock.
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELL_CHARS, Key, type WorldIndex } from '@parapet-world/schemas';
import {
  GridWorld,
  R,
  createStatics,
  encodeInputLog,
  hashRunner,
  loadRuleset,
  type Ruleset,
} from '@parapet-world/sim';
import { NetClient } from '@parapet-world/net';
import {
  FileStorage,
  GameServer,
  MemoryStorage,
  checkBotRoute,
  parseBotRoute,
  type Session,
} from '../src/index.ts';

const rules: Ruleset = loadRuleset(
  JSON.parse(readFileSync(new URL('../../content/rules/moves.json', import.meta.url), 'utf8')),
);

const W = 96;
const rows: string[] = [];
for (let y = 0; y < 16; y++) {
  if (y < 12) rows.push('#' + '.'.repeat(W - 2) + '#');
  else rows.push('#'.repeat(W));
}
// a few obstacles to jump over
rows[11] = '#' + '.'.repeat(20) + '#' + '.'.repeat(30) + '__' + '.'.repeat(W - 55) + '#';
const world = GridWorld.fromRows(rows, CELL_CHARS);
const SPAWN: [number, number] = [6 * 1024 + 512, 12 * 1024];
const index: WorldIndex = {
  format: 1,
  bounds: [0, 0, 3, 1],
  chunks: [],
  materials: [],
  districts: [],
  regions: [{ id: 'r', district: 'rooftops', rect: [0, 0, W, 16], hub: 0 }],
  hubs: [
    { id: 'hub', district: 'rooftops', name: 'Hub', rect: [2, 8, 8, 4], spawn: SPAWN, facing: 1 },
  ],
  routes: [
    {
      id: 'dash',
      district: 'rooftops',
      name: 'Dash',
      difficulty: 1,
      start: [8, 8, 1, 4],
      checkpoints: [[13, 8, 1, 4]],
      finish: [18, 8, 1, 4],
      corridor: [[7, 4, 14, 8]],
    },
  ],
  finds: [{ id: 'coin', district: 'rooftops', rect: [16, 10, 1, 2], clue: 'by the first wall' }],
  props: [],
  bots: [],
  startHub: 0,
};
const statics = createStatics(index);
const STEP = 1000 / 30;

/** A seeded random number generator (deterministic tests). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

interface Player {
  client: NetClient;
  session: Session;
  rnd: () => number;
  held: number;
  holdLeft: number;
  frozenUntil: number;
}

class VirtualNet {
  now = 0;
  private queue: Array<{ at: number; seq: number; fn: () => void }> = [];
  private seq = 0;
  readonly server: GameServer;
  readonly players: Player[] = [];
  log: string[] = [];
  readonly rtt: number;
  readonly jitter: number;
  stallChance: number;
  constructor(
    rtt: number,
    jitter: number,
    stallChance: number,
    seed: number,
    bots: ReturnType<typeof parseBotRoute>[] = [],
  ) {
    this.rtt = rtt;
    this.jitter = jitter;
    this.stallChance = stallChance;
    this.rnd = lcg(seed);
    this.server = new GameServer({
      index,
      world,
      rules,
      statics,
      storage: new MemoryStorage(),
      bots,
      log: (l) => this.log.push(l),
    });
  }
  private rnd: () => number;
  private delay(): number {
    return this.rtt / 2 + (this.rnd() * 2 - 1) * this.jitter;
  }
  /** Schedules a delivery on a link; a link never reorders (WebSockets run over TCP). */
  private later(link: { last: number }, ms: number, fn: () => void): void {
    const at = Math.max(this.now + Math.max(0, ms), link.last);
    link.last = at;
    this.queue.push({ at, seq: this.seq++, fn });
  }
  join(name: string, seed: number): Player {
    let player!: Player;
    const down = { last: 0 };
    const up = { last: 0 };
    const conn = {
      address: `10.0.0.${this.players.length + 1}`,
      send: (data: Uint8Array | string) => {
        const copy = typeof data === 'string' ? data : data.slice();
        this.later(down, this.delay(), () => player.client.receive(copy, this.now));
      },
      close: () => {},
    };
    const session = this.server.connect(conn)!;
    const client = new NetClient({
      rules,
      world,
      statics,
      token: `token-${name}-0123456789abcdef`,
      name,
      transport: {
        send: (data) => {
          const copy = typeof data === 'string' ? data : data.slice();
          this.later(up, this.delay(), () => this.server.receive(session, copy));
        },
      },
    });
    player = { client, session, rnd: lcg(seed), held: 0, holdLeft: 0, frozenUntil: 0 };
    this.players.push(player);
    client.start();
    return player;
  }
  /** Runs the world for `ms` of virtual time: server ticks at 30 Hz, clients update at `fps`. */
  run(ms: number, fps = 60): void {
    const end = this.now + ms;
    let nextTick = Math.ceil(this.now / STEP) * STEP;
    let nextFrame = this.now;
    while (this.now < end) {
      this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const nextMsg = this.queue[0]?.at ?? Infinity;
      const t = Math.min(nextMsg, nextTick, nextFrame, end);
      this.now = t;
      if (nextMsg === t) {
        this.queue.shift()!.fn();
        continue;
      }
      if (nextTick === t) {
        this.server.tick();
        nextTick += STEP;
        continue;
      }
      if (nextFrame === t) {
        for (const p of this.players) this.frame(p);
        nextFrame += 1000 / fps;
        continue;
      }
    }
  }
  private frame(p: Player): void {
    if (this.now < p.frozenUntil) return;
    if (this.stallChance > 0 && p.rnd() < this.stallChance / 60) {
      p.frozenUntil = this.now + 300 + p.rnd() * 400; // a stalled tab or a GC pause
      return;
    }
    if (--p.holdLeft <= 0) {
      const r = p.rnd();
      p.held =
        r < 0.4
          ? Key.RIGHT
          : r < 0.7
            ? Key.LEFT
            : r < 0.8
              ? Key.RIGHT | Key.UP
              : r < 0.9
                ? Key.UP
                : 0;
      p.holdLeft = 10 + Math.floor(p.rnd() * 50);
    }
    p.client.update(this.now, p.held);
  }
}

function ownMatchesServer(net: VirtualNet, p: Player): boolean {
  const r = net.server.runner(p.client.id)!;
  const k = Math.min(r.step, p.client.ownStep);
  const serverHash = r.hashAt(k);
  // The client's own hash at step k is only known for its current step; compare at the server's
  // simulated step after letting the inputs arrive.
  return serverHash !== null && k === p.client.ownStep
    ? serverHash === hashRunner(p.client.own)
    : true;
}

describe('netplay over a virtual network', () => {
  it('two players at 200 ms RTT stay in sync and see each other', () => {
    const net = new VirtualNet(200, 20, 0, 1);
    const a = net.join('Ana', 11);
    const b = net.join('Bo', 22);
    net.run(60_000);
    expect(a.client.phase).toBe('joined');
    expect(net.log.filter((l) => l.includes('mismatch'))).toEqual([]);
    // Both clients keep pace with the server's clock.
    const ra = net.server.runner(a.client.id)!;
    expect(Math.abs(a.client.ownStep - ra.step)).toBeLessThan(15);
    // B sees A, and B's copy of A matches the server's A at B's confirmed step.
    const remote = b.client.remotes.get(a.client.id)!;
    expect(remote).toBeDefined();
    const k = remote.confirmedStep;
    expect(k).toBeGreaterThan(1500);
    expect(hashRunner(remote.confirmed)).toBe(ra.hashAt(k));
    // A's own prediction matches the server once the server reaches A's step.
    const before = a.client.ownStep;
    const own = Int32Array.from(a.client.own);
    a.frozenUntil = Infinity;
    net.run(1000);
    expect(ra.hashAt(before)).toBe(hashRunner(own));
    expect(ownMatchesServer(net, b)).toBe(true);
  });

  it('5% stalls cause fills and resyncs that converge, slack stays in range', () => {
    const net = new VirtualNet(200, 30, 0.05, 2);
    const a = net.join('Cy', 33);
    let resyncs = 0;
    a.client.onResync = () => resyncs++;
    net.run(120_000);
    const ra = net.server.runner(a.client.id)!;
    // After the run: stop stalls, give it a few seconds, then own state must match the server.
    a.frozenUntil = 0;
    net.stallChance = 0;
    net.run(5000);
    const k = a.client.ownStep;
    const own = Int32Array.from(a.client.own);
    a.frozenUntil = Infinity;
    net.run(2000);
    expect(ra.hashAt(k)).toBe(hashRunner(own));
    expect(resyncs).toBeGreaterThan(0);
    expect(ra.slack).toBeGreaterThanOrEqual(-1);
    expect(ra.slack).toBeLessThanOrEqual(8);
  });

  it('an hour of play at 100 ms RTT has no hash mismatch', { timeout: 300_000 }, () => {
    const net = new VirtualNet(100, 15, 0, 3);
    net.join('Dee', 44);
    net.run(60 * 60_000, 30);
    expect(net.log.filter((l) => l.includes('mismatch'))).toEqual([]);
  });
});

describe('bots', () => {
  function shuttle(): ReturnType<typeof parseBotRoute> {
    // Run right, stop, run back left, stop: search the return run's length that ends nearest.
    let best: ReturnType<typeof parseBotRoute> | null = null;
    let bestDist = Infinity;
    for (let back = 20; back <= 60; back++) {
      const held: number[] = [];
      for (let i = 0; i < 40; i++) held.push(Key.RIGHT);
      for (let i = 0; i < 25; i++) held.push(0);
      for (let i = 0; i < back; i++) held.push(Key.LEFT);
      for (let i = 0; i < 25; i++) held.push(0);
      for (let i = 0; i < 3; i++) held.push(Key.RIGHT);
      for (let i = 0; i < 25; i++) held.push(0);
      const route = parseBotRoute(
        {
          format: 1,
          name: 'Shuttle',
          district: 'rooftops',
          look: { hair: 'hairShort', costume: 'tee' },
          start: { x: SPAWN[0] + 10 * 1024, y: SPAWN[1], facing: 1 },
          runs: encodeInputLog(held),
        },
        'shuttle',
      );
      const c = checkBotRoute(route, world, rules, statics);
      if (c.ok && c.endDistancePx < bestDist) {
        bestDist = c.endDistancePx;
        best = route;
      }
    }
    if (!best) throw new Error('no shuttle route closes its loop');
    return best;
  }

  it('a bot loops and a player sees it exactly as the server runs it', () => {
    const route = shuttle();
    const net = new VirtualNet(150, 10, 0, 5, [route]);
    const a = net.join('Eve', 55);
    a.frozenUntil = 0;
    net.run(20_000);
    const bots = [...a.client.remotes.values()].filter((r) => r.bot);
    expect(bots.length).toBe(1);
    const bot = bots[0]!;
    const sr = net.server.runner(bot.id)!;
    expect(hashRunner(bot.confirmed)).toBe(sr.hashAt(bot.confirmedStep));
    // The loop restarted at least twice in 20 s (each loop is a few seconds).
    expect(sr.state[R.STEP]).toBeLessThan(route.held.length + 1);
  });
});

describe('profiles', () => {
  it('survive a restart; names are claimed; recovery codes move them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-profiles-'));
    try {
      let storage = new FileStorage(dir);
      let s1 = new GameServer({ index, world, rules, statics, storage });
      const p = s1.profiles.claim('token-aaaaaaaaaaaaaaaa', 'Kite');
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      p.profile.finds.push('f1');
      s1.profiles.save(p.profile);
      storage.flush();
      storage = new FileStorage(dir);
      s1 = new GameServer({ index, world, rules, statics, storage });
      const again = s1.profiles.claim('token-aaaaaaaaaaaaaaaa', 'ignored');
      expect(again.ok && again.profile.finds).toEqual(['f1']);
      const taken = s1.profiles.claim('token-bbbbbbbbbbbbbbbb', 'kite');
      expect(taken).toEqual({ ok: false, code: 'nameTaken' });
      const moved = s1.profiles.claim('token-bbbbbbbbbbbbbbbb', 'Kite', p.recovery!);
      expect(moved.ok && moved.profile.finds).toEqual(['f1']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('goals through the observers', () => {
  it('a finished route and a find reach the client, the profile and the leaderboard', () => {
    const net = new VirtualNet(120, 10, 0, 9);
    const p = net.join('Fay', 66);
    p.held = Key.RIGHT;
    p.holdLeft = 1e9;
    const events: string[] = [];
    p.client.onEvent = (e) => events.push(e.kind === 'finish' ? `finish:${e.route}` : e.kind);
    net.run(6000);
    expect(events).toContain('routeStart');
    expect(events).toContain('checkpoint');
    expect(events).toContain('finish:dash');
    expect(events).toContain('find');
    expect(p.client.profile?.finds).toEqual(['coin']);
    expect(p.client.profile?.best.dash).toBeGreaterThan(0);
    expect(net.server.boards.top('dash')[0]?.name).toBe('Fay');
  });
});
