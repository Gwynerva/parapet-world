// The props atlas (`content/art/props.png`): every prop of props.json and the entity markers,
// painted flat for the runners' plane with their own shading (light from the upper left) and a
// dark outline that reads against the tiles. Segment props are exactly one cell long along the
// axis they repeat on and have no outline across that seam, so stacked copies join seamlessly.
import { text, textWidth } from './font.ts';
import { CLEAR, Canvas, dither2, hash, hex, mix, ramp, withAlpha, type RGBA } from './paint.ts';

export interface PropArt {
  id: string;
  size: [number, number];
  /** Where the sprite's top-left goes relative to the mask's top-left cell corner. */
  offset: [number, number];
  /** The axis a segment prop repeats along. */
  tile?: 'x' | 'y';
  /** `in` darkens the shape's own border, `out` draws ink around it, `none` leaves it. */
  outline: 'in' | 'out' | 'none';
  paint(g: Canvas): void;
  /** Painted after the outline (glows, see-through mesh, shadows). */
  after?(g: Canvas): void;
}

const INK = hex('#121016');

// Ramps, dark to light.
const FE = ramp('#16171b', '#2a2c33', '#40444d', '#5c626d', '#7e8592');
const GV = ramp('#3b4046', '#5f666d', '#848c93', '#a9b1b6', '#cdd3d5');
const AC = ramp('#4a4740', '#77736a', '#9d988c', '#bdb7aa', '#d8d2c4');
const BR = ramp('#3a1c18', '#5e2a22', '#7d3a2c', '#96472f', '#ad5a3a', '#c4744c');
const CO = ramp('#4d4750', '#6c6569', '#8a8282', '#a69d98', '#c4b9ae');
const WT = ramp('#2b2119', '#4a3a2c', '#665240', '#806a52', '#9a8466');
const GL = ramp('#2a2b4a', '#45487a', '#6a6fa6', '#9aa0cf', '#d0d4f0');
const YL = ramp('#4a3510', '#7a5a14', '#b08518', '#d9a520', '#f0c84a');
const CR = ramp('#2e120e', '#5a2018', '#7e2e22', '#9c3e2c', '#b8573c');
const CB = ramp('#0f1a2b', '#1c3150', '#2a4a74', '#3c6596', '#5a86b8');
const WD = ramp('#3a2414', '#5c3b20', '#7e5530', '#9e7040', '#bd8d55');
const BX = ramp('#4a3420', '#6e5034', '#8e6c48', '#ad8a60');
const RB = ramp('#141c2a', '#24344e', '#36507a', '#4c6c9c');
const RO = ramp('#4a1e08', '#8a3a10', '#c25a1c', '#e47a30', '#f5a050');
const RU = ramp('#0e0e10', '#1e1e22', '#303036', '#46464e');
const MG = ramp('#1a241e', '#2c3d33', '#3f5849', '#55735f', '#73917a');
const MB = ramp('#141b26', '#22303f', '#34475e', '#4a617e', '#6a84a2');
const ST = ramp('#1d2126', '#353b43', '#4f5761', '#6d7682', '#9099a4', '#b8c0c8');
const DB = ramp('#0e1a33', '#1a2f5a', '#284682', '#3a5fa8', '#5a80c8');
const IR = ramp('#1a1c1a', '#2e322f', '#454b46', '#5f6760', '#7c857d');
const RS = ramp('#2a140c', '#4a2414', '#6b3a1f', '#8f522c', '#b06d3a', '#cc8a4e');
const SN = ramp('#2a2824', '#403d37', '#57534b', '#6f6a60', '#8a8478');
const SB = ramp('#2a1d16', '#40291e', '#583828', '#704a34', '#8a5e44');
const GD = ramp('#5a3a08', '#9a6a10', '#d8a020', '#f5d050', '#fff2a0', '#ffffff');
const MOSS = ramp('#2a3418', '#3e4e22', '#56682e');

/** Shading index across a cylinder of `w` px for a ramp of `n` colours, lit from the left. */
const cylinder = (i: number, w: number, n: number): number => {
  const t = w > 1 ? i / (w - 1) : 0.5;
  const v = 1 - ((t - 0.3) / 0.75) ** 2;
  return Math.max(0, Math.min(n - 1, Math.round(v * (n - 1))));
};

/** A vertical cylinder (pole, pipe, drum) over columns x..x+w-1. */
const vcyl = (
  g: Canvas,
  x: number,
  w: number,
  y0: number,
  y1: number,
  r: readonly RGBA[],
): void => {
  for (let i = 0; i < w; i++) g.vline(x + i, y0, y1, r[cylinder(i, w, r.length)]!);
};

/** A horizontal cylinder over rows y..y+h-1. */
const hcyl = (
  g: Canvas,
  x0: number,
  x1: number,
  y: number,
  h: number,
  r: readonly RGBA[],
): void => {
  for (let i = 0; i < h; i++) g.hline(x0, x1, y + i, r[cylinder(i, h, r.length)]!);
};

/** A round-headed rivet or bolt lit from the upper left. */
const rivet = (g: Canvas, x: number, y: number, hi: RGBA, lo: RGBA): void => {
  g.set(x, y, hi);
  g.set(x + 1, y + 1, lo);
};

/** Diagonal warning stripes. */
const hazard = (g: Canvas, x: number, y: number, w: number, h: number, a: RGBA, b: RGBA): void => {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) g.set(i, j, (i + j) % 8 < 4 ? a : b);
};

/** Text scaled by an integer factor, centred on `cx`. */
const bigText = (g: Canvas, cx: number, y: number, s: string, c: RGBA, k: number): void => {
  const w = textWidth(s);
  const t = new Canvas(w, 5);
  text(t, 0, 0, s, c);
  const x0 = Math.round(cx - (w * k) / 2);
  for (let j = 0; j < 5 * k; j++) {
    for (let i = 0; i < w * k; i++) {
      const p = t.get((i / k) | 0, (j / k) | 0);
      if (p[3]) g.set(x0 + i, y + j, p);
    }
  }
};

const centred = (g: Canvas, cx: number, y: number, s: string, c: RGBA): void => {
  text(g, Math.round(cx - textWidth(s) / 2), y, s, c);
};

// ---------- segments: ladders, poles, bars, posts, fence, chain ----------

const ladderRoof: PropArt = {
  id: 'ladder.roof',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    for (const x of [5, 24]) {
      g.vline(x, 0, 31, FE[4]!);
      g.vline(x + 1, 0, 31, FE[3]!);
      g.vline(x + 2, 0, 31, FE[1]!);
    }
    for (const y of [3, 11, 19, 27]) {
      g.hline(8, 23, y, FE[4]!);
      g.hline(8, 23, y + 1, FE[2]!);
      g.set(6, y, GV[3]!);
      g.set(25, y, GV[3]!);
    }
    g.set(21, 20, RS[3]!);
    g.set(22, 20, RS[2]!);
    g.set(9, 4, RS[2]!);
  },
};

const ladderWh: PropArt = {
  id: 'ladder.wh',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    for (const x of [6, 23]) vcyl(g, x, 3, 0, 31, YL);
    for (const y of [4, 12, 20, 28]) {
      g.hline(9, 22, y, GV[4]!);
      g.hline(9, 22, y + 1, GV[2]!);
    }
    for (const y of [4, 20]) {
      g.set(7, y, YL[1]!);
      g.set(24, y, YL[1]!);
    }
  },
};

const ladderFac: PropArt = {
  id: 'ladder.fac',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    g.vline(2, 0, 31, YL[3]!);
    g.vline(29, 0, 31, YL[2]!);
    for (const x of [7, 22]) vcyl(g, x, 3, 0, 31, ST);
    for (const y of [4, 12, 20, 28]) {
      g.hline(10, 21, y, ST[5]!);
      g.hline(10, 21, y + 1, ST[2]!);
    }
    g.hline(2, 29, 16, YL[4]!);
    g.hline(2, 29, 17, YL[2]!);
  },
};

const ladderSew: PropArt = {
  id: 'ladder.sew',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    for (const y of [6, 22]) {
      g.rect(8, y - 3, 3, 3, IR[2]!);
      g.rect(21, y - 3, 3, 3, IR[1]!);
      g.set(8, y - 3, IR[3]!);
      g.hline(9, 22, y, RS[4]!);
      g.hline(9, 22, y + 1, RS[3]!);
      g.hline(9, 22, y + 2, RS[1]!);
      g.vline(9, y - 2, y + 2, RS[3]!);
      g.vline(22, y - 2, y + 2, RS[2]!);
      for (const x of [12, 17]) g.set(x, y, RS[5]!);
      g.set(15, y + 1, IR[2]!);
    }
  },
};

const poleRoof: PropArt = {
  id: 'pole.roof',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    vcyl(g, 14, 4, 0, 31, GV);
    vcyl(g, 13, 6, 10, 12, GV);
    g.hline(19, 20, 11, GV[1]!);
    g.set(13, 12, GV[1]!);
  },
};

const poleWh: PropArt = {
  id: 'pole.wh',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    vcyl(g, 13, 6, 0, 31, YL);
    vcyl(g, 12, 8, 27, 31, GV);
    g.hline(12, 19, 27, GV[4]!);
    for (const x of [13, 18]) rivet(g, x, 29, GV[4]!, GV[0]!);
  },
};

const poleFac: PropArt = {
  id: 'pole.fac',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    vcyl(g, 12, 8, 0, 31, ST);
    for (const y of [30, 31, 0, 1]) g.hline(10, 21, y, ST[y === 30 ? 5 : y === 1 ? 2 : 3]!);
    for (const x of [11, 20]) {
      g.set(x, 31, ST[5]!);
      g.set(x, 0, ST[1]!);
    }
    g.hline(13, 15, 14, ST[1]!);
    g.set(16, 15, ST[3]!);
  },
};

const poleSew: PropArt = {
  id: 'pole.sew',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    vcyl(g, 13, 6, 0, 31, IR);
    vcyl(g, 12, 8, 18, 20, IR);
    for (const [x, y, k] of [
      [14, 6, 3],
      [15, 7, 2],
      [17, 9, 2],
      [17, 10, 1],
      [17, 21, 3],
      [17, 22, 2],
      [17, 23, 2],
      [17, 25, 1],
      [14, 27, 3],
    ] as const) {
      g.set(x, y, RS[k]!);
    }
  },
};

const barRoof: PropArt = {
  id: 'bar.roof',
  size: [32, 8],
  offset: [0, 0],
  tile: 'x',
  outline: 'out',
  paint(g) {
    g.hline(0, 31, 2, hex('#d8d0be'));
    for (const x of [6, 22]) {
      g.rect(x, 1, 2, 4, WD[3]!);
      g.set(x, 1, WD[4]!);
      g.set(x + 1, 4, WD[1]!);
    }
  },
};

const barWh: PropArt = {
  id: 'bar.wh',
  size: [32, 8],
  offset: [0, 0],
  tile: 'x',
  outline: 'out',
  paint(g) {
    hcyl(g, 0, 31, 1, 4, GV);
    g.vline(0, 1, 4, GV[1]!);
    g.vline(1, 1, 4, GV[4]!);
  },
};

const barFac: PropArt = {
  id: 'bar.fac',
  size: [32, 14],
  offset: [0, -6],
  tile: 'x',
  outline: 'out',
  paint(g) {
    g.vline(15, 0, 6, ST[3]!);
    g.vline(16, 0, 6, ST[1]!);
    hcyl(g, 0, 31, 6, 6, ST);
    g.rect(13, 5, 6, 1, ST[4]!);
    g.rect(13, 12, 6, 1, ST[1]!);
    g.vline(13, 5, 12, ST[4]!);
    g.vline(18, 5, 12, ST[1]!);
  },
};

const barSew: PropArt = {
  id: 'bar.sew',
  size: [32, 8],
  offset: [0, 0],
  tile: 'x',
  outline: 'out',
  paint(g) {
    hcyl(g, 0, 31, 1, 5, IR);
    for (const x of [30, 31, 0, 1]) g.vline(x, 0, 6, IR[x === 30 ? 4 : x === 1 ? 1 : 3]!);
    for (const [x, y, k] of [
      [9, 4, 3],
      [10, 4, 2],
      [10, 5, 1],
      [19, 2, 3],
      [24, 5, 2],
    ] as const) {
      g.set(x, y, RS[k]!);
    }
  },
};

const postRoof: PropArt = {
  id: 'post.roof',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    vcyl(g, 12, 8, 0, 31, GV);
    g.rect(11, 14, 10, 4, GV[2]!);
    g.hline(11, 20, 14, GV[4]!);
    g.hline(11, 20, 17, GV[0]!);
    rivet(g, 12, 15, GV[4]!, GV[0]!);
    rivet(g, 18, 15, GV[4]!, GV[0]!);
  },
};

const postFac: PropArt = {
  id: 'post.fac',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    g.vline(12, 0, 31, YL[4]!);
    g.vline(13, 0, 31, YL[3]!);
    for (let x = 14; x < 18; x++) g.vline(x, 0, 31, YL[2]!);
    g.vline(18, 0, 31, YL[3]!);
    g.vline(19, 0, 31, YL[1]!);
    for (let y = 3; y < 32; y += 8) {
      g.set(12, y, YL[4]!);
      g.set(12, y + 1, YL[0]!);
      g.set(18, y, YL[4]!);
      g.set(18, y + 1, YL[0]!);
    }
    g.set(15, 20, YL[1]!);
    g.set(16, 21, YL[1]!);
  },
};

const postSew: PropArt = {
  id: 'post.sew',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    vcyl(g, 12, 8, 0, 31, IR);
    vcyl(g, 11, 10, 4, 6, IR);
    vcyl(g, 11, 10, 20, 22, IR);
    for (const [x, y, k] of [
      [14, 9, 3],
      [14, 10, 2],
      [18, 13, 2],
      [13, 25, 3],
      [17, 27, 2],
      [17, 28, 1],
    ] as const) {
      g.set(x, y, RS[k]!);
    }
  },
};

const fence: PropArt = {
  id: 'fence',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    vcyl(g, 13, 6, 0, 31, GV);
    hcyl(g, 0, 31, 0, 2, GV);
  },
  after(g) {
    for (let y = 2; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (g.alpha(x, y)) continue;
        if ((x + y) % 8 === 0 || (x - y + 64) % 8 === 0) g.set(x, y, (x + y) % 8 ? GV[2]! : GV[1]!);
      }
    }
  },
};

/** Chain links on a pitch of 8 px: a ring seen face-on, then one seen edge-on. */
const chainLinks = (g: Canvas, y0: number, y1: number): void => {
  for (let k = 0; k * 8 + y0 < y1; k++) {
    const y = y0 + k * 8;
    if (k % 2 === 0) {
      g.vline(13, y + 1, y + 7, ST[4]!);
      g.vline(18, y + 1, y + 7, ST[1]!);
      g.hline(14, 17, y, ST[5]!);
      g.hline(14, 17, y + 8, ST[2]!);
    } else {
      g.vline(15, y - 1, y + 9, ST[4]!);
      g.vline(16, y - 1, y + 9, ST[2]!);
    }
  }
};

const chain: PropArt = {
  id: 'chain',
  size: [32, 32],
  offset: [0, 0],
  tile: 'y',
  outline: 'out',
  paint(g) {
    chainLinks(g, 0, 32);
    g.set(15, 31, ST[4]!);
    g.set(16, 31, ST[2]!);
  },
};

const chainHook: PropArt = {
  id: 'chain.hook',
  size: [32, 32],
  offset: [0, 0],
  outline: 'out',
  paint(g) {
    chainLinks(g, 0, 10);
    g.rect(11, 11, 10, 7, YL[3]!);
    g.hline(11, 20, 11, YL[4]!);
    g.hline(11, 20, 17, YL[1]!);
    g.vline(20, 12, 17, YL[2]!);
    rivet(g, 15, 13, ST[5]!, ST[0]!);
    g.rect(15, 18, 3, 5, ST[3]!);
    g.vline(15, 18, 22, ST[4]!);
    for (let y = 21; y < 32; y++) {
      for (let x = 8; x < 22; x++) {
        const d = Math.hypot(x - 14.5, y - 25.5);
        if (d > 5 || d < 2.4) continue;
        if (x > 14 && y < 25) continue;
        g.set(x, y, d < 3.4 ? ST[4]! : y > 27 || x > 17 ? ST[2]! : ST[3]!);
      }
    }
    g.set(9, 22, ST[4]!);
    g.set(9, 21, ST[4]!);
  },
};

// ---------- rooftops ----------

const acUnit: PropArt = {
  id: 'ac.unit',
  size: [64, 32],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    g.rect(0, 0, 64, 28, AC[2]!);
    g.hline(0, 63, 0, AC[4]!);
    g.hline(0, 63, 1, AC[3]!);
    g.vline(0, 0, 27, AC[3]!);
    g.vline(63, 0, 27, AC[1]!);
    g.hline(0, 63, 26, AC[1]!);
    g.hline(0, 63, 27, AC[0]!);
    for (const x of [4, 52]) {
      g.rect(x, 28, 8, 4, FE[2]!);
      g.hline(x, x + 7, 28, FE[3]!);
    }
    for (let y = 5; y < 23; y += 3) {
      g.hline(5, 26, y, AC[3]!);
      g.hline(5, 26, y + 1, AC[1]!);
    }
    g.disc(44, 13.5, 10.5, AC[0]!);
    for (let y = 4; y < 24; y += 3) {
      for (let x = 33; x < 56; x++) if (Math.hypot(x - 44, y - 13.5) < 10) g.set(x, y, AC[2]!);
    }
    for (let a = 0; a < 360; a += 4) {
      const r = 10.6;
      g.set(
        Math.round(44 + Math.cos((a * Math.PI) / 180) * r),
        Math.round(13.5 + Math.sin((a * Math.PI) / 180) * r),
        a > 180 && a < 360 ? AC[4]! : AC[1]!,
      );
    }
    g.disc(44, 13.5, 2, AC[3]!);
    for (const [x, y] of [
      [3, 3],
      [59, 3],
      [3, 23],
      [59, 23],
    ] as const) {
      rivet(g, x, y, AC[4]!, AC[0]!);
    }
    g.rect(8, 23, 10, 2, AC[1]!);
  },
};

const waterTank: PropArt = {
  id: 'water.tank',
  size: [96, 96],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    for (let x = 0; x < 96; x++) {
      const k = x % 6;
      const stave = Math.floor(x / 6);
      const tone = hash(stave, 0, 3) < 0.5 ? 3 : 2;
      const fade = x > 72 ? -1 : x < 12 ? 1 : 0;
      const c = k === 0 ? 1 : k === 1 ? Math.min(4, tone + 1 + fade) : tone + fade;
      g.vline(x, 0, 59, WT[Math.max(0, Math.min(4, c))]!);
    }
    g.rect(0, 0, 96, 3, WT[4]!);
    g.hline(0, 95, 3, WT[1]!);
    for (const y of [10, 22, 34, 46]) {
      g.hline(0, 95, y, FE[3]!);
      g.hline(0, 95, y + 1, FE[1]!);
      rivet(g, 6, y, FE[4]!, FE[0]!);
      rivet(g, 50, y, FE[4]!, FE[0]!);
    }
    g.rect(0, 58, 96, 6, FE[2]!);
    g.hline(0, 95, 58, FE[4]!);
    g.hline(0, 95, 63, FE[0]!);
    for (const x of [12, 76]) {
      g.rect(x, 64, 8, 32, FE[2]!);
      g.vline(x, 64, 95, FE[4]!);
      g.vline(x + 1, 64, 95, FE[3]!);
      g.vline(x + 7, 64, 95, FE[0]!);
    }
    g.line(20, 66, 75, 93, FE[2]!);
    g.line(75, 66, 20, 93, FE[2]!);
    g.hline(20, 75, 80, FE[3]!);
  },
};

const ventDuct: PropArt = {
  id: 'vent.duct',
  size: [96, 16],
  offset: [0, 16],
  outline: 'in',
  paint(g) {
    g.rect(0, 0, 96, 14, GV[2]!);
    g.hline(0, 95, 0, GV[4]!);
    g.hline(0, 95, 1, GV[3]!);
    g.hline(0, 95, 2, GV[3]!);
    g.hline(0, 95, 11, GV[1]!);
    g.hline(0, 95, 12, GV[1]!);
    g.hline(0, 95, 13, GV[0]!);
    for (const x of [0, 31, 63, 94]) {
      g.vline(x, 0, 13, GV[4]!);
      g.vline(x + 1, 0, 13, GV[1]!);
      rivet(g, x, 4, GV[4]!, GV[0]!);
      rivet(g, x, 9, GV[4]!, GV[0]!);
    }
    for (const x of [10, 80]) {
      g.rect(x, 14, 6, 2, FE[2]!);
      g.hline(x, x + 5, 14, FE[3]!);
    }
    g.hline(40, 52, 6, GV[3]!);
    g.hline(40, 52, 7, GV[1]!);
  },
};

const chimney: PropArt = {
  id: 'chimney',
  size: [32, 64],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    for (let y = 6; y < 64; y++) {
      const course = y >> 2;
      const py = y & 3;
      const off = course % 2 ? 4 : 0;
      for (let x = 0; x < 32; x++) {
        const px = (x + off) & 7;
        if (py === 3 || px === 7) {
          g.set(x, y, hex('#7d6e66'));
          continue;
        }
        const i = hash((x + off) >> 3, course, 9) < 0.3 ? 2 : 3;
        g.set(x, y, py === 0 && px < 6 ? BR[i + 1]! : px === 6 ? BR[i - 1]! : BR[i]!);
      }
    }
    for (let y = 6; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        if (dither2(x, y) < (16 - y) / 10) g.set(x, y, mix(g.get(x, y), FE[0]!, 0.55));
      }
    }
    g.rect(0, 0, 32, 5, CO[3]!);
    g.hline(0, 31, 0, CO[4]!);
    g.hline(0, 31, 4, CO[1]!);
    g.hline(0, 31, 5, BR[0]!);
    g.vline(31, 6, 63, BR[1]!);
  },
};

const billboard: PropArt = {
  id: 'billboard',
  size: [128, 96],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    g.rect(0, 0, 128, 4, FE[2]!);
    g.hline(0, 127, 0, FE[4]!);
    for (let x = 2; x < 128; x += 4) g.set(x, 2, FE[0]!);
    g.rect(4, 4, 120, 56, FE[1]!);
    const bands = ramp('#123a4e', '#17506a', '#1d6782', '#2a8098');
    for (let y = 6; y < 58; y++) g.hline(6, 121, y, bands[Math.min(3, Math.floor((y - 6) / 13))]!);
    g.disc(96, 30, 15, hex('#f08a3c'));
    g.disc(96, 30, 12, hex('#f7a94e'));
    for (let y = 36; y < 46; y += 3) g.hline(78, 114, y, bands[2]!);
    bigText(g, 46, 14, 'PARAPET', hex('#fff1d0'), 2);
    centred(g, 46, 30, 'RUN THE CITY', hex('#f7a94e'));
    g.rect(14, 44, 64, 8, hex('#f0e6c8'));
    centred(g, 46, 46, 'EVERY ROOF', hex('#1d3a4e'));
    g.rect(4, 4, 120, 2, FE[3]!);
    g.rect(4, 58, 120, 2, FE[0]!);
    for (const x of [20, 64, 108]) {
      g.rect(x - 2, 4, 5, 2, FE[3]!);
      g.set(x, 6, hex('#ffe9a0'));
    }
    for (const x of [16, 106]) {
      g.rect(x, 60, 6, 36, FE[2]!);
      g.vline(x, 60, 95, FE[4]!);
      g.vline(x + 5, 60, 95, FE[0]!);
    }
    for (let y = 62; y < 94; y += 16) {
      g.line(22, y, 105, y + 14, FE[2]!);
      g.line(105, y, 22, y + 14, FE[2]!);
    }
  },
};

const skylight: PropArt = {
  id: 'skylight',
  size: [64, 16],
  offset: [0, 16],
  outline: 'in',
  paint(g) {
    for (let y = 0; y < 12; y++) {
      const x0 = 11 - y;
      const x1 = 52 + y;
      for (let x = x0; x <= x1; x++) {
        const streak = (x - y * 2 + 64) % 21 < 3;
        g.set(x, y, streak ? GL[4]! : y < 4 ? GL[3]! : GL[2]!);
      }
      g.set(x0, y, FE[3]!);
      g.set(x1, y, FE[1]!);
    }
    for (const x of [22, 32, 42]) g.vline(x, 0, 11, FE[3]!);
    g.hline(11, 52, 0, FE[4]!);
    g.rect(0, 12, 64, 4, FE[2]!);
    g.hline(0, 63, 12, FE[4]!);
  },
};

// ---------- warehouses ----------

const container = (id: string, r: readonly RGBA[], label: string, doorsLeft: boolean): PropArt => ({
  id,
  size: [192, 64],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    const profile = [3, 4, 4, 3, 2, 1, 1, 2];
    for (let x = 0; x < 192; x++) g.vline(x, 0, 63, r[profile[x % 8]!]!);
    const doors = doorsLeft ? 6 : 140;
    g.rect(doors, 4, 46, 55, r[3]!);
    g.vline(doors + 22, 4, 58, r[0]!);
    g.vline(doors + 23, 4, 58, r[4]!);
    for (const dx of [6, 16, 30, 40]) {
      g.vline(doors + dx, 4, 58, GV[3]!);
      g.vline(doors + dx + 1, 4, 58, GV[1]!);
      g.rect(doors + dx - 1, 28, 4, 2, GV[2]!);
      g.hline(doors + dx + 2, doors + dx + 4, 33, GV[3]!);
    }
    g.rect(0, 0, 192, 4, r[3]!);
    g.hline(0, 191, 0, r[4]!);
    g.hline(0, 191, 3, r[1]!);
    g.rect(0, 59, 192, 5, r[2]!);
    g.hline(0, 191, 59, r[3]!);
    g.hline(0, 191, 63, r[0]!);
    for (const x of [0, 186]) {
      g.rect(x, 0, 6, 64, r[2]!);
      g.vline(x, 0, 63, r[4]!);
      g.vline(x + 5, 0, 63, r[1]!);
      for (const y of [0, 58]) {
        g.rect(x, y, 6, 6, r[1]!);
        g.rect(x + 2, y + 2, 2, 3, RU[0]!);
        g.hline(x, x + 5, y, r[3]!);
      }
    }
    const paint = hex('#ddd8cc');
    const tx = doorsLeft ? 70 : 16;
    text(g, tx, 9, label, paint);
    text(g, tx, 16, '22G1', paint);
    text(g, tx + 60, 9, 'MAX 30480', mix(paint, r[2]!, 0.35));
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(hash(i, 1, id.length) * 170) + 10;
      const w = 3 + Math.floor(hash(i, 2, 4) * 8);
      for (let j = 0; j < w; j++) {
        g.set(x + j, 58, RS[2]!);
        if (j % 2 === 0) g.set(x + j, 57, RS[3]!);
        if (j > 1 && j < w - 1) g.set(x + j, 59, RS[1]!);
      }
    }
  },
});

const crate: PropArt = {
  id: 'crate',
  size: [32, 32],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    g.fill(WD[2]!);
    for (const y of [4, 12, 20]) {
      g.hline(4, 27, y, WD[3]!);
      g.hline(4, 27, y + 7, WD[1]!);
    }
    for (let i = 0; i < 24; i++) {
      for (let t = -1; t <= 1; t++) {
        const x = 4 + i + t;
        const y = 27 - i;
        if (x > 3 && x < 28) g.set(x, y, t === -1 ? WD[4]! : t === 1 ? WD[1]! : WD[3]!);
      }
    }
    for (const [x, y, w, h] of [
      [0, 0, 32, 4],
      [0, 28, 32, 4],
      [0, 0, 4, 32],
      [28, 0, 4, 32],
    ] as const) {
      g.rect(x, y, w, h, WD[3]!);
    }
    g.hline(0, 31, 0, WD[4]!);
    g.vline(0, 0, 31, WD[4]!);
    g.hline(4, 27, 3, WD[1]!);
    g.hline(4, 27, 28, WD[4]!);
    g.vline(3, 4, 27, WD[1]!);
    g.vline(28, 4, 27, WD[4]!);
    g.vline(31, 0, 31, WD[1]!);
    g.hline(0, 31, 31, WD[1]!);
    for (const [x, y] of [
      [1, 1],
      [29, 1],
      [1, 29],
      [29, 29],
    ] as const) {
      g.set(x, y, WD[0]!);
    }
  },
};

const crateBig: PropArt = {
  id: 'crate.big',
  size: [64, 64],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    g.fill(WD[2]!);
    for (let y = 5; y < 59; y += 9) {
      g.hline(5, 58, y, WD[3]!);
      g.hline(5, 58, y + 8, WD[1]!);
    }
    for (const dir of [1, -1]) {
      for (let i = 0; i < 54; i++) {
        for (let t = -2; t <= 2; t++) {
          const x = (dir > 0 ? 5 + i : 58 - i) + t;
          const y = 58 - i;
          if (x > 4 && x < 59) g.set(x, y, t === -2 ? WD[4]! : t === 2 ? WD[1]! : WD[3]!);
        }
      }
    }
    for (const [x, y, w, h] of [
      [0, 0, 64, 5],
      [0, 59, 64, 5],
      [0, 0, 5, 64],
      [59, 0, 5, 64],
    ] as const) {
      g.rect(x, y, w, h, WD[3]!);
    }
    g.hline(0, 63, 0, WD[4]!);
    g.vline(0, 0, 63, WD[4]!);
    g.hline(5, 58, 4, WD[1]!);
    g.vline(4, 5, 58, WD[1]!);
    g.vline(63, 0, 63, WD[1]!);
    g.hline(0, 63, 63, WD[1]!);
    g.rect(14, 8, 36, 7, WD[3]!);
    centred(g, 32, 9, 'FRAGILE', hex('#7a2a1a'));
    for (const [x, y] of [
      [2, 2],
      [60, 2],
      [2, 60],
      [60, 60],
      [31, 2],
      [31, 60],
    ] as const) {
      g.set(x, y, WD[0]!);
    }
  },
};

const pallet: PropArt = {
  id: 'pallet',
  size: [64, 16],
  offset: [0, 16],
  outline: 'in',
  paint(g) {
    for (const [x, w] of [
      [1, 30],
      [33, 30],
    ] as const) {
      g.rect(x, 0, w, 11, BX[2]!);
      g.hline(x, x + w - 1, 0, BX[3]!);
      g.vline(x, 0, 10, BX[3]!);
      g.vline(x + w - 1, 0, 10, BX[0]!);
      g.rect(x + Math.floor(w / 2) - 2, 0, 4, 11, hex('#c8b890'));
      g.hline(x + 3, x + 9, 6, BX[1]!);
    }
    g.rect(0, 11, 64, 2, WD[3]!);
    g.hline(0, 63, 11, WD[4]!);
    for (const x of [0, 28, 56]) {
      g.rect(x, 13, 8, 3, WD[2]!);
      g.vline(x + 7, 13, 15, WD[1]!);
    }
  },
  after(g) {
    const film = withAlpha(hex('#e8eef0'), 110);
    for (let i = 0; i < 64; i += 11) g.line(i + 2, 0, i + 8, 10, film);
  },
};

const rack: PropArt = {
  id: 'rack',
  size: [96, 96],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    for (const x of [0, 92]) {
      g.rect(x, 0, 4, 96, RB[2]!);
      g.vline(x, 0, 95, RB[3]!);
      g.vline(x + 3, 0, 95, RB[1]!);
      for (let y = 8; y < 94; y += 4) g.vline(x + 1, y, y + 1, RB[0]!);
      g.rect(x - (x ? 2 : 0), 93, 6, 3, GV[2]!);
    }
    for (const y of [0, 64]) {
      g.rect(0, y, 96, 5, RO[2]!);
      g.hline(0, 95, y, RO[4]!);
      g.hline(0, 95, y + 1, RO[3]!);
      g.hline(0, 95, y + 4, RO[1]!);
      for (const x of [4, 88]) g.rect(x, y + 1, 4, 3, RB[2]!);
    }
  },
  after(g) {
    const back = withAlpha(RB[0]!, 120);
    for (const [y0, y1] of [
      [5, 63],
      [69, 92],
    ] as const) {
      for (let y = y0; y <= y1; y++)
        for (let x = 4; x < 92; x++) if (!g.alpha(x, y)) g.set(x, y, back);
      for (let x = 12; x < 92; x += 16) g.vline(x, y0, y1, withAlpha(RB[1]!, 150));
    }
  },
};

const forklift: PropArt = {
  id: 'forklift',
  size: [64, 64],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    g.rect(14, 4, 34, 4, FE[2]!);
    g.hline(14, 47, 4, FE[4]!);
    g.rect(14, 8, 3, 26, FE[2]!);
    g.vline(14, 8, 33, FE[3]!);
    g.rect(43, 8, 3, 24, FE[2]!);
    g.rect(40, 2, 3, 2, hex('#f08a20'));
    g.set(40, 2, hex('#ffd080'));
    g.rect(30, 22, 10, 12, RU[2]!);
    g.hline(30, 39, 22, RU[3]!);
    g.line(22, 24, 27, 20, RU[2]!);
    g.rect(16, 32, 30, 22, YL[3]!);
    g.rect(44, 26, 20, 28, YL[2]!);
    g.hline(16, 45, 32, YL[4]!);
    g.hline(44, 63, 26, YL[4]!);
    g.vline(16, 32, 53, YL[4]!);
    for (let y = 30; y < 50; y += 4) g.hline(50, 61, y, YL[1]!);
    g.hline(16, 63, 53, YL[1]!);
    hazard(g, 16, 46, 28, 4, YL[3]!, RU[1]!);
    g.rect(6, 6, 5, 52, ST[2]!);
    g.vline(6, 6, 57, ST[4]!);
    g.vline(8, 6, 57, ST[1]!);
    g.rect(10, 38, 4, 21, ST[3]!);
    g.rect(0, 57, 12, 3, ST[3]!);
    g.hline(0, 11, 57, ST[5]!);
    for (const [cx, cy, r] of [
      [22, 56, 7.5],
      [52, 57, 6.5],
    ] as const) {
      g.disc(cx, cy, r, RU[1]!);
      g.disc(cx - 1, cy - 1, r - 2, RU[2]!);
      g.disc(cx, cy, 2.5, GV[3]!);
      g.set(cx - 1, cy - 1, GV[4]!);
    }
  },
};

// ---------- factory ----------

const catwalkRail: PropArt = {
  id: 'catwalk.rail',
  size: [128, 36],
  offset: [0, -32],
  tile: 'x',
  outline: 'out',
  paint(g) {
    hcyl(g, 0, 127, 0, 3, YL);
    g.hline(0, 127, 15, YL[3]!);
    g.hline(0, 127, 16, YL[1]!);
    g.rect(0, 28, 128, 4, YL[2]!);
    g.hline(0, 127, 28, YL[4]!);
    g.hline(0, 127, 31, YL[1]!);
    for (let x = 14; x < 128; x += 32) {
      vcyl(g, x, 3, 0, 35, YL);
      rivet(g, x, 33, YL[4]!, YL[0]!);
    }
  },
};

const machine: PropArt = {
  id: 'machine',
  size: [96, 64],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    g.rect(0, 0, 96, 58, MG[2]!);
    g.hline(0, 95, 0, MG[4]!);
    g.hline(0, 95, 1, MG[3]!);
    g.vline(0, 0, 57, MG[3]!);
    g.vline(95, 0, 57, MG[1]!);
    g.hline(0, 95, 42, MG[1]!);
    g.hline(0, 95, 43, MG[3]!);
    g.rect(6, 8, 30, 28, MG[0]!);
    g.hline(6, 35, 36, MG[3]!);
    g.vline(36, 8, 36, MG[3]!);
    g.disc(26, 18, 6, ST[3]!);
    g.disc(26, 18, 5, hex('#d8dcd0'));
    g.line(26, 18, 29, 15, RU[0]!);
    g.set(26, 18, hex('#c03028'));
    for (const [x, c] of [
      [9, '#c03028'],
      [13, '#40a050'],
      [17, '#e0c040'],
    ] as const) {
      g.rect(x, 28, 3, 3, hex(c));
      g.set(x, 28, mix(hex(c), hex('#ffffff'), 0.5));
    }
    g.rect(9, 12, 10, 6, hex('#1a3a2a'));
    for (let x = 10; x < 18; x += 2) g.set(x, 14, hex('#60e090'));
    for (let x = 48; x < 90; x += 3) {
      g.vline(x, 10, 38, MG[0]!);
      g.vline(x + 1, 10, 38, MG[3]!);
    }
    for (let y = 0; y < 7; y++) {
      for (let x = 43 - y; x <= 43 + y; x++)
        g.set(x, 44 + y, x === 43 - y || x === 43 + y || y === 6 ? RU[1]! : hex('#e8c030'));
    }
    g.vline(43, 46, 48, RU[1]!);
    g.set(43, 50, RU[1]!);
    for (const x of [3, 92]) for (const y of [4, 39, 47]) rivet(g, x, y, MG[4]!, MG[0]!);
    g.rect(0, 58, 96, 6, FE[2]!);
    g.hline(0, 95, 58, FE[4]!);
    for (const x of [6, 44, 84]) g.rect(x, 60, 6, 3, FE[0]!);
  },
};

const press: PropArt = {
  id: 'press',
  size: [64, 96],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    g.rect(0, 0, 64, 32, MB[2]!);
    g.hline(0, 63, 0, MB[4]!);
    g.hline(0, 63, 1, MB[3]!);
    g.vline(0, 0, 31, MB[3]!);
    g.vline(63, 0, 31, MB[1]!);
    vcyl(g, 20, 24, 3, 24, MB);
    g.hline(20, 43, 3, MB[4]!);
    for (const x of [4, 56]) for (const y of [5, 20]) rivet(g, x, y, MB[4]!, MB[0]!);
    hazard(g, 0, 26, 64, 6, YL[3]!, RU[1]!);
    for (const x of [2, 56]) vcyl(g, x, 6, 32, 63, ST);
    vcyl(g, 27, 10, 32, 38, ST);
    g.rect(0, 64, 64, 32, MB[2]!);
    hazard(g, 0, 64, 64, 5, YL[3]!, RU[1]!);
    g.hline(0, 63, 64, YL[4]!);
    g.hline(0, 63, 69, MB[0]!);
    g.vline(0, 64, 95, MB[3]!);
    g.vline(63, 64, 95, MB[1]!);
    g.rect(8, 74, 48, 12, MB[1]!);
    g.hline(8, 55, 86, MB[3]!);
    centred(g, 32, 77, '200 T', hex('#e8c030'));
    g.rect(0, 92, 64, 4, FE[2]!);
    g.hline(0, 63, 92, FE[3]!);
  },
};

const barrel: PropArt = {
  id: 'barrel',
  size: [32, 32],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    vcyl(g, 2, 28, 0, 31, DB);
    for (const y of [9, 21]) {
      for (let x = 2; x < 30; x++) {
        g.set(x, y, DB[Math.min(4, cylinder(x - 2, 28, 5) + 1)]!);
        g.set(x, y + 1, DB[Math.max(0, cylinder(x - 2, 28, 5) - 2)]!);
      }
    }
    for (let x = 2; x < 30; x++) {
      g.set(x, 0, DB[4]!);
      g.set(x, 1, DB[Math.max(0, cylinder(x - 2, 28, 5) - 1)]!);
      g.set(x, 30, DB[Math.max(0, cylinder(x - 2, 28, 5) - 2)]!);
    }
    const orange = hex('#e07a20');
    for (let y = 0; y < 9; y++) {
      const half = 4 - Math.abs(y - 4);
      g.hline(13 - half, 13 + half, 11 + y, orange);
    }
    g.vline(13, 13, 16, RU[0]!);
    g.set(13, 18, RU[0]!);
    g.set(20, 4, DB[1]!);
  },
};

const conveyor: PropArt = {
  id: 'conveyor',
  size: [128, 16],
  offset: [0, 16],
  outline: 'in',
  paint(g) {
    g.rect(0, 0, 128, 3, RU[1]!);
    g.hline(0, 127, 0, RU[3]!);
    for (let x = 3; x < 128; x += 8) g.set(x, 1, RU[0]!);
    g.rect(0, 3, 128, 6, ST[3]!);
    g.hline(0, 127, 3, ST[5]!);
    g.hline(0, 127, 8, ST[1]!);
    for (let x = 8; x < 128; x += 16) {
      g.disc(x, 5.5, 1.6, ST[1]!);
      g.set(x - 1, 5, ST[5]!);
    }
    for (const x of [6, 118]) {
      g.rect(x, 9, 4, 7, ST[2]!);
      g.vline(x, 9, 15, ST[4]!);
      g.rect(x - 2, 14, 8, 2, ST[1]!);
    }
    g.rect(54, 9, 20, 5, MG[2]!);
    g.hline(54, 73, 9, MG[4]!);
    g.line(10, 10, 54, 13, ST[2]!);
    g.line(74, 13, 117, 10, ST[2]!);
  },
};

// ---------- sewer ----------

const pipeBig: PropArt = {
  id: 'pipe.big',
  size: [128, 32],
  offset: [0, 0],
  tile: 'x',
  outline: 'in',
  paint(g) {
    hcyl(g, 0, 127, 0, 32, IR);
    for (const x of [0, 62, 124]) {
      for (let y = 0; y < 32; y++) {
        g.set(x, y, IR[Math.min(4, cylinder(y, 32, 5) + 1)]!);
        g.set(x + 1, y, IR[Math.min(4, cylinder(y, 32, 5))]!);
        g.set(x + 2, y, IR[Math.min(4, cylinder(y, 32, 5))]!);
        g.set(x + 3, y, IR[Math.max(0, cylinder(y, 32, 5) - 2)]!);
      }
      for (const y of [4, 15, 26]) rivet(g, x + 1, y, IR[4]!, IR[0]!);
    }
    for (const [x, n] of [
      [8, 9],
      [40, 6],
      [70, 11],
      [101, 7],
    ] as const) {
      for (let i = 0; i < n; i++)
        if (i < n - 2 || i % 2 === 0) g.set(x, 18 + i, RS[i < 3 ? 3 : 2]!);
      g.set(x + 1, 18, RS[4]!);
    }
    for (let x = 0; x < 128; x++) {
      const h = hash(x >> 2, 0, 17);
      if (h < 0.5) g.set(x, 1, MOSS[h < 0.2 ? 2 : 1]!);
      if (h < 0.2) g.set(x, 2, MOSS[0]!);
    }
  },
};

const sluice: PropArt = {
  id: 'sluice',
  size: [32, 96],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    const plate = [
      RS[1]!,
      mix(IR[2]!, RS[2]!, 0.5),
      mix(IR[3]!, RS[3]!, 0.4),
      mix(IR[4]!, RS[4]!, 0.3),
    ];
    g.rect(5, 0, 22, 96, plate[1]!);
    for (let y = 8; y < 96; y += 16) {
      g.hline(5, 26, y, plate[3]!);
      g.hline(5, 26, y + 1, plate[2]!);
      g.hline(5, 26, y + 2, plate[0]!);
      for (const x of [8, 15, 22]) rivet(g, x, y + 4, plate[3]!, plate[0]!);
    }
    for (const x of [0, 27]) {
      g.rect(x, 0, 5, 96, IR[2]!);
      g.vline(x, 0, 95, IR[4]!);
      g.vline(x + 4, 0, 95, IR[0]!);
    }
    g.rect(12, 0, 8, 4, IR[3]!);
    g.hline(12, 19, 0, IR[4]!);
    g.rect(14, 1, 4, 2, IR[0]!);
    for (let y = 70; y < 96; y++) {
      for (let x = 5; x < 27; x++) {
        g.set(x, y, mix(g.get(x, y), IR[0]!, 0.35));
        if (y > 82 && dither2(x, y) < (y - 82) / 16) g.set(x, y, MOSS[1]!);
      }
    }
  },
};

const rubble: PropArt = {
  id: 'rubble',
  size: [64, 16],
  offset: [0, 16],
  outline: 'in',
  paint(g) {
    const topAt = (x: number): number => {
      const e = Math.min(x, 63 - x);
      return e < 10 ? Math.round((10 - e) * 0.9) : Math.round(hash(x >> 2, 0, 23) * 2);
    };
    for (let x = 0; x < 64; x++) g.vline(x, topAt(x), 15, SN[0]!);
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 9; k++) {
        const x = Math.floor(k * 7.5 + hash(k, row, 31) * 4 - 2 + (row % 2) * 3);
        const y = row * 4 + Math.floor(hash(k, row, 37) * 2);
        const isBrick = hash(k, row, 41) < 0.5;
        const r = isBrick ? SB : SN;
        const w = isBrick ? 6 : 4 + Math.floor(hash(k, row, 43) * 3);
        for (let j = 0; j < 3; j++) {
          for (let i = 0; i < w; i++) {
            const px = x + i;
            const py = y + j;
            if (px < 0 || px > 63 || py < topAt(px)) continue;
            g.set(px, py, j === 0 ? r[4]! : i === w - 1 || j === 2 ? r[2]! : r[3]!);
          }
        }
      }
    }
  },
};

const valve: PropArt = {
  id: 'valve',
  size: [32, 32],
  offset: [0, 0],
  outline: 'out',
  paint(g) {
    vcyl(g, 13, 6, 22, 31, IR);
    vcyl(g, 11, 10, 20, 21, IR);
    vcyl(g, 12, 8, 13, 19, IR);
    vcyl(g, 15, 2, 9, 12, GV);
    const red = ramp('#4a1410', '#6e1e18', '#8f2a22', '#b8443a');
    for (let y = 0; y < 20; y++) {
      for (let x = 6; x < 27; x++) {
        const d = Math.hypot(x - 16, y - 9);
        if (d >= 6.6 && d <= 8.6) g.set(x, y, red[y < 7 && x < 18 ? 3 : y > 12 ? 1 : 2]!);
      }
    }
    for (let i = -6; i <= 6; i++) {
      g.set(16 + i, 9, red[2]!);
      g.set(16, 9 + i, red[2]!);
    }
    g.disc(16, 9, 1.6, red[3]!);
  },
};

// ---------- hub signs ----------

interface SignStyle {
  board: RGBA;
  border: RGBA;
  title: RGBA;
  name: RGBA;
  post: readonly RGBA[];
  glow?: RGBA;
  extra?(g: Canvas): void;
}

const hubSign = (district: string, label: string, s: SignStyle): PropArt => ({
  id: `hub.sign.${district}`,
  size: [64, 64],
  offset: [0, 0],
  outline: 'in',
  paint(g) {
    for (const x of [12, 48]) {
      g.rect(x, 34, 4, 28, s.post[2]!);
      g.vline(x, 34, 61, s.post[3]!);
      g.vline(x + 3, 34, 61, s.post[0]!);
    }
    g.rect(8, 61, 48, 3, s.post[1]!);
    g.rect(2, 2, 60, 32, s.border);
    g.rect(4, 4, 56, 28, s.board);
    const t = new Canvas(64, 64);
    bigText(t, 32, 7, 'HUB', s.title, 2);
    centred(t, 32, 22, label, s.name);
    if (s.glow) t.outlineOutside(s.glow);
    g.blit(t, 0, 0);
    s.extra?.(g);
  },
});

const signs = [
  hubSign('rooftops', 'ROOFTOPS', {
    board: hex('#1e1a2e'),
    border: FE[2]!,
    title: hex('#ffd6f2'),
    name: hex('#c8f6ff'),
    post: FE,
    glow: hex('#d0408e'),
    extra(g) {
      for (let x = 4; x < 60; x += 4) g.set(x, 2, x % 8 ? hex('#ffd36a') : hex('#fff3c0'));
    },
  }),
  hubSign('warehouses', 'WAREHOUSES', {
    board: hex('#e0b030'),
    border: RU[1]!,
    title: RU[0]!,
    name: RU[1]!,
    post: WD,
    extra(g) {
      hazard(g, 2, 2, 60, 2, YL[4]!, RU[0]!);
      hazard(g, 2, 32, 60, 2, YL[4]!, RU[0]!);
    },
  }),
  hubSign('factory', 'FACTORY', {
    board: hex('#22804a'),
    border: ST[3]!,
    title: hex('#f4f4ee'),
    name: hex('#f4f4ee'),
    post: ST,
    extra(g) {
      for (const [x, y] of [
        [3, 3],
        [59, 3],
        [3, 31],
        [59, 31],
      ] as const) {
        rivet(g, x, y, ST[5]!, ST[0]!);
      }
    },
  }),
  hubSign('sewer', 'SEWER', {
    board: hex('#1f4fa0'),
    border: hex('#e8ecf0'),
    title: hex('#f4f6f8'),
    name: hex('#f4f6f8'),
    post: IR,
    extra(g) {
      for (const [x, y] of [
        [2, 2],
        [61, 2],
        [2, 33],
        [61, 33],
      ] as const) {
        g.set(x, y, CLEAR);
      }
      for (const [x, y, k] of [
        [5, 31, 2],
        [6, 31, 3],
        [57, 4, 2],
        [3, 12, 3],
        [60, 26, 2],
      ] as const) {
        g.set(x, y, RS[k]!);
      }
    },
  }),
];

// ---------- markers ----------

const find: PropArt = {
  id: 'find',
  size: [32, 32],
  offset: [0, 0],
  outline: 'none',
  paint(g) {
    const glow = hex('#ffd050');
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const d = Math.abs(x - 15.5) + Math.abs(y - 15.5);
        if (d <= 13 && d > 8) g.set(x, y, withAlpha(glow, d > 11 ? 36 : 72));
      }
    }
    const star = new Canvas(32, 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const dx = Math.abs(x - 15.5);
        const dy = Math.abs(y - 15.5);
        if (dx + dy <= 6)
          star.set(
            x,
            y,
            dx + dy <= 2
              ? GD[5]!
              : x < 16 && y < 16
                ? GD[4]!
                : x >= 16 && y >= 16
                  ? GD[2]!
                  : GD[3]!,
          );
        else if ((dx < 1 && dy <= 10) || (dy < 1 && dx <= 10)) star.set(x, y, GD[4]!);
      }
    }
    star.outlineOutside(INK);
    g.blit(star, 0, 0);
  },
};

const gate = (id: string, head: (g: Canvas) => void): PropArt => ({
  id,
  size: [32, 64],
  offset: [0, 0],
  outline: 'out',
  paint(g) {
    vcyl(g, 14, 4, 4, 59, GV);
    g.rect(9, 60, 14, 3, FE[2]!);
    g.hline(9, 22, 60, FE[4]!);
    for (let y = 12; y < 58; y += 12) {
      g.hline(14, 17, y, hex('#e8e4dc'));
      g.hline(14, 17, y + 1, hex('#e8e4dc'));
    }
    head(g);
  },
});

const lamp = (g: Canvas, c: RGBA, hi: RGBA): void => {
  g.rect(10, 1, 12, 12, FE[1]!);
  g.hline(10, 21, 1, FE[3]!);
  g.disc(15.5, 7, 4, c);
  g.disc(14.5, 6, 1.6, hi);
};

const markers = [
  find,
  gate('gate.start', (g) => lamp(g, hex('#30d060'), hex('#d0ffd8'))),
  gate('gate.checkpoint', (g) => {
    for (let y = 0; y < 14; y++) {
      const len = Math.round(13 - Math.abs(y - 7) * 1.7);
      for (let x = 18; x < 18 + len; x++) g.set(x, 4 + y, y < 7 ? hex('#f5b830') : hex('#d88a18'));
    }
    g.rect(13, 0, 6, 4, hex('#f0a020'));
    g.hline(13, 18, 0, hex('#ffe0a0'));
  }),
  gate('gate.finish', (g) => {
    const wave = [0, 0, 1, 1, 1, 0, 0, -1, -1, -1, 0, 0, 1, 1];
    for (let x = 18; x < 32; x++) {
      for (let y = 0; y < 18; y++) {
        const yy = y + 4 + wave[x - 18]!;
        const dark = (((x - 18) >> 2) + (y >> 2)) % 2 === 0;
        g.set(x, yy, dark ? RU[1]! : hex('#f2f2ee'));
      }
    }
    g.rect(13, 0, 6, 4, GD[3]!);
  }),
];

export const MARKER_IDS = ['find', 'gate.start', 'gate.checkpoint', 'gate.finish'];

export const PROP_ART: readonly PropArt[] = [
  ladderRoof,
  ladderWh,
  ladderFac,
  ladderSew,
  poleRoof,
  poleWh,
  poleFac,
  poleSew,
  barRoof,
  barWh,
  barFac,
  barSew,
  postRoof,
  postFac,
  postSew,
  fence,
  chain,
  chainHook,
  acUnit,
  waterTank,
  ventDuct,
  chimney,
  billboard,
  skylight,
  container('container', CR, 'PWRU 482117', false),
  container('container.blue', CB, 'TCNU 300512', true),
  crate,
  crateBig,
  pallet,
  rack,
  forklift,
  catwalkRail,
  machine,
  press,
  barrel,
  conveyor,
  pipeBig,
  sluice,
  rubble,
  valve,
  ...signs,
  ...markers,
];

export interface PackedProp {
  art: PropArt;
  sprite: [number, number, number, number];
}

const ATLAS_W = 512;

/** Paints every prop and packs them into one atlas, tallest first, with 1 px gutters. */
export const buildPropsAtlas = (): { atlas: Canvas; packed: PackedProp[] } => {
  const painted = PROP_ART.map((art) => {
    const g = new Canvas(art.size[0], art.size[1]);
    art.paint(g);
    const wrap = { x: art.tile === 'x', y: art.tile === 'y' };
    if (art.outline === 'in') g.outline(INK, wrap);
    if (art.outline === 'out') g.outlineOutside(INK, wrap);
    art.after?.(g);
    return { art, g };
  });
  const order = [...painted].sort((a, b) => b.g.height - a.g.height || b.g.width - a.g.width);
  const spots = new Map<PropArt, [number, number]>();
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const { art, g } of order) {
    if (x + g.width + 2 > ATLAS_W) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    spots.set(art, [x + 1, y + 1]);
    x += g.width + 2;
    shelf = Math.max(shelf, g.height + 2);
  }
  const atlas = new Canvas(ATLAS_W, y + shelf);
  const packed = painted.map(({ art, g }) => {
    const [sx, sy] = spots.get(art)!;
    atlas.blit(g, sx, sy, 0, 0, g.width, g.height, true);
    atlas.gutter(sx, sy, g.width, g.height);
    return { art, sprite: [sx, sy, g.width, g.height] as [number, number, number, number] };
  });
  return { atlas, packed };
};
