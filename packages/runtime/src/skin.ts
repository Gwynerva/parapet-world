/**
 * Skin compositing. A look is a stack of sheets in the same box-unwrap layout (schemas `skin.ts`):
 * body, hair, costume, then any extra layer. The stack is composited once, alpha over (both halves
 * at once, since the halves never mix), into one sheet; the overlay half's opaque texels decide
 * which overlay shell triangles exist. 1x (128 x 128) and 2x (256 x 256) sheets mix freely: every
 * layer is resampled with nearest filtering to the largest scale in the stack.
 */
import { SKIN_HALF, SKIN_SHEET } from '@parapet-world/schemas';

/** Decoded RGBA pixels, rows from the top, not premultiplied. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** A composited look: the sheet, its scale (1 or 2) and the overlay mask at 1x. */
export interface ComposedSkin {
  pixels: Uint8ClampedArray;
  size: number;
  scale: number;
  /** One byte per 1x texel of the overlay half (128 x 64): 1 where any sub-texel is opaque. */
  mask: Uint8Array;
}

/** Alpha below this counts as empty (the template's faint face tints, editor noise). */
export const EMPTY_ALPHA = 32;

/** The scale of a sheet from its size, or 0 when it is not a square multiple of 128. */
export function sheetScale(p: Pixels): number {
  if (p.width !== p.height || p.width % SKIN_SHEET) return 0;
  return p.width / SKIN_SHEET;
}

/** Composites `src` over `dst` in place (straight alpha). */
export function overOnto(dst: Uint8ClampedArray, src: Uint8Array | Uint8ClampedArray): void {
  for (let i = 0; i < dst.length; i += 4) {
    const a = src[i + 3]! / 255;
    if (a <= 0) continue;
    const b = (dst[i + 3]! / 255) * (1 - a),
      oa = a + b;
    for (let c = 0; c < 3; c++) dst[i + c] = (src[i + c]! * a + dst[i + c]! * b) / oa;
    dst[i + 3] = oa * 255;
  }
}

/** A square sheet resampled with nearest filtering to `size` x `size`. */
export function resample(p: Pixels, size: number): Uint8Array | Uint8ClampedArray {
  if (p.width === size) return p.data;
  const out = new Uint8ClampedArray(size * size * 4),
    k = p.width / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (Math.floor(y * k) * p.width + Math.floor(x * k)) * 4,
        d = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) out[d + c] = p.data[s + c]!;
    }
  }
  return out;
}

/** The overlay mask at 1x: a texel counts when any of its sub-texels has alpha >= 128. */
export function maskOf(px: Uint8Array | Uint8ClampedArray, scale: number): Uint8Array {
  const W = SKIN_SHEET * scale,
    m = new Uint8Array(SKIN_SHEET * SKIN_HALF);
  for (let y = 0; y < SKIN_HALF * scale; y++) {
    for (let x = 0; x < W; x++) {
      if (px[((SKIN_HALF * scale + y) * W + x) * 4 + 3]! >= 128) {
        m[Math.floor(y / scale) * SKIN_SHEET + Math.floor(x / scale)] = 1;
      }
    }
  }
  return m;
}

/** A copy of a layer with near-transparent texels cleared (see `EMPTY_ALPHA`). */
export function cleanLayer(p: Pixels): Pixels {
  const data = new Uint8ClampedArray(p.data);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < EMPTY_ALPHA) data[i - 3] = data[i - 2] = data[i - 1] = data[i] = 0;
  }
  return { width: p.width, height: p.height, data };
}

/**
 * Composites a stack of sheets, bottom first. Sheets that are not square multiples of 128 are
 * rejected with an error naming their size, so a wrong export fails loudly.
 */
export function composeSkin(layers: readonly Pixels[]): ComposedSkin {
  let scale = 1;
  for (const l of layers) {
    const s = sheetScale(l);
    if (!s)
      throw new Error(`a skin sheet must be 128 x 128 or 256 x 256, not ${l.width} x ${l.height}`);
    scale = Math.max(scale, s);
  }
  const size = SKIN_SHEET * scale,
    pixels = new Uint8ClampedArray(size * size * 4);
  for (const l of layers) overOnto(pixels, resample(l, size));
  return { pixels, size, scale, mask: maskOf(pixels, scale) };
}
