/**
 * The game server's core, independent of sockets and timers: sessions come and go through
 * `connect`/`receive`/`disconnect`, and `tick()` advances the global clock by one step. Every
 * runner (players and bots) is simulated on its own; the server relays the inputs it simulated
 * each runner with to the sessions that see it (5 x 5 chunks around their own runner, one chunk of
 * hysteresis), checks the owners' hashes, resyncs, runs the observers and keeps profiles and
 * leaderboards.
 */
import {
  Bin,
  KeyframeReason,
  PROTOCOL_VERSION,
  ProtocolError,
  decodeBinary,
  encodeBinary,
  encodeJson,
  parseClientJson,
  validLook,
  type BinaryMessage,
  type ClientJson,
  type GameEvent,
  type KeyframeReasonCode,
  type ServerJson,
} from '@parapet-world/protocol';
import {
  R,
  copyRunner,
  createRunner,
  hashRunner,
  stepRunner,
  type CellReader,
  type Ruleset,
  type WorldStatics,
} from '@parapet-world/sim';
import {
  CHUNK,
  Command,
  UNLOCKS,
  chunkKey,
  type InputCommand,
  type InputRun,
  type WorldIndex,
} from '@parapet-world/schemas';
import { Boards } from './boards.ts';
import { botStart, type BotRoute } from './bots.ts';
import { createObserverFor, type RunnerObserver, type SimEvent } from './observe.ts';
import { Profiles, lookAllowed, profileView, type Profile } from './profiles.ts';
import { FILL_AFTER, ServerRunner, ZERO_AFTER } from './runner.ts';
import type { Storage } from './storage.ts';

export interface Connection {
  readonly address: string;
  send(data: Uint8Array | string): void;
  close(): void;
}

export interface GameServerOptions {
  index: WorldIndex;
  world: CellReader;
  rules: Ruleset;
  statics: WorldStatics;
  storage: Storage;
  bots?: BotRoute[];
  /** Max players at once. */
  capacity?: number;
  log?: (line: string) => void;
}

const VIEW = 2;
const KEEP = 3;
const INTEREST_EVERY = 10;
const RESYNC_GAP = 15;
const MSG_PER_SECOND = 240;
const SESSIONS_PER_ADDRESS = 8;

export class Session {
  readonly conn: Connection;
  runner: ServerRunner | null = null;
  profile: Profile | null = null;
  /** Runners this session sees, with the last step relayed to it. */
  readonly sees = new Map<number, number>();
  msgCount = 0;
  msgWindow = 0;
  closed = false;
  constructor(conn: Connection) {
    this.conn = conn;
  }
  json(m: ServerJson): void {
    if (!this.closed) this.conn.send(encodeJson(m));
  }
  bin(m: BinaryMessage): void {
    if (!this.closed) this.conn.send(encodeBinary(m));
  }
}

interface Driver {
  runner: ServerRunner;
  observer: RunnerObserver;
  route?: BotRoute;
  start?: Int32Array;
}

export class GameServer {
  /** The global step. */
  step = 0;
  readonly sessions = new Set<Session>();
  private readonly drivers = new Map<number, Driver>();
  private nextId = 1;
  readonly profiles: Profiles;
  readonly boards: Boards;
  private readonly o: GameServerOptions;
  private readonly events: SimEvent[] = [];
  private readonly log: (line: string) => void;

  constructor(options: GameServerOptions) {
    this.o = options;
    this.profiles = new Profiles(options.storage);
    this.boards = new Boards(options.storage);
    this.log = options.log ?? (() => {});
    for (const route of options.bots ?? []) this.addBot(route);
  }

  get runnerCount(): number {
    return this.drivers.size;
  }
  runner(id: number): ServerRunner | undefined {
    return this.drivers.get(id)?.runner;
  }

  private newId(): number {
    for (let i = 0; i < 65535; i++) {
      const id = this.nextId;
      this.nextId = (this.nextId % 65534) + 1;
      if (!this.drivers.has(id)) return id;
    }
    throw new Error('no runner ids left');
  }

  private addBot(route: BotRoute): void {
    const r = new ServerRunner(this.newId(), 'bot', route.file.name, route.file.look);
    const start = botStart(route, this.o.rules);
    copyRunner(start, r.state);
    r.origin = this.step - r.step;
    this.drivers.set(r.id, {
      runner: r,
      observer: createObserverFor(this.o.statics, this.o.rules),
      route,
      start,
    });
  }

  // ---------- sessions ----------

  connect(conn: Connection): Session | null {
    let same = 0;
    for (const s of this.sessions) if (s.conn.address === conn.address) same++;
    if (same >= SESSIONS_PER_ADDRESS) {
      conn.send(encodeJson({ t: 'error', code: 'rate', message: 'too many connections' }));
      conn.close();
      return null;
    }
    const s = new Session(conn);
    this.sessions.add(s);
    return s;
  }

  disconnect(s: Session): void {
    if (s.closed) return;
    s.closed = true;
    this.sessions.delete(s);
    if (s.runner) {
      const id = s.runner.id;
      this.drivers.delete(id);
      for (const other of this.sessions) {
        if (other.sees.delete(id)) other.json({ t: 'leave', id });
      }
    }
    if (s.profile) this.profiles.save(s.profile);
  }

  receive(s: Session, data: Uint8Array | string): void {
    if (s.closed) return;
    if (s.msgWindow !== Math.floor(this.step / 30)) {
      s.msgWindow = Math.floor(this.step / 30);
      s.msgCount = 0;
    }
    if (++s.msgCount > MSG_PER_SECOND) {
      s.json({ t: 'error', code: 'rate', message: 'too many messages' });
      s.conn.close();
      this.disconnect(s);
      return;
    }
    try {
      if (typeof data === 'string') this.onJson(s, parseClientJson(data));
      else this.onBinary(s, decodeBinary(data));
    } catch (e) {
      if (e instanceof ProtocolError) {
        s.json({ t: 'error', code: 'bad', message: e.message });
        return;
      }
      throw e;
    }
  }

  private onJson(s: Session, m: ClientJson): void {
    if (m.t === 'hello') return this.hello(s, m);
    if (!s.runner || !s.profile) return;
    switch (m.t) {
      case 'look':
        if (!lookAllowed(s.profile, m.look)) return;
        s.profile.look = validLook(m.look);
        s.runner.look = s.profile.look;
        this.profiles.save(s.profile);
        s.json({ t: 'look', id: s.runner.id, look: s.profile.look });
        for (const o of this.sessions)
          if (o.sees.has(s.runner.id)) o.json({ t: 'look', id: s.runner.id, look: s.profile.look });
        break;
      case 'board':
        s.json({
          t: 'board',
          route: m.route,
          top: this.boards.top(m.route),
          mine: this.boards.mine(m.route, s.profile.id),
        });
        break;
      case 'resync':
        this.resync(s.runner, true);
        break;
      case 'ping':
        s.json({ t: 'pong', id: m.id, serverStep: this.step });
        break;
    }
  }

  private hello(s: Session, m: Extract<ClientJson, { t: 'hello' }>): void {
    if (s.runner) return;
    if (m.v !== PROTOCOL_VERSION) {
      s.json({ t: 'error', code: 'version', message: `protocol ${PROTOCOL_VERSION} required` });
      return;
    }
    if (m.rules >>> 0 !== this.o.rules.hash >>> 0) {
      s.json({ t: 'error', code: 'rules', message: 'the game was updated; reload' });
      return;
    }
    let players = 0;
    for (const o of this.sessions) if (o.runner) players++;
    if (players >= (this.o.capacity ?? 64)) {
      s.json({ t: 'error', code: 'full', message: 'the city is full' });
      return;
    }
    const claim = this.profiles.claim(m.token, m.name, m.recovery);
    if (!claim.ok) {
      const message =
        claim.code === 'nameTaken'
          ? 'that name is taken'
          : claim.code === 'recovery'
            ? 'wrong recovery code'
            : 'names are 2-16 letters, digits, spaces, dots, dashes or underscores';
      s.json({ t: 'error', code: claim.code, message });
      return;
    }
    const profile = claim.profile;
    for (const o of this.sessions) {
      if (o !== s && o.profile?.id === profile.id) {
        o.json({ t: 'error', code: 'bad', message: 'signed in elsewhere' });
        o.conn.close();
        this.disconnect(o);
      }
    }
    s.profile = profile;
    const hubs = this.o.index.hubs;
    let hub = hubs.findIndex((h) => h.id === profile.lastHub);
    if (hub < 0) hub = this.o.index.startHub;
    const h = hubs[hub];
    const r = new ServerRunner(this.newId(), 'player', profile.name, profile.look);
    const fresh = h
      ? createRunner(this.o.rules, h.spawn[0], h.spawn[1], h.facing)
      : createRunner(this.o.rules, 0, 0, 1);
    copyRunner(fresh, r.state);
    r.origin = this.step;
    s.runner = r;
    this.drivers.set(r.id, {
      runner: r,
      observer: createObserverFor(this.o.statics, this.o.rules),
    });
    s.json({
      t: 'welcome',
      v: PROTOCOL_VERSION,
      id: r.id,
      profile: profileView(profile),
      serverStep: this.step,
      origin: r.origin,
    });
    if (claim.recovery) s.json({ t: 'recovery', code: claim.recovery });
    this.keyframe(s, r, KeyframeReason.ENTER);
    this.interest(s);
    this.log(`join ${profile.name} as runner ${r.id}`);
  }

  private onBinary(s: Session, m: BinaryMessage): void {
    const r = s.runner;
    if (!r || !s.profile) return;
    if (m.type === Bin.INPUT) this.input(s, r, m.fromStep, m.runs, m.commands);
    else if (m.type === Bin.HASH) this.ownerHash(r, m.step, m.hash);
  }

  private input(
    s: Session,
    r: ServerRunner,
    fromStep: number,
    runs: readonly InputRun[],
    commands: readonly InputCommand[],
  ): void {
    let k = fromStep;
    let late = false;
    for (const run of runs) {
      for (let i = 0; i < run.steps; i++, k++) {
        const res = r.offer(k, run.held & 31, this.step);
        if (res === 'late') late = true;
        else if (res === 'early') {
          r.needsResync = true;
          return;
        }
      }
    }
    for (const c of commands) {
      if (c.step <= r.step) continue;
      if (c.kind === Command.TELEPORT) {
        const hub = this.o.index.hubs[c.arg];
        if (!hub || !s.profile!.hubs.includes(hub.id)) {
          r.needsResync = true;
          continue;
        }
        r.inboxCommands.set(c.step, c);
      }
    }
    if (late && r.fillingFrom >= 0) r.needsResync = true;
    else if (late) r.needsResync = true;
  }

  private ownerHash(r: ServerRunner, step: number, hash: number): void {
    if (step > r.step) {
      if (r.ownerHashes.size < 64) r.ownerHashes.set(step, hash >>> 0);
      return;
    }
    const mine = r.hashAt(step);
    if (mine !== null && mine !== hash >>> 0) {
      this.log(`hash mismatch runner ${r.id} step ${step}`);
      r.needsResync = true;
    }
  }

  // ---------- the clock ----------

  /** Advances the global clock one step: simulate, observe, relay, tick. */
  tick(): void {
    this.step++;
    for (const d of this.drivers.values()) {
      if (d.runner.kind === 'bot') this.advanceBot(d);
      else this.advancePlayer(d);
    }
    if (this.step % INTEREST_EVERY === 0) for (const s of this.sessions) this.interest(s);
    for (const s of this.sessions) this.relay(s);
  }

  private session(r: ServerRunner): Session | undefined {
    for (const s of this.sessions) if (s.runner === r) return s;
    return undefined;
  }

  private advancePlayer(d: Driver): void {
    const r = d.runner;
    const s = this.session(r);
    const due = this.step - r.origin;
    while (r.step < due) {
      const k = r.step + 1;
      let held = r.inputFor(k);
      if (held < 0) {
        const waited = this.step - (r.origin + k);
        if (waited < FILL_AFTER) break;
        held = waited >= FILL_AFTER + ZERO_AFTER ? 0 : r.lastHeld;
        if (r.fillingFrom < 0) {
          r.fillingFrom = k;
          s?.bin({ type: Bin.INPUT_FILL, runner: r.id, step: k, held });
        }
      } else {
        r.fillingFrom = -1;
      }
      if (!this.simulate(d, held, r.inboxCommands.get(k) ?? null)) break;
    }
    if (s) {
      s.bin({
        type: Bin.TICK,
        serverStep: this.step,
        simStep: r.step,
        ackStep: r.newestInput,
        slack: r.slack,
      });
      if (r.needsResync && this.step - r.lastResync >= RESYNC_GAP) this.resync(r, false);
    }
  }

  private advanceBot(d: Driver): void {
    const r = d.runner;
    const route = d.route!;
    const loopLen = route.held.length;
    const startStep = d.start![R.STEP]!;
    let i = r.step - startStep;
    if (i >= loopLen) {
      copyRunner(d.start!, r.state);
      r.origin = this.step - r.step;
      d.observer.reset();
      for (const s of this.sessions) {
        if (s.sees.has(r.id)) {
          this.keyframe(s, r, KeyframeReason.LOOP);
        }
      }
      i = 0;
    }
    this.simulate(d, route.held[i]!, null);
  }

  private simulate(d: Driver, held: number, command: InputCommand | null): boolean {
    const r = d.runner;
    if (!stepRunner(r.state, held, command, this.o.world, this.o.rules, this.o.statics))
      return false;
    r.lastHeld = held;
    const k = r.step;
    const hash = hashRunner(r.state);
    r.recordRan(k, held, command, hash);
    const reported = r.ownerHashes.get(k);
    if (reported !== undefined) {
      r.ownerHashes.delete(k);
      if (reported !== hash) {
        this.log(`hash mismatch runner ${r.id} step ${k}`);
        r.needsResync = true;
      }
    }
    if (command) d.observer.reset();
    this.events.length = 0;
    d.observer.step(r.state, this.events);
    if (this.events.length && r.kind === 'player') this.onEvents(r, this.events);
    return true;
  }

  private resync(r: ServerRunner, asked: boolean): void {
    const s = this.session(r);
    if (!s) return;
    r.needsResync = false;
    r.lastResync = this.step;
    r.fillingFrom = -1;
    r.ownerHashes.clear();
    // The owner restarts from our newest state; its inputs after it are still good.
    this.keyframe(s, r, KeyframeReason.RESYNC);
    if (asked) this.log(`resync requested by runner ${r.id}`);
  }

  private keyframe(s: Session, r: ServerRunner, reason: KeyframeReasonCode): void {
    s.bin({ type: Bin.KEYFRAME, runner: r.id, reason, serverStep: this.step, state: r.state });
    if (s.runner !== r) s.sees.set(r.id, r.step);
  }

  // ---------- interest and relay ----------

  private interest(s: Session): void {
    const own = s.runner;
    if (!own) return;
    const cx = Math.floor(own.state[R.X]! / CHUNK);
    const cy = Math.floor(own.state[R.Y]! / CHUNK);
    for (const d of this.drivers.values()) {
      const r = d.runner;
      if (r === own) continue;
      const dx = Math.abs(Math.floor(r.state[R.X]! / CHUNK) - cx);
      const dy = Math.abs(Math.floor(r.state[R.Y]! / CHUNK) - cy);
      const seen = s.sees.has(r.id);
      if (!seen && dx <= VIEW && dy <= VIEW) {
        s.json({ t: 'enter', id: r.id, name: r.name, look: r.look, bot: r.kind === 'bot' });
        this.keyframe(s, r, KeyframeReason.ENTER);
      } else if (seen && (dx > KEEP || dy > KEEP)) {
        s.sees.delete(r.id);
        s.json({ t: 'leave', id: r.id });
      }
    }
    for (const id of s.sees.keys()) {
      if (!this.drivers.has(id)) {
        s.sees.delete(id);
        s.json({ t: 'leave', id });
      }
    }
  }

  private relay(s: Session): void {
    for (const [id, sent] of s.sees) {
      const r = this.drivers.get(id)?.runner;
      if (!r || r.step <= sent) continue;
      if (!r.hasHistory(sent + 1, r.step)) {
        this.keyframe(s, r, KeyframeReason.ENTER);
        continue;
      }
      const runs: InputRun[] = [];
      const commands: InputCommand[] = [];
      for (let k = sent + 1; k <= r.step; k++) {
        const h = r.ranHeld[k % r.ranHeld.length]!;
        const tail = runs[runs.length - 1];
        if (tail && tail.held === h) tail.steps++;
        else runs.push({ steps: 1, held: h });
        const c = r.ranCommands.get(k);
        if (c) commands.push(c);
      }
      s.bin({ type: Bin.RUNNER_INPUT, runner: id, fromStep: sent + 1, runs, commands });
      s.sees.set(id, r.step);
    }
  }

  // ---------- events ----------

  private onEvents(r: ServerRunner, events: readonly SimEvent[]): void {
    const s = this.session(r);
    const p = s?.profile;
    if (!s || !p) return;
    const idx = this.o.index;
    const send = (event: GameEvent, withProfile = false) =>
      s.json(withProfile ? { t: 'event', event, profile: profileView(p) } : { t: 'event', event });
    for (const e of events) {
      switch (e.kind) {
        case 'hub': {
          const hub = idx.hubs[e.hub];
          if (!hub) break;
          p.lastHub = hub.id;
          if (!p.hubs.includes(hub.id)) {
            p.hubs.push(hub.id);
            send({ kind: 'hub', hub: hub.id }, true);
          }
          this.profiles.save(p);
          break;
        }
        case 'find': {
          const find = idx.finds[e.find];
          if (!find || p.finds.includes(find.id)) break;
          const before = p.finds.length;
          p.finds.push(find.id);
          this.profiles.save(p);
          send({ kind: 'find', find: find.id, total: p.finds.length }, true);
          for (const u of UNLOCKS) {
            if (before < u.finds && p.finds.length >= u.finds) {
              send({ kind: 'unlock', unlock: u.kind, id: u.id }, true);
            }
          }
          break;
        }
        case 'routeStart': {
          const route = idx.routes[e.route];
          if (route) send({ kind: 'routeStart', route: route.id });
          break;
        }
        case 'checkpoint': {
          const route = idx.routes[e.route];
          if (route) send({ kind: 'checkpoint', route: route.id, index: e.index, steps: e.steps });
          break;
        }
        case 'finish': {
          const route = idx.routes[e.route];
          if (!route) break;
          const { best, rank } = this.boards.submit(route.id, p.id, p.name, e.steps, Date.now());
          if (best) {
            p.best[route.id] = e.steps;
            this.profiles.save(p);
          }
          send({ kind: 'finish', route: route.id, steps: e.steps, best, rank }, best);
          break;
        }
        case 'cancel': {
          const route = idx.routes[e.route];
          if (route) send({ kind: 'cancel', route: route.id });
          break;
        }
        case 'death':
          send({ kind: 'death' });
          break;
        case 'respawn': {
          const hub = idx.hubs[e.hub];
          if (hub) p.lastHub = hub.id;
          break;
        }
      }
    }
  }

  /** Visible chunk keys of a session (for tests and diagnostics). */
  viewKey(s: Session): number {
    const own = s.runner;
    if (!own) return 0;
    return chunkKey(Math.floor(own.state[R.X]! / CHUNK), Math.floor(own.state[R.Y]! / CHUNK));
  }
}
