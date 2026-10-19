/**
 * Per-cell shape functions in local units: `lx`, `ly` in [0, 1024), y growing downward. Every
 * collision question the simulation asks (walls, floors, ceilings, overlaps) goes through these,
 * so each class's shape is written down exactly once (see `schemas/cells.ts`).
 *
 * Solid regions: SOLID the whole cell, HALF `ly >= 512`, SLAB `ly < 512`, POST
 * `384 <= lx < 640`, SLOPE_UP `lx + ly >= 1024`, SLOPE_DOWN `ly >= lx`. TOP and BAR are one-way
 * floors at `ly = 0` and `ly = 64` with no solid area; LADDER, POLE and KILL have no collision.
 */
import { Cell } from '@parapet-world/schemas';

export const NONE = 0x3fffffff;
export const CELL_SHIFT = 10;
export const CELL_UNITS = 1024;
export const CELL_MASK = 1023;
const HALF_CELL = 512;
const POST_L = 384;
const POST_R = 640;
const BAR_Y = 64;

export function isSlope(c: number): boolean {
  return c === Cell.SLOPE_UP || c === Cell.SLOPE_DOWN;
}

export function isOneWay(c: number): boolean {
  return c === Cell.TOP || c === Cell.BAR;
}

/** Whether a class has solid area (blocks the body box). */
export function isSolidClass(c: number): boolean {
  return (
    c === Cell.SOLID ||
    c === Cell.HALF ||
    c === Cell.SLAB ||
    c === Cell.POST ||
    c === Cell.SLOPE_UP ||
    c === Cell.SLOPE_DOWN
  );
}

/** Whether the local rectangle [la, lb) x [ta, tb) overlaps the class's solid area. */
export function rectHitsShape(c: number, la: number, lb: number, ta: number, tb: number): boolean {
  if (la >= lb || ta >= tb) return false;
  switch (c) {
    case Cell.SOLID:
      return true;
    case Cell.HALF:
      return tb > HALF_CELL;
    case Cell.SLAB:
      return ta < HALF_CELL;
    case Cell.POST:
      return la < POST_R && lb > POST_L;
    case Cell.SLOPE_UP:
      return lb - 1 + (tb - 1) >= CELL_UNITS;
    case Cell.SLOPE_DOWN:
      return tb - 1 >= la;
    default:
      return false;
  }
}

/**
 * The leftmost solid column within rows [a, b), for a body moving right into the cell; `NONE`
 * when nothing blocks. A SLOPE_UP's sloped side is not a wall unless the feet are below the cell
 * (`under`): runners walk up it and the floor logic lifts them.
 */
export function leftFace(c: number, a: number, b: number, under: boolean): number {
  switch (c) {
    case Cell.SOLID:
      return 0;
    case Cell.HALF:
      return b > HALF_CELL ? 0 : NONE;
    case Cell.SLAB:
      return a < HALF_CELL ? 0 : NONE;
    case Cell.POST:
      return POST_L;
    case Cell.SLOPE_DOWN:
      return 0;
    case Cell.SLOPE_UP: {
      if (!under) return NONE;
      const f = CELL_UNITS + 1 - b;
      return f < CELL_UNITS ? f : NONE;
    }
    default:
      return NONE;
  }
}

/** One past the rightmost solid column within rows [a, b), for a body moving left. */
export function rightFace(c: number, a: number, b: number, under: boolean): number {
  switch (c) {
    case Cell.SOLID:
      return CELL_UNITS;
    case Cell.HALF:
      return b > HALF_CELL ? CELL_UNITS : NONE;
    case Cell.SLAB:
      return a < HALF_CELL ? CELL_UNITS : NONE;
    case Cell.POST:
      return POST_R;
    case Cell.SLOPE_UP:
      return b >= 2 ? CELL_UNITS : NONE;
    case Cell.SLOPE_DOWN:
      return under ? b : NONE;
    default:
      return NONE;
  }
}

/** One past the lowest solid row within columns [la, lb): the ceiling a rising head meets. */
export function bottomFace(c: number, la: number, lb: number): number {
  switch (c) {
    case Cell.SOLID:
    case Cell.HALF:
    case Cell.SLOPE_DOWN:
      return CELL_UNITS;
    case Cell.SLAB:
      return HALF_CELL;
    case Cell.POST:
      return la < POST_R && lb > POST_L ? CELL_UNITS : NONE;
    case Cell.SLOPE_UP:
      return lb >= 2 ? CELL_UNITS : NONE;
    default:
      return NONE;
  }
}

/** The floor surface of a slope at column `lx` (may be 1024: the cell's bottom edge). */
export function slopeTop(c: number, lx: number): number {
  return c === Cell.SLOPE_UP ? CELL_UNITS - lx : lx;
}

/**
 * The flat floor surface a span [la, lb) of feet meets in a cell, `NONE` for none. Slopes are
 * not flat; one-way floors count only when `oneWay` is set.
 */
export function flatTop(c: number, la: number, lb: number, oneWay: boolean): number {
  switch (c) {
    case Cell.SOLID:
    case Cell.SLAB:
      return 0;
    case Cell.HALF:
      return HALF_CELL;
    case Cell.POST:
      return la < POST_R && lb > POST_L ? 0 : NONE;
    case Cell.TOP:
      return oneWay ? 0 : NONE;
    case Cell.BAR:
      return oneWay ? BAR_Y : NONE;
    default:
      return NONE;
  }
}

/** The local y of the bar a hand can hang from. */
export const BAR_LOCAL_Y = BAR_Y;
/** The local x range of a post and the pole line. */
export const POST_LEFT = POST_L;
export const POST_RIGHT = POST_R;
export const CELL_MIDDLE = HALF_CELL;
