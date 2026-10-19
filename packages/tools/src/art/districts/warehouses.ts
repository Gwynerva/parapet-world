// Warehouses: board-formed concrete, teal corrugated cladding, loading docks with hazard edges,
// orange-brown brick and yellow steel mezzanines; a port yard with a gantry crane behind rows of
// pallet racks at nightfall.
import { bands, lattice, layer } from '../backdrop.ts';
import { bevel, bricks, down, left, right, up, type DistrictArt } from '../district.ts';
import { CLEAR, Canvas, dither2, hash, hex, mix, ramp, step, type RGBA } from '../paint.ts';
import { rim, type MaterialArt } from '../tiles.ts';

/** Concrete, teal cladding, dock concrete, brick, mortar, yellow paint, galvanised steel, rubber. */
const CW = ramp('#2c2f36', '#454952', '#60656e', '#7b818a', '#959ba3', '#b2b7bd');
const TL = ramp('#1a2a32', '#28404c', '#365a68', '#4a7484', '#6290a0', '#86b0bc');
const DK = ramp('#25221f', '#3a3632', '#524d47', '#6a645c', '#837c72', '#9f978b');
const WB = ramp('#3e1e14', '#62301e', '#80422a', '#9a5434', '#b06840', '#c6824e');
const WM = ramp('#6a6058', '#8c8278', '#aaa094');
const YL = ramp('#4a3510', '#7a5a14', '#b08518', '#d9a520', '#f0c84a');
const GV = ramp('#3b4046', '#5f666d', '#848c93', '#a9b1b6', '#cdd3d5');
const RU = ramp('#0e0e10', '#1e1e22', '#303036', '#46464e');
const RS = ramp('#4a2414', '#6b3a1f', '#8f522c');

/** Board marks of the formwork: 8 px boards in two tones with a fine seam. */
const boards = (g: Canvas, x0: number, w: number): void => {
  for (let y = 0; y < 32; y++) {
    const board = y >> 3;
    const base = hash(board, 0, 2) < 0.5 ? CW[3]! : mix(CW[3]!, CW[2]!, 0.5);
    for (let x = x0; x < x0 + w; x++) {
      const k = y & 7;
      g.set(x, y, k === 7 ? CW[2]! : k === 0 ? CW[4]! : base);
    }
  }
  for (let b = 0; b < 4; b++) {
    const x = (b * 11 + 7) % 32;
    g.vline(x, b * 8 + 1, b * 8 + 6, CW[2]!);
  }
};

const concrete: MaterialArt = {
  id: 'wh.concrete',
  rimTop: rim(CW[0]!),
  rimSide: rim(CW[0]!),
  front(g, mask) {
    boards(g, 0, 32);
    // Form-tie holes where the boards were held.
    for (const [x, y] of [
      [9, 11],
      [25, 27],
    ] as const) {
      g.set(x, y, CW[1]!);
      g.set(x + 1, y + 1, CW[4]!);
    }
    bevel(g, mask, CW[4]!, CW[2]!);
    if (up(mask)) {
      // A steel nosing along the slab's edge.
      g.hline(0, 31, 1, GV[4]!);
      g.hline(0, 31, 2, GV[2]!);
      g.hline(0, 31, 3, GV[1]!);
      g.hline(0, 31, 4, CW[1]!);
      for (const x of [6, 22]) g.set(x, 2, GV[4]!);
    }
    if (down(mask)) {
      for (let x = 1; x < 31; x++) {
        g.set(x, 29, CW[2]!);
        if (dither2(x, 28) < 0.5) g.set(x, 28, CW[2]!);
      }
    }
  },
  top(g) {
    g.fill(CW[4]!);
    g.hline(0, 31, 1, GV[3]!);
    g.hline(0, 31, 2, CW[3]!);
    g.hline(0, 31, 4, YL[4]!);
    g.hline(0, 31, 5, YL[3]!);
    g.hline(0, 31, 6, YL[3]!);
    g.vline(31, 7, 15, CW[3]!);
    g.hline(0, 31, 15, CW[3]!);
  },
  side(g) {
    for (let y = 0; y < 32; y++) {
      const k = y & 7;
      g.hline(0, 15, y, k === 7 ? CW[2]! : k === 0 ? CW[4]! : CW[3]!);
    }
  },
};

/** Trapezoidal cladding profile by x % 16: a narrow lit rib, then a wide pan. */
const rib = (x: number): RGBA => {
  const k = x % 16;
  return k === 0
    ? TL[5]!
    : k < 3
      ? TL[4]!
      : k === 3
        ? TL[1]!
        : k === 4
          ? TL[2]!
          : k === 10
            ? TL[2]!
            : TL[3]!;
};

const corrugated: MaterialArt = {
  id: 'wh.corrugated',
  rimTop: rim(TL[0]!),
  rimSide: rim(TL[0]!),
  front(g, mask) {
    g.paint((x) => rib(x));
    for (let k = 0; k < 2; k++) {
      for (const y of [5, 21]) {
        g.set(k * 16 + 8, y, TL[5]!);
        g.set(k * 16 + 8, y + 1, TL[1]!);
      }
    }
    g.hline(0, 31, 13, TL[2]!);
    for (const [x, y] of [
      [21, 9],
      [22, 10],
      [23, 10],
      [6, 25],
    ] as const) {
      g.set(x, y, TL[4]!);
    }
    if (down(mask)) {
      for (const [x, n] of [
        [6, 5],
        [13, 3],
        [24, 6],
      ] as const) {
        for (let i = 0; i < n; i++) g.set(x, 30 - i, RS[i < 2 ? 1 : 2]!);
      }
      g.hline(1, 30, 30, TL[1]!);
    }
    if (up(mask)) {
      g.hline(1, 30, 1, GV[4]!);
      g.hline(1, 30, 2, GV[3]!);
      g.hline(1, 30, 3, GV[2]!);
      g.hline(1, 30, 4, TL[0]!);
    }
    if (left(mask)) {
      g.vline(1, 1, 30, GV[4]!);
      g.vline(2, 1, 30, GV[2]!);
      g.vline(3, 1, 30, TL[1]!);
    }
    if (right(mask)) {
      g.vline(29, 1, 30, GV[3]!);
      g.vline(30, 1, 30, GV[1]!);
    }
  },
  top(g) {
    g.paint((x) => {
      const k = x % 16;
      return k === 0 ? TL[5]! : k < 3 ? TL[4]! : k === 3 ? TL[2]! : TL[3]!;
    });
    g.hline(0, 31, 1, GV[3]!);
    g.hline(0, 31, 15, TL[2]!);
  },
  side(g) {
    g.fill(TL[3]!);
    g.hline(0, 15, 13, TL[2]!);
    g.hline(0, 15, 5, TL[4]!);
    g.hline(0, 15, 21, TL[4]!);
    g.vline(15, 0, 31, TL[2]!);
  },
};

const dock: MaterialArt = {
  id: 'wh.dock',
  rimTop: rim(DK[0]!),
  rimSide: rim(DK[0]!),
  front(g, mask) {
    g.fill(DK[3]!);
    for (const x of [7, 23]) {
      g.vline(x, 0, 31, DK[2]!);
      g.vline(x + 1, 0, 31, DK[4]!);
    }
    for (const [x, y] of [
      [14, 21],
      [15, 22],
      [15, 23],
      [16, 24],
      [3, 27],
      [27, 12],
    ] as const) {
      g.set(x, y, DK[2]!);
    }
    bevel(g, mask, DK[4]!, DK[2]!);
    if (up(mask)) {
      // A steel edge with warning stripes, and a rubber bumper below it.
      for (let y = 1; y < 5; y++)
        for (let x = 0; x < 32; x++) g.set(x, y, (x + y) % 8 < 4 ? YL[3]! : RU[1]!);
      g.hline(0, 31, 1, mix(YL[4]!, RU[2]!, 0.15));
      g.hline(0, 31, 5, DK[0]!);
      g.rect(10, 7, 12, 11, RU[1]!);
      g.hline(10, 21, 7, RU[3]!);
      g.vline(10, 7, 17, RU[2]!);
      g.hline(10, 21, 17, RU[0]!);
      for (const x of [12, 19]) {
        g.set(x, 9, GV[3]!);
        g.set(x, 15, GV[3]!);
      }
      g.hline(10, 21, 18, DK[1]!);
    }
    if (down(mask)) {
      for (let x = 1; x < 31; x++) if (dither2(x, 28) < 0.5) g.set(x, 28, DK[2]!);
      g.hline(1, 30, 29, DK[2]!);
    }
  },
  top(g) {
    g.fill(DK[4]!);
    for (let y = 1; y < 6; y++) {
      for (let x = 0; x < 32; x++) {
        g.set(x, y, (x + y * 3) % 6 === 0 ? GV[4]! : GV[2]!);
      }
    }
    g.hline(0, 31, 6, DK[2]!);
    g.vline(15, 7, 15, DK[3]!);
    g.hline(0, 31, 15, DK[3]!);
  },
  side(g) {
    g.fill(DK[3]!);
    g.vline(15, 0, 31, DK[2]!);
    g.hline(0, 15, 11, DK[2]!);
    g.hline(0, 15, 12, DK[4]!);
  },
};

const brickShade = (course: number, index: number): number => {
  const h = hash(index, course, 29);
  return h < 0.25 ? 2 : h < 0.8 ? 3 : 4;
};

/** English bond: courses of stretchers (8 px) alternate with courses of headers (4 px). */
const englishBond = (g: Canvas, y0: number, y1: number): void => {
  for (let y = y0; y <= y1; y++) {
    const course = y >> 2;
    const header = course % 2 === 1;
    bricks(
      g,
      0,
      y,
      32,
      1,
      { w: header ? 4 : 8, h: 4, shift: header ? 2 : 0 },
      WM[1]!,
      (c, i, px, py) => {
        const k = brickShade(c * 2 + (header ? 1 : 0), i);
        const last = (header ? 4 : 8) - 2;
        if (py === 0 && px < last) return WB[k + 1]!;
        if (px === last) return WB[k - 1]!;
        return WB[k]!;
      },
    );
  }
};

const brick: MaterialArt = {
  id: 'wh.brick',
  rimTop: rim(WB[0]!),
  rimSide: rim(WB[0]!),
  front(g, mask) {
    englishBond(g, 0, 31);
    if (up(mask)) {
      // A soldier course: bricks on end along the top.
      for (let y = 1; y < 9; y++) {
        for (let x = 0; x < 32; x++) {
          const k = x & 3;
          const i = brickShade(99, x >> 2);
          g.set(
            x,
            y,
            y === 8 || k === 3 ? WM[0]! : y === 1 ? WB[i + 1]! : k === 2 ? WB[i - 1]! : WB[i]!,
          );
        }
      }
    }
    if (left(mask)) for (let y = 1; y < 31; y++) g.set(1, y, step(g.get(1, y), 1, WB, WM));
    if (right(mask)) for (let y = 1; y < 31; y++) g.set(30, y, step(g.get(30, y), -1, WB, WM));
    if (down(mask)) {
      for (let x = 1; x < 31; x++) {
        g.set(x, 30, step(g.get(x, 30), -2, WB, WM));
        if (dither2(x, 29) < 0.5) g.set(x, 29, step(g.get(x, 29), -1, WB, WM));
      }
    }
  },
  top(g) {
    for (let x = 0; x < 32; x++) {
      const k = x & 3;
      const i = brickShade(99, x >> 2);
      g.vline(x, 1, 15, k === 3 ? WM[1]! : k === 2 ? WB[i]! : WB[i + 1]!);
    }
    g.hline(0, 31, 15, WB[2]!);
  },
  side(g) {
    for (let y = 0; y < 32; y++) {
      const py = y & 3;
      const i = brickShade(y >> 2, 3);
      g.hline(0, 15, y, py === 3 ? WM[1]! : py === 0 ? WB[i + 1]! : WB[i]!);
    }
  },
};

const DECK = 8;

const mezzanine: MaterialArt = {
  id: 'wh.mezzanine',
  deck: DECK,
  rimTop: rim(YL[0]!),
  rimSide: Array.from({ length: 32 }, (_, y) => (y < DECK ? YL[0]! : CLEAR)),
  front(g, mask) {
    g.rect(0, 0, 32, DECK, YL[3]!);
    g.hline(0, 31, 1, YL[4]!);
    g.hline(0, 31, 6, YL[2]!);
    g.hline(0, 31, 7, YL[1]!);
    for (const x of [7, 23]) {
      for (const y of [3, 4]) {
        g.set(x, y, YL[4]!);
        g.set(x + 1, y, YL[1]!);
      }
    }
    g.vline(15, 2, 5, YL[2]!);
    g.vline(16, 2, 5, YL[4]!);
    if (left(mask)) g.vline(1, 1, 6, YL[4]!);
    if (right(mask)) g.vline(30, 1, 6, YL[1]!);
  },
  top(g) {
    g.fill(GV[2]!);
    for (let y = 3; y < 15; y++) {
      for (let x = 0; x < 32; x++) {
        if (x % 8 === 1 && y % 8 === 3) g.set(x, y, GV[4]!);
        if (x % 8 === 2 && y % 8 === 4) g.set(x, y, GV[1]!);
        if (x % 8 === 5 && y % 8 === 7) g.set(x, y, GV[4]!);
        if (x % 8 === 6 && y % 8 === 0) g.set(x, y, GV[1]!);
      }
    }
    g.hline(0, 31, 1, YL[4]!);
    g.hline(0, 31, 2, YL[3]!);
    g.hline(0, 31, 15, GV[1]!);
  },
  side(g) {
    for (let x = 0; x < 16; x++) {
      g.set(x, 0, YL[1]!);
      g.set(x, 1, YL[4]!);
      for (let y = 2; y < 6; y++) g.set(x, y, YL[3]!);
      g.set(x, 6, YL[2]!);
      g.set(x, 7, YL[1]!);
    }
  },
};

/** Night falling over the port: indigo above, a last band of amber at the horizon. */
const SKY = ramp(
  '#1a1e34',
  '#20253e',
  '#282c48',
  '#323350',
  '#423a56',
  '#56425a',
  '#6c4a5a',
  '#8a5658',
  '#a86454',
);

const yardLayer = (): Canvas => {
  const g = layer(1024, 640);
  const horizon = 300;
  bands(g, SKY, [40, 80, 120, 160, 196, 230, 258, 282]);
  const far = hex('#22263a');
  const near = hex('#1a1d2c');
  const light = hex('#e8c070');
  g.rect(0, horizon, 1024, g.height - horizon, far);
  // Container stacks along the quay.
  for (let x = 0; x < 1024;) {
    const w = 36 + Math.floor(hash(x, 1, 3) * 60);
    const h = 8 * (1 + Math.floor(hash(x, 2, 3) * 4));
    g.rect(x, horizon - h, w, h, far);
    for (let y = horizon - h + 8; y < horizon; y += 8) g.hline(x, x + w - 1, y, hex('#2a2f45'));
    x += w + 2 + Math.floor(hash(x, 4, 3) * 18);
  }
  // Two gantry cranes: legs on rails, a high girder, a boom over the water.
  for (const cx of [180, 690]) {
    const top = 120;
    lattice(g, cx, horizon, cx + 18, top, 4, 9, near);
    lattice(g, cx + 90, horizon, cx + 72, top, 4, 9, near);
    lattice(g, cx - 120, top, cx + 210, top, 7, 10, near);
    g.rect(cx - 2, top - 30, 94, 30, near);
    g.rect(cx + 20, top - 46, 50, 16, near);
    g.rect(cx + 40, top + 8, 18, 10, near);
    g.vline(cx + 48, top + 18, top + 70, near);
    g.rect(cx + 36, top + 70, 26, 12, near);
    g.hline(cx - 30, cx + 120, horizon - 1, near);
    g.set(cx - 120, top - 1, hex('#ff4a3a'));
    g.set(cx + 210, top - 1, hex('#ff4a3a'));
    for (let x = cx + 6; x < cx + 88; x += 8) g.set(x, top - 20, light);
  }
  for (let x = 0; x < 1024; x += 37) g.set(x, horizon - 2 - (x % 5), light);
  return g;
};

const racksLayer = (): Canvas => {
  const g = layer(1024, 768);
  const frame = hex('#1e2638');
  const frameLit = hex('#2c3850');
  const beam = hex('#6a3a20');
  const beamLit = hex('#8a4e2a');
  const boxes = ramp('#3a2e26', '#4a3a2e', '#5a4836', '#2e3442');
  for (let x0 = 0; x0 < 1024; x0 += 256) {
    // A run of rack bays 160 px long; the rest is an aisle.
    const top = 120 + ((x0 >> 8) % 2) * 24;
    for (let x = x0; x <= x0 + 160; x += 40) {
      g.rect(x, top, 4, g.height - top, frame);
      g.vline(x, top, g.height - 1, frameLit);
    }
    for (let y = top; y < g.height; y += 64) {
      g.rect(x0, y, 164, 4, beam);
      g.hline(x0, x0 + 163, y, beamLit);
      for (let x = x0 + 4; x < x0 + 160; x += 40) {
        let bx = x + 2;
        while (bx < x + 34) {
          const w = 14 + Math.floor(hash(bx, y, 7) * 12);
          const h = 14 + Math.floor(hash(bx, y, 8) * 18);
          if (bx + w > x + 36) break;
          const c = boxes[Math.floor(hash(bx, y, 9) * 4)]!;
          g.rect(bx, y - h - 3, w, h, c);
          g.hline(bx, bx + w - 1, y - 3, hex('#4a3420'));
          g.hline(bx + 1, bx + w - 2, y - 2, hex('#2a1e14'));
          g.hline(bx, bx + w - 1, y - h - 3, mix(c, hex('#ffffff'), 0.12));
          g.vline(bx + w - 1, y - h - 3, y - 4, mix(c, hex('#000000'), 0.3));
          bx += w + 1;
        }
      }
    }
  }
  return g;
};

export const warehouses: DistrictArt = {
  id: 'warehouses',
  name: 'Warehouses',
  sky: [0x1a, 0x1e, 0x34],
  ambience: 'warehouses.yard',
  materials: [concrete, corrugated, dock, brick, mezzanine],
  layers: [
    { file: 'bg-0.png', factor: 0.1, y: 60, paint: yardLayer },
    { file: 'bg-1.png', factor: 0.3, y: 537, paint: racksLayer },
  ],
  room: {
    worldY: 2496,
    rows: [
      '......................',
      '......................',
      '......................',
      '.............Hwwwwwwww',
      '.............Hwwwwwwww',
      '.............Hww......',
      '.............Hww.=====',
      '.............Hbb......',
      'dddd.........Hbb......',
      'dddd.......nxHbb......',
      '######################',
      '######################',
    ],
    props: [
      ['hub.sign.warehouses', 1, 6],
      ['container', 4, 8],
      ['container.blue', 5, 6],
      ['barrel', 10, 9],
      ['forklift', 16, 8],
      ['pallet', 19, 9],
      ['rack', 19, 7],
    ],
    runner: [250, 192],
  },
};
