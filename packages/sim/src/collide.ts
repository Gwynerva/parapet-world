/**
 * Collision queries over a `CellReader`, built only from the shape functions in `shapes.ts`.
 * Stateless: every answer is derived from a position. The body is a box [x - hw, x + hw) x
 * [y - h, y) around the feet point (x, y). Walls are tested with the box minus its lowest `stepUp`
 * units (the toes may sink into slopes and onto corners); floors with the feet span and, on
 * slopes, the centre column; ceilings with the box's top edge.
 */
import { CELL_MISSING, Cell } from '@parapet-world/schemas';
import type { CellReader } from './world.ts';
import {
  CELL_MASK,
  CELL_SHIFT,
  NONE,
  bottomFace,
  flatTop,
  isSlope,
  leftFace,
  rectHitsShape,
  rightFace,
  slopeTop,
} from './shapes.ts';

/** Reads a class with the missing bit cleared (a missing chunk reads as empty air). */
export function cellAt(w: CellReader, cx: number, cy: number): number {
  return w.cell(cx, cy) & ~CELL_MISSING;
}

/** Results of the last query that reports more than a number (no allocation per step). */
export const hit = {
  /** Collision class of the floor found by `findFloor`. */
  kind: 0,
  /** Slope of that floor: 1 `/`, -1 `\`, 0 flat. */
  slope: 0,
};

/**
 * Moves a wall box [top, bottom) horizontally by dx from feet x; returns the new x. Faces that
 * the box already overlaps are ignored, so a box never gets stuck in what it started in.
 */
export function sweepX(
  w: CellReader,
  x: number,
  dx: number,
  hw: number,
  top: number,
  bottom: number,
  feet: number,
  stepUp: number,
): number {
  if (dx === 0 || top >= bottom) return x + dx;
  const r0 = top >> CELL_SHIFT;
  const r1 = (bottom - 1) >> CELL_SHIFT;
  if (dx > 0) {
    const e = x + hw;
    let lim = e + dx;
    const c0 = e >> CELL_SHIFT;
    const c1 = (lim - 1) >> CELL_SHIFT;
    for (let r = r0; r <= r1; r++) {
      const base = r << CELL_SHIFT;
      const a = (top > base ? top : base) - base;
      const b = (bottom < base + 1024 ? bottom : base + 1024) - base;
      const under = feet - stepUp >= base + 1024;
      for (let c = c0; c <= c1; c++) {
        const f = leftFace(cellAt(w, c, r), a, b, under);
        if (f === NONE) continue;
        const fw = (c << CELL_SHIFT) + f;
        if (fw >= e && fw < lim) lim = fw;
      }
    }
    return lim - hw;
  }
  const s = x - hw;
  let lim = s + dx;
  const c0 = (s - 1) >> CELL_SHIFT;
  const c1 = lim >> CELL_SHIFT;
  for (let r = r0; r <= r1; r++) {
    const base = r << CELL_SHIFT;
    const a = (top > base ? top : base) - base;
    const b = (bottom < base + 1024 ? bottom : base + 1024) - base;
    const under = feet - stepUp >= base + 1024;
    for (let c = c0; c >= c1; c--) {
      const f = rightFace(cellAt(w, c, r), a, b, under);
      if (f === NONE) continue;
      const fw = (c << CELL_SHIFT) + f;
      if (fw <= s && fw > lim) lim = fw;
    }
  }
  return lim + hw;
}

/**
 * Moves the box's top edge up by dy < 0 (columns [x - hw, x + hw)); returns the new top edge.
 * One-way floors never act as ceilings.
 */
export function sweepUp(w: CellReader, x: number, hw: number, top: number, dy: number): number {
  let lim = top + dy;
  const x0 = x - hw;
  const x1 = x + hw;
  const c0 = x0 >> CELL_SHIFT;
  const c1 = (x1 - 1) >> CELL_SHIFT;
  const r0 = (top - 1) >> CELL_SHIFT;
  const r1 = lim >> CELL_SHIFT;
  for (let c = c0; c <= c1; c++) {
    const base = c << CELL_SHIFT;
    const la = (x0 > base ? x0 : base) - base;
    const lb = (x1 < base + 1024 ? x1 : base + 1024) - base;
    for (let r = r0; r >= r1; r--) {
      const f = bottomFace(cellAt(w, c, r), la, lb);
      if (f === NONE) continue;
      const fw = (r << CELL_SHIFT) + f;
      if (fw <= top && fw > lim) lim = fw;
    }
  }
  return lim;
}

/**
 * The topmost floor surface for feet at x within [yFrom, yTo], or `NONE`. Flat floors count
 * anywhere under the feet span [x - hw, x + hw); slopes only under the centre column. On a slope a
 * flat floor beside it counts only when it is more than `hw` higher, so walking off a slope's top
 * onto the flat (or back) never pops. Sets `hit.kind` and `hit.slope`.
 */
export function findFloor(
  w: CellReader,
  x: number,
  hw: number,
  yFrom: number,
  yTo: number,
  oneWay: boolean,
): number {
  if (yTo < yFrom) return NONE;
  const r0 = (yFrom >> CELL_SHIFT) - 1;
  const r1 = yTo >> CELL_SHIFT;
  const cxc = x >> CELL_SHIFT;
  const lxc = x & CELL_MASK;
  const x0 = x - hw;
  const x1 = x + hw;
  const c0 = x0 >> CELL_SHIFT;
  const c1 = (x1 - 1) >> CELL_SHIFT;
  for (let r = r0; r <= r1; r++) {
    const base = r << CELL_SHIFT;
    let slopeY = NONE;
    let slopeKind = 0;
    const cc = cellAt(w, cxc, r);
    if (isSlope(cc)) {
      const ys = base + slopeTop(cc, lxc);
      if (ys >= yFrom && ys <= yTo) {
        slopeY = ys;
        slopeKind = cc;
      }
    }
    let flatY = NONE;
    let flatKind = 0;
    for (let c = c0; c <= c1; c++) {
      const cb = c << CELL_SHIFT;
      const k = cellAt(w, c, r);
      const t = flatTop(
        k,
        (x0 > cb ? x0 : cb) - cb,
        (x1 < cb + 1024 ? x1 : cb + 1024) - cb,
        oneWay,
      );
      if (t === NONE) continue;
      const ys = base + t;
      if (ys >= yFrom && ys <= yTo && ys < flatY) {
        flatY = ys;
        flatKind = k;
      }
    }
    if (slopeY !== NONE && (flatY === NONE || flatY >= slopeY - hw)) {
      hit.kind = slopeKind;
      hit.slope = slopeKind === Cell.SLOPE_UP ? 1 : -1;
      return slopeY;
    }
    if (flatY !== NONE) {
      hit.kind = flatKind;
      hit.slope = 0;
      return flatY;
    }
  }
  return NONE;
}

/** Whether the world box [x0, x1) x [y0, y1) overlaps any solid shape. */
export function boxHitsSolid(
  w: CellReader,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  if (x0 >= x1 || y0 >= y1) return false;
  const c0 = x0 >> CELL_SHIFT;
  const c1 = (x1 - 1) >> CELL_SHIFT;
  const r0 = y0 >> CELL_SHIFT;
  const r1 = (y1 - 1) >> CELL_SHIFT;
  for (let r = r0; r <= r1; r++) {
    const rb = r << CELL_SHIFT;
    const ta = (y0 > rb ? y0 : rb) - rb;
    const tb = (y1 < rb + 1024 ? y1 : rb + 1024) - rb;
    for (let c = c0; c <= c1; c++) {
      const cb = c << CELL_SHIFT;
      const la = (x0 > cb ? x0 : cb) - cb;
      const lb = (x1 < cb + 1024 ? x1 : cb + 1024) - cb;
      if (rectHitsShape(cellAt(w, c, r), la, lb, ta, tb)) return true;
    }
  }
  return false;
}

/** Whether any cell overlapping the world box [x0, x1) x [y0, y1) has the given class. */
export function boxHasClass(
  w: CellReader,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cls: number,
): boolean {
  if (x0 >= x1 || y0 >= y1) return false;
  const c0 = x0 >> CELL_SHIFT;
  const c1 = (x1 - 1) >> CELL_SHIFT;
  const r0 = y0 >> CELL_SHIFT;
  const r1 = (y1 - 1) >> CELL_SHIFT;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) if (cellAt(w, c, r) === cls) return true;
  }
  return false;
}
