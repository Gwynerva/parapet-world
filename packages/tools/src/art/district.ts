// What a district's art module provides: its materials in slot order, background layers, the
// district.json fields and a sample room for the preview.
import type { DistrictDef } from '@parapet-world/schemas';
import { VARIANT } from '@parapet-world/schemas';
import type { Canvas, RGBA } from './paint.ts';
import { has, type MaterialArt } from './tiles.ts';

export interface LayerArt {
  file: string;
  /** Scroll factor (well below 1). */
  factor: number;
  /** World y of the image's top edge when the view's top edge is at y = 0. */
  y: number;
  paint(): Canvas;
}

export interface SampleRoom {
  /** Room characters (palette.json legend of the district), top row first. */
  rows: string[];
  /** Multi-cell props: id and the mask's top-left cell. */
  props: Array<[string, number, number]>;
  /** World y of the room's top edge (sets the background parallax in the preview). */
  worldY: number;
  /** The runner's feet, in room px. */
  runner: [number, number];
}

export interface DistrictArt {
  id: DistrictDef['id'];
  name: string;
  sky: [number, number, number];
  ambience: string;
  /** Materials in slot order; ids match materials.json. */
  materials: MaterialArt[];
  layers: LayerArt[];
  room: SampleRoom;
}

/** The view a layer's `y` is placed for: a logical screen of 683 x 384 px. */
export const SCREEN: [number, number] = [683, 384];

/**
 * Inner light and shadow along the exposed edges of a front tile, light from the upper left:
 * `light` on the row/column just inside an exposed top or left rim, `dark` inside an exposed
 * bottom or right rim.
 */
export const bevel = (
  g: Canvas,
  mask: number,
  light: RGBA | null,
  dark: RGBA | null,
  from = 1,
  to = 30,
): void => {
  if (light && !has(mask, VARIANT.UP)) g.hline(1, 30, 1, light);
  if (light && !has(mask, VARIANT.LEFT)) g.vline(1, from, to, light);
  if (dark && !has(mask, VARIANT.DOWN)) g.hline(1, 30, 30, dark);
  if (dark && !has(mask, VARIANT.RIGHT)) g.vline(30, from, to, dark);
};

export const up = (mask: number): boolean => !has(mask, VARIANT.UP);
export const down = (mask: number): boolean => !has(mask, VARIANT.DOWN);
export const left = (mask: number): boolean => !has(mask, VARIANT.LEFT);
export const right = (mask: number): boolean => !has(mask, VARIANT.RIGHT);

/**
 * Running-bond bricks over a rect: courses `h` px tall (the last row mortar), bricks `w` px long
 * (the last column mortar), every other course shifted by half a brick. `shade` picks a brick's
 * colour from its course and index (wrapped so the pattern tiles every 32 px).
 */
export const bricks = (
  g: Canvas,
  x0: number,
  y0: number,
  w: number,
  h: number,
  size: { w: number; h: number; shift?: number },
  mortar: RGBA,
  shade: (course: number, index: number, px: number, py: number) => RGBA,
): void => {
  const per = 32 / size.w;
  for (let y = y0; y < y0 + h; y++) {
    const course = Math.floor(y / size.h);
    const py = y - course * size.h;
    const off = course % 2 ? (size.shift ?? size.w / 2) : 0;
    for (let x = x0; x < x0 + w; x++) {
      const bx = x + off;
      const index = Math.floor(bx / size.w);
      const px = bx - index * size.w;
      const c =
        py === size.h - 1 || px === size.w - 1
          ? mortar
          : shade(course % (32 / size.h), ((index % per) + per) % per, px, py);
      g.set(x, y, c);
    }
  }
};
