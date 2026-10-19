/**
 * The fixed-step clock: real time accumulates, whole 30 Hz steps are taken out, the fraction is
 * carried to the next frame (and used to interpolate the picture). A frame longer than 250 ms
 * counts as 250 ms, so a tab that wakes up does not try to catch up on minutes.
 */
import { STEPS_PER_SECOND } from '@parapet-world/schemas';

export const STEP_SECONDS = 1 / STEPS_PER_SECOND;
export const MAX_FRAME_SECONDS = 0.25;

export class StepClock {
  /** Elapsed time not yet turned into steps, in steps (0..1 after `advance`). */
  private carry = 0;

  /** Adds a frame's real time and returns how many steps are due. */
  advance(seconds: number): number {
    const dt = seconds > 0 ? Math.min(seconds, MAX_FRAME_SECONDS) : 0;
    this.carry += dt * STEPS_PER_SECOND;
    // a hair of tolerance so 1/30 s frames do not drift into skipped steps
    const n = Math.floor(this.carry + 1e-6);
    this.carry = Math.max(0, this.carry - n);
    return n;
  }

  /** How far the next step has come, 0..1, for interpolating between the last two states. */
  get alpha(): number {
    return Math.min(1, this.carry);
  }

  /** Drops the carried time (after a stall or a pause). */
  reset(): void {
    this.carry = 0;
  }
}
