/**
 * Autotile variants and depth outlines of the tile layer, computed over the whole world so both
 * are final across chunk borders. Prop cells are never extruded or autotiled (they carry no
 * material). Outside the world the nearest edge cell repeats, so masses run on past the bounds.
 *
 * Visual shapes in px within a cell: SOLID the whole cell, HALF the bottom half, SLAB the top half,
 * TOP a plank 4 px thick along the top edge, the slopes their triangles. Only these classes are
 * extruded (`EXTRUDED` in `schemas/cells.ts`).
 */
import { CELL_PX, Cell, EXTRUDED, VARIANT, type CellClass } from '@parapet-world/schemas';

/** A grid view the outline code reads; out-of-range reads clamp to the edge. */
export interface TileGrid {
  x0: number;
  y0: number;
  width: number;
  height: number;
  cells: Uint8Array;
  materials: Uint8Array;
}

const PLANK = 4;
const P = CELL_PX;
const H = CELL_PX / 2;

export const FACE = { TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3 } as const;

function clampAt(g: TileGrid, x: number, y: number): number {
  const gx = Math.min(Math.max(x - g.x0, 0), g.width - 1);
  const gy = Math.min(Math.max(y - g.y0, 0), g.height - 1);
  return gy * g.width + gx;
}

/** Class of a tile cell (material set and extruded or KILL), else -1. */
function tileClass(g: TileGrid, x: number, y: number): number {
  if (g.width === 0 || g.height === 0) return -1;
  const i = clampAt(g, x, y);
  return g.materials[i] !== 0 ? g.cells[i]! : -1;
}

function materialAt(g: TileGrid, x: number, y: number): number {
  if (g.width === 0 || g.height === 0) return 0;
  return g.materials[clampAt(g, x, y)]!;
}

/** Whether a class's shape covers the whole of one of its edges (0 up, 1 right, 2 down, 3 left). */
function fullEdge(c: number, d: number): boolean {
  switch (c) {
    case Cell.SOLID:
    case Cell.KILL:
      return true;
    case Cell.SLOPE_UP:
      return d === 1 || d === 2;
    case Cell.SLOPE_DOWN:
      return d === 3 || d === 2;
    case Cell.HALF:
      return d === 2;
    case Cell.SLAB:
      return d === 0;
    default:
      return false;
  }
}

/** Two cells of the same partial class meet along a matching edge (planks, low walls, slabs). */
function partialMatch(c: number, d: number): boolean {
  const horizontal = d === 1 || d === 3;
  return horizontal && (c === Cell.TOP || c === Cell.HALF || c === Cell.SLAB);
}

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const BIT = [VARIANT.UP, VARIANT.RIGHT, VARIANT.DOWN, VARIANT.LEFT];

/** The 4-bit autotile variant of every cell (0 where there is no tile). */
export function autotile(g: TileGrid): Uint8Array {
  const out = new Uint8Array(g.width * g.height);
  for (let gy = 0; gy < g.height; gy++) {
    for (let gx = 0; gx < g.width; gx++) {
      const i = gy * g.width + gx;
      const m = g.materials[i]!;
      if (m === 0) continue;
      const c = g.cells[i]!;
      const x = g.x0 + gx;
      const y = g.y0 + gy;
      let v = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        if (materialAt(g, nx, ny) !== m) continue;
        const n = tileClass(g, nx, ny);
        if ((fullEdge(c, d) && fullEdge(n, (d + 2) & 3)) || (c === n && partialMatch(c, d))) {
          v |= BIT[d]!;
        }
      }
      out[i] = v;
    }
  }
  return out;
}

/** The interval [a, b] (px along the edge, top-to-bottom or left-to-right) a shape covers. */
function edgeCover(c: number, d: number): [number, number] | null {
  if (!EXTRUDED.has(c as CellClass)) return null;
  switch (d) {
    case 0:
      return c === Cell.SOLID || c === Cell.SLAB || c === Cell.TOP ? [0, P] : null;
    case 2:
      return c === Cell.SOLID || c === Cell.HALF || c === Cell.SLOPE_UP || c === Cell.SLOPE_DOWN
        ? [0, P]
        : null;
    case 1:
    case 3: {
      if (c === Cell.SOLID) return [0, P];
      if (c === Cell.HALF) return [H, P];
      if (c === Cell.SLAB) return [0, H];
      if (c === Cell.TOP) return [0, PLANK];
      if (c === Cell.SLOPE_UP) return d === 1 ? [0, P] : null;
      if (c === Cell.SLOPE_DOWN) return d === 3 ? [0, P] : null;
      return null;
    }
    default:
      return null;
  }
}

function subtract(a: [number, number], b: [number, number] | null): Array<[number, number]> {
  if (b === null || b[1] <= a[0] || b[0] >= a[1]) return [a];
  const out: Array<[number, number]> = [];
  if (b[0] > a[0]) out.push([a[0], b[0]]);
  if (b[1] < a[1]) out.push([b[1], a[1]]);
  return out;
}

/** One outline piece: world px, material, face. */
export type Segment = [number, number, number, number, number, number];

/** Exposed outline pieces of one tile cell, clockwise around solids (y down). */
export function cellOutline(g: TileGrid, x: number, y: number): Segment[] {
  const c = tileClass(g, x, y);
  const m = materialAt(g, x, y);
  if (c < 0 || !EXTRUDED.has(c as CellClass)) return [];
  const ox = x * P;
  const oy = y * P;
  const out: Segment[] = [];
  for (let d = 0; d < 4; d++) {
    const own = edgeCover(c, d);
    if (own === null) continue;
    const n = tileClass(g, x + DX[d]!, y + DY[d]!);
    const other = n < 0 ? null : edgeCover(n, (d + 2) & 3);
    for (const [a, b] of subtract(own, other)) {
      if (d === 0) out.push([ox + a, oy, ox + b, oy, m, FACE.TOP]);
      else if (d === 1) out.push([ox + P, oy + a, ox + P, oy + b, m, FACE.RIGHT]);
      else if (d === 2) out.push([ox + b, oy + P, ox + a, oy + P, m, FACE.BOTTOM]);
      else out.push([ox, oy + b, ox, oy + a, m, FACE.LEFT]);
    }
  }
  switch (c) {
    case Cell.HALF:
      out.push([ox, oy + H, ox + P, oy + H, m, FACE.TOP]);
      break;
    case Cell.SLAB:
      out.push([ox + P, oy + H, ox, oy + H, m, FACE.BOTTOM]);
      break;
    case Cell.TOP:
      out.push([ox + P, oy + PLANK, ox, oy + PLANK, m, FACE.BOTTOM]);
      break;
    case Cell.SLOPE_UP:
      out.push([ox, oy + P, ox + P, oy, m, FACE.TOP]);
      break;
    case Cell.SLOPE_DOWN:
      out.push([ox, oy, ox + P, oy + P, m, FACE.TOP]);
      break;
  }
  return out;
}

/**
 * Merges collinear pieces of one material and face that touch end to start, and orders the result
 * (face, line, start) so the output is stable.
 */
export function mergeSegments(segs: Segment[]): Segment[] {
  const key = (s: Segment): string => {
    const [x0, y0, x1, y1, m, f] = s;
    if (y0 === y1) return `${m}|${f}|h|${y0}`;
    if (x0 === x1) return `${m}|${f}|v|${x0}`;
    const dir = Math.sign(x1 - x0) * Math.sign(y1 - y0);
    return `${m}|${f}|d${dir}|${dir > 0 ? x0 - y0 : x0 + y0}`;
  };
  const groups = new Map<string, Segment[]>();
  for (const s of segs) {
    const k = key(s);
    const list = groups.get(k);
    if (list) list.push(s);
    else groups.set(k, [s]);
  }
  const out: Segment[] = [];
  for (const k of [...groups.keys()].sort()) {
    const list = groups.get(k)!;
    // Order along the walking direction, then join where one ends at the next one's start.
    const along = (s: Segment) => {
      const dx = Math.sign(s[2] - s[0]);
      const dy = Math.sign(s[3] - s[1]);
      return dx !== 0 ? s[0] * dx : s[1] * dy;
    };
    list.sort((a, b) => along(a) - along(b));
    let cur: Segment | null = null;
    for (const s of list) {
      if (cur && cur[2] === s[0] && cur[3] === s[1]) {
        cur[2] = s[2];
        cur[3] = s[3];
      } else {
        if (cur) out.push(cur);
        cur = [...s] as Segment;
      }
    }
    if (cur) out.push(cur);
  }
  out.sort((a, b) => a[5] - b[5] || a[1] - b[1] || a[0] - b[0] || a[3] - b[3] || a[2] - b[2]);
  return out;
}
