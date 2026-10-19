// Factory floor: riveted steel plates, grated catwalks, yellow girders, sooty brick and worn
// concrete inside a hall with tall windows, light shafts and machine silhouettes.
import { layer, lattice } from '../backdrop.ts';
import { bevel, bricks, down, left, right, up, type DistrictArt } from '../district.ts';
import { CLEAR, Canvas, dither2, dither4, hash, hex, ramp, step, withAlpha } from '../paint.ts';
import { rim, type MaterialArt } from '../tiles.ts';

/** Steel plate, grating, girder paint, brick, mortar and concrete ramps, dark to light. */
const SP = ramp('#1c2027', '#2c323b', '#3e4651', '#525c69', '#687483', '#8590a0');
const GR = ramp('#15181d', '#23282f', '#363d47', '#4c5562', '#66717f', '#86919e');
const BM = ramp('#3a2408', '#6a4210', '#946018', '#b67a22', '#d29a32', '#e8bc58');
const FB = ramp('#2a1612', '#44221a', '#5c2e22', '#743a2a', '#8a4834', '#a05a40');
const FM = ramp('#3a3230', '#524844', '#6a5e58');
const FC = ramp('#2e2c29', '#4a4743', '#66625c', '#7f7a72', '#9a948a', '#b6afa3');

const plate: MaterialArt = {
  id: 'fac.plate',
  rimTop: rim(SP[0]!),
  rimSide: rim(SP[0]!),
  front(g, mask) {
    g.fill(SP[3]!);
    // Plates meet on the cell borders: lit on their top and left edges, dark on the others.
    g.hline(0, 31, 0, SP[4]!);
    g.vline(0, 0, 31, SP[4]!);
    g.hline(0, 31, 31, SP[1]!);
    g.vline(31, 0, 31, SP[1]!);
    for (const x of [3, 9, 15, 21, 27]) {
      for (const y of [3, 28]) {
        g.set(x, y, SP[5]!);
        g.set(x + 1, y + 1, SP[1]!);
      }
    }
    for (const y of [9, 15, 21]) {
      for (const x of [3, 27]) {
        g.set(x, y, SP[5]!);
        g.set(x + 1, y + 1, SP[1]!);
      }
    }
    for (const [x0, y0, n] of [
      [10, 10, 4],
      [17, 18, 3],
      [21, 9, 2],
    ] as const) {
      for (let i = 0; i < n; i++) g.set(x0 + i, y0 - i, SP[4]!);
    }
    for (let y = 20; y < 26; y++) {
      for (let x = 12; x < 22; x++) {
        const d = ((x - 16.5) / 5) ** 2 + ((y - 23) / 3) ** 2;
        if (d < 1 && dither2(x, y) < 1.1 - d) g.set(x, y, SP[2]!);
      }
    }
    bevel(g, mask, SP[5]!, SP[1]!);
    if (up(mask)) g.hline(1, 30, 2, SP[4]!);
  },
  top(g) {
    g.fill(SP[4]!);
    g.hline(0, 31, 1, SP[5]!);
    g.vline(31, 1, 15, SP[2]!);
    g.vline(0, 1, 15, SP[5]!);
    for (const x of [8, 24]) {
      g.set(x, 4, SP[5]!);
      g.set(x, 12, SP[5]!);
    }
    g.hline(0, 31, 15, SP[3]!);
  },
  side(g) {
    g.fill(SP[3]!);
    g.hline(0, 15, 31, SP[1]!);
    g.hline(0, 15, 0, SP[4]!);
    for (const y of [3, 28]) g.hline(0, 15, y, SP[4]!);
  },
};

const GDECK = 8;

const grate: MaterialArt = {
  id: 'fac.grate',
  deck: GDECK,
  rimTop: rim(GR[0]!),
  rimSide: Array.from({ length: 32 }, (_, y) => (y < GDECK ? GR[0]! : CLEAR)),
  front(g, mask) {
    g.rect(0, 0, 32, GDECK, GR[3]!);
    g.hline(0, 31, 1, GR[5]!);
    for (let x = 0; x < 32; x++) {
      for (const y of [2, 3, 4, 5]) g.set(x, y, x % 3 === 0 ? GR[1]! : y === 2 ? GR[4]! : GR[3]!);
    }
    g.hline(0, 31, 6, GR[2]!);
    g.hline(0, 31, 7, GR[1]!);
    if (left(mask)) g.vline(1, 1, 6, GR[5]!);
    if (right(mask)) g.vline(30, 1, 6, GR[1]!);
  },
  top(g) {
    g.paint((x) => (x % 3 === 0 ? GR[4]! : GR[1]!));
    for (const y of [1, 8]) g.hline(0, 31, y, GR[3]!);
    g.hline(0, 31, 15, GR[2]!);
  },
  side(g) {
    for (let x = 0; x < 16; x++) {
      g.set(x, 0, GR[1]!);
      g.set(x, 1, GR[5]!);
      for (let y = 2; y < 6; y++) g.set(x, y, GR[3]!);
      g.set(x, 6, GR[2]!);
      g.set(x, 7, GR[1]!);
    }
  },
};

const beam: MaterialArt = {
  id: 'fac.beam',
  rimTop: rim(BM[0]!),
  rimSide: rim(BM[0]!),
  front(g, mask) {
    g.fill(BM[3]!);
    // A stiffener plate down the middle and rivet rows along the flanges.
    g.vline(14, 0, 31, BM[4]!);
    g.vline(15, 0, 31, BM[3]!);
    g.vline(16, 0, 31, BM[3]!);
    g.vline(17, 0, 31, BM[1]!);
    for (const x of [4, 9, 22, 27]) {
      for (const y of [4, 27]) {
        g.set(x, y, BM[5]!);
        g.set(x + 1, y + 1, BM[1]!);
      }
    }
    for (const y of [10, 16, 22]) {
      g.set(15, y, BM[5]!);
      g.set(16, y + 1, BM[1]!);
    }
    for (const [x, y] of [
      [6, 14],
      [7, 14],
      [24, 19],
      [25, 20],
    ] as const) {
      g.set(x, y, SP[2]!);
    }
    bevel(g, mask, BM[5]!, BM[1]!);
    if (up(mask)) {
      g.hline(1, 30, 2, BM[4]!);
      g.hline(1, 30, 3, BM[4]!);
      g.hline(1, 30, 4, BM[1]!);
      for (const x of [3, 4, 11, 26, 27, 28]) g.set(x, 1, SP[3]!);
    }
    if (down(mask)) {
      g.hline(1, 30, 27, BM[5]!);
      g.hline(1, 30, 28, BM[3]!);
      g.hline(1, 30, 29, BM[2]!);
      for (const x of [5, 18, 19]) g.set(x, 30, SP[2]!);
    }
    if (left(mask) && up(mask)) {
      g.set(1, 1, SP[3]!);
      g.set(2, 1, SP[2]!);
      g.set(1, 2, SP[2]!);
    }
  },
  top(g) {
    g.fill(BM[4]!);
    g.hline(0, 31, 1, BM[5]!);
    g.vline(15, 1, 15, BM[3]!);
    g.vline(16, 1, 15, BM[5]!);
    for (const x of [6, 25]) {
      g.set(x, 5, BM[5]!);
      g.set(x, 11, BM[5]!);
    }
    g.hline(0, 31, 15, BM[2]!);
  },
  side(g) {
    g.fill(BM[3]!);
    g.hline(0, 15, 4, BM[5]!);
    g.hline(0, 15, 27, BM[5]!);
    g.vline(15, 0, 31, BM[2]!);
  },
};

const brickShade = (course: number, index: number): number => {
  const h = hash(index, course, 47);
  return h < 0.3 ? 2 : h < 0.85 ? 3 : 4;
};

const brick: MaterialArt = {
  id: 'fac.brick',
  rimTop: rim(FB[0]!),
  rimSide: rim(FB[0]!),
  front(g, mask) {
    for (let y = 0; y < 32; y++) {
      const course = y >> 2;
      const header = course % 2 === 1;
      bricks(
        g,
        0,
        y,
        32,
        1,
        { w: header ? 4 : 8, h: 4, shift: header ? 2 : 0 },
        FM[1]!,
        (c, i, px, py) => {
          const k = brickShade(c * 2 + (header ? 1 : 0), i);
          const last = (header ? 4 : 8) - 2;
          if (py === 0 && px < last) return FB[k + 1]!;
          if (px === last) return FB[k - 1]!;
          return FB[k]!;
        },
      );
    }
    if (left(mask)) for (let y = 1; y < 31; y++) g.set(1, y, step(g.get(1, y), 1, FB, FM));
    if (right(mask)) for (let y = 1; y < 31; y++) g.set(30, y, step(g.get(30, y), -1, FB, FM));
    if (up(mask)) {
      // Soot gathers under a cap of grey concrete.
      for (let y = 4; y < 14; y++) {
        for (let x = 1; x < 31; x++) {
          if (dither4(x, y) < (14 - y) / 12) g.set(x, y, step(g.get(x, y), -2, FB, FM));
        }
      }
      g.hline(1, 30, 1, FC[4]!);
      g.hline(1, 30, 2, FC[3]!);
      g.hline(1, 30, 3, FC[1]!);
    }
    if (down(mask)) g.hline(1, 30, 30, FB[1]!);
  },
  top(g) {
    g.fill(FC[3]!);
    g.hline(0, 31, 1, FC[4]!);
    g.vline(19, 1, 15, FC[2]!);
    g.hline(0, 31, 15, FC[2]!);
  },
  side(g) {
    for (let y = 0; y < 32; y++) {
      const py = y & 3;
      const k = brickShade(y >> 2, 5);
      g.hline(0, 15, y, py === 3 ? FM[1]! : py === 0 ? FB[k + 1]! : FB[k]!);
    }
  },
};

const concrete: MaterialArt = {
  id: 'fac.concrete',
  rimTop: rim(FC[0]!),
  rimSide: rim(FC[0]!),
  front(g, mask) {
    g.fill(FC[3]!);
    for (const y of [10, 21]) {
      g.hline(0, 31, y, FC[2]!);
      g.hline(0, 31, y + 1, FC[4]!);
    }
    for (let y = 23; y < 31; y++) {
      for (let x = 3; x < 13; x++) {
        const d = ((x - 7.5) / 5) ** 2 + ((y - 27) / 4) ** 2;
        if (d < 1 && dither2(x, y) < 1 - d * 0.8) g.set(x, y, FC[2]!);
      }
    }
    g.set(24, 5, FC[2]!);
    g.set(25, 6, FC[2]!);
    g.set(25, 7, FC[2]!);
    bevel(g, mask, FC[4]!, FC[2]!);
    if (up(mask)) {
      g.hline(1, 30, 1, FC[5]!);
      g.hline(1, 30, 2, FC[4]!);
    }
  },
  top(g) {
    g.fill(FC[4]!);
    g.hline(0, 31, 1, FC[5]!);
    for (let x = 0; x < 32; x++) {
      const on = (x >> 2) % 2 === 0;
      g.set(x, 4, on ? hex('#d8d4c8') : FC[4]!);
      g.set(x, 5, on ? hex('#c4c0b4') : FC[4]!);
    }
    g.vline(23, 7, 15, FC[3]!);
    g.hline(0, 31, 15, FC[3]!);
  },
  side(g) {
    g.fill(FC[3]!);
    for (const y of [10, 21]) {
      g.hline(0, 15, y, FC[2]!);
      g.hline(0, 15, y + 1, FC[4]!);
    }
  },
};

const wallLayer = (): Canvas => {
  const g = layer(1024, 640);
  const brickA = hex('#2e1c18');
  const brickB = hex('#26171a');
  const mortar = hex('#1c1416');
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < 1024; x++) {
      const course = y >> 2;
      const off = course % 2 ? 4 : 0;
      g.set(
        x,
        y,
        y % 4 === 3 || (x + off) % 8 === 7
          ? mortar
          : hash((x + off) >> 3, course, 5) < 0.5
            ? brickA
            : brickB,
      );
    }
  }
  const frame = hex('#141a22');
  const paneA = hex('#6c8294');
  const paneB = hex('#8ea2b2');
  const paneDark = hex('#3a4858');
  const shaft = withAlpha(hex('#f0e2b8'), 26);
  for (let wx = 36; wx < 1024; wx += 128) {
    const top = 50;
    const bottom = 270;
    // A tall steel-framed window with a round head.
    for (let y = top; y < bottom; y++) {
      for (let x = wx; x < wx + 56; x++) {
        const head = y < top + 28 && Math.hypot(x - (wx + 27.5), y - (top + 28)) > 28;
        if (head) continue;
        const mullion = (x - wx) % 9 === 0 || (y - top) % 12 === 0 || x === wx + 55;
        const k = hash((x - wx) / 9, (y - top) / 12, wx);
        g.set(x, y, mullion ? frame : k < 0.12 ? paneDark : (x - wx) % 9 < 3 ? paneB : paneA);
      }
    }
    g.rect(wx - 4, bottom, 64, 4, hex('#4a4440'));
    g.hline(wx - 4, wx + 59, bottom, hex('#6a625a'));
    // Its light falls down to the right.
    for (let y = bottom + 4; y < g.height; y++) {
      const d = (y - bottom) * 0.55;
      for (let x = Math.round(wx + d); x < wx + 56 + d; x++) g.over(x, y, shaft);
      for (let x = Math.round(wx + 12 + d); x < wx + 40 + d; x++) g.over(x, y, shaft);
    }
    g.rect(wx + 76, 0, 12, g.height, hex('#1a1c22'));
    g.vline(wx + 76, 0, g.height - 1, hex('#2a2e36'));
  }
  return g;
};

const machinesLayer = (): Canvas => {
  const g = layer(1024, 896);
  const body = hex('#1e232c');
  const lit = hex('#323a48');
  // The overhead crane's girder across the hall, with a trolley and a hook.
  g.rect(0, 60, 1024, 12, body);
  g.hline(0, 1023, 60, lit);
  for (let x = 0; x < 1024; x += 16) g.vline(x, 61, 71, hex('#262c36'));
  for (const tx of [220, 760]) {
    g.rect(tx, 72, 40, 14, body);
    g.vline(tx + 18, 86, 180, body);
    g.vline(tx + 22, 86, 180, body);
    g.rect(tx + 12, 180, 16, 12, body);
    g.rect(tx + 17, 192, 6, 10, body);
  }
  // Machines along the floor: presses, a boiler, a chimney stack.
  for (let x = 0; x < 1024;) {
    const kind = Math.floor(hash(x, 0, 13) * 3);
    const w = kind === 0 ? 70 : kind === 1 ? 110 : 44;
    const h = kind === 0 ? 170 : kind === 1 ? 120 : 260;
    const top = g.height - 100 - h;
    if (kind === 0) {
      g.rect(x, top, w, 50, body);
      g.rect(x + 8, top + 50, 10, h - 50, body);
      g.rect(x + w - 18, top + 50, 10, h - 50, body);
      g.rect(x, top + h - 40, w, 140, body);
      g.vline(x, top, top + 49, lit);
    } else if (kind === 1) {
      for (let y = top; y < g.height; y++) {
        const r = y < top + 24 ? Math.sqrt(Math.max(0, 24 * 24 - (top + 24 - y) ** 2)) : 24;
        g.hline(x + 55 - Math.round(r * 2.2), x + 55 + Math.round(r * 2.2), y, body);
      }
      g.rect(x + 20, top - 30, 8, 30, body);
    } else {
      g.rect(x + 8, top, 28, g.height - top, body);
      g.rect(x + 4, top, 36, 6, body);
      g.vline(x + 8, top, g.height - 1, lit);
    }
    x += w + 30 + Math.floor(hash(x, 1, 13) * 40);
  }
  return g;
};

const nearLayer = (): Canvas => {
  const g = layer(1024, 1344);
  const body = hex('#101318');
  const lit = hex('#262c36');
  const ceiling = 200;
  // Riser pipes from floor to roof, a roof truss, a pipe run and two hanging lamps.
  for (const px of [130, 610]) {
    g.rect(px, 0, 14, g.height, body);
    g.vline(px + 2, 0, g.height - 1, lit);
    g.rect(px + 20, 0, 8, g.height, body);
    for (let y = 40; y < g.height; y += 96) g.rect(px - 3, y, 34, 6, body);
  }
  lattice(g, 0, ceiling - 30, 1024, ceiling - 30, 12, 16, body);
  g.rect(0, ceiling + 70, 1024, 10, body);
  g.hline(0, 1023, ceiling + 71, lit);
  for (const lx of [330, 880]) {
    g.vline(lx, ceiling - 18, ceiling + 130, body);
    for (let y = ceiling + 130; y < ceiling + 146; y++) {
      const half = Math.round((y - ceiling - 130) * 0.9) + 3;
      g.hline(lx - half, lx + half, y, body);
    }
    g.hline(lx - 4, lx + 4, ceiling + 146, hex('#ffe4a0'));
    g.hline(lx - 2, lx + 2, ceiling + 147, hex('#fff4d0'));
    for (let y = ceiling + 148; y < ceiling + 310; y++) {
      const half = 6 + (y - ceiling - 148) * 0.42;
      for (let x = Math.round(lx - half); x <= lx + half; x++) {
        g.over(x, y, withAlpha(hex('#ffe8b0'), 20));
      }
    }
  }
  return g;
};

export const factory: DistrictArt = {
  id: 'factory',
  name: 'Factory Floor',
  sky: [0x14, 0x16, 0x1c],
  ambience: 'factory.hum',
  materials: [plate, grate, beam, brick, concrete],
  layers: [
    { file: 'bg-0.png', factor: 0.1, y: 60, paint: wallLayer },
    { file: 'bg-1.png', factor: 0.25, y: 144, paint: machinesLayer },
    { file: 'bg-2.png', factor: 0.45, y: 360, paint: nearLayer },
  ],
  room: {
    worldY: 2496,
    rows: [
      'bbbbbbbbbbbbbbbbbbbbbb',
      '...y.........y........',
      '...y.........y........',
      '...y.=====...y........',
      '...y.........y--------',
      '...y......P..y........',
      '...H......P..y........',
      '...H......P......kk...',
      '...H......P......kk...',
      '...H......Po.....kk...',
      '######################',
      'kkkkkkkkkkkkkkkkkkkkkk',
    ],
    props: [
      ['catwalk.rail', 5, 3],
      ['chain', 12, 1],
      ['chain', 12, 2],
      ['chain.hook', 12, 3],
      ['machine', 4, 8],
      ['crate', 12, 9],
      ['conveyor', 13, 9],
      ['press', 19, 7],
    ],
    runner: [220, 96],
  },
};
