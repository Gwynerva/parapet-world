/**
 * Hot-path messages, sent as binary frames. The first byte is the message type. Steps are a
 * runner's own step numbers (`R.STEP` after the step), except `Tick.serverStep`, the server's
 * global step.
 */
import type { InputCommand, InputRun } from '@parapet-world/schemas';
import { ByteReader, ByteWriter, ProtocolError } from './binary.ts';

export const Bin = {
  /** client -> server: held-mask runs of the own runner from `fromStep`, plus commands. */
  INPUT: 1,
  /** client -> server: the own runner's hash after `step`. */
  HASH: 2,
  /** server -> client: clock, acknowledged input and slack. */
  TICK: 20,
  /** server -> client: the inputs a runner was simulated with, from `fromStep`. */
  RUNNER_INPUT: 21,
  /** server -> client: a runner's full state. */
  KEYFRAME: 22,
  /** server -> client: the server filled the own runner's missing input at `step`. */
  INPUT_FILL: 23,
} as const;

export const KeyframeReason = {
  /** The first state of a runner coming into view (or the own runner after Welcome). */
  ENTER: 0,
  /** The own runner disagreed with the server (hash, fill, late input) and must restart here. */
  RESYNC: 1,
  /** A bot restarted its loop. */
  LOOP: 2,
  /** A teleport or respawn ordered outside the input stream (reserved). */
  SERVER: 3,
} as const;
export type KeyframeReasonCode = (typeof KeyframeReason)[keyof typeof KeyframeReason];

export interface InputMsg {
  type: typeof Bin.INPUT;
  /** The step number the first run's first step produces (the runner's step after it). */
  fromStep: number;
  runs: InputRun[];
  commands: InputCommand[];
}
export interface HashMsg {
  type: typeof Bin.HASH;
  step: number;
  hash: number;
}
export interface TickMsg {
  type: typeof Bin.TICK;
  serverStep: number;
  /** The own runner's last step the server has simulated. */
  simStep: number;
  /** The own runner's last step whose input the server holds. */
  ackStep: number;
  /** How many steps early the latest input arrived (negative: late). */
  slack: number;
}
export interface RunnerInputMsg {
  type: typeof Bin.RUNNER_INPUT;
  runner: number;
  fromStep: number;
  runs: InputRun[];
  commands: InputCommand[];
}
export interface KeyframeMsg {
  type: typeof Bin.KEYFRAME;
  runner: number;
  reason: KeyframeReasonCode;
  /** The server's global step when the keyframe was taken. */
  serverStep: number;
  state: Int32Array;
}
export interface InputFillMsg {
  type: typeof Bin.INPUT_FILL;
  runner: number;
  step: number;
  held: number;
}
export type BinaryMessage =
  InputMsg | HashMsg | TickMsg | RunnerInputMsg | KeyframeMsg | InputFillMsg;

const MAX_RUNS = 4096;
const MAX_COMMANDS = 64;
const MAX_WORDS = 1024;

function writeRuns(w: ByteWriter, runs: readonly InputRun[], commands: readonly InputCommand[]) {
  if (runs.length > MAX_RUNS || commands.length > MAX_COMMANDS) throw new ProtocolError('too long');
  w.u16(runs.length);
  for (const r of runs) w.u16(r.steps).u8(r.held);
  w.u8(commands.length);
  for (const c of commands) w.u32(c.step).u8(c.kind).u16(c.arg);
}
function readRuns(r: ByteReader): { runs: InputRun[]; commands: InputCommand[] } {
  const n = r.u16();
  if (n > MAX_RUNS) throw new ProtocolError('too many runs');
  const runs: InputRun[] = [];
  for (let i = 0; i < n; i++) {
    const steps = r.u16();
    const held = r.u8();
    if (steps === 0) throw new ProtocolError('empty run');
    runs.push({ steps, held });
  }
  const m = r.u8();
  if (m > MAX_COMMANDS) throw new ProtocolError('too many commands');
  const commands: InputCommand[] = [];
  for (let i = 0; i < m; i++) {
    const step = r.u32();
    const kind = r.u8();
    const arg = r.u16();
    if (kind !== 1) throw new ProtocolError('unknown command');
    commands.push({ step, kind, arg });
  }
  return { runs, commands };
}

const shared = new ByteWriter(512);

export function encodeBinary(m: BinaryMessage, w: ByteWriter = shared): Uint8Array {
  w.reset().u8(m.type);
  switch (m.type) {
    case Bin.INPUT:
      w.u32(m.fromStep);
      writeRuns(w, m.runs, m.commands);
      break;
    case Bin.HASH:
      w.u32(m.step).u32(m.hash);
      break;
    case Bin.TICK:
      w.u32(m.serverStep).u32(m.simStep).u32(m.ackStep).i16(clamp16(m.slack));
      break;
    case Bin.RUNNER_INPUT:
      w.u16(m.runner).u32(m.fromStep);
      writeRuns(w, m.runs, m.commands);
      break;
    case Bin.KEYFRAME:
      w.u16(m.runner).u8(m.reason).u32(m.serverStep).u16(m.state.length);
      for (let i = 0; i < m.state.length; i++) w.i32(m.state[i]!);
      break;
    case Bin.INPUT_FILL:
      w.u16(m.runner).u32(m.step).u8(m.held);
      break;
  }
  return w.bytes();
}

export function decodeBinary(bytes: Uint8Array): BinaryMessage {
  const r = new ByteReader(bytes);
  const type = r.u8();
  let m: BinaryMessage;
  switch (type) {
    case Bin.INPUT: {
      const fromStep = r.u32();
      m = { type, fromStep, ...readRuns(r) };
      break;
    }
    case Bin.HASH:
      m = { type, step: r.u32(), hash: r.u32() };
      break;
    case Bin.TICK:
      m = { type, serverStep: r.u32(), simStep: r.u32(), ackStep: r.u32(), slack: r.i16() };
      break;
    case Bin.RUNNER_INPUT: {
      const runner = r.u16();
      const fromStep = r.u32();
      m = { type, runner, fromStep, ...readRuns(r) };
      break;
    }
    case Bin.KEYFRAME: {
      const runner = r.u16();
      const reason = r.u8();
      if (reason > 3) throw new ProtocolError('unknown keyframe reason');
      const serverStep = r.u32();
      const n = r.u16();
      if (n > MAX_WORDS) throw new ProtocolError('state too long');
      const state = new Int32Array(n);
      for (let i = 0; i < n; i++) state[i] = r.i32();
      m = { type, runner, reason: reason as KeyframeReasonCode, serverStep, state };
      break;
    }
    case Bin.INPUT_FILL:
      m = { type, runner: r.u16(), step: r.u32(), held: r.u8() };
      break;
    default:
      throw new ProtocolError(`unknown binary message ${type}`);
  }
  r.end();
  return m;
}

function clamp16(v: number): number {
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v | 0;
}
