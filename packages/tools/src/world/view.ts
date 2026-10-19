/**
 * `node packages/tools/src/world/view.ts <out.png> [x y w h] [--scale <s>] [--gym]`: bakes the city
 * in memory and draws a rectangle of it (cells; the whole city by default) flat at one texel per
 * pixel times the scale: each district's sky, the front tiles with their autotile variants and the
 * cell shapes, the props, and outlines of hubs (green), route gates (start blue, checkpoints
 * amber, finish red) and finds (magenta), with cell numbers every 8 cells. No slab depth: this is
 * for checking layouts, the game shows the real thing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cell, frontRect, type CellRect } from '@parapet-world/schemas';
import { text } from '../art/font.ts';
import { Canvas, hex, type RGBA } from '../art/paint.ts';
import { decodePng, encodePng } from '../png.ts';
import { CONTENT_ROOT, loadWorld, option } from './load.ts';

const args = process.argv.slice(2);
const out = args[0];
if (out === undefined || out.startsWith('--')) {
  throw new Error('usage: view.ts <out.png> [x y w h] [--scale <s>] [--gym]');
}
const w = loadWorld(args.includes('--gym'));
const [ax, ay, aw, ah] = w.area;
const nums = args.slice(1, 5).map(Number);
const [X0, Y0, CW, CH] = nums.length === 4 && nums.every(Number.isFinite) ? nums : [ax, ay, aw, ah];
const scale = Number(option(args, '--scale', '1'));
const idx = w.index;
const a = w.baked.world;

const image = (path: string): Canvas | null => {
  try {
    return Canvas.from(decodePng(readFileSync(path)));
  } catch {
    return null;
  }
};
const atlases = new Map<string, Canvas | null>();
const atlas = (district: string) => {
  if (!atlases.has(district)) {
    atlases.set(district, image(join(CONTENT_ROOT, 'art', district, 'tiles.png')));
  }
  return atlases.get(district)!;
};
const propsAtlas = image(join(CONTENT_ROOT, 'art', 'props.png'));
const sky = new Map<string, RGBA>();
for (const d of ['rooftops', 'warehouses', 'factory', 'sewer']) {
  try {
    const j = JSON.parse(readFileSync(join(CONTENT_ROOT, 'art', d, 'district.json'), 'utf8'));
    sky.set(d, [j.sky[0], j.sky[1], j.sky[2], 255]);
  } catch {
    sky.set(d, hex('#202028'));
  }
}
const districtAt = (x: number, y: number): string => {
  for (const r of idx.regions) {
    const q = r.rect;
    if (x >= q[0] && y >= q[1] && x < q[0] + q[2] && y < q[1] + q[3]) return r.district;
  }
  return 'rooftops';
};

const g = new Canvas(CW! * 32, CH! * 32);
const inArea = (x: number, y: number) => x >= ax && y >= ay && x < ax + aw && y < ay + ah;
const matAt = (x: number, y: number) => (inArea(x, y) ? a.materials[(y - ay) * aw + x - ax]! : 0);
for (let y = 0; y < CH!; y++) {
  for (let x = 0; x < CW!; x++) {
    const wx = X0! + x;
    const wy = Y0! + y;
    g.rect(x * 32, y * 32, 32, 32, sky.get(districtAt(wx, wy))!);
    const m = matAt(wx, wy);
    if (m === 0) continue;
    const def = idx.materials[m]!;
    const at = atlas(def.district);
    if (at === null) continue;
    const i = (wy - ay) * aw + wx - ax;
    const cls = a.cells[i]!;
    const [fx, fy] = frontRect(def.slot, w.baked.variants[i]! & 15);
    let y0 = 0;
    let y1 = 32;
    let src = 0;
    if (cls === Cell.HALF) [y0, src] = [16, -16];
    if (cls === Cell.SLAB) [y1, src] = [16, 16];
    if (cls === Cell.TOP) y1 = 8;
    for (let v = y0; v < y1; v++) {
      for (let u = 0; u < 32; u++) {
        if (cls === Cell.SLOPE_UP && u + v < 31) continue;
        if (cls === Cell.SLOPE_DOWN && v < u) continue;
        g.over(x * 32 + u, y * 32 + v, at.get(fx + u, fy + v + src));
      }
    }
  }
}
if (propsAtlas !== null) {
  for (const front of [false, true]) {
    for (const p of a.placements) {
      const def = idx.props[p.prop]!;
      if ((def.layer === 'front') !== front) continue;
      const [sx, sy, sw, sh] = def.sprite;
      g.blit(
        propsAtlas,
        (p.x - X0!) * 32 + def.offset[0],
        (p.y - Y0!) * 32 + def.offset[1],
        sx,
        sy,
        sw,
        sh,
      );
    }
  }
}
const box = (r: CellRect, col: RGBA, label: string) => {
  const x = (r[0] - X0!) * 32;
  const y = (r[1] - Y0!) * 32;
  const bw = r[2] * 32;
  const bh = r[3] * 32;
  for (let i = 0; i < bw; i++)
    for (const yy of [y, y + 1, y + bh - 2, y + bh - 1]) g.set(x + i, yy, col);
  for (let j = 0; j < bh; j++)
    for (const xx of [x, x + 1, x + bw - 2, x + bw - 1]) g.set(xx, y + j, col);
  g.rect(x + 2, y + 2, label.length * 4 + 4, 8, hex('#000000'));
  text(g, x + 4, y + 3, label, col);
};
for (const h of idx.hubs) box(h.rect, hex('#40ff60'), `hub ${h.id}`);
for (const r of idx.routes) {
  box(r.start, hex('#40c0ff'), `${r.id} start`);
  r.checkpoints.forEach((c, k) => box(c, hex('#ffc040'), `${r.id} ${k + 1}`));
  box(r.finish, hex('#ff6040'), `${r.id} finish`);
}
for (const f of idx.finds) box(f.rect, hex('#ff40ff'), f.id);
const white = hex('#ffffff');
for (let x = 0; x < CW!; x++) {
  if ((X0! + x) % 8 === 0) {
    g.rect(x * 32, 0, 1, 8, white);
    text(g, x * 32 + 2, 1, String(X0! + x), white);
  }
}
for (let y = 0; y < CH!; y++) {
  if ((Y0! + y) % 8 === 0) {
    g.rect(0, y * 32, 8, 1, white);
    text(g, 1, y * 32 + 2, String(Y0! + y), white);
  }
}
let outCanvas = g;
if (scale !== 1) {
  outCanvas = new Canvas(
    Math.max(1, Math.round(g.width * scale)),
    Math.max(1, Math.round(g.height * scale)),
  );
  for (let y = 0; y < outCanvas.height; y++) {
    for (let x = 0; x < outCanvas.width; x++) {
      outCanvas.set(x, y, g.get(Math.floor(x / scale), Math.floor(y / scale)));
    }
  }
}
writeFileSync(out, encodePng(outCanvas.image()));
console.log(
  `wrote ${out} (${CW} x ${CH} cells from ${X0},${Y0}, ${outCanvas.width} x ${outCanvas.height} px)`,
);
