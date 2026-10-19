// Painters shared by the background layers: banded skies, skylines of flat buildings and lattice
// structures (cranes, gantries). Layers repeat horizontally, so every painter draws on a canvas
// that wraps x around its width.
import { Canvas, dither2, hash, random, type RGBA } from './paint.ts';

/** A repeating layer canvas. */
export const layer = (width: number, height: number): Canvas => {
  const g = new Canvas(width, height);
  g.wrapX = true;
  return g;
};

/**
 * Horizontal bands of colour from top to bottom with a two-row ordered-dither seam between
 * neighbours. `edges[i]` is the first row of band i + 1.
 */
export const bands = (
  g: Canvas,
  colours: readonly RGBA[],
  edges: readonly number[],
  y0 = 0,
): void => {
  for (let y = y0; y < g.height; y++) {
    let i = 0;
    while (i < edges.length && y >= edges[i]!) i++;
    const next = edges[i];
    const prev = edges[i - 1];
    for (let x = 0; x < g.width; x++) {
      let c = colours[i]!;
      if (next !== undefined && y >= next - 2 && dither2(x, y) < (y === next - 1 ? 0.5 : 0.25)) {
        c = colours[i + 1]!;
      } else if (prev !== undefined && y < prev + 1 && dither2(x, y) < 0.25) c = colours[i - 1]!;
      g.set(x, y, c);
    }
  }
};

export interface Building {
  x: number;
  w: number;
  top: number;
}

export interface SkylineStyle {
  seed: number;
  /** Building widths and the rows their roofs may sit on. */
  width: [number, number];
  top: [number, number];
  /** Gap between buildings (may be negative to overlap). */
  gap: [number, number];
  body: RGBA;
  /** The lit left edge and the shaded right edge. */
  lit: RGBA;
  shade: RGBA;
  window: { lit: RGBA[]; dark: RGBA; chance: number; w: number; h: number; dx: number; dy: number };
}

/** A row of flat buildings from `top` to the bottom of the canvas; returns them for decoration. */
export const skyline = (g: Canvas, s: SkylineStyle): Building[] => {
  const rnd = random(s.seed);
  const pick = ([a, b]: [number, number]): number => Math.round(a + (b - a) * rnd());
  const out: Building[] = [];
  for (let x = 0; x < g.width;) {
    const w = pick(s.width);
    const top = pick(s.top);
    out.push({ x, w, top });
    x += w + pick(s.gap);
  }
  // Draw from the tallest so lower buildings stay in front of taller neighbours.
  for (const b of [...out].sort((p, q) => p.top - q.top)) {
    g.rect(b.x, b.top, b.w, g.height - b.top, s.body);
    g.vline(b.x, b.top, g.height - 1, s.lit);
    g.vline(b.x + b.w - 1, b.top, g.height - 1, s.shade);
    g.hline(b.x, b.x + b.w - 1, b.top, s.lit);
    const win = s.window;
    const seed = Math.round(rnd() * 1e6);
    if (rnd() > 0.85) continue;
    for (let y = b.top + 4; y + win.h < g.height; y += win.dy) {
      for (let x = b.x + 3; x + win.w <= b.x + b.w - 3; x += win.dx) {
        const h = hash(x, y, seed);
        const c =
          h < win.chance ? win.lit[Math.floor((h / win.chance) * win.lit.length)]! : win.dark;
        g.rect(x, y, win.w, win.h, c);
      }
    }
  }
  return out;
};

/** A water tank on legs standing on a roof at (x, roof). */
export const waterTank = (g: Canvas, x: number, roof: number, c: RGBA, lit: RGBA): void => {
  g.rect(x + 1, roof - 22, 12, 14, c);
  g.rect(x, roof - 24, 14, 2, c);
  g.set(x + 7, roof - 25, c);
  g.rect(x + 6, roof - 26, 2, 1, c);
  g.vline(x + 1, roof - 22, roof - 9, lit);
  for (const lx of [x + 2, x + 11]) g.vline(lx, roof - 8, roof - 1, c);
  g.line(x + 2, roof - 8, x + 11, roof - 2, c);
  g.line(x + 11, roof - 8, x + 2, roof - 2, c);
};

/** A thin mast with a red light on top. */
export const antenna = (
  g: Canvas,
  x: number,
  roof: number,
  h: number,
  c: RGBA,
  light: RGBA,
): void => {
  g.vline(x, roof - h, roof - 1, c);
  g.hline(x - 2, x + 2, roof - h + 4, c);
  g.hline(x - 1, x + 1, roof - h + 8, c);
  g.set(x, roof - h - 1, light);
};

/** A lattice between two parallel lines (a crane's jib or mast), zigzag every `step` px. */
export const lattice = (
  g: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thick: number,
  step: number,
  c: RGBA,
): void => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const nx = (-(y1 - y0) / len) * thick;
  const ny = ((x1 - x0) / len) * thick;
  const r = (v: number): number => Math.round(v);
  g.line(r(x0), r(y0), r(x1), r(y1), c);
  g.line(r(x0 + nx), r(y0 + ny), r(x1 + nx), r(y1 + ny), c);
  const n = Math.max(1, Math.round(len / step));
  for (let i = 0; i < n; i++) {
    const a = i / n;
    const b = (i + 1) / n;
    const ax = x0 + (x1 - x0) * a;
    const ay = y0 + (y1 - y0) * a;
    const bx = x0 + (x1 - x0) * b;
    const by = y0 + (y1 - y0) * b;
    if (i % 2) g.line(r(ax), r(ay), r(bx + nx), r(by + ny), c);
    else g.line(r(ax + nx), r(ay + ny), r(bx), r(by), c);
  }
};

/** A tower crane: mast from the ground up to `top`, a jib to the right, a counter-jib left. */
export const towerCrane = (
  g: Canvas,
  x: number,
  ground: number,
  top: number,
  jib: number,
  c: RGBA,
  light: RGBA,
): void => {
  lattice(g, x, ground, x, top, 6, 7, c);
  lattice(g, x - 26, top, x + jib, top, -5, 8, c);
  g.rect(x - 26, top - 4, 9, 9, c);
  g.line(x + 3, top - 18, x - 22, top - 5, c);
  g.line(x + 3, top - 18, x + jib - 10, top - 5, c);
  g.vline(x + 3, top - 18, top - 5, c);
  g.rect(x + 1, top + 1, 7, 6, c);
  const hook = x + Math.round(jib * 0.62);
  g.vline(hook, top + 1, top + 40, c);
  g.rect(hook - 1, top + 41, 3, 2, c);
  g.set(x + 3, top - 19, light);
  g.set(x + jib, top - 6, light);
};
