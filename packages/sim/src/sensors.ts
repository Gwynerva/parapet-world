/**
 * Read-only sensors for grips and obstacles: ledge corners, obstacles to step over or vault,
 * ladders, poles and bars. Each is a pure function of the runner's position, facing and the
 * cells; results that are more than a yes or no land in `found` (no allocation per step).
 * Positions are world units; F is the facing.
 */
import { Cell } from '@parapet-world/schemas';
import { boxHitsSolid, cellAt, findFloor } from './collide.ts';
import { R } from './layout.ts';
import { FLAG } from './registry.ts';
import { B, type Ruleset } from './ruleset.ts';
import { BAR_LOCAL_Y, CELL_SHIFT, NONE, POST_LEFT, POST_RIGHT } from './shapes.ts';
import type { CellReader } from './world.ts';

export const found = {
  /** Grip or obstacle face x, grip or obstacle top y. */
  x: 0,
  y: 0,
  kind: 0,
  /** Obstacle length in cells and its far edge x. */
  len: 0,
  far: 0,
  /** Vault landing point. */
  landX: 0,
  landY: 0,
};

const EDGE = 256;

function boxHits(w: CellReader, xa: number, ya: number, xb: number, yb: number): boolean {
  return boxHitsSolid(w, xa < xb ? xa : xb, ya, xa < xb ? xb : xa, yb);
}

export function bodyHeight(s: Int32Array, rs: Ruleset): number {
  return (rs.flags[s[R.MOVE]!]! & FLAG.crouch) !== 0 ? rs.body[B.CROUCH_H]! : rs.body[B.H]!;
}

/**
 * A grabbable ledge corner ahead: the top corner of a SOLID, HALF or POST cell facing the runner
 * with free space above and in front of it, at most `reach` ahead of the body's front edge and
 * between `low` and `high` above the feet. The nearest wins, then the one nearest the middle.
 */
export function findLedge(
  s: Int32Array,
  w: CellReader,
  rs: Ruleset,
  reach: number,
  low: number,
  high: number,
): boolean {
  const f = s[R.FACING]!;
  const x = s[R.X]!;
  const y = s[R.Y]!;
  const hw = rs.body[B.HW]!;
  const front = x + f * hw;
  const xa = front - f * EDGE;
  const xb = front + f * reach;
  const c0 = (xa < xb ? xa : xb) >> CELL_SHIFT;
  const c1 = (xa < xb ? xb : xa) >> CELL_SHIFT;
  const r0 = (y - high - 512) >> CELL_SHIFT;
  const r1 = (y - low) >> CELL_SHIFT;
  const mid = (low + high) >> 1;
  let bestD = NONE;
  let bestM = NONE;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cls = cellAt(w, c, r);
      let cx: number;
      let cy = r << CELL_SHIFT;
      if (cls === Cell.SOLID) cx = f > 0 ? c << CELL_SHIFT : (c + 1) << CELL_SHIFT;
      else if (cls === Cell.HALF) {
        cx = f > 0 ? c << CELL_SHIFT : (c + 1) << CELL_SHIFT;
        cy += 512;
      } else if (cls === Cell.POST) cx = (c << CELL_SHIFT) + (f > 0 ? POST_LEFT : POST_RIGHT);
      else continue;
      const h = y - cy;
      if (h < low || h > high) continue;
      const d = f * (cx - front);
      if (d < -EDGE || d > reach) continue;
      // Exposed: nothing on top of the edge, nothing in front of it where the hands and the
      // hanging body go.
      if (boxHits(w, cx, cy - EDGE, cx + f * EDGE, cy)) continue;
      if (boxHits(w, cx - f * 2 * hw, cy - EDGE, cx, cy + 1024)) continue;
      const m = h > mid ? h - mid : mid - h;
      if (d < bestD || (d === bestD && m < bestM)) {
        bestD = d;
        bestM = m;
        found.x = cx;
        found.y = cy;
        found.kind = cls;
      }
    }
  }
  return bestD !== NONE;
}

/** The standing body fits at (x, y) on a floor. */
function standsAt(w: CellReader, rs: Ruleset, x: number, y: number): boolean {
  const hw = rs.body[B.HW]!;
  if (findFloor(w, x, hw, y, y, true) === NONE) return false;
  return !boxHitsSolid(w, x - hw, y - rs.body[B.H]!, x + hw, y - rs.body[B.STEP_UP]!);
}

/** A ledge as `findLedge` finds it, with room to stand on top halfWidth + 2 px past the corner. */
export function findLedgeTop(
  s: Int32Array,
  w: CellReader,
  rs: Ruleset,
  reach: number,
  low: number,
  high: number,
): boolean {
  if (!findLedge(s, w, rs, reach, low, high)) return false;
  return standsAt(w, rs, found.x + s[R.FACING]! * (rs.body[B.HW]! + 64), found.y);
}

/** The standing body fits on the gripped ledge at dx past its corner, on a floor. */
export function ledgeRoom(s: Int32Array, w: CellReader, rs: Ruleset, dx: number): boolean {
  return standsAt(w, rs, s[R.GRIP_X]! + s[R.FACING]! * dx, s[R.GRIP_Y]!);
}

/** The top of the obstacle column at `c`, starting from the row just above the floor. */
function columnTop(w: CellReader, c: number, r: number): number {
  let cls = cellAt(w, c, r);
  let top = (r << CELL_SHIFT) + (cls === Cell.HALF ? 512 : 0);
  let rr = r;
  while (cls !== Cell.HALF) {
    const up = cellAt(w, c, rr - 1);
    if (up !== Cell.SOLID && up !== Cell.POST && up !== Cell.HALF) break;
    rr--;
    cls = up;
    top = (rr << CELL_SHIFT) + (up === Cell.HALF ? 512 : 0);
  }
  return top;
}

/**
 * The first obstacle ahead of a runner on the floor: a SOLID, HALF or POST cell in the row just
 * above the floor whose face lies within `reach` of the body's front edge. True when its top is
 * more than `stepUp` and at most `maxH` above the feet and the body fits over it. Sets `found.x`
 * (face), `found.y` (top), `found.len` (cells of the same top, up to 4), `found.far` (far edge).
 */
export function scanObstacle(
  s: Int32Array,
  w: CellReader,
  rs: Ruleset,
  reach: number,
  maxH: number,
): boolean {
  const f = s[R.FACING]!;
  const x = s[R.X]!;
  const y = s[R.Y]!;
  const hw = rs.body[B.HW]!;
  const front = x + f * hw;
  const r = (y - 1) >> CELL_SHIFT;
  const cFirst = front >> CELL_SHIFT;
  const cLast = (front + f * reach) >> CELL_SHIFT;
  for (let c = cFirst; f > 0 ? c <= cLast : c >= cLast; c += f) {
    const cls = cellAt(w, c, r);
    if (cls !== Cell.SOLID && cls !== Cell.HALF && cls !== Cell.POST) continue;
    const base = c << CELL_SHIFT;
    const face =
      cls === Cell.POST ? base + (f > 0 ? POST_LEFT : POST_RIGHT) : f > 0 ? base : base + 1024;
    const d = f * (face - front);
    if (d < 0) continue;
    if (d > reach) return false;
    const top = columnTop(w, c, r);
    const h = y - top;
    if (h <= rs.body[B.STEP_UP]! || h > maxH) return false;
    // A face hidden behind a slope or a step is walked onto, not stepped over.
    if (boxHits(w, face - f * 64, top + 64, face, y - 1)) return false;
    if (boxHits(w, face, top - rs.body[B.H]!, face + f * 1024, top)) return false;
    let len = 1;
    let last = c;
    while (len < 4) {
      const n = last + f;
      const k = cellAt(w, n, r);
      if (k !== cls || columnTop(w, n, r) !== top) break;
      last = n;
      len++;
    }
    const lastBase = last << CELL_SHIFT;
    found.x = face;
    found.y = top;
    found.kind = cls;
    found.len = len;
    found.far =
      cls === Cell.POST
        ? lastBase + (f > 0 ? POST_RIGHT : POST_LEFT)
        : f > 0
          ? lastBase + 1024
          : lastBase;
    return true;
  }
  return false;
}

/**
 * An obstacle to vault: as `scanObstacle`, at most `maxLen` cells long, with room to land beyond
 * it (on a floor up to three cells lower, or in the air at the runner's height). Sets the landing
 * point in `found.landX`, `found.landY`.
 */
export function vaultTarget(
  s: Int32Array,
  w: CellReader,
  rs: Ruleset,
  reach: number,
  maxH: number,
  maxLen: number,
): boolean {
  if (!scanObstacle(s, w, rs, reach, maxH) || found.len > maxLen) return false;
  const f = s[R.FACING]!;
  const y = s[R.Y]!;
  const hw = rs.body[B.HW]!;
  const lx = found.far + f * (hw + 64);
  let ly = findFloor(w, lx, hw, found.y, y + 3072, true);
  if (ly === NONE) ly = y;
  if (boxHitsSolid(w, lx - hw, ly - rs.body[B.H]!, lx + hw, ly - rs.body[B.STEP_UP]!)) return false;
  found.landX = lx;
  found.landY = ly;
  return true;
}

/** A ladder cell in the centre column from the body's middle down to just below the feet. */
export function ladderHere(s: Int32Array, w: CellReader, rs: Ruleset): boolean {
  const y = s[R.Y]!;
  const c = s[R.X]! >> CELL_SHIFT;
  for (let r = (y - (bodyHeight(s, rs) >> 1)) >> CELL_SHIFT; r <= (y + 64) >> CELL_SHIFT; r++) {
    if (cellAt(w, c, r) === Cell.LADDER) return true;
  }
  return false;
}

/** Whether the ladder continues at the head (climbing up stops where it ends). */
export function ladderAtHead(s: Int32Array, w: CellReader, rs: Ruleset): boolean {
  const y = s[R.Y]! - bodyHeight(s, rs) - 1;
  return cellAt(w, s[R.X]! >> CELL_SHIFT, y >> CELL_SHIFT) === Cell.LADDER;
}

/**
 * The top of the ladder the runner is on is at most `reach` above the feet and a floor beside it
 * at that height has room to stand: the facing side first. Sets `found.x` (the ladder's edge on
 * that side), `found.y` (the top) and `found.kind` (the side, 1 or -1).
 */
export function ladderTop(s: Int32Array, w: CellReader, rs: Ruleset, reach: number): boolean {
  const x = s[R.X]!;
  const y = s[R.Y]!;
  const lc = x >> CELL_SHIFT;
  let r = (y - (bodyHeight(s, rs) >> 1)) >> CELL_SHIFT;
  if (cellAt(w, lc, r) !== Cell.LADDER) return false;
  while (cellAt(w, lc, r - 1) === Cell.LADDER) r--;
  const top = r << CELL_SHIFT;
  if (y - top > reach) return false;
  const hw = rs.body[B.HW]!;
  const f = s[R.FACING]!;
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? f : -f;
    const edge = side > 0 ? (lc + 1) << CELL_SHIFT : lc << CELL_SHIFT;
    const tx = edge + side * (hw + 64);
    if (findFloor(w, tx, hw, top, top, true) === NONE) continue;
    if (boxHitsSolid(w, tx - hw, top - rs.body[B.H]!, tx + hw, top - rs.body[B.STEP_UP]!)) continue;
    found.x = edge;
    found.y = top;
    found.kind = side;
    return true;
  }
  return false;
}

/** A pole whose line is within `reach` of the runner's centre at the hands (near the head). */
export function findPole(s: Int32Array, w: CellReader, rs: Ruleset, reach: number): boolean {
  const x = s[R.X]!;
  const r = (s[R.Y]! - bodyHeight(s, rs) + 256) >> CELL_SHIFT;
  let best = NONE;
  for (let c = (x - reach) >> CELL_SHIFT; c <= (x + reach) >> CELL_SHIFT; c++) {
    if (cellAt(w, c, r) !== Cell.POLE) continue;
    const px = (c << CELL_SHIFT) + 512;
    const d = px > x ? px - x : x - px;
    if (d <= reach && d < best) {
      best = d;
      found.x = px;
      found.kind = Cell.POLE;
    }
  }
  return best !== NONE;
}

/** Whether a pole continues at the hands of a runner on it (column of the grip). */
export function poleAtHands(s: Int32Array, w: CellReader, rs: Ruleset): boolean {
  const r = (s[R.Y]! - bodyHeight(s, rs) + 256) >> CELL_SHIFT;
  return cellAt(w, s[R.GRIP_X]! >> CELL_SHIFT, r) === Cell.POLE;
}

/** A bar over the runner's centre between `low` and `high` above the feet. */
export function findBar(s: Int32Array, w: CellReader, low: number, high: number): boolean {
  const x = s[R.X]!;
  const y = s[R.Y]!;
  const c = x >> CELL_SHIFT;
  for (let r = (y - high) >> CELL_SHIFT; r <= (y - low) >> CELL_SHIFT; r++) {
    if (cellAt(w, c, r) !== Cell.BAR) continue;
    const by = (r << CELL_SHIFT) + BAR_LOCAL_Y;
    const h = y - by;
    if (h >= low && h <= high) {
      found.x = x;
      found.y = by;
      found.kind = Cell.BAR;
      return true;
    }
  }
  return false;
}

/** Solid ahead of the body within d units, in the band [y - top, y - bottom). */
export function bandAhead(
  s: Int32Array,
  w: CellReader,
  rs: Ruleset,
  d: number,
  top: number,
  bottom: number,
): boolean {
  const f = s[R.FACING]!;
  const front = s[R.X]! + f * rs.body[B.HW]!;
  const y = s[R.Y]!;
  return boxHits(w, front, y - top, front + f * d, y - bottom);
}
