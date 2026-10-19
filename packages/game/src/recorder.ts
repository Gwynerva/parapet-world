/**
 * The developer's route recorder (`?dev`), producing bot routes in the format of
 * `content/bots/README.md`: a bot starts every loop as a fresh runner standing at `start` (the
 * spawn move) and replays `runs`. So recording begins only while the own runner stands still in
 * the spawn move on the ground (it is replaced by exactly that fresh runner), and on stop the
 * recording is trimmed at the last step where the runner is back in the same move and facing
 * within one cell of the start; anything else is refused.
 */
import { CELL, type InputRun, type Look } from '@parapet-world/schemas';
import {
  R,
  createRunner,
  encodeInputLog,
  type Ruleset,
  type RunnerState,
} from '@parapet-world/sim';

/** A route is at least a second long (the README). */
export const MIN_LOOP_STEPS = 30;

/** A bot route (`content/bots/<district>-<n>.bot.json`). */
export interface BotFile {
  format: 1;
  name: string;
  district: string;
  look: Look;
  /** The feet point (world units, y down) and facing a fresh runner starts the loop at. */
  start: { x: number; y: number; facing: 1 | -1 };
  /** Held masks per step, run-length encoded; one pass is one loop. */
  runs: InputRun[];
}

export interface Trim {
  /** Steps in the loop. */
  steps: number;
  /** How far the loop's end is from its start, in units. */
  gap: number;
}

/** Why recording cannot begin now, or null when it can. */
export function cannotBegin(s: RunnerState, rules: Ruleset): string | null {
  if (s[R.MOVE] !== rules.roles.spawn) return 'stand still first';
  if (s[R.GROUND] === 0) return 'stand on the ground first';
  if (s[R.VX] !== 0 || s[R.VY] !== 0) return 'stand still first';
  return null;
}

export class RouteRecorder {
  private start: Int32Array | null = null;
  private held: number[] = [];
  private xs: number[] = [];
  private ys: number[] = [];
  private moves: number[] = [];
  private facings: number[] = [];

  get recording(): boolean {
    return this.start !== null;
  }

  get length(): number {
    return this.held.length;
  }

  /**
   * Starts recording from `s`, the own runner standing still in the spawn move (see
   * `cannotBegin`): it is replaced by a fresh runner at its feet point and facing, the state the
   * bot begins every loop with, so the recording replays exactly.
   */
  begin(s: RunnerState, rules: Ruleset): void {
    s.set(createRunner(rules, s[R.X]!, s[R.Y]!, s[R.FACING]!));
    this.start = Int32Array.from(s);
    this.held = [];
    this.xs = [];
    this.ys = [];
    this.moves = [];
    this.facings = [];
  }

  /** One step: the mask it used and the state after it. */
  record(held: number, s: RunnerState): void {
    if (!this.start) return;
    this.held.push(held);
    this.xs.push(s[R.X]!);
    this.ys.push(s[R.Y]!);
    this.moves.push(s[R.MOVE]!);
    this.facings.push(s[R.FACING]!);
  }

  /**
   * Where the loop closes: the last step (at least a second in) where the runner is back in the
   * start's move and facing within one cell of it; null when there is none.
   */
  trim(): Trim | null {
    const s = this.start;
    if (!s) return null;
    for (let i = this.held.length - 1; i >= MIN_LOOP_STEPS - 1; i--) {
      if (this.moves[i] !== s[R.MOVE] || this.facings[i] !== s[R.FACING]) continue;
      const gap = Math.hypot(this.xs[i]! - s[R.X]!, this.ys[i]! - s[R.Y]!);
      if (gap <= CELL) return { steps: i + 1, gap };
    }
    return null;
  }

  /** Stops and returns the trimmed route, or null when the loop does not close. */
  finish(meta: Pick<BotFile, 'name' | 'district' | 'look'>): { file: BotFile; trim: Trim } | null {
    const t = this.trim(),
      s = this.start;
    this.start = null;
    if (!t || !s) return null;
    return {
      trim: t,
      file: {
        format: 1,
        ...meta,
        start: { x: s[R.X]!, y: s[R.Y]!, facing: s[R.FACING]! < 0 ? -1 : 1 },
        runs: encodeInputLog(this.held.slice(0, t.steps)),
      },
    };
  }

  cancel(): void {
    this.start = null;
  }
}
