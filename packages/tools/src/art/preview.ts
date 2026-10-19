// Previews of the generated art: a sample room per district drawn like the game draws it (parallax
// background, tile fronts, depth faces extruded into a slab with perspective toward the screen
// centre, props and a stand-in runner mid-slab), and a contact sheet of the props atlas.
// The world is drawn at logical resolution and upscaled, props and the runner at the output scale.
import {
  Cell,
  DEFAULT_RENDER,
  TILE,
  VARIANT,
  cameraDistance,
  frontRect,
  sideStripRect,
  topStripRect,
  type CellClass,
} from '@parapet-world/schemas';
import { SCREEN, type DistrictArt } from './district.ts';
import { text, textWidth } from './font.ts';
import { Canvas, hex, mix, type RGBA } from './paint.ts';
import type { MaterialArt } from './tiles.ts';

/** A room character: a material with a collision class, or a single-cell prop. */
export interface LegendEntry {
  material?: string;
  cell?: string;
  prop?: string;
}

export interface PropSprite {
  sprite: [number, number, number, number];
  offset: [number, number];
  layer: 'mid' | 'front';
}

const SCALE = 2;

const shade = (c: RGBA, k: number): RGBA => [
  Math.round(c[0] * k),
  Math.round(c[1] * k),
  Math.round(c[2] * k),
  c[3],
];

interface CellInfo {
  cls: CellClass;
  slot: number;
}

export const renderPreview = (
  district: DistrictArt,
  atlas: Canvas,
  layers: Canvas[],
  legend: Readonly<Record<string, LegendEntry>>,
  materialCells: ReadonlyMap<string, string>,
  props: ReadonlyMap<string, PropSprite>,
  propsAtlas: Canvas,
): Canvas => {
  const [W, H] = SCREEN;
  const room = district.room;
  const rows = room.rows;
  const slotOf = new Map(district.materials.map((m, i) => [m.id, i]));
  const art = (slot: number): MaterialArt => district.materials[slot]!;
  const cells: Array<CellInfo | null>[] = [];
  const placed: Array<[string, number, number]> = [...room.props];
  rows.forEach((row, cy) => {
    cells.push(
      [...row].map((ch, cx) => {
        const e = legend[ch];
        if (!e || e.cell === 'EMPTY') return null;
        if (e.prop) {
          placed.push([e.prop, cx, cy]);
          return null;
        }
        if (!e.material) return null;
        const name = e.cell ?? materialCells.get(e.material) ?? 'SOLID';
        return { cls: Cell[name as keyof typeof Cell], slot: slotOf.get(e.material)! };
      }),
    );
  });
  const at = (cx: number, cy: number): CellInfo | null => cells[cy]?.[cx] ?? null;

  // 1. Sky and parallax layers (the view's top-left is the room's top-left).
  const g = new Canvas(W, H);
  g.fill([...district.sky, 255]);
  const camX = 900;
  district.layers.forEach((l, i) => {
    const img = layers[i]!;
    const top = Math.round(l.y - l.factor * room.worldY);
    const shift = Math.round(l.factor * camX) % img.width;
    for (let y = 0; y < H; y++) {
      const sy = y - top;
      if (sy < 0 || sy >= img.height) continue;
      for (let x = 0; x < W; x++) g.over(x, y, img.get((x + shift) % img.width, sy));
    }
  });

  // 2. Solid shapes per pixel (material slot + 1), for the depth outline.
  const RW = rows[0]!.length * TILE;
  const RH = rows.length * TILE;
  const solid = new Int16Array(RW * RH);
  const shapeRows = (c: CellInfo): [number, number] => {
    const deck = art(c.slot).deck;
    if (c.cls === Cell.HALF) return [16, 32];
    if (c.cls === Cell.SLAB) return [0, 16];
    if (c.cls === Cell.TOP) return [0, deck ?? 8];
    if (c.cls === Cell.SOLID) return [0, 32];
    return [0, 0];
  };
  for (let cy = 0; cy < rows.length; cy++) {
    for (let cx = 0; cx < rows[0]!.length; cx++) {
      const c = at(cx, cy);
      if (!c) continue;
      const [y0, y1] = shapeRows(c);
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < TILE; x++) solid[(cy * TILE + y) * RW + cx * TILE + x] = c.slot + 1;
      }
    }
  }
  const S = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= RW || y >= RH ? 0 : solid[y * RW + x]!;

  // 3. Depth faces, far slices first, splatted along every exposed pixel edge.
  const F = cameraDistance(DEFAULT_RENDER.perspective);
  const depth = DEFAULT_RENDER.slabDepth;
  const cx0 = W / 2;
  const cy0 = H / 2;
  const project = (x: number, y: number, z: number): [number, number] => {
    const s = F / (F + z);
    return [cx0 + (x - cx0) * s, cy0 + (y - cy0) * s];
  };
  for (let zi = depth * 4 - 1; zi >= 0; zi--) {
    const z = (zi + 0.5) / 4;
    const row = Math.min(15, Math.floor(z));
    for (let y = 0; y < RH; y++) {
      for (let x = 0; x < RW; x++) {
        const m = S(x, y);
        if (!m) continue;
        const slot = m - 1;
        const [tx, ty] = topStripRect(slot);
        const [sx, sy] = sideStripRect(slot);
        const u = x % TILE;
        const v = y % TILE;
        if (!S(x, y - 1)) {
          const [px, py] = project(x + 0.5, y, z);
          g.set(Math.floor(px), Math.ceil(py) - 1, shade(atlas.get(tx + u, ty + row), 1));
        }
        if (!S(x, y + 1)) {
          const [px, py] = project(x + 0.5, y + 1, z);
          g.set(Math.floor(px), Math.floor(py), shade(atlas.get(tx + u, ty + row), 0.58));
        }
        if (!S(x - 1, y)) {
          const [px, py] = project(x, y + 0.5, z);
          g.set(Math.ceil(px) - 1, Math.floor(py), shade(atlas.get(sx + row, sy + v), 0.76));
        }
        if (!S(x + 1, y)) {
          const [px, py] = project(x + 1, y + 0.5, z);
          g.set(Math.floor(px), Math.floor(py), shade(atlas.get(sx + row, sy + v), 0.76));
        }
      }
    }
  }

  // 4. Front faces at their true positions, clipped to the cell's shape.
  for (let cy = 0; cy < rows.length; cy++) {
    for (let cx = 0; cx < rows[0]!.length; cx++) {
      const c = at(cx, cy);
      if (!c) continue;
      const sameAt = (dx: number, dy: number): boolean => at(cx + dx, cy + dy)?.slot === c.slot;
      const mask =
        (sameAt(0, -1) ? VARIANT.UP : 0) |
        (sameAt(1, 0) ? VARIANT.RIGHT : 0) |
        (sameAt(0, 1) ? VARIANT.DOWN : 0) |
        (sameAt(-1, 0) ? VARIANT.LEFT : 0);
      const [fx, fy] = frontRect(c.slot, mask);
      let [y0, y1] = shapeRows(c);
      let src = 0;
      if (c.cls === Cell.HALF) src = -16;
      if (c.cls === Cell.SLAB) src = 16;
      if (c.cls === Cell.KILL) [y0, y1] = [0, 32];
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < TILE; x++) {
          g.over(cx * TILE + x, cy * TILE + y, atlas.get(fx + x, fy + y + src));
        }
      }
    }
  }

  // 5. Upscale, then props and the runner at the runner depth.
  const out = g.scaled(SCALE);
  const zr = depth * DEFAULT_RENDER.runnerDepth;
  const sprite = (
    src: Canvas,
    sx: number,
    sy: number,
    w: number,
    h: number,
    wx: number,
    wy: number,
  ) => {
    const [ax, ay] = project(wx, wy, zr);
    const [bx, by] = project(wx + w, wy + h, zr);
    for (let oy = Math.floor(ay * SCALE); oy < Math.ceil(by * SCALE); oy++) {
      for (let ox = Math.floor(ax * SCALE); ox < Math.ceil(bx * SCALE); ox++) {
        const u = Math.floor(((ox + 0.5) / SCALE - ax) / ((bx - ax) / w));
        const v = Math.floor(((oy + 0.5) / SCALE - ay) / ((by - ay) / h));
        if (u < 0 || v < 0 || u >= w || v >= h) continue;
        out.over(ox, oy, src.get(sx + u, sy + v));
      }
    }
  };
  const drawProps = (layer: 'mid' | 'front'): void => {
    for (const [id, cx, cy] of placed) {
      const p = props.get(id);
      if (!p || p.layer !== layer) continue;
      const [sx, sy, w, h] = p.sprite;
      sprite(propsAtlas, sx, sy, w, h, cx * TILE + p.offset[0], cy * TILE + p.offset[1]);
    }
  };
  drawProps('mid');
  const runner = standIn();
  sprite(
    runner,
    0,
    0,
    runner.width,
    runner.height,
    room.runner[0] - 8,
    room.runner[1] - runner.height,
  );
  drawProps('front');
  return out;
};

/**
 * A flat stand-in for the 3D runner in its default look (red hair, white tank top, grey capris,
 * red sneakers), about 57 px tall, only to judge contrast in previews.
 */
const standIn = (): Canvas => {
  const g = new Canvas(16, 57);
  const skin = hex('#e0a47c');
  const skinDark = hex('#b87a5a');
  const hair = hex('#c8302a');
  const hairDark = hex('#8e1f1e');
  const top = hex('#f2f0ea');
  const topShade = hex('#c9c6c0');
  const capri = hex('#8a8c90');
  const capriShade = hex('#6a6c72');
  const shoe = hex('#d42e2e');
  const sole = hex('#f0f0f0');
  g.rect(5, 2, 7, 9, skin);
  g.rect(4, 0, 8, 4, hair);
  g.rect(4, 4, 2, 6, hair);
  g.rect(3, 2, 2, 9, hairDark);
  g.set(10, 6, hex('#3a2a2a'));
  g.rect(7, 11, 3, 2, skinDark);
  g.rect(4, 13, 8, 12, top);
  g.rect(4, 13, 2, 12, topShade);
  g.rect(4, 25, 8, 3, skin);
  g.rect(9, 14, 3, 13, skin);
  g.rect(11, 14, 1, 13, skinDark);
  g.rect(4, 28, 8, 17, capri);
  g.rect(4, 28, 2, 17, capriShade);
  g.rect(7, 36, 1, 9, capriShade);
  g.rect(5, 45, 2, 7, skin);
  g.rect(9, 45, 2, 7, skin);
  g.rect(4, 52, 4, 3, shoe);
  g.rect(8, 52, 5, 3, shoe);
  g.hline(4, 12, 55, sole);
  g.hline(4, 12, 56, sole);
  g.outline(hex('#101014'));
  return g;
};

/** The props atlas enlarged with every sprite labelled; segment props are repeated three times. */
export const renderContactSheet = (
  propsAtlas: Canvas,
  entries: ReadonlyArray<{
    id: string;
    sprite: [number, number, number, number];
    tile?: 'x' | 'y';
  }>,
): Canvas => {
  const pad = 12;
  const maxW = 1400;
  const label = 12;
  const items = entries.map((e) => {
    const [, , w, h] = e.sprite;
    const n = e.tile && (e.tile === 'y' || w <= 32) ? 3 : 1;
    const cw = (e.tile === 'x' ? w * n : w) * SCALE;
    const ch = (e.tile === 'y' ? h * n : h) * SCALE;
    return { e, n, w: Math.max(cw, textWidth(e.id) * 2), h: ch, cw };
  });
  const placed: Array<{ it: (typeof items)[number]; x: number; y: number }> = [];
  let x = pad;
  let y = pad;
  let rowH = 0;
  for (const it of items) {
    if (x + it.w > maxW) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    placed.push({ it, x, y });
    x += it.w + pad;
    rowH = Math.max(rowH, it.h + label);
  }
  const g = new Canvas(maxW, y + rowH + pad);
  const bgA = hex('#5c6470');
  const bgB = hex('#4e5560');
  g.paint((px, py) => (((px >> 3) + (py >> 3)) % 2 ? bgA : bgB));
  const ink = new Canvas(maxW, 5);
  for (const { it, x, y } of placed) {
    const [sx, sy, w, h] = it.e.sprite;
    for (let k = 0; k < it.n; k++) {
      const ox = it.e.tile === 'x' ? k * w : 0;
      const oy = it.e.tile === 'y' ? k * h : 0;
      for (let v = 0; v < h * SCALE; v++) {
        for (let u = 0; u < w * SCALE; u++) {
          const c = propsAtlas.get(sx + ((u / SCALE) | 0), sy + ((v / SCALE) | 0));
          g.over(x + ox * SCALE + u, y + label + oy * SCALE + v, c);
        }
      }
    }
    ink.fill([0, 0, 0, 0]);
    text(ink, 0, 0, it.e.id, hex('#f0f0f0'));
    for (let v = 0; v < 10; v++) {
      for (let u = 0; u < textWidth(it.e.id) * 2; u++) {
        g.set(
          x + u,
          y + v,
          ink.alpha(u >> 1, v >> 1) ? hex('#f0f0f0') : mix(bgB, hex('#000000'), 0.5),
        );
      }
    }
  }
  return g;
};
