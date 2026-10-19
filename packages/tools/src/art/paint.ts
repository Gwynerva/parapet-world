// Drawing helpers for the art generators: colours, a pixel canvas over the PNG image type and a
// deterministic hash. Everything paints whole pixels; nothing is anti-aliased.
import { createImage, type Image } from '../png.ts';

export type RGBA = readonly [number, number, number, number];

export const CLEAR: RGBA = [0, 0, 0, 0];

/** `#rrggbb` to an opaque colour. */
export const hex = (s: string): RGBA => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
  255,
];

/** A ramp of colours from dark to light. */
export const ramp = (...colours: string[]): RGBA[] => colours.map(hex);

export const mix = (a: RGBA, b: RGBA, t: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
  Math.round(a[3] + (b[3] - a[3]) * t),
];

export const withAlpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];

export const same = (a: RGBA, b: RGBA): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/** A hash of integer coordinates to [0, 1). */
export const hash = (x: number, y: number, seed = 0): number => {
  let h =
    Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

/** A seeded generator of numbers in [0, 1). */
export const random = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

/** The 2 x 2 ordered dither threshold of a pixel, for stepped blends between two colours. */
export const dither2 = (x: number, y: number): number =>
  [0.125, 0.625, 0.875, 0.375][(y & 1) * 2 + (x & 1)]!;

/** The 4 x 4 ordered dither threshold of a pixel. */
export const dither4 = (x: number, y: number): number =>
  ([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y & 3) * 4 + (x & 3)]! + 0.5) / 16;

export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  /** Wrap x around the width, for horizontally repeating layers. */
  wrapX = false;

  constructor(width: number, height: number, data?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8Array(width * height * 4);
  }

  static from(img: Image): Canvas {
    return new Canvas(img.width, img.height, img.data);
  }

  image(): Image {
    const img = createImage(this.width, this.height);
    img.data.set(this.data);
    return img;
  }

  inside(x: number, y: number): boolean {
    return (this.wrapX || (x >= 0 && x < this.width)) && y >= 0 && y < this.height;
  }

  private index(x: number, y: number): number {
    const w = this.width;
    return (y * w + (this.wrapX ? ((x % w) + w) % w : x)) * 4;
  }

  get(x: number, y: number): RGBA {
    if (!this.inside(x, y)) return CLEAR;
    const o = this.index(x, y);
    const d = this.data;
    return [d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!];
  }

  alpha(x: number, y: number): number {
    return this.inside(x, y) ? this.data[this.index(x, y) + 3]! : 0;
  }

  /** Overwrites a pixel (alpha included). */
  set(x: number, y: number, c: RGBA): void {
    if (!this.inside(x, y)) return;
    const o = this.index(x, y);
    this.data[o] = c[0];
    this.data[o + 1] = c[1];
    this.data[o + 2] = c[2];
    this.data[o + 3] = c[3];
  }

  /** Draws a colour over a pixel with the colour's alpha (straight alpha, "over"). */
  over(x: number, y: number, c: RGBA): void {
    if (!this.inside(x, y) || c[3] === 0) return;
    if (c[3] === 255) return this.set(x, y, c);
    const d = this.get(x, y);
    const a = c[3] / 255;
    const outA = a + (d[3] / 255) * (1 - a);
    if (outA <= 0) return this.set(x, y, CLEAR);
    const ch = (i: 0 | 1 | 2): number =>
      Math.round((c[i] * a + d[i] * (d[3] / 255) * (1 - a)) / outA);
    this.set(x, y, [ch(0), ch(1), ch(2), Math.round(outA * 255)]);
  }

  fill(c: RGBA): void {
    this.rect(0, 0, this.width, this.height, c);
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  /** A rect drawn with `over`. */
  tint(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.over(i, j, c);
  }

  hline(x0: number, x1: number, y: number, c: RGBA): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: RGBA): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
  }

  /** A Bresenham line, both ends included. */
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** A filled disc of pixel centres within radius r of (cx, cy). */
  disc(cx: number, cy: number, r: number, c: RGBA): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c);
      }
    }
  }

  /** Every pixel for which `fn` returns a colour. */
  paint(
    fn: (x: number, y: number) => RGBA | null,
    x0 = 0,
    y0 = 0,
    w = this.width,
    h = this.height,
  ): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const c = fn(x, y);
        if (c) this.set(x, y, c);
      }
    }
  }

  /** Copies a rect of another canvas; transparent source pixels are skipped unless `raw`. */
  blit(
    src: Canvas,
    dx: number,
    dy: number,
    sx = 0,
    sy = 0,
    w = src.width,
    h = src.height,
    raw = false,
  ): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = src.get(sx + x, sy + y);
        if (raw) this.set(dx + x, dy + y, c);
        else this.over(dx + x, dy + y, c);
      }
    }
  }

  /**
   * Turns every opaque pixel that touches a transparent one (4-neighbourhood) into an outline
   * pixel: its own colour darkened toward `ink`. Edges listed in `wrap` see the opposite edge
   * as their neighbour, so a sprite that tiles along that axis gets no outline at its seam.
   */
  outline(ink: RGBA, wrap: { x?: boolean; y?: boolean } = {}): void {
    const { width: w, height: h } = this;
    const solid = (x: number, y: number): boolean => {
      if (wrap.x) x = (x + w) % w;
      if (wrap.y) y = (y + h) % h;
      return this.alpha(x, y) > 0;
    };
    const edge: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!solid(x, y)) continue;
        if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) {
          edge.push(x, y);
        }
      }
    }
    for (let i = 0; i < edge.length; i += 2) {
      const x = edge[i]!;
      const y = edge[i + 1]!;
      this.set(x, y, mix(this.get(x, y), ink, 0.78));
    }
  }

  /**
   * Draws `ink` on every transparent pixel next to an opaque one (4-neighbourhood): an outline
   * outside the shape. `wrap` as for `outline`.
   */
  outlineOutside(ink: RGBA, wrap: { x?: boolean; y?: boolean } = {}): void {
    const { width: w, height: h } = this;
    const solid = (x: number, y: number): boolean => {
      if (wrap.x) x = (x + w) % w;
      if (wrap.y) y = (y + h) % h;
      return this.alpha(x, y) > 0;
    };
    const edge: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (solid(x, y)) continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
          edge.push(x, y);
        }
      }
    }
    for (let i = 0; i < edge.length; i += 2) this.set(edge[i]!, edge[i + 1]!, ink);
  }

  /** Repeats the border pixels of a rect one pixel outward (the atlas gutter). */
  gutter(x: number, y: number, w: number, h: number): void {
    for (let i = -1; i <= w; i++) {
      const sx = x + Math.min(w - 1, Math.max(0, i));
      this.set(x + i, y - 1, this.get(sx, y));
      this.set(x + i, y + h, this.get(sx, y + h - 1));
    }
    for (let j = 0; j < h; j++) {
      this.set(x - 1, y + j, this.get(x, y + j));
      this.set(x + w, y + j, this.get(x + w - 1, y + j));
    }
  }

  /** A nearest-neighbour enlargement. */
  scaled(k: number): Canvas {
    const out = new Canvas(this.width * k, this.height * k);
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) out.set(x, y, this.get((x / k) | 0, (y / k) | 0));
    }
    return out;
  }
}

/** The colour `d` steps lighter (positive) or darker in whichever ramp holds `c`. */
export const step = (c: RGBA, d: number, ...ramps: ReadonlyArray<readonly RGBA[]>): RGBA => {
  for (const r of ramps) {
    const i = r.findIndex((k) => same(k, c));
    if (i >= 0) return r[Math.max(0, Math.min(r.length - 1, i + d))]!;
  }
  return c;
};
