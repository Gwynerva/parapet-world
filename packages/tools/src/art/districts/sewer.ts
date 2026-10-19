// Sewer: wet brown brick, mossy concrete walkways, cast-iron grates, rough stone and sewage
// channels under brick tunnel arches. Desaturated greens and browns, dark.
import { layer } from '../backdrop.ts';
import { bevel, bricks, down, left, right, up, type DistrictArt } from '../district.ts';
import {
  CLEAR,
  Canvas,
  dither2,
  dither4,
  hash,
  hex,
  mix,
  ramp,
  step,
  withAlpha,
} from '../paint.ts';
import { rim, type MaterialArt } from '../tiles.ts';

/** Brick, mortar, concrete, cast iron, stone, sewage and moss ramps, dark to light. */
const SB = ramp('#1c1410', '#2e2018', '#402c20', '#54382a', '#684634', '#7e5840');
const SM = ramp('#26261e', '#36362a', '#484838');
const SC = ramp('#22261f', '#363b33', '#4c5248', '#62695d', '#7a8274', '#949c8c');
const CI = ramp('#141614', '#22261f', '#33382f', '#454b40', '#5c6355', '#767e6c');
const SS = ramp('#1e1d1a', '#302e29', '#43403a', '#57534b', '#6d685e', '#857f73');
const LQ = ramp('#1c2410', '#2a3616', '#3a4a1c', '#4a5e22', '#5e742a', '#7a8e36');
const MOSS = ramp('#232d14', '#34431c', '#4a5c26', '#627832');
const WET = hex('#9a8a72');

const brickShade = (course: number, index: number): number => {
  const h = hash(index, course, 53);
  return h < 0.3 ? 2 : h < 0.8 ? 3 : 4;
};

const brick: MaterialArt = {
  id: 'sew.brick',
  rimTop: rim(SB[0]!),
  rimSide: rim(SB[0]!),
  front(g, mask) {
    bricks(g, 0, 0, 32, 32, { w: 8, h: 4 }, SM[1]!, (course, index, px, py) => {
      const i = brickShade(course, index);
      if (py === 0 && px === 1 && hash(index, course, 59) < 0.35) return WET;
      if (py === 0 && px < 6) return SB[i + 1]!;
      if (px === 6) return SB[i - 1]!;
      return SB[i]!;
    });
    // Moss in a few mortar joints.
    for (const [x, y] of [
      [7, 3],
      [6, 3],
      [19, 11],
      [20, 11],
      [3, 19],
      [27, 23],
      [28, 23],
    ] as const) {
      g.set(x, y, MOSS[1]!);
    }
    if (left(mask)) for (let y = 1; y < 31; y++) g.set(1, y, step(g.get(1, y), 1, SB, SM));
    if (right(mask)) for (let y = 1; y < 31; y++) g.set(30, y, step(g.get(30, y), -1, SB, SM));
    if (up(mask)) {
      g.hline(1, 30, 1, SB[5]!);
      for (let x = 1; x < 31; x++) g.set(x, 2, step(g.get(x, 2), 1, SB, SM));
    }
    if (down(mask)) {
      // Slime where the water splashes.
      for (let y = 24; y < 31; y++) {
        for (let x = 1; x < 31; x++) {
          if (dither4(x, y) < (y - 23) / 8)
            g.set(x, y, y > 28 ? MOSS[0]! : MOSS[(x + y) % 3 ? 1 : 2]!);
        }
      }
    }
  },
  top(g) {
    for (let x = 0; x < 32; x++) {
      const i = brickShade(x >> 3, 7);
      g.vline(x, 1, 15, x % 8 === 7 ? SM[1]! : x % 8 === 0 ? SB[i + 1]! : SB[i]!);
    }
    g.hline(0, 31, 1, SB[5]!);
    g.hline(0, 31, 15, SB[2]!);
  },
  side(g) {
    for (let y = 0; y < 32; y++) {
      const py = y & 3;
      const i = brickShade(y >> 2, 9);
      g.hline(0, 15, y, py === 3 ? SM[1]! : py === 0 ? SB[i + 1]! : SB[i]!);
    }
  },
};

const concrete: MaterialArt = {
  id: 'sew.concrete',
  rimTop: rim(SC[0]!),
  rimSide: rim(SC[0]!),
  front(g, mask) {
    g.fill(SC[3]!);
    g.hline(0, 31, 15, SC[1]!);
    g.hline(0, 31, 16, SC[4]!);
    // Water stains running down from the joints.
    for (const [x, y0, n] of [
      [5, 17, 9],
      [6, 17, 4],
      [18, 0, 12],
      [26, 17, 6],
    ] as const) {
      for (let i = 0; i < n; i++) if (i < n - 3 || i % 2 === 0) g.set(x, y0 + i, SC[2]!);
    }
    for (const [x, y] of [
      [11, 14],
      [12, 14],
      [13, 14],
      [24, 14],
    ] as const) {
      g.set(x, y, MOSS[2]!);
    }
    bevel(g, mask, SC[4]!, SC[2]!);
    if (up(mask)) {
      // A rounded edge, and moss where the walkway meets the wall.
      g.hline(1, 30, 1, SC[5]!);
      g.hline(1, 30, 2, SC[4]!);
      g.hline(1, 30, 4, SC[2]!);
    }
    if (down(mask)) {
      for (let x = 1; x < 31; x++) {
        g.set(x, 29, MOSS[1]!);
        if (dither2(x, 28) < 0.5) g.set(x, 28, MOSS[2]!);
        if (dither2(x, 27) < 0.25) g.set(x, 27, SC[2]!);
      }
    }
  },
  top(g) {
    g.fill(SC[4]!);
    g.hline(0, 31, 1, SC[5]!);
    for (let y = 6; y < 11; y++) {
      for (let x = 6; x < 22; x++) {
        const d = ((x - 13.5) / 8) ** 2 + ((y - 8) / 2.6) ** 2;
        if (d < 1) g.set(x, y, d < 0.4 ? SC[2]! : SC[3]!);
      }
    }
    g.set(10, 7, SC[5]!);
    g.hline(0, 31, 15, MOSS[1]!);
    g.hline(0, 31, 14, SC[3]!);
  },
  side(g) {
    g.fill(SC[3]!);
    g.hline(0, 15, 15, SC[1]!);
    g.hline(0, 15, 16, SC[4]!);
    g.hline(0, 15, 29, MOSS[1]!);
  },
};

const GDECK = 8;

const grate: MaterialArt = {
  id: 'sew.grate',
  deck: GDECK,
  rimTop: rim(CI[0]!),
  rimSide: Array.from({ length: 32 }, (_, y) => (y < GDECK ? CI[0]! : CLEAR)),
  front(g, mask) {
    g.rect(0, 0, 32, GDECK, CI[3]!);
    g.hline(0, 31, 1, CI[5]!);
    for (let x = 0; x < 32; x++) {
      for (const y of [2, 3, 4, 5]) {
        const slot = x % 4 === 1 || x % 4 === 2;
        g.set(x, y, slot && y > 2 ? CI[0]! : y === 2 ? CI[4]! : CI[3]!);
      }
    }
    g.hline(0, 31, 6, CI[2]!);
    g.hline(0, 31, 7, CI[1]!);
    for (const [x, y] of [
      [9, 5],
      [10, 5],
      [25, 4],
    ] as const) {
      g.set(x, y, hex('#6b3a1f'));
    }
    if (left(mask)) g.vline(1, 1, 6, CI[5]!);
    if (right(mask)) g.vline(30, 1, 6, CI[1]!);
  },
  top(g) {
    g.paint((x, y) => {
      const slot = x % 4 === 1 || x % 4 === 2;
      if (y === 1 || y === 8 || y === 15) return CI[y === 1 ? 4 : 3]!;
      return slot ? CI[0]! : x % 4 === 0 ? CI[4]! : CI[3]!;
    });
  },
  side(g) {
    for (let x = 0; x < 16; x++) {
      g.set(x, 0, CI[1]!);
      g.set(x, 1, CI[5]!);
      for (let y = 2; y < 6; y++) g.set(x, y, CI[3]!);
      g.set(x, 6, CI[2]!);
      g.set(x, 7, CI[1]!);
    }
  },
};

const stone: MaterialArt = {
  id: 'sew.stone',
  rimTop: rim(SS[0]!),
  rimSide: rim(SS[0]!),
  front(g, mask) {
    // Ashlar blocks 16 x 16 in a stagger: lit top and left edges, dark joints, chisel marks.
    for (let y = 0; y < 32; y++) {
      const course = y >> 4;
      const off = course % 2 ? 8 : 0;
      for (let x = 0; x < 32; x++) {
        const bx = (x + off) & 15;
        const by = y & 15;
        const block = ((x + off) >> 4) & 1;
        const tone = hash(block, course, 61) < 0.5 ? 3 : 2;
        let c = SS[tone]!;
        if (bx === 15 || by === 15) c = SS[0]!;
        else if (by === 0 || bx === 0) c = SS[tone + 2]!;
        else if (bx === 14 || by === 14) c = SS[tone - 1]!;
        else if ((bx * 3 + by * 5 + block * 7) % 13 === 0) c = SS[tone - 1]!;
        g.set(x, y, c);
      }
    }
    for (const [x, y] of [
      [7, 31],
      [8, 31],
      [23, 15],
      [24, 15],
      [15, 23],
    ] as const) {
      g.set(x, y, MOSS[1]!);
    }
    if (left(mask)) for (let y = 1; y < 31; y++) g.set(1, y, step(g.get(1, y), 1, SS));
    if (right(mask)) for (let y = 1; y < 31; y++) g.set(30, y, step(g.get(30, y), -1, SS));
    if (up(mask)) g.hline(1, 30, 1, SS[5]!);
    if (down(mask)) {
      for (let x = 1; x < 31; x++) if (dither2(x, 29) < 0.5) g.set(x, 29, MOSS[0]!);
    }
  },
  top(g) {
    for (let x = 0; x < 32; x++) {
      const bx = x & 15;
      g.vline(x, 1, 15, bx === 15 ? SS[1]! : bx === 0 ? SS[5]! : SS[4]!);
    }
    g.hline(0, 31, 1, SS[5]!);
    g.hline(0, 31, 15, SS[2]!);
  },
  side(g) {
    for (let y = 0; y < 32; y++) {
      const by = y & 15;
      g.hline(0, 15, y, by === 15 ? SS[0]! : by === 0 ? SS[5]! : by === 14 ? SS[2]! : SS[3]!);
    }
  },
};

const sewage: MaterialArt = {
  id: 'sew.sewage',
  rimTop: rim(LQ[1]!),
  rimSide: rim(LQ[1]!),
  front(g, mask) {
    // Two flat bands, darker below, joined by a two-row dither.
    g.fill(LQ[2]!);
    for (let y = 12; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (y > 13 || dither2(x, y) < (y === 12 ? 0.25 : 0.5)) g.set(x, y, LQ[1]!);
      }
    }
    // Long slow ripples: a lit line with its trough under it.
    for (const [x0, y, n] of [
      [3, 6, 9],
      [19, 9, 7],
      [11, 16, 10],
      [26, 24, 8],
      [5, 28, 6],
    ] as const) {
      for (let i = 0; i < n; i++) {
        g.set((x0 + i) % 32, y, y < 12 ? LQ[3]! : LQ[2]!);
        if (i > 1 && i < n - 2) g.set((x0 + i) % 32, y + 1, LQ[0]!);
      }
    }
    for (const [x, y] of [
      [9, 3],
      [24, 14],
    ] as const) {
      g.set(x, y, LQ[4]!);
      g.set(x - 1, y + 1, LQ[3]!);
      g.set(x + 1, y + 1, LQ[3]!);
      g.set(x, y + 1, LQ[1]!);
    }
    if (up(mask)) {
      // Scum and foam on the surface.
      for (let x = 1; x < 31; x++) {
        const h = hash(x >> 2, 0, 67);
        g.set(x, 1, h < 0.45 ? LQ[5]! : LQ[4]!);
        g.set(x, 2, h < 0.3 ? LQ[4]! : LQ[3]!);
        g.set(x, 3, LQ[3]!);
      }
      for (const x of [6, 7, 19, 26]) g.set(x, 2, mix(LQ[5]!, hex('#d8d0a0'), 0.4));
    }
  },
  top(g) {
    g.fill(LQ[3]!);
    g.hline(0, 31, 1, LQ[5]!);
    for (let x = 0; x < 32; x += 8) g.hline(x, x + 3, 6, LQ[4]!);
    g.hline(0, 31, 15, LQ[2]!);
  },
  side(g) {
    g.fill(LQ[2]!);
    g.hline(0, 15, 1, LQ[4]!);
    for (let y = 12; y < 32; y++) g.hline(0, 15, y, y < 14 ? LQ[2]! : LQ[1]!);
  },
};

const BRICK_BG = ramp('#140e0b', '#1c140f', '#251a14', '#2e2119');

const tunnelLayer = (): Canvas => {
  const g = layer(1024, 512);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 1024; x++) {
      const course = y >> 2;
      const off = course % 2 ? 4 : 0;
      const mortar = y % 4 === 3 || (x + off) % 8 === 7;
      g.set(
        x,
        y,
        mortar ? BRICK_BG[0]! : BRICK_BG[hash((x + off) >> 3, course, 71) < 0.5 ? 1 : 2]!,
      );
    }
  }
  // Tunnel mouths receding into the dark, with rings of brick getting darker inward.
  const rings = ['#2e2119', '#140e0b', '#1a130f', '#100b09', '#0c0907', '#080606'].map(hex);
  for (let cx = 128; cx < 1024; cx += 256) {
    const spring = 300;
    for (let k = 0; k < rings.length; k++) {
      const r = 84 - k * 12;
      const half = r;
      for (let y = spring - r; y < 512; y++) {
        for (let x = cx - half; x <= cx + half; x++) {
          const inside = y >= spring ? true : Math.hypot(x - cx, y - spring) <= r;
          if (inside) g.set(x, y, rings[k]!);
        }
      }
    }
    for (let x = cx - 10; x <= cx + 10; x++) g.set(x, 470, withAlpha(hex('#3a4a1c'), 200));
    g.disc(cx, spring + 20, 3, hex('#3a3a24'));
  }
  // The water running along the bottom.
  for (let y = 470; y < 512; y++) g.hline(0, 1023, y, y === 470 ? hex('#2a3418') : hex('#141a0c'));
  for (let x = 0; x < 1024; x += 23) g.hline(x, x + 4, 474 + (x % 3) * 6, hex('#2a3418'));
  return g;
};

const arcadeLayer = (): Canvas => {
  const g = layer(1024, 720);
  const brickA = hex('#3a2a1e');
  const brickB = hex('#33251b');
  const mortar = hex('#1c150f');
  const lit = hex('#4a3626');
  const spring = 380;
  const span = 256;
  const pier = 48;
  const r = (span - pier) / 2;
  for (let y = 0; y < 720; y++) {
    for (let x = 0; x < 1024; x++) {
      const local = x % span;
      const cx = pier + r;
      const open = y > spring - 0 ? local >= pier : Math.hypot(local - cx, y - spring) < r;
      const inPier = local < pier;
      if (open && !inPier && y < 600) continue;
      const course = y >> 2;
      const off = course % 2 ? 4 : 0;
      const m = y % 4 === 3 || (x + off) % 8 === 7;
      g.set(x, y, m ? mortar : hash((x + off) >> 3, course, 73) < 0.5 ? brickA : brickB);
    }
  }
  // Voussoirs: a ring of bricks set on end around each arch, lit on the inside from the left.
  for (let x0 = 0; x0 < 1024; x0 += span) {
    const cx = x0 + pier + r;
    for (let a = 180; a <= 360; a += 0.5) {
      const rad = (a * Math.PI) / 180;
      for (let d = 0; d < 8; d++) {
        const x = Math.round(cx + Math.cos(rad) * (r + d));
        const y = Math.round(spring + Math.sin(rad) * (r + d));
        const joint = Math.round(a) % 9 === 0;
        g.set(x, y, joint ? mortar : d === 0 && a < 270 ? lit : brickA);
      }
    }
    g.vline(x0 + pier - 1, spring, 599, hex('#241a12'));
    g.vline(x0, 0, 599, lit);
  }
  // A rusty pipe along the wall above the arches, and the walkway ledge at the bottom.
  const pipe = ramp('#22140a', '#2a180c', '#36200f', '#4a2a1a', '#5a3420', '#6b3e24');
  [4, 5, 4, 3, 2, 2, 1, 0].forEach((k, i) => g.hline(0, 1023, 140 + i, pipe[k]!));
  for (let x = 0; x < 1024; x += 128) {
    g.rect(x, 136, 6, 16, hex('#2a180c'));
    g.vline(x + 3, 148, 156 + (x % 5), withAlpha(hex('#4a3a2a'), 160));
  }
  for (let y = 600; y < 720; y++) g.hline(0, 1023, y, y < 603 ? hex('#4a4c40') : hex('#2a2c24'));
  return g;
};

export const sewer: DistrictArt = {
  id: 'sewer',
  name: 'Sewer',
  sky: [0x0c, 0x0f, 0x0d],
  ambience: 'sewer.drips',
  materials: [brick, concrete, grate, stone, sewage],
  layers: [
    { file: 'bg-0.png', factor: 0.1, y: 263, paint: tunnelLayer },
    { file: 'bg-1.png', factor: 0.3, y: 836, paint: arcadeLayer },
  ],
  room: {
    worldY: 3500,
    rows: [
      '######################',
      '#....................#',
      '#....................#',
      '#..........H.........#',
      '#.....=====H.........#',
      '#..........H.........#',
      '#..........H.........#',
      'rr.........H.......rrr',
      'kkkk.......H.....kkkkk',
      'kkkk~~~~~~~~~~~~~kkkkk',
      '####~~~~~~~~~~~~~#####',
      '######################',
    ],
    props: [
      ['pipe.big', 13, 1],
      ['sluice', 3, 5],
      ['rubble', 17, 7],
      ['valve', 15, 7],
      ['hub.sign.sewer', 19, 5],
    ],
    runner: [64, 256],
  },
};
