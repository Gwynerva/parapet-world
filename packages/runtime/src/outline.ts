/**
 * Depth outlines for synthetic chunks (the baker writes them for real content): the boundary
 * between solid and empty space of every extruded cell shape, cut per chunk, collinear pieces of
 * one material merged, in the ChunkFile layout `x0, y0, x1, y1, material, face`, world px, the
 * solid on the right-hand side of the walk (y down).
 */
import { CELL_PX, CHUNK_CELLS, Cell, EXTRUDED, type CellClass } from '@parapet-world/schemas';

/** A TOP plank's thickness in the synthetic world. */
export const PLANK_PX = 8;

/** Cell-local polygons, clockwise on screen (y down), so the solid is right of every edge. */
function shape(cls: number): number[] | null {
  switch (cls) {
    case Cell.SOLID:
      return [0, 0, 32, 0, 32, 32, 0, 32];
    case Cell.TOP:
      return [0, 0, 32, 0, 32, PLANK_PX, 0, PLANK_PX];
    case Cell.SLOPE_UP:
      return [0, 32, 32, 0, 32, 32];
    case Cell.SLOPE_DOWN:
      return [0, 0, 32, 32, 0, 32];
    case Cell.HALF:
      return [0, 16, 32, 16, 32, 32, 0, 32];
    case Cell.SLAB:
      return [0, 0, 32, 0, 32, 16, 0, 16];
    case Cell.POST:
      return [12, 0, 20, 0, 20, 32, 12, 32];
  }
  return null;
}

interface Edge {
  a: number;
  b: number;
  dir: number;
  mat: number;
  cx: number;
  cy: number;
}

/**
 * Outlines of a whole grid (cells, materials: width x height, row-major), split into chunks:
 * returns a map from `${chunkX},${chunkY}` to the chunk's flat outline list.
 */
export function outlines(
  cells: Uint8Array,
  mats: Uint8Array,
  width: number,
  height: number,
): Map<string, number[]> {
  const horizontal = new Map<number, Edge[]>(),
    vertical = new Map<number, Edge[]>(),
    diagonal: number[][] = [];
  const add = (m: Map<number, Edge[]>, k: number, e: Edge): void => {
    let l = m.get(k);
    if (!l) m.set(k, (l = []));
    l.push(e);
  };
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const i = cy * width + cx,
        cls = cells[i]! as CellClass;
      if (!EXTRUDED.has(cls)) continue;
      const pts = shape(cls);
      if (!pts) continue;
      const n = pts.length / 2;
      for (let k = 0; k < n; k++) {
        const x0 = cx * CELL_PX + pts[k * 2]!,
          y0 = cy * CELL_PX + pts[k * 2 + 1]!,
          x1 = cx * CELL_PX + pts[((k + 1) % n) * 2]!,
          y1 = cy * CELL_PX + pts[((k + 1) % n) * 2 + 1]!,
          mat = mats[i]!;
        if (y0 === y1) add(horizontal, y0, { a: x0, b: x1, dir: Math.sign(x1 - x0), mat, cx, cy });
        else if (x0 === x1)
          add(vertical, x0, { a: y0, b: y1, dir: Math.sign(y1 - y0), mat, cx, cy });
        else diagonal.push([x0, y0, x1, y1, mat, cx, cy]);
      }
    }
  }
  // per line, keep the stretches covered by edges of one direction only
  const pieces: number[][] = [];
  const sweep = (m: Map<number, Edge[]>, horiz: boolean): void => {
    for (const [c, list] of m) {
      const cuts = new Set<number>();
      for (const e of list) {
        cuts.add(e.a);
        cuts.add(e.b);
      }
      const xs = [...cuts].sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k++) {
        const lo = xs[k]!,
          hi = xs[k + 1]!;
        let net = 0,
          owner: Edge | null = null;
        for (const e of list) {
          if (Math.min(e.a, e.b) <= lo && Math.max(e.a, e.b) >= hi) {
            net += e.dir;
            owner = e;
          }
        }
        if (!net || !owner) continue;
        const [s, t] = net > 0 ? [lo, hi] : [hi, lo];
        const face = horiz ? (net > 0 ? 0 : 2) : net > 0 ? 1 : 3;
        const seg = horiz ? [s, c, t, c] : [c, s, c, t];
        pieces.push([...seg, owner.mat, face, owner.cx, owner.cy]);
      }
    }
  };
  sweep(horizontal, true);
  sweep(vertical, false);
  for (const [x0, y0, x1, y1, mat, cx, cy] of diagonal)
    pieces.push([x0!, y0!, x1!, y1!, mat!, 0, cx!, cy!]);

  // by chunk, merging collinear neighbours of one material and face
  const out = new Map<string, number[]>();
  const byChunk = new Map<string, number[][]>();
  for (const p of pieces) {
    const key = `${Math.floor(p[6]! / CHUNK_CELLS)},${Math.floor(p[7]! / CHUNK_CELLS)}`;
    let l = byChunk.get(key);
    if (!l) byChunk.set(key, (l = []));
    l.push(p);
  }
  for (const [key, list] of byChunk) {
    // along each line in walking order: the line's coordinate, then the start along the walk
    const line = (p: number[]): number => (p[0] === p[2] ? p[0]! : p[1] === p[3] ? p[1]! : 1e9);
    const start = (p: number[]): number =>
      p[1] === p[3] ? p[0]! * Math.sign(p[2]! - p[0]!) : p[1]! * Math.sign(p[3]! - p[1]!);
    list.sort((p, q) => p[5]! - q[5]! || p[4]! - q[4]! || line(p) - line(q) || start(p) - start(q));
    const merged: number[][] = [];
    for (const p of list) {
      const last = merged[merged.length - 1];
      const straight = p[0] === p[2] || p[1] === p[3];
      if (
        last &&
        straight &&
        last[4] === p[4] &&
        last[5] === p[5] &&
        last[2] === p[0] &&
        last[3] === p[1] &&
        (last[2]! - last[0]!) * (p[3]! - p[1]!) === (last[3]! - last[1]!) * (p[2]! - p[0]!)
      ) {
        last[2] = p[2]!;
        last[3] = p[3]!;
      } else merged.push(p.slice(0, 6));
    }
    out.set(key, merged.flat());
  }
  return out;
}
