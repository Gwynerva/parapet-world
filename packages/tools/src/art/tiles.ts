// The tile atlas of a district (schemas atlas.ts): per material slot the 16 autotile variants of
// the front tile, the top depth strip and the side depth strip, each with a 1 px gutter.
//
// Edge contract (checked here, relied on by the baker's validator): a material has one edge row
// `rimTop` and one edge column `rimSide`. Every variant without its up neighbour has row 0 equal to
// `rimTop`, without down row 31, without left column 0 equal to `rimSide`, without right column 31.
// The top strip's first row is `rimTop` and the side strip's first column `rimSide`, so a depth face
// meets its front face exactly on tops, undersides and both walls. Deck materials (one-way
// floors) are transparent below their deck and have no bottom rim.
import {
  ATLAS_WIDTH,
  TILE,
  VARIANT,
  atlasHeight,
  frontRect,
  sideStripRect,
  topStripRect,
  type Rect,
} from '@parapet-world/schemas';
import { CLEAR, Canvas, same, type RGBA } from './paint.ts';

export interface MaterialArt {
  id: string;
  /** Height of the deck of a one-way floor in px; the front tile is transparent below it. */
  deck?: number;
  /** The edge row (32 px): row 0 of exposed tops and row 31 of exposed bottoms. */
  rimTop: readonly RGBA[];
  /** The edge column (32 px): column 0 of exposed left sides and column 31 of exposed right sides. */
  rimSide: readonly RGBA[];
  /** Paints the 32 x 32 front tile of a variant; the generator then writes the rims over it. */
  front(g: Canvas, mask: number): void;
  /** Paints the 32 x 16 top strip; row 0 meets the front face (overwritten with `rimTop`). */
  top(g: Canvas): void;
  /** Paints the 16 x 32 side strip; column 0 meets the front face (overwritten with `rimSide`). */
  side(g: Canvas): void;
}

export const has = (mask: number, bit: number): boolean => (mask & bit) !== 0;

/** A rim of one colour, or of a pattern repeated along it. */
export const rim = (...pattern: RGBA[]): RGBA[] =>
  Array.from({ length: TILE }, (_, i) => pattern[i % pattern.length]!);

const paintFront = (art: MaterialArt, mask: number): Canvas => {
  const g = new Canvas(TILE, TILE);
  art.front(g, mask);
  const deck = art.deck ?? TILE;
  if (art.deck) g.rect(0, deck, TILE, TILE - deck, CLEAR);
  if (!has(mask, VARIANT.UP)) for (let x = 0; x < TILE; x++) g.set(x, 0, art.rimTop[x]!);
  if (!has(mask, VARIANT.DOWN) && !art.deck) {
    for (let x = 0; x < TILE; x++) g.set(x, TILE - 1, art.rimTop[x]!);
  }
  for (let y = 0; y < deck; y++) {
    if (!has(mask, VARIANT.LEFT)) g.set(0, y, art.rimSide[y]!);
    if (!has(mask, VARIANT.RIGHT)) g.set(TILE - 1, y, art.rimSide[y]!);
  }
  return g;
};

const paintTop = (art: MaterialArt): Canvas => {
  const g = new Canvas(TILE, 16);
  art.top(g);
  for (let x = 0; x < TILE; x++) g.set(x, 0, art.rimTop[x]!);
  return g;
};

const paintSide = (art: MaterialArt): Canvas => {
  const g = new Canvas(16, TILE);
  art.side(g);
  for (let y = 0; y < TILE; y++) g.set(0, y, art.rimSide[y]!);
  return g;
};

const put = (atlas: Canvas, g: Canvas, [x, y]: Rect): void => {
  atlas.blit(g, x, y, 0, 0, g.width, g.height, true);
  atlas.gutter(x, y, g.width, g.height);
};

/** Paints the atlas of one district; `slots[i]` is the material of slot i. */
export const buildAtlas = (slots: readonly MaterialArt[]): Canvas => {
  const atlas = new Canvas(ATLAS_WIDTH, atlasHeight(slots.length));
  slots.forEach((art, slot) => {
    checkRims(art);
    for (let mask = 0; mask < 16; mask++) put(atlas, paintFront(art, mask), frontRect(slot, mask));
    put(atlas, paintTop(art), topStripRect(slot));
    put(atlas, paintSide(art), sideStripRect(slot));
  });
  checkAtlas(atlas, slots);
  return atlas;
};

/** A slot's average colour (inside front tile and top strip, opaque texels), for `MaterialDef.avg`. */
export const slotAverage = (atlas: Canvas, slot: number): [number, number, number] => {
  const sum: [number, number, number] = [0, 0, 0];
  let n = 0;
  for (const [x0, y0, w, h] of [frontRect(slot, 15), topStripRect(slot)]) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const c = atlas.get(x, y);
        if (c[3] < 128) continue;
        sum[0] += c[0];
        sum[1] += c[1];
        sum[2] += c[2];
        n++;
      }
    }
  }
  return n ? [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)] : [0, 0, 0];
};

const checkRims = (art: MaterialArt): void => {
  const fail = (what: string): never => {
    throw new Error(`art: material ${art.id}: ${what}`);
  };
  if (art.rimTop.length !== TILE || art.rimSide.length !== TILE) fail('rims must be 32 px long');
  const corner = art.rimTop[0]!;
  const corners = [art.rimTop[TILE - 1]!, art.rimSide[0]!];
  if (!art.deck) corners.push(art.rimSide[TILE - 1]!);
  if (!corners.every((c) => same(c, corner))) fail('rim corners differ');
  if (art.deck) {
    for (let y = art.deck; y < TILE; y++) {
      if (art.rimSide[y]![3] !== 0) fail('a deck rim must be clear below the deck');
    }
  }
};

/** Reads the atlas back and checks the edge contract, opacity and gutters. */
const checkAtlas = (atlas: Canvas, slots: readonly MaterialArt[]): void => {
  slots.forEach((art, slot) => {
    const fail = (what: string): never => {
      throw new Error(`art: material ${art.id}: ${what}`);
    };
    const [tx, ty] = topStripRect(slot);
    const [sx, sy] = sideStripRect(slot);
    const deck = art.deck ?? TILE;
    for (let mask = 0; mask < 16; mask++) {
      const [fx, fy] = frontRect(slot, mask);
      for (let i = 0; i < TILE; i++) {
        const top = atlas.get(tx + i, ty);
        const side = atlas.get(sx, sy + i);
        if (!has(mask, VARIANT.UP) && !same(atlas.get(fx + i, fy), top)) fail(`top row ${mask}`);
        if (!art.deck && !has(mask, VARIANT.DOWN) && !same(atlas.get(fx + i, fy + 31), top)) {
          fail(`bottom row ${mask}`);
        }
        if (!has(mask, VARIANT.LEFT) && !same(atlas.get(fx, fy + i), side)) fail(`left ${mask}`);
        if (!has(mask, VARIANT.RIGHT) && !same(atlas.get(fx + 31, fy + i), side)) {
          fail(`right ${mask}`);
        }
      }
      for (let y = 0; y < deck; y++) {
        for (let x = 0; x < TILE; x++) {
          if (atlas.alpha(fx + x, fy + y) !== 255) fail(`front ${mask} not opaque at ${x},${y}`);
        }
      }
    }
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < TILE; x++) if (atlas.alpha(tx + x, ty + y) !== 255) fail('top strip');
    }
    for (let y = 0; y < deck; y++) {
      for (let x = 0; x < 16; x++) if (atlas.alpha(sx + x, sy + y) !== 255) fail('side strip');
    }
  });
};
