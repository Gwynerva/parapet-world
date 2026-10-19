/**
 * Another runner as this client sees it: the server relays the inputs it simulated that runner
 * with, and the client steps its own copy with them (the simulation is deterministic, so the copy
 * matches the server's). The runner is shown a few steps behind the newest relayed input so late
 * packets rarely show; when the inputs run out anyway, the display predicts ahead by repeating the
 * last held mask (the same rule the server's InputFill uses) and drops the prediction when the
 * real inputs arrive.
 */
import {
  R,
  copyRunner,
  stepRunner,
  type CellReader,
  type RunnerState,
  type Ruleset,
  type WorldStatics,
} from '@parapet-world/sim';
import type { InputCommand, InputRun, Look } from '@parapet-world/schemas';

const HISTORY = 32;
/** How far behind the newest confirmed step the display aims to be. */
export const REMOTE_DELAY = 3;
const MAX_PREDICT = 15;

export interface RemoteFrame {
  /** The states at the display step and the next one; `alpha` interpolates between them. */
  a: RunnerState;
  b: RunnerState;
  alpha: number;
}

export class RemoteRunner {
  /** The newest state that matches the server, at step `confirmedStep`. */
  readonly confirmed: RunnerState;
  /** Ring of confirmed states by step (for interpolation behind the newest one). */
  private readonly history: RunnerState[];
  private readonly historyStep: Int32Array;
  /** Relayed inputs not applied yet (the chunks around the runner may be missing). */
  private pending: Array<{ step: number; held: number; command: InputCommand | null }> = [];
  private lastHeld = 0;
  /** The step the display shows (fractional). */
  display = 0;
  private predicted: RunnerState[] = [];
  private predictedFrom = -1;
  private readonly frameOut: RemoteFrame;
  readonly id: number;
  name: string;
  look: Look;
  readonly bot: boolean;

  constructor(id: number, name: string, look: Look, bot: boolean, stateWords: number) {
    this.id = id;
    this.name = name;
    this.look = look;
    this.bot = bot;
    this.confirmed = new Int32Array(stateWords);
    this.history = Array.from({ length: HISTORY }, () => new Int32Array(stateWords));
    this.historyStep = new Int32Array(HISTORY).fill(-1);
    this.frameOut = { a: this.confirmed, b: this.confirmed, alpha: 0 };
  }

  get confirmedStep(): number {
    return this.confirmed[R.STEP]!;
  }

  /** A keyframe: the runner restarts from this state (entering view, a bot's loop, a teleport). */
  keyframe(state: Int32Array): void {
    copyRunner(state, this.confirmed);
    this.pending.length = 0;
    this.historyStep.fill(-1);
    this.remember();
    this.display = this.confirmedStep;
    this.predictedFrom = -1;
  }

  /** Inputs the server simulated this runner with, the first one producing step `fromStep`. */
  inputs(fromStep: number, runs: readonly InputRun[], commands: readonly InputCommand[]): void {
    let step = fromStep;
    const last = this.pending.length
      ? this.pending[this.pending.length - 1]!.step
      : this.confirmedStep;
    for (const run of runs) {
      for (let i = 0; i < run.steps; i++, step++) {
        if (step <= last) continue; // already have it
        const command = commands.find((c) => c.step === step) ?? null;
        this.pending.push({ step, held: run.held, command });
      }
    }
  }

  /** Applies whatever pending inputs can run now. */
  advance(world: CellReader, rules: Ruleset, statics: WorldStatics): void {
    let applied = 0;
    while (applied < this.pending.length) {
      const next = this.pending[applied]!;
      if (next.step !== this.confirmedStep + 1) {
        if (next.step <= this.confirmedStep) {
          applied++;
          continue;
        }
        break; // a gap: wait for a keyframe
      }
      if (!stepRunner(this.confirmed, next.held, next.command, world, rules, statics)) break;
      this.lastHeld = next.held;
      this.remember();
      applied++;
    }
    if (applied) {
      this.pending.splice(0, applied);
      this.predictedFrom = -1;
    }
  }

  private remember(): void {
    const step = this.confirmedStep;
    const slot = ((step % HISTORY) + HISTORY) % HISTORY;
    copyRunner(this.confirmed, this.history[slot]);
    this.historyStep[slot] = step;
  }

  private stateAt(
    step: number,
    world: CellReader,
    rules: Ruleset,
    statics: WorldStatics,
  ): RunnerState {
    const c = this.confirmedStep;
    if (step <= c) {
      const slot = ((step % HISTORY) + HISTORY) % HISTORY;
      if (this.historyStep[slot] === step) return this.history[slot]!;
      return this.confirmed;
    }
    // Predict ahead by repeating the last held mask.
    const ahead = Math.min(step - c, MAX_PREDICT);
    if (this.predictedFrom !== c) {
      this.predicted.length = 0;
      this.predictedFrom = c;
    }
    while (this.predicted.length < ahead) {
      const prev = this.predicted.length
        ? this.predicted[this.predicted.length - 1]!
        : this.confirmed;
      const next = copyRunner(prev);
      if (!stepRunner(next, this.lastHeld, null, world, rules, statics)) break;
      this.predicted.push(next);
    }
    return this.predicted[Math.min(ahead, this.predicted.length) - 1] ?? this.confirmed;
  }

  /**
   * Moves the display on by `steps` (fractional, from the client's clock) and returns the two states
   * to interpolate. The display drifts toward `REMOTE_DELAY` behind the newest confirmed step.
   */
  frame(steps: number, world: CellReader, rules: Ruleset, statics: WorldStatics): RemoteFrame {
    const goal = this.confirmedStep - REMOTE_DELAY;
    let rate = 1;
    if (this.display > goal + 2) rate = 0.8;
    else if (this.display < goal - 2) rate = 1.25;
    this.display += steps * rate;
    if (this.display < goal - 30) this.display = goal; // far behind: jump
    if (this.display > this.confirmedStep + MAX_PREDICT)
      this.display = this.confirmedStep + MAX_PREDICT;
    const base = Math.floor(this.display);
    const f = this.frameOut;
    f.a = this.stateAt(base, world, rules, statics);
    f.b = this.stateAt(base + 1, world, rules, statics);
    f.alpha = this.display - base;
    return f;
  }
}
