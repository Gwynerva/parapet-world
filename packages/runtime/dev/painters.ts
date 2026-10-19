/**
 * Procedural skin layers for the dev harness, ported from the graphics demo: painted per texel
 * from where the texel sits on the body, so 1x and 2x sheets share one design. The game reads PNG
 * sheets from content; these only stand in until those exist. Layers: body, hairRed, hairShort,
 * hoodie, tee, classic, summer. Asymmetric on purpose: the hoodie's chevron on the left sleeve and
 * print on the left chest, the tee's print on the left chest, torn left knee and a phone in the
 * right back pocket, the summer watch on the left wrist, the short hair parted on the left.
 */
import {
  SKIN,
  SKIN_HALF,
  SKIN_SHEET,
  skinFaceRect,
  type SkinFace,
  type SkinPart,
} from '@parapet-world/schemas';
import { FACES, L2, bodyParts, cubeDir, faceN, faceSize } from '../src/mesh.ts';
import type { Pixels } from '../src/skin.ts';
import { clamp, type Vec3 } from '../src/math.ts';

type RGBA = readonly [number, number, number, number];
const D2R = Math.PI / 180;
const S45 = Math.SQRT1_2;

const HEX = (h: string): RGBA => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  255,
];
const PAL_HEX = {
  skinL: '#ffd794',
  skin: '#f7be7b',
  skinM: '#e7aa6b',
  skinD: '#c67539',
  skinDD: '#a55129',
  hairL: '#ff3a18',
  hair: '#e70000',
  hairM: '#c60404',
  hairD: '#a50800',
  hairDD: '#5a0400',
  jeansL: '#7d8aa6',
  jeans: '#6b7994',
  jeansM: '#525d6b',
  jeansD: '#42494a',
  jeansDD: '#313031',
  white: '#ffffff',
  whiteS: '#e0d6c2',
  whiteD: '#bdb197',
  belt: '#0e0c0b',
  beltL: '#2c2826',
  buckle: '#ffffff',
  red: '#e70000',
  redD: '#ad0808',
  redDD: '#5a0400',
  sole: '#ffffff',
  soleS: '#d6cbb5',
  black: '#100c0a',
  eyeW: '#ffffff',
  iris: '#1ea032',
  irisD: '#006910',
  pupil: '#0c1a0c',
  lip: '#d01010',
  lipD: '#7a0c08',
  teeth: '#fff3e0',
  brow: '#7a1206',
  orange: '#ff7a1a',
  glow: '#3fe7ff',
  metal: '#8d939e',
  dark: '#15171c',
  uwL: '#5b6170',
  uw: '#454a57',
  uwD: '#333743',
  hkF: '#a47b52',
  hkL: '#6b4a34',
  hk: '#3e2a1f',
  hkM: '#2e1f17',
  hkD: '#1d130e',
  browK: '#2a1a12',
  hoL: '#56a7a2',
  ho: '#2f7d79',
  hoM: '#256662',
  hoD: '#1a4c49',
  hoDD: '#0f302e',
  cord: '#f2efe6',
  aglet: '#b9bec6',
  jgL: '#5a5e6b',
  jg: '#40434d',
  jgM: '#33363e',
  jgD: '#25272d',
  stripe: '#e9e6dc',
  gyL: '#eef0f3',
  gy: '#cdd2d9',
  gyM: '#a3aab5',
  gyD: '#6c7480',
  teL: '#ffd56b',
  te: '#f2ad2e',
  teM: '#d18e1d',
  teD: '#9e6614',
  ink: '#3a1d12',
  dnL: '#6d93cf',
  dn: '#4769ab',
  dnM: '#36558f',
  dnD: '#273f6d',
  dnC: '#9dbbe4',
  thread: '#e8dcc0',
  brn: '#5c3b22',
  brnL: '#7c5634',
  brass: '#e0bb63',
  phone: '#22252b',
  cv: '#f6f3ec',
  cvS: '#d9d2c4',
  rub: '#2b2b2e',
  heel: '#d23a2a',
  spL: '#ff9a86',
  sp: '#f2634f',
  spM: '#cc4a3b',
  spD: '#9b3229',
  bk: '#25272d',
  bkM: '#1b1c21',
  cyan: '#3fd0e0',
  neon: '#c8f04c',
  neonD: '#93b52d',
  strap: '#17181c',
  dial: '#c3cdd4',
} as const;
const PAL = Object.fromEntries(Object.entries(PAL_HEX).map(([k, v]) => [k, HEX(v)])) as Record<
  keyof typeof PAL_HEX,
  RGBA
>;

const tri = (x: number): number => 1 - Math.abs((((x % 2) + 2) % 2) - 1);
const frac = (x: number): number => x - Math.floor(x);
const hash = (a: number, b: number): number =>
  frac(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
const asinD = (x: number): number => Math.asin(clamp(x, -1, 1)) / D2R;
const acosD = (x: number): number => Math.acos(clamp(x, -1, 1)) / D2R;
const norm180 = (a: number): number => {
  a = ((((a + 180) % 360) + 360) % 360) - 180;
  return a === -180 ? 180 : a;
};

/** Where every region's surface is on the body. */
interface Geo {
  kind: 'head' | 'loft' | 'foot';
  part: string;
  side: 'L' | 'R' | null;
  a0: number;
  a1: number;
}
const GEO = new Map<SkinPart, Geo>();
for (const p of bodyParts(L2)) {
  if (p.shape === 'ellipsoid' || p.shape === 'cone' || GEO.has(p.region)) continue;
  const last = p.region.slice(-1),
    side = last === 'L' || last === 'R' ? last : null,
    part = side ? p.region.slice(0, -1) : p.region;
  if (p.shape === 'cube') GEO.set(p.region, { kind: 'head', part, side, a0: 0, a1: 0 });
  else {
    const rg = p.rings;
    GEO.set(p.region, {
      kind: p.axis === 'x' ? 'foot' : 'loft',
      part,
      side,
      a0: rg[0]!.at,
      a1: rg[rg.length - 1]!.at,
    });
  }
}

/**
 * A texel's place on the body. Head: th around (0 front, +90 the runner's right), ph from the
 * crown (0 top .. 180 under the chin), d the direction. Lofts: th around (the foot: 0 top, 90
 * right, 180 sole), y bone-local height or x heel to toe, v 0 at the top or heel .. 1, and on an
 * end cap cu, cv, rho. o: th turned so +90 is a limb's outer side on either side.
 */
interface Texel {
  part: string;
  side: 'L' | 'R' | null;
  f: SkinFace;
  fx: number;
  fy: number;
  th: number;
  ph: number;
  d: Vec3;
  cap: boolean;
  cu: number;
  cv: number;
  rho: number;
  v: number;
  x: number;
  y: number;
  o: number;
}

function texel(region: SkinPart, f: SkinFace, fx: number, fy: number): Texel {
  const g = GEO.get(region)!,
    [W, H] = faceSize(region, f),
    n = faceN(f, fx, fy, W, H);
  const P: Texel = {
    part: g.part,
    side: g.side,
    f,
    fx,
    fy,
    th: 0,
    ph: 0,
    d: [0, 0, 0],
    cap: false,
    cu: 0,
    cv: 0,
    rho: 0,
    v: 0,
    x: 0,
    y: 0,
    o: 0,
  };
  if (g.kind === 'head') {
    const d = cubeDir(f, n);
    P.d = d;
    P.th = Math.atan2(d[2], d[0]) / D2R;
    P.ph = acosD(d[1]);
  } else {
    const foot = g.kind === 'foot';
    if ((foot ? 'FB' : 'TU').includes(f)) {
      P.cap = true;
      P.cu = foot ? n[1] : n[0];
      P.cv = n[2];
      P.rho = Math.hypot(P.cu, P.cv);
      P.th = Math.atan2(P.cv, P.cu) / D2R;
    } else if (foot) {
      P.th =
        f === 'T'
          ? asinD(n[2] * S45)
          : f === 'U'
            ? norm180(180 - asinD(n[2] * S45))
            : f === 'R'
              ? acosD(n[1] * S45)
              : -acosD(n[1] * S45);
    } else {
      P.th =
        f === 'F'
          ? asinD(n[2] * S45)
          : f === 'B'
            ? norm180(180 - asinD(n[2] * S45))
            : f === 'R'
              ? acosD(n[0] * S45)
              : -acosD(n[0] * S45);
    }
    P.v = foot ? (n[0] + 1) / 2 : (1 - n[1]) / 2;
    if (foot) P.x = g.a0 + P.v * (g.a1 - g.a0);
    else P.y = g.a0 + P.v * (g.a1 - g.a0);
  }
  P.o = P.side === 'L' ? -P.th : P.th;
  return P;
}

type Painter = (P: Texel) => RGBA | null;
interface Layer {
  base?: Painter;
  over?: Painter;
}
const backShade = (a: number, c: RGBA, m: RGBA): RGBA => (a > 122 ? m : c);

/* body: skin, the face, ears, underwear */
function bodyHead(P: Texel): RGBA {
  const th = P.th,
    a = Math.abs(th),
    ph = P.ph;
  const ex = (a - 32) / 15,
    ey = (ph - 96) / 17;
  if (ex * ex + ey * ey < 1) {
    if (ph < 96 - 17 * Math.sqrt(Math.max(0, 1 - ex * ex)) + 4.5) return PAL.black; // the upper lid
    const ix = (a - 29) / 9.5,
      iy = (ph - 100) / 12.5;
    if (ix * ix + iy * iy < 1) {
      const hx = (a - 25.5) / 2.6,
        hy = (ph - 96) / 3.4;
      if (hx * hx + hy * hy < 1) return PAL.eyeW;
      const px = (a - 28) / 4.6,
        py = (ph - 101) / 6.5;
      return px * px + py * py < 1 ? PAL.pupil : ph < 97 ? PAL.irisD : PAL.iris;
    }
    return PAL.eyeW;
  }
  if (a > 86 && a < 108 && ph > 86 && ph < 116) {
    // the ear
    const ox = (a - 97) / 11,
      oy = (ph - 101) / 15;
    return ox * ox + oy * oy > 0.5 ? PAL.skinD : PAL.skinM;
  }
  const mw = 15 - Math.max(0, ph - 124); // a grin, the lower lip curving up at the corners
  if (a < mw && ph > 119 && ph < 131) {
    if (ph < 121.5) return PAL.lip;
    if (ph < 125 && a < mw - 3) return PAL.teeth;
    if (ph < 128 && a < mw - 4) return PAL.lipD;
    return PAL.lip;
  }
  if (ph > 140 || a > 100) return PAL.skinM;
  return PAL.skin;
}

const LAYERS: Record<string, Layer> = {};
LAYERS.body = {
  base(P) {
    const a = Math.abs(P.th),
      y = P.y;
    switch (P.part) {
      case 'head':
        return bodyHead(P);
      case 'neck':
        return a > 110 ? PAL.skinM : PAL.skin;
      case 'chest': {
        // a strapless bandeau: deep over the bust, a narrow band round the back
        if (P.cap) return PAL.skin;
        const top = a < 80 ? 8.4 - (a / 80) * 1.6 : 6.8,
          bot = a < 80 ? 3.2 + (a / 80) * 1.5 : 4.7;
        if (y < top && y > bot) return y > top - 0.55 ? PAL.uwL : backShade(a, PAL.uw, PAL.uwD);
        return backShade(a, PAL.skin, PAL.skinM);
      }
      case 'pelvis': {
        // briefs
        if (P.cap) return PAL.uw;
        const top = -0.2 + (a / 180) * 0.6;
        if (y < top) return y > top - 0.5 ? PAL.uwL : backShade(a, PAL.uw, PAL.uwD);
        if (a < 6 && y > 2.3 && y < 3.0) return PAL.skinD; // the navel
        return backShade(a, PAL.skin, PAL.skinM);
      }
      case 'uarm':
        if (P.cap) return PAL.skin;
        return a > 125 ? PAL.skinM : a < 35 && P.v < 0.5 ? PAL.skinL : PAL.skin;
      case 'larm':
        return backShade(a, PAL.skin, PAL.skinM);
      case 'hand':
        if (P.cap) return PAL.skinM;
        if (a < 60 && P.v > 0.42 && P.v < 0.5) return PAL.skinD;
        return a > 125 || P.v > 0.85 ? PAL.skinM : PAL.skin;
      case 'uleg':
        return backShade(a, PAL.skin, PAL.skinM);
      case 'lleg':
        if (P.cap) return PAL.skinM;
        if (a < 30 && y > -1.2 && y < -0.4) return PAL.skinM;
        return backShade(a, PAL.skin, PAL.skinM);
      case 'foot': {
        // bare feet
        if (P.cap) return P.cu < -0.4 ? PAL.skinD : PAL.skin;
        if (a > 135) return PAL.skinD;
        if (P.x > 6.4 && a < 70 && Math.floor((P.th + 70) / 20) % 2) return PAL.skinM;
        return a > 95 ? PAL.skinM : PAL.skin;
      }
    }
    return null;
  },
};

/* hair 1: red, swept back; the base holds hairline, brows and strands, the overlay the volume */
function redStrands(P: Texel, edge: number, over: boolean): RGBA {
  const d = P.d,
    phi = Math.atan2(d[2], d[1]) / D2R - Math.sign(d[2] || 1) * 28 * d[0],
    s = frac((phi + 720) / 26),
    r = hash(Math.floor((phi + 720) / 26), 3);
  if (edge < (over ? 3.5 : 4.5)) return over ? PAL.hairD : PAL.hairM;
  if (s < 0.3 && d[1] > -0.3 && r > 0.35) return over || P.ph < 40 ? PAL.hairL : PAL.hair;
  if (s > 0.55 && s < 0.78 && r < 0.75) return PAL.hairM;
  return PAL.hair;
}
LAYERS.hairRed = {
  base(P) {
    if (P.part !== 'head') return null;
    const th = P.th,
      a = Math.abs(th),
      ph = P.ph;
    if (ph > 71 && ph < 77 && a > 16 && a < 46) return PAL.brow;
    if (a > 77 && a < 85 && ph > 84 && ph < 104) return PAL.hairD; // sideburns
    const line =
      a < 60
        ? 64 + 5 * tri((th + 90) / 11)
        : a < 80
          ? 70 + (a - 60) * 0.6
          : a < 115
            ? 82 + (a - 80) * 0.25
            : 152;
    return ph > line ? null : redStrands(P, line - ph, false);
  },
  over(P) {
    if (P.part !== 'head') return null;
    const th = P.th,
      a = Math.abs(th),
      ph = P.ph;
    const line =
      a < 50
        ? 57 + 12 * tri((th + 90) / 12)
        : a < 120
          ? 62 + (a - 50) * 0.45 + 20 * frac((a - 50) / 24)
          : 134 + 12 * tri(th / 14);
    return ph > line ? null : redStrands(P, line - ph, true);
  },
};
/* hair 2: short and dark, parted on the runner's left, faded at the sides and the nape */
LAYERS.hairShort = {
  base(P) {
    if (P.part !== 'head') return null;
    const th = P.th,
      a = Math.abs(th),
      ph = P.ph;
    if (ph > 70 && ph < 76 && a > 16 && a < 48) return PAL.browK;
    if (ph < 50 && Math.abs(th + 38) < 4 && ph > 10) return PAL.skinM; // the parting
    const line = a < 55 ? 60 - (th + 55) * 0.05 : a < 115 ? 76 : 118,
      fade = a < 55 ? 0 : 7;
    if (ph > line + fade) return null;
    if (ph > line) return PAL.hkF; // the faded sides and nape
    if (ph < 30 && Math.floor((th + 400) / 15) % 2) return PAL.hkL;
    return Math.floor(P.d[2] * 9 + P.d[1] * 3 + 40) % 2 ? PAL.hk : PAL.hkM;
  },
  over(P) {
    if (P.part !== 'head') return null;
    const th = P.th,
      a = Math.abs(th),
      ph = P.ph;
    if (Math.abs(th + 38) < 5 && ph < 52) return null; // the parting stays flat
    const line = a < 50 && th > -38 ? 50 + 7 * tri((th + 90) / 10) : 40 + 5 * tri(th / 9);
    if (ph > line) return null;
    return line - ph < 4 ? PAL.hkM : ph < 26 ? PAL.hkL : PAL.hk;
  },
};

/* shoes: one sneaker in each costume's colours */
interface Shoe {
  upper: RGBA;
  upperD: RGBA;
  toe: RGBA;
  heel: RGBA;
  collar: RGBA;
  lace: RGBA;
  sole: RGBA;
  tread: RGBA;
  rim: RGBA;
  flash?: RGBA;
}
function sneaker(P: Texel, c: Shoe): RGBA {
  if (P.cap) return P.cu < -0.45 ? c.sole : P.f === 'B' ? c.heel : c.toe;
  const a = Math.abs(P.th),
    x = P.x;
  if (a > 140) return a > 166 ? c.tread : c.sole;
  if (a > 122) return c.rim;
  if (x > 6.1 && a > 45) return c.toe;
  if (a < 25 && x > 0.4 && x < 5.0) return Math.floor(x * 2) % 2 === 0 ? c.lace : c.upperD;
  if (x < -1.7 && a < 50) return c.collar;
  if (c.flash && a > 55 && a < 115 && Math.abs(x - 2.4 - (a - 85) * 0.03) < 0.9) return c.flash;
  return a > 95 ? c.upperD : c.upper;
}
const SHOES: Record<string, Shoe> = {
  grey: {
    upper: PAL.gy,
    upperD: PAL.gyM,
    toe: PAL.gyL,
    heel: PAL.gyD,
    collar: PAL.gyD,
    lace: PAL.white,
    sole: PAL.white,
    tread: PAL.gyD,
    rim: PAL.gyL,
    flash: PAL.hoM,
  },
  canvas: {
    upper: PAL.cv,
    upperD: PAL.cvS,
    toe: PAL.white,
    heel: PAL.heel,
    collar: PAL.cvS,
    lace: PAL.white,
    sole: PAL.white,
    tread: PAL.rub,
    rim: PAL.rub,
  },
  classic: {
    upper: PAL.red,
    upperD: PAL.redD,
    toe: PAL.sole,
    heel: PAL.redD,
    collar: PAL.redDD,
    lace: PAL.sole,
    sole: PAL.sole,
    tread: PAL.black,
    rim: PAL.black,
  },
  neon: {
    upper: PAL.neon,
    upperD: PAL.neonD,
    toe: PAL.white,
    heel: PAL.bk,
    collar: PAL.bk,
    lace: PAL.white,
    sole: PAL.white,
    tread: PAL.bk,
    rim: PAL.white,
    flash: PAL.bk,
  },
};

/* costume 1, closed: a hoodie and joggers; the hood, down, is the overlay round the neck and back */
LAYERS.hoodie = {
  base(P) {
    const th = P.th,
      a = Math.abs(th),
      o = P.o,
      y = P.y,
      rib = Math.floor(P.fx) % 2 === 0;
    switch (P.part) {
      case 'chest': {
        if (P.cap) return PAL.ho;
        if (y > 10.0 && a < 30) return null; // the throat
        if (Math.abs(a - 9) < 2.2 && y > 6.2 && y < 10.2) return y < 6.8 ? PAL.aglet : PAL.cord; // drawstrings
        if (th < -18 && th > -40 && y > 7.4 && y < 8.6) return PAL.cord; // a small print on the left chest
        if (a < 38 && y < 3.6) return a > 34 || y > 3.15 ? PAL.hoD : PAL.hoM; // the pocket
        return a > 122 ? PAL.hoM : a < 30 && y > 5 ? PAL.hoL : PAL.ho;
      }
      case 'pelvis': {
        if (P.cap) return PAL.jgD;
        if (y > 1.5) {
          // pocket, ribbed hem
          return a < 38 && y > 2.0
            ? a > 34
              ? PAL.hoD
              : PAL.hoM
            : y < 2.0
              ? rib
                ? PAL.hoD
                : PAL.hoM
              : backShade(a, PAL.ho, PAL.hoM);
        }
        if (y > 0.7) return rib ? PAL.jgD : PAL.jgM; // the joggers' waistband
        return backShade(a, PAL.jg, PAL.jgM);
      }
      case 'uarm':
        if (P.cap) return PAL.ho;
        if (P.side === 'L' && o > 50 && o < 130 && y < -1.6 && y > -5.6) {
          // a chevron patch on the left sleeve
          const k = Math.abs(o - 90) / 40 + (y + 1.6) / -4;
          return frac(k * 1.6) < 0.45 ? PAL.cord : PAL.ho;
        }
        return backShade(a, PAL.ho, PAL.hoM);
      case 'larm':
        if (y < -6.0) return rib ? PAL.hoD : PAL.hoM;
        return backShade(a, PAL.ho, PAL.hoM);
      case 'uleg':
        if (Math.abs(o - 90) < 8) return PAL.stripe;
        return backShade(a, PAL.jg, PAL.jgM);
      case 'lleg':
        if (P.cap) return P.v > 0.5 ? null : PAL.jg;
        if (y < -9.2) return rib ? PAL.jgD : PAL.jgM;
        if (Math.abs(o - 90) < 8) return PAL.stripe;
        return backShade(a, PAL.jg, PAL.jgM);
      case 'foot':
        return sneaker(P, SHOES.grey!);
    }
    return null;
  },
  over(P) {
    const a = Math.abs(P.th);
    if (P.part === 'neck') {
      return a < 55 ? null : a < 75 ? PAL.hoDD : Math.floor(P.fy * 2) % 2 ? PAL.hoM : PAL.hoD;
    }
    if (P.part !== 'chest') return null;
    if (P.cap)
      return P.cu < 0.3 && P.rho > 0.28 && P.rho < 0.9 ? (P.cu > 0.1 ? PAL.hoDD : PAL.hoM) : null;
    const bottom = 5.4 + (180 - a) * 0.075 + 0.5 * tri(a / 14); // the hood hangs down the back
    if (a < 105 || P.y < bottom) return null;
    return P.y < bottom + 0.7 || a < 112
      ? PAL.hoDD
      : Math.abs(P.y - bottom - 2.6) < 0.3
        ? PAL.hoD
        : PAL.hoM;
  },
};
/* costume 2: a T-shirt and jeans; bare forearms, the jeans rolled into cuffs on the overlay */
LAYERS.tee = {
  base(P) {
    const th = P.th,
      a = Math.abs(th),
      y = P.y;
    const denim = (): RGBA =>
      Math.abs(a - 90) < 3 ? PAL.dnM : a > 122 ? PAL.dnM : a < 28 && P.v < 0.6 ? PAL.dnL : PAL.dn;
    const rip = (): RGBA | null => (Math.floor(P.fy * 2) % 2 === 0 ? PAL.thread : null);
    switch (P.part) {
      case 'chest': {
        if (P.cap) return PAL.te;
        if (y > 10.1 && a < 32) return null;
        if (y > 9.5 && a < 36) return PAL.teM;
        if (th < -16 && th > -42 && y > 6.8 && y < 9.0) {
          return th < -22 && th > -36 && y > 7.3 && y < 8.5 ? PAL.ink : PAL.teL;
        }
        if (a > 122) return PAL.teM;
        return a < 70 && Math.abs(y - 4.4 - th / 60) < 0.25 ? PAL.teM : PAL.te;
      }
      case 'pelvis': {
        if (P.cap) return PAL.dnD;
        if (y > 1.5) return y < 1.9 || a > 122 ? PAL.teM : PAL.te; // the hem over the belt
        if (y > 0.5) {
          // belt, loops
          return a < 8
            ? PAL.brass
            : Math.abs(a - 60) < 4 || Math.abs(a - 150) < 4
              ? PAL.dnD
              : PAL.brn;
        }
        if (a > 126 && a < 170 && y < -0.8 && y > -3.6) {
          // back pockets, a phone in the right one
          if (th > 0 && y > -1.7 && a > 134 && a < 162) return PAL.phone;
          return a < 129 || a > 167 || y < -3.3 ? PAL.thread : PAL.dnM;
        }
        if (a < 3 && y < -0.6) return PAL.dnD;
        if (a > 40 && a < 58 && y > -2.6 && Math.abs(y + (a - 40) * 0.12) < 0.35) return PAL.dnD;
        return a > 122 ? PAL.dnM : PAL.dn;
      }
      case 'uarm':
        if (P.cap) return PAL.te;
        if (y > -3.4) return backShade(a, PAL.te, PAL.teM);
        return y > -4.0 ? PAL.teM : null;
      case 'uleg':
        if (P.side === 'L' && a < 30 && y < -10.4) return rip();
        return denim();
      case 'lleg':
        if (P.cap) return P.v > 0.5 ? null : PAL.dn;
        if (P.side === 'L' && a < 30 && y > -1.6) return rip();
        if (y < -9.9) return null;
        return denim();
      case 'foot':
        return sneaker(P, SHOES.canvas!);
    }
    return null;
  },
  over(P) {
    if (P.part !== 'lleg' || P.cap || P.y > -8.0 || P.y < -9.9) return null;
    return P.y > -8.5 ? PAL.dnD : Math.floor(P.fy * 2) % 2 ? PAL.dnC : PAL.dnL;
  },
};
/* costume 3, the Classic look: a cropped tank top, a belt, light capris rolled at the calf */
function classicTop(P: Texel): RGBA | null {
  const th = P.th,
    a = Math.abs(th),
    y = P.y;
  if (P.cap) return Math.abs(P.cv) > 0.38 && Math.abs(P.cv) < 0.72 ? PAL.white : null; // straps
  const strap = (a > 16 && a < 46) || (a > 134 && a < 164);
  const line = a < 44 ? 8.6 + (a / 44) * 1.4 : a < 68 ? 10.0 : a < 112 ? 9.0 : 10.0;
  if (y > line && !strap) return null;
  if (y < 2.0 + 0.5 * tri((th + 180) / 9) || a > 118) return PAL.whiteS; // a ragged hem
  if (Math.abs(y - 2.9 - 0.3 * tri((th + 180) / 23)) < 0.2) return PAL.whiteS;
  if (a < 34 && y > 3.1 && y < 3.6) return PAL.whiteS; // under the bust
  if (a < 70 && (Math.abs(y - 6.2 - th / 40) < 0.28 || Math.abs(y - 8.0 + th / 50) < 0.24)) {
    return PAL.whiteS; // folds
  }
  return PAL.white;
}
function classicThigh(P: Texel): RGBA {
  const th = P.th,
    a = Math.abs(th),
    v = P.v;
  if (Math.abs(a - 90) < 4 || a > 118) return PAL.jeansM;
  if (a < 80) {
    // soft broken folds
    const cell = Math.floor((th + 180) / 13),
      w = v * 4.2 + cell * 0.37,
      r = Math.abs(Math.sin(cell * 12.9898 + Math.floor(w) * 78.233) * 43758.5453) % 1;
    if (r > 0.55 && Math.abs((w % 1) - 0.5) < 0.1 + r * 0.06) return PAL.jeansM;
  }
  return a < 30 && v < 0.6 ? PAL.jeansL : PAL.jeans;
}
function classicShin(P: Texel): RGBA | null {
  const a = Math.abs(P.th),
    y = P.y;
  if (P.cap) return P.v > 0.5 ? null : PAL.jeans;
  if (y > -3.42) return a > 115 ? PAL.jeansM : PAL.jeans;
  if (y > -5.53) {
    // the rolled cuff
    return y > -3.8 || Math.abs(y + 4.6) < 0.18 ? PAL.jeansD : a > 115 ? PAL.jeans : PAL.jeansL;
  }
  return null;
}
LAYERS.classic = {
  base(P) {
    const a = Math.abs(P.th),
      y = P.y;
    switch (P.part) {
      case 'chest':
        return classicTop(P);
      case 'pelvis':
        if (P.cap) return PAL.jeansD;
        if (y > 1.3) return null;
        if (y > -0.65) return a < 9 ? PAL.buckle : y > 0.95 ? PAL.beltL : PAL.belt;
        if (a < 3 && y < -1.2) return PAL.jeansD;
        if (a > 50 && a < 57 && y > -3.2) return PAL.jeansD;
        return a > 115 ? PAL.jeansM : PAL.jeans;
      case 'uleg':
        return classicThigh(P);
      case 'lleg':
        return classicShin(P);
      case 'foot':
        return sneaker(P, SHOES.classic!);
    }
    return null;
  },
  over(P) {
    switch (P.part) {
      case 'uleg':
        return classicThigh(P);
      case 'lleg':
        return classicShin(P);
      case 'larm':
        return !P.cap && P.y < -4.9 && P.y > -7.0 ? (P.y > -5.4 ? PAL.beltL : PAL.belt) : null;
    }
    return null;
  },
};
/* costume 4, open and tight: a sports top and bike shorts; a watch on the left wrist */
LAYERS.summer = {
  base(P) {
    const th = P.th,
      a = Math.abs(th),
      o = P.o,
      y = P.y;
    switch (P.part) {
      case 'chest': {
        if (P.cap) return Math.abs(P.cv) > 0.4 && Math.abs(P.cv) < 0.66 ? PAL.sp : null;
        if (y > 3.1 && y < 4.1) return Math.abs(y - 3.6) < 0.15 ? PAL.cyan : PAL.spD; // the band
        const cup = y < (a < 70 ? 8.2 - (a / 70) * 0.8 : 6.9),
          strap = Math.abs(a - 30) < 8 && y > 7.0,
          racer = a > 152 && y > 6.0;
        if ((y >= 4.1 && cup) || strap || racer) {
          return a > 122 ? PAL.spM : y > 7.6 && a < 60 ? PAL.spL : PAL.sp;
        }
        return null;
      }
      case 'pelvis':
        if (P.cap) return PAL.bk;
        if (y > 1.2) return null;
        if (y > 0.4) return Math.abs(y - 0.8) < 0.15 ? PAL.cyan : PAL.bkM;
        return backShade(a, PAL.bk, PAL.bkM);
      case 'uleg':
        if (y < -6.6) return null;
        if (y < -6.0) return PAL.bkM;
        if (Math.abs(o - 90) < 7) return PAL.cyan;
        return backShade(a, PAL.bk, PAL.bkM);
      case 'larm':
        if (P.side !== 'L' || P.cap || y > -5.9 || y < -7.1) return null;
        return Math.abs(o - 90) < 38 && y < -6.1 && y > -6.9
          ? Math.abs(o - 90) < 30 && y < -6.2 && y > -6.8
            ? PAL.dial
            : PAL.metal
          : PAL.strap;
      case 'foot':
        return sneaker(P, SHOES.neon!);
    }
    return null;
  },
};

export const LAYER_NAMES = [
  'body',
  'hairRed',
  'hairShort',
  'hoodie',
  'tee',
  'classic',
  'summer',
] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

/** Paints one layer as a sheet (1x 128 x 128 or 2x 256 x 256). */
export function paintLayer(name: LayerName, scale = 1): Pixels {
  const layer = LAYERS[name]!,
    W = SKIN_SHEET * scale,
    px = new Uint8ClampedArray(W * W * 4);
  for (const region of Object.keys(SKIN) as SkinPart[]) {
    for (const f of FACES) {
      const [x0, y0, fw, fh] = skinFaceRect(region, f);
      for (let y = 0; y < fh * scale; y++) {
        for (let x = 0; x < fw * scale; x++) {
          const P = texel(region, f, (x + 0.5) / scale, (y + 0.5) / scale);
          for (const half of [0, 1]) {
            const fn = half ? layer.over : layer.base;
            if (!fn) continue;
            const c = fn(P);
            if (!c) continue;
            const o = (((y0 + half * SKIN_HALF) * scale + y) * W + x0 * scale + x) * 4;
            px[o] = c[0];
            px[o + 1] = c[1];
            px[o + 2] = c[2];
            px[o + 3] = c[3];
          }
        }
      }
    }
  }
  return { width: W, height: W, data: px };
}
