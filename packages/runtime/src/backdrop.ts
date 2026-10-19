/**
 * Where each district's backdrop shows. Every world cell belongs to the district of the first
 * region rect that holds it (a cell beyond the world's bounds to the nearest cell inside them), so
 * the sewer's arches stay in the sewer's band and the skyline on the rooftops. The weights are
 * blurred by a box of `BLEND_CELLS` cells each way, so two districts cross-fade over a few cells
 * at their border and nowhere else.
 *
 * The renderer fills a mask for a window of cells around the view whenever the view moves to
 * another cell, uploads it as a small RGBA texture (one texel per cell, one channel per district
 * on screen, sampled with linear filtering) and composites each district's backdrop through it.
 */
import { CHUNK_CELLS, type CellRect } from '@parapet-world/schemas';

/** How many cells each side of a border two districts' backdrops cross-fade over. */
export const BLEND_CELLS = 2;
/** Districts on screen at once (one per texture channel); more fall back to the base. */
export const MASK_CHANNELS = 4;

/** A region rect (cells) and the index of its district. */
export interface DistrictArea {
  rect: CellRect;
  district: number;
}

export interface DistrictMask {
  /** The window's top-left cell and its size in cells. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** The district index of each channel (-1 unused); channel 0 is the base. */
  readonly channels: Int32Array;
  /** Channels in use (1 when a single district covers the whole window). */
  used: number;
  /** RGBA weights 0..255 per cell, rows from the top; a cell's channels add up to 255 (+-1). */
  data: Uint8Array;
  /** Scratch: the channel of every cell of the window grown by the blur on each side. */
  cells: Uint8Array;
  /** Scratch: the horizontal pass, counts per channel. */
  rows: Uint16Array;
}

export const createDistrictMask = (): DistrictMask => ({
  x0: 0,
  y0: 0,
  w: 0,
  h: 0,
  channels: new Int32Array(MASK_CHANNELS).fill(-1),
  used: 0,
  data: new Uint8Array(0),
  cells: new Uint8Array(0),
  rows: new Uint16Array(0),
});

/**
 * Fills `m` for the w x h cells from (x0, y0): `areas` are the regions in the world's order,
 * `bounds` the world's bounds in chunks, `base` the district drawn underneath (the one under the
 * camera; also the district of cells no region holds). Allocates only when the window grows.
 */
export function fillDistrictMask(
  m: DistrictMask,
  areas: readonly DistrictArea[],
  bounds: readonly [number, number, number, number],
  base: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  blend = BLEND_CELLS,
): void {
  const r = Math.max(0, Math.floor(blend)),
    gw = w + 2 * r,
    gh = h + 2 * r,
    ch = m.channels;
  if (m.data.length !== w * h * 4) m.data = new Uint8Array(w * h * 4);
  if (m.cells.length < gw * gh) m.cells = new Uint8Array(gw * gh);
  if (m.rows.length < w * gh * 4) m.rows = new Uint16Array(w * gh * 4);
  m.x0 = x0;
  m.y0 = y0;
  m.w = w;
  m.h = h;
  ch.fill(-1);
  ch[0] = base;
  m.used = 1;
  // the channel of every cell, clamped into the world's bounds
  const bx0 = bounds[0] * CHUNK_CELLS,
    by0 = bounds[1] * CHUNK_CELLS,
    bx1 = (bounds[0] + bounds[2]) * CHUNK_CELLS - 1,
    by1 = (bounds[1] + bounds[3]) * CHUNK_CELLS - 1,
    cells = m.cells;
  for (let j = 0; j < gh; j++) {
    const cy = clamp(y0 - r + j, by0, by1);
    for (let i = 0; i < gw; i++) {
      const cx = clamp(x0 - r + i, bx0, bx1);
      let d = base;
      for (let a = 0; a < areas.length; a++) {
        const rc = areas[a]!.rect;
        if (cx >= rc[0] && cy >= rc[1] && cx < rc[0] + rc[2] && cy < rc[1] + rc[3]) {
          d = areas[a]!.district;
          break;
        }
      }
      let c = 0;
      while (c < m.used && ch[c] !== d) c++;
      if (c === m.used) {
        if (m.used < MASK_CHANNELS) ch[m.used++] = d;
        else c = 0;
      }
      cells[j * gw + i] = c;
    }
  }
  // the box blur, rows then columns
  const rows = m.rows,
    k = 2 * r + 1;
  rows.fill(0, 0, w * gh * 4);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      for (let t = 0; t < k; t++) {
        const q = o + cells[j * gw + i + t]!;
        rows[q] = rows[q]! + 1;
      }
    }
  }
  const data = m.data,
    area = k * k;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      let left = 255;
      for (let c = MASK_CHANNELS - 1; c >= 0; c--) {
        let n = 0;
        for (let t = 0; t < k; t++) n += rows[((j + t) * w + i) * 4 + c]!;
        // channel 0 takes the rounding, so a cell's weights add up to 255
        const v = c ? Math.round((n * 255) / area) : Math.max(0, left);
        data[o + c] = v;
        left -= v;
      }
    }
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
