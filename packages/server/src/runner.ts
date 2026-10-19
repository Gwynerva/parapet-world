/**
 * A runner on the server: a player's (inputs from its socket) or a bot's (inputs from a looped
 * recording). Step k of a runner is due at global step `origin + k`. A player's step waits for its
 * input; after `FILL_AFTER` steps of waiting the last held mask is repeated (InputFill), and after
 * `ZERO_AFTER` more, nothing is held. Every simulated step's input is kept in a ring for relaying
 * to the clients that see the runner, and its hash for comparing with the owner's.
 */
import { R, STATE_WORDS, type RunnerState } from '@parapet-world/sim';
import type { InputCommand, Look } from '@parapet-world/schemas';

export const RING = 512;
export const FILL_AFTER = 15;
export const ZERO_AFTER = 60;
/** Inputs further ahead of the server's clock than this are refused. */
export const MAX_AHEAD = 90;

export class ServerRunner {
  readonly id: number;
  readonly kind: 'player' | 'bot';
  name: string;
  look: Look;
  readonly state: RunnerState = new Int32Array(STATE_WORDS);
  /** The global step at which this runner's step 0 is due. */
  origin = 0;

  /** Received inputs by step (`RING` slots): held mask, or -1 for none. */
  readonly inbox = new Int16Array(RING).fill(-1);
  readonly inboxStep = new Int32Array(RING).fill(-1);
  readonly inboxCommands = new Map<number, InputCommand>();
  /** The highest step whose input arrived, and how early it arrived (steps). */
  newestInput = 0;
  slack = 0;

  /** Simulated history: the held mask and command each step ran with. */
  readonly ranHeld = new Uint8Array(RING);
  readonly ranStep = new Int32Array(RING).fill(-1);
  readonly ranCommands = new Map<number, InputCommand>();
  readonly hashes = new Uint32Array(RING);
  /** Hashes the owner reported for steps not simulated yet. */
  readonly ownerHashes = new Map<number, number>();

  lastHeld = 0;
  /** The first step of the current run of filled inputs, or -1. */
  fillingFrom = -1;
  /** Global step of the last resync sent (rate limit). */
  lastResync = -1e9;
  needsResync = false;

  constructor(id: number, kind: 'player' | 'bot', name: string, look: Look) {
    this.id = id;
    this.kind = kind;
    this.name = name;
    this.look = look;
  }

  get step(): number {
    return this.state[R.STEP]!;
  }

  /** Stores an input for step `k`; false when it is too late or too early. */
  offer(k: number, held: number, globalStep: number): 'ok' | 'late' | 'early' {
    if (k <= this.step) return 'late';
    if (this.origin + k > globalStep + MAX_AHEAD) return 'early';
    const slot = k % RING;
    this.inbox[slot] = held;
    this.inboxStep[slot] = k;
    if (k > this.newestInput) {
      this.newestInput = k;
      this.slack = this.origin + k - globalStep;
    }
    return 'ok';
  }

  /** The input for step `k` if it arrived. */
  inputFor(k: number): number {
    const slot = k % RING;
    return this.inboxStep[slot] === k ? this.inbox[slot]! : -1;
  }

  recordRan(k: number, held: number, command: InputCommand | null, hash: number): void {
    const slot = k % RING;
    this.ranHeld[slot] = held;
    this.ranStep[slot] = k;
    this.hashes[slot] = hash;
    if (command) this.ranCommands.set(k, command);
    this.ranCommands.delete(k - RING);
    this.inboxCommands.delete(k);
  }

  /** The hash after step `k`, if it is still in the ring. */
  hashAt(k: number): number | null {
    const slot = k % RING;
    return this.ranStep[slot] === k ? this.hashes[slot]! : null;
  }

  /** Whether steps `from..to` are all still in the relay ring. */
  hasHistory(from: number, to: number): boolean {
    return (
      to - from < RING - 8 && this.ranStep[from % RING] === from && this.ranStep[to % RING] === to
    );
  }
}
