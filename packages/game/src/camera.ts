/**
 * The game camera: follows the own runner with a look-ahead along its facing and speed, eases
 * toward it, and never clamps to the edges of the world. Positions are world units, y down.
 *
 * Vertically it frames the floor the runner last stood on, not every jump: while the runner is in
 * the air within a band around that floor the camera keeps its height, so jumps and short drops
 * do not bob the picture; beyond the band (a climb, a long drop, a wall run up a tower) it follows,
 * and a fast fall pulls it down so the landing comes into view. Tall districts stay readable.
 */
import { CELL, UNITS_PER_PX } from '@parapet-world/schemas';

/** How far ahead of the runner the camera looks when it stands, and per unit/step of speed. */
const LOOK_FACING = 48 * UNITS_PER_PX;
const LOOK_PER_SPEED = 20;
const LOOK_MAX = 160 * UNITS_PER_PX;
/** The runner sits a little below the centre: the camera aims this far above the feet. */
const LIFT = 40 * UNITS_PER_PX;
/** How far above and below the last floor the runner may be before the camera follows. */
const BAND_UP = 88 * UNITS_PER_PX;
const BAND_DOWN = 40 * UNITS_PER_PX;
/**
 * A fall faster than a jump's own descent (units per step) pulls the camera down so the landing
 * comes into view; an ordinary jump does not.
 */
const FALL_FAST = 340;
const LOOK_FALL = 10;
const LOOK_FALL_MAX = 112 * UNITS_PER_PX;
/** Rates of the exponential ease, per second (look-ahead and the floor height are slower). */
const FOLLOW = 9;
const AHEAD = 2.2;
const FLOOR = 4;
/** A jump farther than this (a teleport or respawn) snaps the camera. */
const SNAP = 6 * CELL;

export class GameCamera {
  x = 0;
  y = 0;
  private ahead = 0;
  private fall = 0;
  /** The feet height the camera frames (the last floor, or the runner beyond the band). */
  private floor = 0;
  /** Extra vertical offset the player chose (looking up or down), units. */
  offsetY = 0;

  /** Puts the camera on a runner at once. */
  snap(x: number, y: number, facing: number): void {
    this.ahead = facing * LOOK_FACING;
    this.fall = 0;
    this.floor = y;
    this.x = x + this.ahead;
    this.y = y - LIFT + this.offsetY;
  }

  /**
   * Moves toward the runner at (x, y) with velocity (vx, vy) units per step, its facing and
   * whether it stands on a floor, over `dt` seconds.
   */
  update(
    x: number,
    y: number,
    vx: number,
    vy: number,
    facing: number,
    grounded: boolean,
    dt: number,
  ): void {
    if (Math.abs(x + this.ahead - this.x) > SNAP || Math.abs(y - this.floor) > SNAP * 2) {
      this.snap(x, y, facing);
      return;
    }
    const wantAhead = clamp(facing * LOOK_FACING + vx * LOOK_PER_SPEED, -LOOK_MAX, LOOK_MAX);
    const wantFall =
      vy > FALL_FAST && !grounded ? Math.min(LOOK_FALL_MAX, (vy - FALL_FAST) * LOOK_FALL) : 0;
    const ka = 1 - Math.exp(-AHEAD * dt),
      kf = 1 - Math.exp(-FOLLOW * dt),
      kfl = 1 - Math.exp(-FLOOR * dt);
    this.ahead += (wantAhead - this.ahead) * ka;
    this.fall += (wantFall - this.fall) * ka;
    // the floor height: the runner's on a floor, else only as far as it left the band
    const wantFloor = grounded ? y : clamp(this.floor, y - BAND_DOWN, y + BAND_UP);
    this.floor += (wantFloor - this.floor) * (grounded ? kfl : kf);
    const tx = x + this.ahead,
      ty = this.floor - LIFT + this.fall + this.offsetY;
    this.x += (tx - this.x) * kf;
    this.y += (ty - this.y) * kf;
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
