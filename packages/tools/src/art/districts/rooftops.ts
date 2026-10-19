// Rooftops: concrete and tar roofs, brick parapets, corrugated sheet and plank bridges under a
// dusk sky. Warm greys and brick reds against a violet skyline.
import { antenna, bands, layer, skyline, towerCrane, waterTank } from '../backdrop.ts';
import { bevel, bricks, down, left, right, up, type DistrictArt } from '../district.ts';
import { CLEAR, dither2, hash, hex, ramp, step, type RGBA } from '../paint.ts';
import { rim, type MaterialArt } from '../tiles.ts';

/** Concrete, tar, brick, mortar, sheet metal, rust and wood ramps, dark to light. */
const C = ramp('#2e2a33', '#4d4750', '#6c6569', '#8a8282', '#a69d98', '#c4b9ae');
const T = ramp('#17151b', '#24222a', '#332f39', '#45404b', '#5b5561');
const B = ramp('#3a1c18', '#5e2a22', '#7d3a2c', '#96472f', '#ad5a3a', '#c4744c');
const M = ramp('#5a4a46', '#7d6e66', '#9a8a7e');
const S = ramp('#1f2630', '#334050', '#4b5a6b', '#657688', '#8495a5', '#a9b8c4');
const R = ramp('#5a2e1e', '#80482a', '#a5643a');
const W = ramp('#2e1d14', '#4f3220', '#6e472c', '#8c5e3a', '#a8774a', '#c4955f');

/** A coping cap over rows 1-4 with its drip shadow on row 5; joints at `joints`. */
const coping = (g: import('../paint.ts').Canvas, mask: number, joints: number[]): void => {
  g.hline(0, 31, 1, C[5]!);
  g.hline(0, 31, 2, C[4]!);
  g.hline(0, 31, 3, C[4]!);
  g.hline(0, 31, 4, C[3]!);
  for (let x = 0; x < 32; x++) g.set(x, 5, step(g.get(x, 5), -2, C, B, M, T));
  for (const j of joints) g.vline(j, 1, 4, C[2]!);
  if (left(mask)) {
    g.set(1, 1, C[3]!);
    g.set(2, 1, C[4]!);
    g.set(1, 2, C[3]!);
  }
  if (right(mask)) {
    g.set(30, 1, C[3]!);
    g.set(29, 1, C[4]!);
    g.set(30, 2, C[2]!);
    g.vline(30, 3, 4, C[2]!);
  }
};

const concrete: MaterialArt = {
  id: 'roof.concrete',
  rimTop: rim(C[1]!),
  rimSide: rim(C[1]!),
  front(g, mask) {
    g.fill(C[3]!);
    // Cast panels 32 x 16 in a stagger; recessed joints are dark above or left, lit below or right.
    g.hline(0, 31, 15, C[1]!);
    g.hline(0, 31, 16, C[4]!);
    g.vline(15, 0, 14, C[1]!);
    g.vline(16, 0, 14, C[4]!);
    g.vline(31, 17, 31, C[1]!);
    g.vline(0, 17, 31, C[4]!);
    for (const [x, y] of [
      [7, 7],
      [23, 7],
      [7, 23],
      [23, 23],
    ] as const) {
      g.set(x, y, C[0]!);
      g.set(x + 1, y, C[1]!);
      g.set(x, y + 1, C[1]!);
      g.set(x + 1, y + 1, C[2]!);
    }
    bevel(g, mask, C[4]!, C[2]!);
    if (down(mask)) {
      for (let x = 1; x < 31; x++) {
        g.set(x, 29, C[2]!);
        if (dither2(x, 28) < 0.5) g.set(x, 28, C[2]!);
      }
      if (left(mask)) g.set(1, 29, C[3]!);
    }
    if (up(mask)) {
      coping(g, mask, [15]);
      for (const [x, n] of [
        [4, 7],
        [20, 8],
        [27, 4],
      ] as const) {
        for (let i = 0; i < n; i++) if (i < n - 3 || i % 2 === 0) g.set(x, 6 + i, C[2]!);
      }
    }
    if (down(mask) && left(mask)) {
      g.set(1, 30, C[2]!);
      g.set(2, 30, C[3]!);
    }
    if (down(mask) && right(mask)) {
      g.set(30, 29, C[1]!);
      g.set(29, 30, C[1]!);
    }
  },
  top(g) {
    g.fill(C[4]!);
    g.hline(0, 31, 1, C[5]!);
    g.hline(0, 31, 2, C[5]!);
    g.vline(15, 1, 15, C[3]!);
    g.hline(0, 31, 15, C[3]!);
  },
  side(g) {
    g.fill(C[3]!);
    g.hline(0, 15, 15, C[1]!);
    g.hline(0, 15, 16, C[4]!);
    g.vline(15, 0, 31, C[2]!);
  },
};

/** Felt laps every 8 rows: a lit lap edge, then shadow under the next lap. */
const lap = (y: number): RGBA | null => {
  const k = y % 8;
  return k === 0 ? T[4]! : k === 1 ? T[3]! : k === 7 ? T[1]! : null;
};

const tar: MaterialArt = {
  id: 'roof.tar',
  rimTop: rim(T[0]!),
  rimSide: rim(T[0]!),
  front(g, mask) {
    g.fill(T[2]!);
    for (let y = 0; y < 32; y++) {
      const c = lap(y);
      if (c) g.hline(0, 31, y, c);
    }
    for (let band = 0; band < 4; band++) {
      const x = (band * 13 + 5) % 32;
      g.vline(x, band * 8 + 1, band * 8 + 6, T[1]!);
      g.vline((x + 1) % 32, band * 8 + 2, band * 8 + 6, T[3]!);
    }
    for (const [x, y] of [
      [9, 4],
      [24, 11],
      [14, 20],
      [27, 27],
    ] as const) {
      g.set(x, y, T[4]!);
      g.set(x + 1, y, T[3]!);
      g.set(x + 1, y + 1, T[1]!);
    }
    bevel(g, mask, T[3]!, T[1]!);
    if (up(mask)) {
      // A steel drip edge along the roof's edge.
      g.hline(0, 31, 1, S[5]!);
      g.hline(0, 31, 2, S[4]!);
      g.hline(0, 31, 3, S[3]!);
      g.hline(0, 31, 4, S[2]!);
      g.hline(0, 31, 5, T[0]!);
      g.vline(23, 1, 4, S[1]!);
      g.set(24, 1, S[4]!);
      if (right(mask)) g.vline(30, 1, 4, S[2]!);
    }
  },
  top(g) {
    g.fill(T[2]!);
    g.hline(0, 31, 1, S[4]!);
    g.hline(0, 31, 2, S[3]!);
    g.hline(0, 31, 3, T[1]!);
    g.vline(9, 4, 15, T[3]!);
    g.vline(25, 4, 15, T[3]!);
    g.vline(23, 1, 2, S[1]!);
  },
  side(g) {
    g.fill(T[2]!);
    for (let y = 0; y < 32; y++) {
      const c = lap(y);
      if (c) g.hline(0, 15, y, c);
    }
  },
};

const brickShade = (course: number, index: number): number => {
  const h = hash(index, course, 11);
  return h < 0.22 ? 2 : h < 0.78 ? 3 : 4;
};
const RIM_BRICK = hex('#33262a');

const brick: MaterialArt = {
  id: 'roof.brick',
  rimTop: rim(RIM_BRICK),
  rimSide: rim(RIM_BRICK),
  front(g, mask) {
    bricks(g, 0, 0, 32, 32, { w: 8, h: 4 }, M[1]!, (course, index, px, py) => {
      const i = brickShade(course, index);
      if (py === 0 && px < 6) return B[i + 1]!;
      if (px === 6) return B[i - 1]!;
      return B[i]!;
    });
    if (left(mask)) for (let y = 1; y < 31; y++) g.set(1, y, step(g.get(1, y), 1, B, M));
    if (right(mask)) for (let y = 1; y < 31; y++) g.set(30, y, step(g.get(30, y), -1, B, M));
    if (down(mask)) {
      for (let x = 1; x < 31; x++) {
        g.set(x, 30, step(g.get(x, 30), -2, B, M));
        g.set(x, 29, step(g.get(x, 29), -1, B, M));
      }
      if (left(mask)) {
        g.set(1, 29, M[0]!);
        g.set(2, 29, M[0]!);
        g.set(1, 28, M[0]!);
      }
    }
    if (up(mask)) coping(g, mask, [11, 27]);
  },
  top(g) {
    g.fill(C[4]!);
    g.hline(0, 31, 1, C[5]!);
    g.hline(0, 31, 2, C[5]!);
    g.vline(11, 1, 15, C[3]!);
    g.vline(27, 1, 15, C[3]!);
    g.hline(0, 31, 15, C[3]!);
  },
  side(g) {
    for (let y = 0; y < 32; y++) {
      const py = y % 4;
      const i = brickShade(y >> 2, 1);
      g.hline(0, 15, y, py === 3 ? M[1]! : py === 0 ? B[i + 1]! : B[i]!);
    }
  },
};

/** Corrugation profile by x % 8: the crest catches the light from the left. */
const PROFILE = [3, 4, 5, 4, 3, 2, 1, 2];

const sheet: MaterialArt = {
  id: 'roof.sheet',
  rimTop: rim(S[0]!),
  rimSide: rim(S[0]!),
  front(g, mask) {
    g.paint((x) => S[PROFILE[x % 8]!]!);
    for (let x = 0; x < 32; x++) {
      const p = PROFILE[x % 8]!;
      g.set(x, 29, S[Math.min(5, p + 1)]!);
      g.set(x, 30, S[Math.max(0, p - 2)]!);
    }
    for (let k = 0; k < 4; k++) {
      const x = k * 8 + 4;
      for (const y of [3, 26]) {
        g.set(x, y, S[5]!);
        g.set(x, y + 1, S[1]!);
      }
      const h = hash(k, 0, 5);
      if (h < 0.6) {
        const n = 3 + Math.floor(h * 8);
        for (let i = 0; i < n; i++)
          if (i < n - 2 || i % 2 === 0) g.set(x, 5 + i, R[i < 2 ? 2 : 1]!);
      }
    }
    if (down(mask)) {
      g.hline(1, 30, 27, S[4]!);
      g.hline(1, 30, 28, S[3]!);
      g.hline(1, 30, 29, S[3]!);
      g.hline(1, 30, 30, S[2]!);
    }
    if (up(mask)) {
      g.hline(1, 30, 1, S[5]!);
      g.hline(1, 30, 2, S[4]!);
      g.hline(1, 30, 3, S[4]!);
      g.hline(1, 30, 4, S[3]!);
      g.hline(1, 30, 5, S[0]!);
      g.vline(20, 1, 4, S[2]!);
    }
    if (left(mask)) {
      g.vline(1, 1, 30, S[5]!);
      g.vline(2, 1, 30, S[4]!);
      g.vline(3, 1, 30, S[1]!);
    }
    if (right(mask)) {
      g.vline(28, 1, 30, S[4]!);
      g.vline(29, 1, 30, S[3]!);
      g.vline(30, 1, 30, S[1]!);
    }
    if (down(mask) && left(mask)) {
      g.set(1, 30, R[0]!);
      g.set(2, 30, R[1]!);
      g.set(2, 29, R[2]!);
      g.set(1, 29, R[1]!);
      g.set(3, 30, R[0]!);
    }
  },
  top(g) {
    const flat = [3, 4, 4, 4, 3, 3, 2, 3];
    g.paint((x) => S[flat[x % 8]!]!);
    g.hline(0, 31, 15, S[2]!);
  },
  side(g) {
    g.fill(S[3]!);
    g.hline(0, 15, 29, S[4]!);
    g.hline(0, 15, 30, S[1]!);
    g.vline(15, 0, 31, S[2]!);
  },
};

const DECK = 8;

const plank: MaterialArt = {
  id: 'roof.plank',
  deck: DECK,
  rimTop: rim(W[0]!),
  rimSide: Array.from({ length: 32 }, (_, y) => (y < DECK ? W[0]! : CLEAR)),
  front(g, mask) {
    g.rect(0, 0, 32, DECK, W[3]!);
    g.hline(0, 31, 1, W[5]!);
    g.hline(0, 31, 6, W[2]!);
    g.hline(0, 31, 7, W[1]!);
    for (const [x0, x1, y] of [
      [3, 9, 3],
      [14, 19, 4],
      [25, 30, 3],
      [6, 12, 5],
      [22, 27, 5],
      [10, 16, 2],
    ] as const) {
      g.hline(x0, x1, y, W[2]!);
    }
    g.vline(20, 1, 7, W[0]!);
    g.vline(21, 1, 6, W[4]!);
    for (const [x, y] of [
      [18, 3],
      [23, 3],
      [18, 5],
      [23, 5],
    ] as const) {
      g.set(x, y, W[0]!);
    }
    if (left(mask)) g.vline(1, 1, 6, W[4]!);
    if (right(mask)) g.vline(30, 1, 6, W[1]!);
  },
  top(g) {
    const tone = [3, 4, 3, 2];
    g.paint((x) => {
      const k = x % 8;
      return k === 0 ? W[1]! : k === 1 ? W[4]! : W[tone[x >> 3]!]!;
    });
    for (let b = 0; b < 4; b++) {
      g.set(b * 8 + 4, 2, W[1]!);
      g.set(b * 8 + 4, 13, W[1]!);
    }
  },
  side(g) {
    for (let x = 0; x < 16; x++) {
      g.set(x, 0, W[1]!);
      g.set(x, 1, W[4]!);
      for (let y = 2; y < 6; y++) g.set(x, y, W[3]!);
      g.set(x, 6, W[2]!);
      g.set(x, 7, W[1]!);
    }
  },
};

/** Dusk sky from deep violet at the top to amber at the horizon. */
const SKY = ramp(
  '#1a1833',
  '#221e42',
  '#2c2350',
  '#3a2a5a',
  '#4c3160',
  '#623863',
  '#7c4163',
  '#9a4c60',
  '#b65a59',
  '#cf6e51',
  '#e2884e',
  '#eea457',
);

const skyLayer = (): import('../paint.ts').Canvas => {
  const g = layer(1024, 512);
  bands(
    g,
    SKY,
    SKY.slice(1).map((_, i) => Math.round(60 + i * 30 - i * i * 0.6)),
  );
  // The sun low behind the skyline, and a few long clouds lit from below.
  g.disc(696, 352, 24, hex('#f6c46c'));
  g.disc(696, 352, 21, hex('#fbd987'));
  // Long flat clouds in three tiers, lit from below by the sun.
  const cloud = hex('#4e2f5c');
  const mid = hex('#6c3a62');
  const under = hex('#c0635c');
  for (const [x, y, w] of [
    [40, 214, 170],
    [262, 172, 96],
    [430, 240, 220],
    [610, 138, 130],
    [820, 204, 180],
    [520, 300, 150],
    [930, 268, 110],
  ] as const) {
    g.rect(x + Math.round(w * 0.3), y - 4, Math.round(w * 0.3), 2, cloud);
    g.rect(x + Math.round(w * 0.12), y - 2, Math.round(w * 0.7), 2, cloud);
    g.rect(x, y, w, 3, cloud);
    g.hline(x + 6, x + w - 10, y + 2, mid);
    g.hline(x + 4, x + w - 6, y + 3, under);
    g.hline(x + Math.round(w * 0.2), x + Math.round(w * 0.6), y + 4, under);
  }
  return g;
};

const farLayer = (): import('../paint.ts').Canvas => {
  const g = layer(1024, 448);
  const body = hex('#3b2f55');
  skyline(g, {
    seed: 21,
    width: [28, 70],
    top: [130, 260],
    gap: [-6, 10],
    body,
    lit: hex('#4a3a63'),
    shade: hex('#33294b'),
    window: {
      lit: ramp('#c99263', '#a87358'),
      dark: hex('#362b4f'),
      chance: 0.18,
      w: 1,
      h: 1,
      dx: 4,
      dy: 5,
    },
  });
  for (const x of [120, 470, 760]) antenna(g, x, 150, 26, body, hex('#ff6a4a'));
  return g;
};

const nearLayer = (): import('../paint.ts').Canvas => {
  const g = layer(1024, 512);
  const body = hex('#241b31');
  const lit = hex('#35283f');
  const buildings = skyline(g, {
    seed: 7,
    width: [46, 120],
    top: [110, 270],
    gap: [0, 26],
    body,
    lit,
    shade: hex('#1d1628'),
    window: {
      lit: ramp('#f0c070', '#e0a160', '#c98a5a'),
      dark: hex('#2b2139'),
      chance: 0.24,
      w: 2,
      h: 3,
      dx: 6,
      dy: 8,
    },
  });
  buildings.forEach((b, i) => {
    if (i % 3 === 0 && b.w > 30) waterTank(g, b.x + Math.floor(b.w / 3), b.top, body, lit);
    else if (i % 3 === 1) antenna(g, b.x + b.w - 8, b.top, 30 + (i % 4) * 8, body, hex('#ff4a3a'));
    if (i % 4 === 2 && b.w > 50) {
      g.rect(b.x + 6, b.top - 14, b.w - 12, 2, body);
      for (let x = b.x + 8; x < b.x + b.w - 8; x += 9) g.vline(x, b.top - 12, b.top - 1, body);
    }
  });
  towerCrane(g, 300, 300, 60, 230, body, hex('#ff4a3a'));
  return g;
};

export const rooftops: DistrictArt = {
  id: 'rooftops',
  name: 'Rooftops',
  sky: [0x1a, 0x18, 0x33],
  ambience: 'rooftops.wind',
  materials: [concrete, tar, brick, sheet, plank],
  layers: [
    { file: 'bg-0.png', factor: 0.05, y: -27, paint: skyLayer },
    { file: 'bg-1.png', factor: 0.15, y: 128, paint: farLayer },
    { file: 'bg-2.png', factor: 0.35, y: 272, paint: nearLayer },
  ],
  room: {
    worldY: 520,
    rows: [
      '......................',
      '......................',
      '......................',
      '......................',
      '..............P.......',
      '..------------P....mmm',
      '..............P....mmm',
      'bbbbn.........P....mmm',
      '####H.........#####mmm',
      '####H...=====b#####mmm',
      'ttttH........b#####ttt',
      '####H........b#####ttt',
    ],
    props: [
      ['chimney', 1, 5],
      ['ac.unit', 15, 7],
      ['skylight', 17, 7],
      ['water.tank', 19, 2],
    ],
    runner: [330, 288],
  },
};
