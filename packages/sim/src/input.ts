/**
 * Input logs: the held mask of every step, run-length encoded (`InputRun`), plus rare commands at
 * a step. A minute of play is a few hundred bytes. `replayRunner` re-runs a log and returns the
 * runner hash after every step, the proof two machines agree.
 */
import { KEY_MASK, type InputCommand, type InputRun } from '@parapet-world/schemas';
import type { Ruleset } from './ruleset.ts';
import { copyRunner, hashRunner, stepRunner, type RunnerState } from './step.ts';
import type { WorldStatics } from './statics.ts';
import type { CellReader } from './world.ts';

/** Run-length encodes held masks (one per step). */
export function encodeInputLog(held: ArrayLike<number>): InputRun[] {
  const out: InputRun[] = [];
  for (let i = 0; i < held.length; i++) {
    const h = held[i]! & KEY_MASK;
    const last = out[out.length - 1];
    if (last !== undefined && last.held === h) last.steps++;
    else out.push({ steps: 1, held: h });
  }
  return out;
}

/** Expands runs back into one held mask per step. */
export function decodeInputLog(runs: readonly InputRun[]): Uint8Array {
  let n = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!;
    if (!Number.isInteger(r.steps) || r.steps < 0) throw new Error(`run ${i}: bad steps`);
    n += r.steps;
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!;
    out.fill(r.held & KEY_MASK, at, at + r.steps);
    at += r.steps;
  }
  return out;
}

/** Appends one step to a run list in place (for recorders). */
export function appendInput(runs: InputRun[], held: number): void {
  const h = held & KEY_MASK;
  const last = runs[runs.length - 1];
  if (last !== undefined && last.held === h) last.steps++;
  else runs.push({ steps: 1, held: h });
}

/** Total steps of a run list. */
export function inputLength(runs: readonly InputRun[]): number {
  let n = 0;
  for (let i = 0; i < runs.length; i++) n += runs[i]!.steps;
  return n;
}

export interface ReplayResult {
  /** The runner hash after every step. */
  hashes: Uint32Array;
  /** The final state. */
  state: RunnerState;
  /** Steps that stalled (chunks missing); a stalled step is retried, not skipped. */
  stalls: number;
}

/**
 * Steps a copy of `start` over a log. Commands apply at their step index (0 = the first step of
 * the log). A stall (missing chunks) throws, because a replay world must hold every chunk.
 */
export function replayRunner(
  start: RunnerState,
  runs: readonly InputRun[],
  commands: readonly InputCommand[],
  world: CellReader,
  rs: Ruleset,
  statics: WorldStatics,
): ReplayResult {
  const held = decodeInputLog(runs);
  const s = copyRunner(start);
  const hashes = new Uint32Array(held.length);
  let c = 0;
  for (let i = 0; i < held.length; i++) {
    let cmd: InputCommand | null = null;
    while (c < commands.length && commands[c]!.step < i) c++;
    if (c < commands.length && commands[c]!.step === i) cmd = commands[c]!;
    if (!stepRunner(s, held[i]!, cmd, world, rs, statics)) {
      throw new Error(`replay stalled at step ${i}: chunks missing`);
    }
    hashes[i] = hashRunner(s);
  }
  return { hashes, state: s, stalls: 0 };
}
