/**
 * The client side of the netcode as a pure state machine: the game owns the socket and feeds bytes
 * in (`receive`) and gives a transport to send through; the client owns the own runner's
 * prediction, the step clock, the remote runners, hashes and resyncs. Nothing here touches the DOM,
 * timers or sockets, so tests drive it with a fake transport and a fake clock.
 */
import {
  Bin,
  KeyframeReason,
  PROTOCOL_VERSION,
  decodeBinary,
  encodeBinary,
  encodeJson,
  parseServerJson,
  type BinaryMessage,
  type BoardEntry,
  type ErrorCode,
  type GameEvent,
  type ProfileView,
  type ServerJson,
} from '@parapet-world/protocol';
import {
  R,
  STATE_WORDS,
  copyRunner,
  hashRunner,
  stepRunner,
  type CellReader,
  type RunnerState,
  type Ruleset,
  type WorldStatics,
} from '@parapet-world/sim';
import { Command, type InputCommand, type InputRun, type Look } from '@parapet-world/schemas';
import { RESYNC_BEHIND, STEP_MS, StepClock } from './clock.ts';
import { RemoteRunner } from './remote.ts';

export interface Transport {
  send(data: Uint8Array | string): void;
}

export interface NetClientOptions {
  rules: Ruleset;
  world: CellReader;
  statics: WorldStatics;
  token: string;
  name: string;
  recovery?: string;
  transport: Transport;
}

export type NetPhase = 'connecting' | 'joined' | 'closed';

const RING = 256;
const HASH_EVERY = 30;
const MAX_STEPS_PER_UPDATE = 8;
const PING_EVERY = 2000;

export class NetClient {
  phase: NetPhase = 'connecting';
  readonly clock = new StepClock();
  id = -1;
  profile: ProfileView | null = null;
  origin = 0;
  /** The own runner (predicted) and its state one step earlier, for interpolation. */
  readonly own: RunnerState = new Int32Array(STATE_WORDS);
  readonly ownPrev: RunnerState = new Int32Array(STATE_WORDS);
  readonly remotes = new Map<number, RemoteRunner>();
  error: { code: ErrorCode; message: string } | null = null;

  onEvent: ((e: GameEvent, profile: ProfileView | null) => void) | null = null;
  onBoard: ((route: string, top: BoardEntry[], mine: number | null) => void) | null = null;
  onRecovery: ((code: string) => void) | null = null;
  onResync: (() => void) | null = null;

  private readonly held = new Uint8Array(RING);
  private readonly commands = new Map<number, InputCommand>();
  private pendingCommand: InputCommand | null = null;
  /** The last step whose input was sent. */
  private sentStep = 0;
  private lastPing = -1e9;
  private pingId = 0;
  private readonly pings = new Map<number, number>();
  private lastUpdate = -1;
  private haveOwn = false;
  private resyncAsked = false;

  private readonly o: NetClientOptions;

  constructor(options: NetClientOptions) {
    this.o = options;
  }

  start(): void {
    this.send({
      t: 'hello',
      v: PROTOCOL_VERSION,
      token: this.o.token,
      name: this.o.name,
      rules: this.o.rules.hash >>> 0,
      ...(this.o.recovery ? { recovery: this.o.recovery } : {}),
    });
  }

  close(): void {
    this.phase = 'closed';
  }

  private send(m: Parameters<typeof encodeJson>[0]): void {
    this.o.transport.send(encodeJson(m));
  }
  private sendBin(m: BinaryMessage): void {
    this.o.transport.send(encodeBinary(m));
  }

  /** The step the own runner has reached. */
  get ownStep(): number {
    return this.own[R.STEP]!;
  }

  /** A message from the server (binary frame or text frame), at local time `now` in ms. */
  receive(data: Uint8Array | string, now: number): void {
    if (typeof data === 'string') this.onJson(parseServerJson(data), now);
    else this.onBinary(decodeBinary(data), now);
  }

  private onJson(m: ServerJson, now: number): void {
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.profile = m.profile;
        this.origin = m.origin;
        this.clock.sample(m.serverStep, now);
        this.phase = 'joined';
        break;
      case 'recovery':
        this.onRecovery?.(m.code);
        break;
      case 'enter':
        if (m.id !== this.id) {
          this.remotes.set(m.id, new RemoteRunner(m.id, m.name, m.look, m.bot, STATE_WORDS));
        }
        break;
      case 'leave':
        this.remotes.delete(m.id);
        break;
      case 'look': {
        const r = this.remotes.get(m.id);
        if (r) r.look = m.look;
        else if (m.id === this.id && this.profile) this.profile.look = m.look;
        break;
      }
      case 'event':
        if (m.profile) this.profile = m.profile;
        this.onEvent?.(m.event, this.profile);
        break;
      case 'board':
        this.onBoard?.(m.route, m.top, m.mine);
        break;
      case 'error':
        this.error = { code: m.code, message: m.message };
        if (
          m.code === 'version' ||
          m.code === 'rules' ||
          m.code === 'name' ||
          m.code === 'nameTaken'
        )
          this.phase = 'closed';
        break;
      case 'pong': {
        const sent = this.pings.get(m.id);
        if (sent !== undefined) {
          this.pings.delete(m.id);
          this.clock.roundTrip(now - sent);
          this.clock.sample(m.serverStep, now);
        }
        break;
      }
    }
  }

  private onBinary(m: BinaryMessage, now: number): void {
    switch (m.type) {
      case Bin.TICK:
        this.clock.sample(m.serverStep, now);
        this.clock.slack(m.slack, now);
        break;
      case Bin.KEYFRAME:
        if (m.runner === this.id) this.ownKeyframe(m.state, m.reason);
        else this.remotes.get(m.runner)?.keyframe(m.state);
        break;
      case Bin.RUNNER_INPUT:
        if (m.runner !== this.id)
          this.remotes.get(m.runner)?.inputs(m.fromStep, m.runs, m.commands);
        break;
      case Bin.INPUT_FILL:
        // The server ran our runner with a guessed input; a resync keyframe follows.
        break;
      default:
        break;
    }
  }

  /** Ask the server to restart the own runner from its state (after the tab was hidden). */
  requestResync(): void {
    if (this.phase === 'joined') this.send({ t: 'resync' });
  }

  private ownKeyframe(state: Int32Array, reason: number): void {
    const step = state[R.STEP]!;
    const current = this.haveOwn ? this.ownStep : step;
    copyRunner(state, this.own);
    copyRunner(state, this.ownPrev);
    this.haveOwn = true;
    this.resyncAsked = false;
    if (reason === KeyframeReason.ENTER) {
      this.sentStep = step;
      return;
    }
    // Replay the inputs we already produced after the keyframe, so the prediction stays ahead.
    for (let k = step + 1; k <= current && k - step < RING; k++) {
      copyRunner(this.own, this.ownPrev);
      if (
        !stepRunner(
          this.own,
          this.held[k % RING]!,
          this.commands.get(k) ?? null,
          this.o.world,
          this.o.rules,
          this.o.statics,
        )
      )
        break;
    }
    if (this.sentStep < step) this.sentStep = step;
    this.onResync?.();
  }

  /** Queue a command (hub teleport) for the own runner's next step. */
  teleport(hub: number): void {
    this.pendingCommand = { step: 0, kind: Command.TELEPORT, arg: hub };
  }
  setLook(look: Look): void {
    this.send({ t: 'look', look });
  }
  requestBoard(route: string): void {
    this.send({ t: 'board', route });
  }

  /**
   * Advances the own runner to the clock's target with `held` for every new step, sends the new
   * inputs and the due hashes, and moves remote displays on. Returns the number of steps run.
   */
  update(now: number, held: number): number {
    const elapsed = this.lastUpdate < 0 ? 0 : (now - this.lastUpdate) / STEP_MS;
    this.lastUpdate = now;
    if (this.phase !== 'joined' || !this.haveOwn || !this.clock.ready) return 0;
    if (now - this.lastPing > PING_EVERY) {
      this.lastPing = now;
      const id = ++this.pingId;
      this.pings.set(id, now);
      this.send({ t: 'ping', id });
    }
    const target = Math.floor(this.clock.target(now, this.origin));
    let ran = 0;
    if (target - this.ownStep > RESYNC_BEHIND) {
      if (!this.resyncAsked) {
        this.resyncAsked = true;
        this.send({ t: 'resync' });
      }
    } else {
      while (this.ownStep < target && ran < MAX_STEPS_PER_UPDATE) {
        const k = this.ownStep + 1;
        let command: InputCommand | null = null;
        if (this.pendingCommand) {
          command = { ...this.pendingCommand, step: k };
          this.pendingCommand = null;
          this.commands.set(k, command);
        }
        copyRunner(this.own, this.ownPrev);
        if (!stepRunner(this.own, held, command, this.o.world, this.o.rules, this.o.statics)) {
          copyRunner(this.ownPrev, this.own);
          break; // chunks missing: the own clock stalls
        }
        this.held[k % RING] = held;
        ran++;
        if (k % HASH_EVERY === 0)
          this.sendBin({ type: Bin.HASH, step: k, hash: hashRunner(this.own) });
      }
      for (const k of this.commands.keys()) if (k < this.ownStep - RING) this.commands.delete(k);
    }
    this.flushInputs();
    for (const r of this.remotes.values()) {
      r.advance(this.o.world, this.o.rules, this.o.statics);
      r.frame(elapsed, this.o.world, this.o.rules, this.o.statics);
    }
    return ran;
  }

  private flushInputs(): void {
    const last = this.ownStep;
    if (last <= this.sentStep) return;
    const runs: InputRun[] = [];
    const commands: InputCommand[] = [];
    for (let k = this.sentStep + 1; k <= last; k++) {
      const h = this.held[k % RING]!;
      const tail = runs[runs.length - 1];
      if (tail && tail.held === h) tail.steps++;
      else runs.push({ steps: 1, held: h });
      const c = this.commands.get(k);
      if (c) commands.push(c);
    }
    this.sendBin({ type: Bin.INPUT, fromStep: this.sentStep + 1, runs, commands });
    this.sentStep = last;
  }

  /** How far the own runner is between `ownPrev` and `own` for drawing (0..1). */
  ownAlpha(now: number): number {
    if (!this.clock.ready) return 1;
    const t = this.clock.target(now, this.origin) - this.ownStep;
    return t <= 0 ? 0 : t >= 1 ? 1 : t;
  }

  /** The remote runner's two states and blend for drawing (call after `update`). */
  remoteFrame(r: RemoteRunner) {
    return r.frame(0, this.o.world, this.o.rules, this.o.statics);
  }
}
