/**
 * What renderers and HUDs read from a runner. This file is presentation, not simulation: it may
 * produce fractions (`progress`), and nothing in the step reads it.
 */
import { R } from './layout.ts';
import { FLAG } from './registry.ts';
import type { Ruleset } from './ruleset.ts';
import type { RunnerState } from './step.ts';

export interface RunnerView {
  /** Feet point in world units (y down). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  move: string;
  clip: string;
  phase: number;
  /**
   * Where the clip is, 0..1: the share of a timed move's duration, the share of the stride for
   * `cycle` moves, the share of the loop for moves with `loop`, else 0.
   */
  progress: number;
  /** Steps in the current move. */
  timer: number;
  /** Changes on every move entry (restart the clip even when the move repeats). */
  nonce: number;
  onGround: boolean;
  anchorHands: boolean;
  crouch: boolean;
  dead: boolean;
}

export function runnerView(s: RunnerState, rs: Ruleset, out?: RunnerView): RunnerView {
  const m = s[R.MOVE]!;
  const dur = s[R.DUR]!;
  const timer = s[R.TIMER]!;
  const flags = rs.flags[m]!;
  let progress = 0;
  if (dur > 0) progress = Math.min(1, timer / dur);
  else if ((flags & FLAG.cycle) !== 0 && rs.stride[m]! > 0) progress = s[R.CYCLE]! / rs.stride[m]!;
  else if (rs.loop[m]! > 0) progress = (timer % rs.loop[m]!) / rs.loop[m]!;
  const v = out ?? ({} as RunnerView);
  v.x = s[R.X]!;
  v.y = s[R.Y]!;
  v.vx = s[R.VX]!;
  v.vy = s[R.VY]!;
  v.facing = s[R.FACING]! < 0 ? -1 : 1;
  v.move = rs.moveNames[m]!;
  v.clip = rs.clips[m]!;
  v.phase = s[R.PHASE]!;
  v.progress = progress;
  v.timer = timer;
  v.nonce = s[R.ANIM_NONCE]!;
  v.onGround = s[R.GROUND] !== 0;
  v.anchorHands = (flags & FLAG.anchorHands) !== 0;
  v.crouch = (flags & FLAG.crouch) !== 0;
  v.dead = m === rs.roles.dead;
  return v;
}

/** Whether the runner is in the dead role's move. */
export function isDead(s: RunnerState, rs: Ruleset): boolean {
  return s[R.MOVE] === rs.roles.dead;
}
