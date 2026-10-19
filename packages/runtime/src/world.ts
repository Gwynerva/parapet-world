/**
 * Chunk meshes for the world pass, built once per loaded chunk (pure: no GL here).
 *
 * Front faces: one quad per cell with a material, shaped by the cell's collision class (the art
 * has one tile per variant): HALF shows the tile's top 16 rows in the cell's bottom half, SLAB
 * the bottom 16 rows in the top half, a TOP plank its top rows down to the plank's underside,
 * slopes the full tile clipped by their triangle, everything else the whole tile.
 *
 * Depth faces: every outline segment of the chunk, cut at cell borders, is extruded into the
 * screen as a quad of unit depth (the shader scales z by the slab depth). Each vertex carries
 * three fills, and the shader picks one: the material's depth strip (top strip along top faces,
 * undersides and slopes, side strip along walls), the front tile's edge texels stretched through
 * the depth, or the material's average colour. Faces are shaded by orientation.
 *
 * Vertex layout, 12 floats, positions relative to the chunk's top-left corner (world px):
 * x, y, z (0 front, -1 back), u0, v0 (front or edge texel, atlas px), u1, v1 (strip texel, atlas
 * px), r, g, b (average colour), shade, mode (3 front, 2 strip, 1 edge, 0 flat).
 */
import {
  CELL_PX,
  CHUNK_AREA,
  CHUNK_CELLS,
  CHUNK_PX,
  Cell,
  base64ToBytes,
  frontRect,
  sideStripRect,
  topStripRect,
  type ChunkFile,
  type PropDef,
  type WorldIndex,
} from '@parapet-world/schemas';

export const WORLD_FLOATS = 12;
export const MODE_FLAT = 0;
export const MODE_EDGE = 1;
export const MODE_STRIP = 2;
export const MODE_FRONT = 3;
/** Shading of depth faces by the side they face: top, right, underside, left. */
export const FACE_SHADE: readonly number[] = [1.0, 0.76, 0.58, 0.76];
/** Quads per batch: 16-bit indices address 65536 vertices. */
export const MAX_QUADS = 16384;
/** A TOP plank's thickness when the chunk's outlines do not show its underside. */
export const DEFAULT_PLANK = 8;

/** One draw: the quads of a chunk that sample one district's atlas. */
export interface ChunkBatch {
  district: number;
  data: Float32Array;
  quads: number;
}

/** A prop of the chunk, ready to draw: world px rect and sprite rect in the props atlas. */
export interface PlacedProp {
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  front: boolean;
}

export interface ChunkMesh {
  cx: number;
  cy: number;
  /** World px of the chunk's top-left corner. */
  ox: number;
  oy: number;
  batches: ChunkBatch[];
  props: PlacedProp[];
  /** Triangles, for stats. */
  triangles: number;
}

/** What the mesh builder needs to know about the world besides the chunk. */
export interface WorldInfo {
  world: WorldIndex;
  /** District index of every material (-1 when its district is unknown). */
  materialDistrict: Int16Array;
  /** Whether a district's atlas has depth strips for a slot: `hasStrips[district][slot]`. */
  hasStrips: boolean[][];
}

export function worldInfo(world: WorldIndex, hasStrips: boolean[][]): WorldInfo {
  const ids = world.districts.map((d) => d.id as string);
  const materialDistrict = Int16Array.from(world.materials, (m) => ids.indexOf(m.district));
  return { world, materialDistrict, hasStrips };
}

class Builder {
  readonly batches = new Map<number, { data: number[]; quads: number }[]>();
  quad(district: number, v: readonly number[]): void {
    let list = this.batches.get(district);
    if (!list) this.batches.set(district, (list = []));
    let b = list[list.length - 1];
    if (!b || b.quads >= MAX_QUADS) list.push((b = { data: [], quads: 0 }));
    for (let i = 0; i < v.length; i++) b.data.push(v[i]!);
    b.quads++;
  }
}

/** A front tile's texel for a point of the cell (cell-local px), given the cell's class. */
function tileY(cls: number, ly: number): number {
  return cls === Cell.HALF ? ly - 16 : cls === Cell.SLAB ? ly + 16 : ly;
}

/** The thickness of TOP planks in a chunk, read from the undersides of its TOP cells. */
function plankThickness(chunk: ChunkFile, cells: Uint8Array): number {
  const o = chunk.outlines,
    ox = chunk.cx * CHUNK_PX,
    oy = chunk.cy * CHUNK_PX;
  for (let i = 0; i + 5 < o.length; i += 6) {
    if (o[i + 5] !== 2 || o[i + 1] !== o[i + 3]) continue;
    const y = o[i + 1]! - oy,
      x = Math.min(o[i]!, o[i + 2]!) - ox + 0.5,
      lx = Math.floor(x / CELL_PX),
      ly = Math.floor((y - 0.5) / CELL_PX);
    if (lx < 0 || ly < 0 || lx >= CHUNK_CELLS || ly >= CHUNK_CELLS) continue;
    if (cells[ly * CHUNK_CELLS + lx] !== Cell.TOP) continue;
    const t = y - ly * CELL_PX;
    if (t > 0 && t < CELL_PX) return t;
  }
  return DEFAULT_PLANK;
}

/** Builds the mesh of a chunk. Materials that are 0 or unknown are skipped. */
export function buildChunkMesh(chunk: ChunkFile, info: WorldInfo): ChunkMesh {
  const { world, materialDistrict, hasStrips } = info;
  const cells = base64ToBytes(chunk.cells),
    mats = base64ToBytes(chunk.materials),
    variants = base64ToBytes(chunk.variants);
  if (cells.length < CHUNK_AREA || mats.length < CHUNK_AREA || variants.length < CHUNK_AREA) {
    throw new Error(`chunk ${chunk.cx},${chunk.cy}: grids must hold ${CHUNK_AREA} cells`);
  }
  const ox = chunk.cx * CHUNK_PX,
    oy = chunk.cy * CHUNK_PX,
    b = new Builder(),
    plank = plankThickness(chunk, cells);
  let triangles = 0;

  // front faces
  for (let ly = 0; ly < CHUNK_CELLS; ly++) {
    for (let lx = 0; lx < CHUNK_CELLS; lx++) {
      const i = ly * CHUNK_CELLS + lx,
        m = mats[i]!,
        def = world.materials[m],
        d = m ? (materialDistrict[m] ?? -1) : -1;
      if (!def || d < 0) continue;
      const cls = cells[i]! & 0x7f,
        [fx, fy] = frontRect(def.slot, variants[i]! & 15),
        x = lx * CELL_PX,
        y = ly * CELL_PX;
      // corners clockwise from the top-left, as cell-local px; the tile texel follows the class
      let pts: number[];
      if (cls === Cell.HALF) pts = [0, 16, 32, 16, 32, 32, 0, 32];
      else if (cls === Cell.SLAB) pts = [0, 0, 32, 0, 32, 16, 0, 16];
      else if (cls === Cell.TOP) pts = [0, 0, 32, 0, 32, plank, 0, plank];
      else if (cls === Cell.POST) pts = [12, 0, 20, 0, 20, 32, 12, 32];
      else if (cls === Cell.SLOPE_UP) pts = [32, 0, 32, 32, 0, 32, 0, 32];
      else if (cls === Cell.SLOPE_DOWN) pts = [0, 0, 32, 32, 0, 32, 0, 32];
      else pts = [0, 0, 32, 0, 32, 32, 0, 32];
      const v: number[] = [];
      for (let k = 0; k < 4; k++) {
        const px = pts[k * 2]!,
          py = pts[k * 2 + 1]!;
        v.push(x + px, y + py, 0, fx + px, fy + tileY(cls, py), 0, 0, 0, 0, 0, 1, MODE_FRONT);
      }
      b.quad(d, v);
      triangles += cls === Cell.SLOPE_UP || cls === Cell.SLOPE_DOWN ? 1 : 2;
    }
  }

  // depth faces, one quad per segment piece within a cell
  const o = chunk.outlines;
  for (let s = 0; s + 5 < o.length; s += 6) {
    const x0 = o[s]! - ox,
      y0 = o[s + 1]! - oy,
      x1 = o[s + 2]! - ox,
      y1 = o[s + 3]! - oy,
      m = o[s + 4]!,
      face = o[s + 5]! & 3,
      def = world.materials[m],
      d = m ? (materialDistrict[m] ?? -1) : -1;
    if (!def || d < 0) continue;
    const dx = x1 - x0,
      dy = y1 - y0,
      L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    // the solid is on the right-hand side walking from (x0, y0) to (x1, y1), y down
    const nx = -dy / L,
      ny = dx / L,
      diagonal = dx !== 0 && dy !== 0,
      inset = diagonal ? Math.SQRT1_2 : 0.5;
    // cut at cell borders along the segment
    const ts = [0, 1];
    for (const [a0, a1] of [
      [x0, x1],
      [y0, y1],
    ] as const) {
      if (a0 === a1) continue;
      const lo = Math.min(a0, a1),
        hi = Math.max(a0, a1);
      for (let g = Math.floor(lo / CELL_PX + 1) * CELL_PX; g < hi; g += CELL_PX) {
        ts.push((g - a0) / (a1 - a0));
      }
    }
    ts.sort((p, q) => p - q);
    const side = face === 1 || face === 3,
      strip = side ? sideStripRect(def.slot) : topStripRect(def.slot),
      stripOk = hasStrips[d]?.[def.slot] ?? false,
      mode =
        def.depth === 'flat'
          ? MODE_FLAT
          : def.depth === 'edge' || !stripOk
            ? MODE_EDGE
            : MODE_STRIP,
      shade = FACE_SHADE[face]!,
      r = def.avg[0] / 255,
      g = def.avg[1] / 255,
      bl = def.avg[2] / 255;
    for (let k = 0; k + 1 < ts.length; k++) {
      const ta = ts[k]!,
        tb = ts[k + 1]!;
      if (tb - ta < 1e-9) continue;
      const ax = x0 + dx * ta,
        ay = y0 + dy * ta,
        bx = x0 + dx * tb,
        by = y0 + dy * tb;
      // the cell this piece belongs to: just inside the solid from the piece's middle
      const cxp = Math.floor(((ax + bx) / 2 + nx * 0.5) / CELL_PX),
        cyp = Math.floor(((ay + by) / 2 + ny * 0.5) / CELL_PX);
      let cls: number = Cell.SOLID,
        variant = 0;
      if (cxp >= 0 && cyp >= 0 && cxp < CHUNK_CELLS && cyp < CHUNK_CELLS) {
        const i = cyp * CHUNK_CELLS + cxp;
        if (mats[i] === m) {
          cls = cells[i]! & 0x7f;
          variant = variants[i]! & 15;
        }
      }
      const [fx, fy] = frontRect(def.slot, variant),
        cellX = cxp * CELL_PX,
        cellY = cyp * CELL_PX;
      const v: number[] = [];
      // front a, front b, back b, back a
      for (const [px, py, z] of [
        [ax, ay, 0],
        [bx, by, 0],
        [bx, by, -1],
        [ax, ay, -1],
      ] as const) {
        const ex = px + nx * inset - cellX,
          ey = tileY(cls, py + ny * inset - cellY),
          along = side ? tileY(cls, py - cellY) : px - cellX,
          across = -z * 16,
          su = side ? strip[0] + across : strip[0] + along,
          sv = side ? strip[1] + along : strip[1] + across;
        v.push(px, py, z, fx + ex, fy + ey, su, sv, r, g, bl, shade, mode);
      }
      b.quad(d, v);
      triangles += 2;
    }
  }

  const batches: ChunkBatch[] = [];
  for (const [district, list] of b.batches) {
    for (const x of list)
      batches.push({ district, data: new Float32Array(x.data), quads: x.quads });
  }
  return {
    cx: chunk.cx,
    cy: chunk.cy,
    ox,
    oy,
    batches,
    props: placeProps(chunk, world.props),
    triangles,
  };
}

/** The chunk's props as world px rects with their sprites. */
export function placeProps(chunk: ChunkFile, defs: readonly PropDef[]): PlacedProp[] {
  const out: PlacedProp[] = [];
  for (const p of chunk.props) {
    const def = defs[p.prop];
    if (!def) continue;
    const [sx, sy, w, h] = def.sprite;
    out.push({
      x: p.x * CELL_PX + def.offset[0],
      y: p.y * CELL_PX + def.offset[1],
      w,
      h,
      sx,
      sy,
      front: def.layer === 'front',
    });
  }
  return out;
}

/** Whether a district atlas has depth strips for each slot (any opaque texel in either strip). */
export function stripsPresent(atlas: {
  width: number;
  height: number;
  data: ArrayLike<number>;
}): boolean[] {
  const slots = Math.floor(atlas.height / 68),
    out: boolean[] = [];
  for (let s = 0; s < slots; s++) {
    let any = false;
    for (const [x0, y0, w, h] of [topStripRect(s), sideStripRect(s)]) {
      for (let y = y0; y < y0 + h && !any; y++) {
        for (let x = x0; x < x0 + w; x++) {
          if (atlas.data[(y * atlas.width + x) * 4 + 3]! > 0) {
            any = true;
            break;
          }
        }
      }
    }
    out.push(any);
  }
  return out;
}
