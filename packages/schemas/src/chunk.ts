import { CHUNK_CELLS } from './units.ts';

/**
 * A baked chunk (`dist/chunks/<hash>.json`): immutable, cached by its content hash. Byte grids
 * are 32 x 32, row-major from the top-left cell, stored as base64.
 */
export interface ChunkFile {
  format: 1;
  cx: number;
  cy: number;
  /** Collision class per cell (`Cell`), props stamped in. */
  cells: string;
  /** Material per cell: an index into `WorldIndex.materials`; 0 = not drawn by the tile pass. */
  materials: string;
  /** Autotile variant per cell (see `atlas.ts`). */
  variants: string;
  /**
   * Depth outline segments of the tiles, final across chunk borders (the baker sees the whole
   * world): flat groups of six numbers `x0, y0, x1, y1, material, face`, positions in world px.
   * `face` is the outward side: 0 top, 1 right, 2 bottom (underside), 3 left; a slope's surface
   * is a top face. Segments run with the solid on their right-hand side when walking from
   * (x0, y0) to (x1, y1) in y-down coordinates, i.e. clockwise around solids.
   */
  outlines: number[];
  /** Props whose anchor cell is in this chunk. */
  props: PropPlacement[];
}

/**
 * A placed prop: `prop` indexes `WorldIndex.props`; `x`, `y` is its mask's top-left cell in
 * absolute world cells (not relative to the chunk).
 */
export interface PropPlacement {
  prop: number;
  x: number;
  y: number;
}

export const CHUNK_AREA = CHUNK_CELLS * CHUNK_CELLS;

/** Bytes to base64 and back, without Node or DOM helpers (usable everywhere). */
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0,
      b = bytes[i + 1] ?? 0,
      c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += ABC[(n >> 18) & 63]! + ABC[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? ABC[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? ABC[n & 63]! : '=';
  }
  return out;
}
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (ABC.indexOf(clean[i]!) << 18) |
      (ABC.indexOf(clean[i + 1] ?? 'A') << 12) |
      (ABC.indexOf(clean[i + 2] ?? 'A') << 6) |
      ABC.indexOf(clean[i + 3] ?? 'A');
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
