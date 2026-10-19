import { describe, expect, it } from 'vitest';
import {
  CHUNK_AREA,
  CHUNK_CELLS,
  Cell,
  bytesToBase64,
  frontRect,
  sideStripRect,
  topStripRect,
  type ChunkFile,
  type MaterialDef,
  type WorldIndex,
} from '@parapet-world/schemas';
import {
  FACE_SHADE,
  MODE_EDGE,
  MODE_FLAT,
  MODE_FRONT,
  MODE_STRIP,
  WORLD_FLOATS,
  buildChunkMesh,
  stripsPresent,
  worldInfo,
} from '../src/world.ts';
import { outlines } from '../src/outline.ts';
import { syntheticWorld } from '../src/testworld.ts';

const mat = (id: string, slot: number, depth: MaterialDef['depth']): MaterialDef => ({
  id,
  district: 'd',
  slot,
  cell: Cell.SOLID,
  avg: [100, 50, 25],
  depth,
  sound: 'concrete',
});
const world: WorldIndex = {
  format: 1,
  bounds: [0, 0, 2, 1],
  chunks: [],
  materials: [
    mat('none', 0, 'flat'),
    mat('a', 0, 'strip'),
    mat('b', 1, 'flat'),
    mat('c', 2, 'strip'),
  ],
  districts: [
    { id: 'rooftops', name: 'd', atlas: '', background: [], sky: [0, 0, 0], ambience: '' },
  ],
  regions: [],
  hubs: [],
  routes: [],
  finds: [],
  props: [
    {
      id: 'p',
      districts: [],
      sprite: [4, 8, 30, 20],
      offset: [1, -2],
      mask: ['#'],
      layer: 'front',
    },
  ],
  bots: [],
  startHub: 0,
};
world.materials.forEach((m) => (m.district = 'rooftops'));
// slot 2 has no depth strips in the atlas: its strip fill falls back to the edge
const info = worldInfo(world, [[true, true, false]]);

/** A chunk at (1, 0) from a list of [x, y, class, material] local cells, with real outlines. */
function chunkOf(list: [number, number, number, number][]): ChunkFile {
  const W = CHUNK_CELLS * 2,
    cells = new Uint8Array(W * CHUNK_CELLS),
    mats = new Uint8Array(W * CHUNK_CELLS);
  for (const [x, y, c, m] of list) {
    cells[y * W + CHUNK_CELLS + x] = c;
    mats[y * W + CHUNK_CELLS + x] = m;
  }
  const local = (src: Uint8Array): Uint8Array => {
    const out = new Uint8Array(CHUNK_AREA);
    for (let y = 0; y < CHUNK_CELLS; y++)
      for (let x = 0; x < CHUNK_CELLS; x++)
        out[y * CHUNK_CELLS + x] = src[y * W + CHUNK_CELLS + x]!;
    return out;
  };
  const variants = new Uint8Array(CHUNK_AREA).fill(0);
  return {
    format: 1,
    cx: 1,
    cy: 0,
    cells: bytesToBase64(local(cells)),
    materials: bytesToBase64(local(mats)),
    variants: bytesToBase64(variants),
    outlines: outlines(cells, mats, W, CHUNK_CELLS).get('1,0') ?? [],
    props: [{ prop: 0, x: 40, y: 3 }],
  };
}
/** The quads of a mesh as lists of vertices (12 floats each). */
function quads(data: Float32Array): number[][][] {
  const out: number[][][] = [];
  for (let q = 0; q < data.length / (WORLD_FLOATS * 4); q++) {
    const vs: number[][] = [];
    for (let k = 0; k < 4; k++) {
      const o = (q * 4 + k) * WORLD_FLOATS;
      vs.push(Array.from(data.subarray(o, o + WORLD_FLOATS)));
    }
    out.push(vs);
  }
  return out;
}

describe('chunk meshes', () => {
  it('builds front quads and per-cell depth pieces with chunk-local positions', () => {
    const mesh = buildChunkMesh(
      chunkOf([
        [1, 1, Cell.SOLID, 1],
        [2, 1, Cell.SOLID, 1],
      ]),
      info,
    );
    expect(mesh.ox).toBe(1024);
    expect(mesh.batches).toHaveLength(1);
    const qs = quads(mesh.batches[0]!.data);
    const front = qs.filter((q) => q[0]![11] === MODE_FRONT),
      depth = qs.filter((q) => q[0]![11] !== MODE_FRONT);
    expect(front).toHaveLength(2);
    // a 2 x 1 block: top and underside cut into two pieces each, two side pieces
    expect(depth).toHaveLength(6);
    for (const q of depth) {
      expect(q.map((v) => v[2])).toEqual([0, 0, -1, -1]);
      for (const v of q) {
        expect(v[0]).toBeGreaterThanOrEqual(32);
        expect(v[0]).toBeLessThanOrEqual(96);
      }
    }
    // the top piece over cell (1, 1): the front tile's top edge, the top strip across the depth
    const top = depth.find(
      (q) => q[0]![1] === 32 && q[1]![1] === 32 && Math.min(q[0]![0]!, q[1]![0]!) === 32,
    )!;
    const [fx, fy] = frontRect(0, 0),
      [tx, ty] = topStripRect(0);
    expect(top[0]![10]).toBeCloseTo(FACE_SHADE[0]!, 6);
    expect(top[0]![11]).toBe(MODE_STRIP);
    expect([top[0]![3], top[0]![4]]).toEqual([fx, fy + 0.5]);
    expect([top[1]![3], top[1]![4]]).toEqual([fx + 32, fy + 0.5]);
    expect([top[0]![5], top[0]![6]]).toEqual([tx, ty]);
    expect([top[2]![5], top[2]![6]]).toEqual([tx + 32, ty + 16]);
    // a side piece samples the side strip, depth across x
    const side = depth.find((q) => q[0]![0] === q[1]![0])!;
    const [sx, sy] = sideStripRect(0);
    expect(side[0]![10]).toBeCloseTo(FACE_SHADE[1]!, 6);
    expect(side[2]![5]).toBe(sx + 16);
    expect([side[0]![6]!, side[1]![6]!].sort((a, b) => a - b)).toEqual([sy, sy + 32]);
    // the underside is darker
    expect(depth.filter((q) => Math.abs(q[0]![10]! - FACE_SHADE[2]!) < 1e-6)).toHaveLength(2);
  });

  it('falls back from strips to the edge, and flat materials use their average colour', () => {
    const mesh = buildChunkMesh(
      chunkOf([
        [1, 1, Cell.SOLID, 2],
        [5, 1, Cell.SOLID, 3],
      ]),
      info,
    );
    const qs = quads(mesh.batches[0]!.data).filter((q) => q[0]![11] !== MODE_FRONT);
    const flat = qs.filter((q) => q[0]![0]! < 100),
      edge = qs.filter((q) => q[0]![0]! > 100);
    expect(flat.every((q) => q[0]![11] === MODE_FLAT)).toBe(true);
    expect(flat[0]![0]!.slice(7, 10).map((c) => Math.round(c * 255))).toEqual([100, 50, 25]);
    expect(edge.every((q) => q[0]![11] === MODE_EDGE)).toBe(true);
  });

  it('shapes front faces by collision class', () => {
    const mesh = buildChunkMesh(
      chunkOf([
        [1, 1, Cell.HALF, 1],
        [3, 1, Cell.SLAB, 1],
        [5, 1, Cell.SLOPE_UP, 1],
        [7, 1, Cell.TOP, 1],
      ]),
      info,
    );
    const front = quads(mesh.batches[0]!.data).filter((q) => q[0]![11] === MODE_FRONT);
    const at = (x: number): number[][] =>
      front.find(
        (q) =>
          Math.min(...q.map((v) => v[0]!)) >= x * 32 &&
          Math.min(...q.map((v) => v[0]!)) < x * 32 + 32,
      )!;
    const [, fy] = frontRect(0, 0);
    // HALF: the bottom half of the cell shows the tile's top 16 rows
    const half = at(1);
    expect(half.map((v) => v[1])).toEqual([48, 48, 64, 64]);
    expect(half.map((v) => v[4])).toEqual([fy, fy, fy + 16, fy + 16]);
    // SLAB: the top half shows the bottom 16 rows
    expect(at(3).map((v) => v[4])).toEqual([fy + 16, fy + 16, fy + 32, fy + 32]);
    // a slope is a triangle (its fourth corner repeats the third)
    const slope = at(5);
    expect(slope[3]).toEqual(slope[2]);
    // a plank: its thickness comes from its underside in the outlines (8 px in the dev outliner)
    expect(Math.max(...at(7).map((v) => v[1]!))).toBe(32 + 8);
    // fronts: 2 + 2 + 1 + 2; depth pieces: four sides each, the slope three, two triangles each
    expect(mesh.triangles).toBe(7 + (4 + 4 + 3 + 4) * 2);
  });

  it('places props in world px from their mask cell and offset', () => {
    const mesh = buildChunkMesh(chunkOf([]), info);
    expect(mesh.props).toEqual([
      { x: 40 * 32 + 1, y: 3 * 32 - 2, w: 30, h: 20, sx: 4, sy: 8, front: true },
    ]);
  });

  it('meets across chunk borders: every depth piece ends on the shared border', () => {
    const s = syntheticWorld(),
      inf = worldInfo(s.world, [
        [true, true, false, true],
        [true, true, true, true],
      ]);
    const meshes = s.chunks.map((c) => buildChunkMesh(c, inf));
    // pieces never cross a chunk border, and pieces on both sides of x = 1024 share endpoints
    const ends = new Set<string>();
    for (const m of meshes) {
      for (const b of m.batches) {
        for (const q of quads(b.data)) {
          if (q[0]![11] === MODE_FRONT) continue;
          for (const v of q) {
            expect(v[0]).toBeGreaterThanOrEqual(0);
            expect(v[0]).toBeLessThanOrEqual(1024);
            expect(v[1]).toBeGreaterThanOrEqual(0);
            expect(v[1]).toBeLessThanOrEqual(1024);
            if (v[2] === 0) ends.add(`${m.ox + v[0]!},${m.oy + v[1]!}`);
          }
        }
      }
    }
    // the platform across x = 1024 (cells 29..36, rows 30..31): its top and underside reach the
    // border from both chunks
    for (const y of [30 * 32, 32 * 32]) {
      expect(ends.has(`1024,${y}`)).toBe(true);
    }
  });

  it('detects missing depth strips in an atlas', () => {
    const s = syntheticWorld();
    expect(stripsPresent(s.art.atlases.rooftops!)).toEqual([true, true, false, true]);
  });
});
