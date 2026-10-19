/**
 * A synthetic world for the dev harness, until the baker writes real content: two districts of
 * 2 x 2 chunks each, procedurally painted tile atlases in the schemas layout (one material
 * without depth strips to show the edge fallback, one flat), a props atlas with markers, parallax
 * layers, and a test level with platforms above and below the screen centre, slopes, low walls,
 * slabs, planks, a pit, and blocks across chunk and district borders.
 */
import {
  ATLAS_WIDTH,
  CELL_PX,
  CHUNK_CELLS,
  CELL_CHARS,
  Cell,
  UNITS_PER_PX,
  atlasHeight,
  bytesToBase64,
  frontRect,
  sideStripRect,
  topStripRect,
  type BackgroundLayer,
  type ChunkFile,
  type DistrictDef,
  type MaterialDef,
  type PropDef,
  type PropPlacement,
  type WorldIndex,
} from '@parapet-world/schemas';
import type { WorldArt } from './renderer.ts';
import type { Pixels } from './skin.ts';
import { outlines } from './outline.ts';

type RGB = readonly [number, number, number];

/** A small RGBA canvas in plain memory. */
class Img implements Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  put(x: number, y: number, c: RGB, k = 1, a = 255): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 4;
    this.data[o] = c[0] * k;
    this.data[o + 1] = c[1] * k;
    this.data[o + 2] = c[2] * k;
    this.data[o + 3] = a;
  }
  rect(x0: number, y0: number, w: number, h: number, c: RGB, k = 1): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.put(x, y, c, k);
  }
  copy(sx: number, sy: number, dx: number, dy: number): void {
    const s = (sy * this.width + sx) * 4,
      d = (dy * this.width + dx) * 4;
    for (let k = 0; k < 4; k++) this.data[d + k] = this.data[s + k]!;
  }
  /** Repeats a rect's border pixels one pixel outward (the atlas gutter), corners too. */
  pad(x0: number, y0: number, w: number, h: number): void {
    for (let x = -1; x <= w; x++) {
      const sx = x0 + Math.min(w - 1, Math.max(0, x));
      this.copy(sx, y0, x0 + x, y0 - 1);
      this.copy(sx, y0 + h - 1, x0 + x, y0 + h);
    }
    for (let y = -1; y <= h; y++) {
      const sy = y0 + Math.min(h - 1, Math.max(0, y));
      this.copy(x0, sy, x0 - 1, y0 + y);
      this.copy(x0 + w - 1, sy, x0 + w, y0 + y);
    }
  }
}

let seed = 1;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

/* ---------- materials ---------- */

type Paint = (x: number, y: number, w: number, h: number) => [RGB, number];
interface MatSpec {
  id: string;
  district: 'rooftops' | 'warehouses';
  slot: number;
  cell: number;
  depth: MaterialDef['depth'];
  sound: MaterialDef['sound'];
  rim: RGB;
  front: Paint;
  top: Paint | null;
  side: Paint | null;
}
const C = {
  con: [128, 128, 132] as RGB,
  con2: [108, 108, 116] as RGB,
  cap: [176, 172, 160] as RGB,
  br: [150, 66, 48] as RGB,
  br2: [128, 52, 40] as RGB,
  mort: [196, 184, 168] as RGB,
  met: [96, 114, 138] as RGB,
  met2: [70, 84, 104] as RGB,
  riv: [170, 184, 200] as RGB,
  wood: [168, 122, 72] as RGB,
  wood2: [130, 90, 52] as RGB,
  blue: [80, 112, 132] as RGB,
  blue2: [60, 88, 108] as RGB,
  yel: [210, 170, 60] as RGB,
  dark: [40, 38, 36] as RGB,
  lcon: [150, 148, 140] as RGB,
  lcon2: [126, 124, 118] as RGB,
};
const n = (base: RGB, lo = 0.9, hi = 0.1): [RGB, number] => [base, lo + rnd() * hi];
const brick: Paint = (x, y) => {
  const row = y >> 2,
    off = row % 2 ? 4 : 0;
  if (y % 4 === 3 || (x + off) % 8 === 7) return n(C.mort, 0.92, 0.08);
  return n((row + ((x + off) >> 3)) % 3 ? C.br : C.br2, 0.9, 0.12);
};
const MATS: MatSpec[] = [
  {
    id: 'roof.concrete',
    district: 'rooftops',
    slot: 0,
    cell: Cell.SOLID,
    depth: 'strip',
    sound: 'concrete',
    rim: [70, 70, 76],
    front: (x, y) => n(y < 4 ? C.cap : (x * 7 + y * 3) % 23 === 0 ? C.con2 : C.con, 0.92),
    top: (x) => n(x % 16 === 0 ? C.con2 : C.cap, 0.94, 0.06),
    side: () => n(C.con, 0.88),
  },
  {
    id: 'roof.brick',
    district: 'rooftops',
    slot: 1,
    cell: Cell.SOLID,
    depth: 'strip',
    sound: 'brick',
    rim: [82, 34, 26],
    front: brick,
    top: (_x, y) => n(y > 13 ? C.con2 : C.cap, 0.9),
    side: (x, y, w, h) => brick(y, x, h, w),
  },
  {
    // painted without strips: its depth faces fall back to stretching the tile's edge
    id: 'roof.sheet',
    district: 'rooftops',
    slot: 2,
    cell: Cell.SOLID,
    depth: 'strip',
    sound: 'metal',
    rim: [40, 48, 60],
    front: (x, y) => {
      const rv = (x === 4 || x === 27) && (y === 4 || y === 27);
      return [rv ? C.riv : x % 4 === 0 ? C.met2 : C.met, rv ? 1 : 0.95 + rnd() * 0.05];
    },
    top: null,
    side: null,
  },
  {
    id: 'roof.plank',
    district: 'rooftops',
    slot: 3,
    cell: Cell.TOP,
    depth: 'strip',
    sound: 'wood',
    rim: [70, 44, 24],
    front: (_x, y) => n(y === 4 ? C.wood2 : C.wood, 0.92, 0.08),
    top: (x) => n(x % 8 === 0 ? C.wood2 : C.wood, 0.92, 0.08),
    side: () => n(C.wood2, 0.9),
  },
  {
    id: 'wh.concrete',
    district: 'warehouses',
    slot: 0,
    cell: Cell.SOLID,
    depth: 'strip',
    sound: 'concrete',
    rim: [76, 74, 70],
    front: (x, y) => n(y < 3 ? C.lcon : (x + y * 5) % 19 === 0 ? C.lcon2 : C.lcon, 0.92),
    top: (x, y) => n((x + y) % 11 === 0 ? C.lcon2 : C.lcon, 0.95, 0.06),
    side: () => n(C.lcon2, 0.9),
  },
  {
    id: 'wh.corrugated',
    district: 'warehouses',
    slot: 1,
    cell: Cell.SOLID,
    depth: 'edge',
    sound: 'metal',
    rim: [36, 52, 64],
    front: (x) => n(x % 4 < 2 ? C.blue : C.blue2, 0.95, 0.05),
    top: (x) => n(x % 4 < 2 ? C.blue : C.blue2, 0.95, 0.05),
    side: () => n(C.blue2, 0.9),
  },
  {
    id: 'wh.dock',
    district: 'warehouses',
    slot: 2,
    cell: Cell.SOLID,
    depth: 'flat',
    sound: 'concrete',
    rim: [30, 28, 26],
    front: (x, y) => n(y < 6 ? (((x + y) >> 2) % 2 ? C.yel : C.dark) : C.con2, 0.92),
    top: () => n(C.con2),
    side: () => n(C.con2),
  },
  {
    id: 'wh.mezzanine',
    district: 'warehouses',
    slot: 3,
    cell: Cell.TOP,
    depth: 'strip',
    sound: 'metal',
    rim: [90, 70, 20],
    front: (x, y) => n(y > 1 && y < 7 && (x + y) % 3 === 0 ? C.dark : C.yel, 0.92),
    top: (x, y) => n((x + y) % 3 === 0 || (x - y + 48) % 3 === 0 ? C.dark : C.yel, 0.94),
    side: () => n(C.yel, 0.85),
  },
];

/** Paints a district's tile atlas in the schemas layout and returns it with material averages. */
function paintAtlas(district: string): { img: Img; avg: Map<string, RGB> } {
  const mats = MATS.filter((m) => m.district === district),
    slots = Math.max(...mats.map((m) => m.slot)) + 1,
    img = new Img(ATLAS_WIDTH, atlasHeight(slots)),
    avg = new Map<string, RGB>();
  for (const m of mats) {
    // the base tile, then every variant: a rim where the neighbour differs, light up and left
    const base: [RGB, number][] = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) base.push(m.front(x, y, 32, 32));
    let sr = 0,
      sg = 0,
      sb = 0;
    for (const [c, k] of base) {
      sr += c[0] * k;
      sg += c[1] * k;
      sb += c[2] * k;
    }
    avg.set(m.id, [Math.round(sr / 1024), Math.round(sg / 1024), Math.round(sb / 1024)]);
    for (let v = 0; v < 16; v++) {
      const [fx, fy] = frontRect(m.slot, v);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const [c, k] = base[y * 32 + x]!;
          const rim =
            (!(v & 1) && y === 0) ||
            (!(v & 4) && y === 31) ||
            (!(v & 8) && x === 0) ||
            (!(v & 2) && x === 31);
          if (rim) img.put(fx + x, fy + y, m.rim);
          else if ((!(v & 1) && y === 1) || (!(v & 8) && x === 1))
            img.put(fx + x, fy + y, c, k * 1.15);
          else if ((!(v & 4) && y === 30) || (!(v & 2) && x === 30))
            img.put(fx + x, fy + y, c, k * 0.8);
          else img.put(fx + x, fy + y, c, k);
        }
      }
      img.pad(fx, fy, 32, 32);
    }
    if (m.top && m.side) {
      const [tx, ty] = topStripRect(m.slot),
        [sx, sy] = sideStripRect(m.slot);
      // row 0 of the top strip and column 0 of the side strip meet the front face: the rim
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 32; x++) {
          const [c, k] = m.top(x, y, 32, 16);
          img.put(tx + x, ty + y, y === 0 ? m.rim : c, y === 0 ? 1 : k * (y === 1 ? 1.12 : 1));
        }
      }
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 16; x++) {
          const [c, k] = m.side(x, y, 16, 32);
          img.put(sx + x, sy + y, x === 0 ? m.rim : c, x === 0 ? 1 : k);
        }
      }
      img.pad(tx, ty, 32, 16);
      img.pad(sx, sy, 16, 32);
    }
  }
  return { img, avg };
}

/* ---------- props ---------- */

const OUTLINE: RGB = [24, 20, 18];
function paintProps(): {
  img: Img;
  defs: PropDef[];
  markers: Record<string, [number, number, number, number]>;
} {
  const img = new Img(256, 128);
  const box = (
    x0: number,
    y0: number,
    w: number,
    h: number,
    fill: (x: number, y: number) => RGB,
  ): void => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        img.put(x0 + x, y0 + y, edge ? OUTLINE : fill(x, y));
      }
    }
  };
  // crate 32 x 32
  box(0, 0, 32, 32, (x, y) =>
    x < 3 || y < 3 || x > 28 || y > 28 || Math.abs(x - y) < 2 || Math.abs(x + y - 31) < 2
      ? C.wood2
      : C.wood,
  );
  // container 96 x 64: ribs, doors, a stencilled band
  box(32, 0, 96, 64, (x, y) =>
    y > 6 && y < 12 ? [220, 220, 210] : x % 6 < 2 ? [150, 46, 34] : [178, 60, 44],
  );
  // AC unit 64 x 32 with a fan grille
  box(128, 0, 64, 32, (x, y) => {
    const dx = x - 44,
      dy = y - 16,
      r = Math.hypot(dx, dy);
    if (r < 11) return r < 3 ? C.dark : Math.floor(r) % 3 === 0 ? [90, 96, 104] : [150, 156, 162];
    return x < 26 && y % 4 === 1 ? [140, 146, 150] : [188, 192, 196];
  });
  // water tank 64 x 96 on legs
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 64; x++) {
      const legs = y >= 60 && (x < 6 || x > 57 || (y > 74 && y < 78));
      const tank = y < 62;
      if (!legs && !tank) continue;
      const edge = tank && (x === 0 || x === 63 || y === 0 || y === 61);
      const legEdge = legs && (x === 0 || x === 5 || x === 58 || x === 63 || y === 95);
      img.put(
        192 + x,
        y,
        edge || legEdge
          ? OUTLINE
          : legs
            ? [70, 70, 74]
            : y % 10 < 2
              ? [110, 86, 60]
              : [146, 112, 76],
      );
    }
  }
  // ladder segment 32 x 32 (tiles vertically)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const rail = (x >= 6 && x <= 8) || (x >= 23 && x <= 25),
        rung = (y % 8 === 3 || y % 8 === 4) && x > 8 && x < 23;
      if (rail || rung)
        img.put(x, 64 + y, x === 6 || x === 25 || (rung && y % 8 === 4) ? OUTLINE : [190, 170, 60]);
    }
  }
  // railing 64 x 32, front layer
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 64; x++) {
      const bar = y >= 6 && y <= 8,
        mid = y >= 18 && y <= 19,
        post = x % 21 >= 0 && x % 21 <= 2;
      if (bar || mid || (post && y >= 6))
        img.put(32 + x, 64 + y, y === 6 || y === 8 ? OUTLINE : [200, 60, 40]);
    }
  }
  // antenna pole 32 x 32 (tiles vertically)
  for (let y = 0; y < 32; y++)
    for (let x = 14; x < 18; x++)
      img.put(96 + x, 64 + y, x === 14 || x === 17 ? OUTLINE : [170, 176, 186]);
  // markers: a find (star) 16 x 16, a gate 16 x 48
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = Math.abs(x - 7.5),
        dy = Math.abs(y - 7.5),
        star = dx + dy < 7 && (dx < 2 || dy < 2 || dx + dy < 4.5);
      if (star) img.put(128 + x, 64 + y, dx + dy > 5.5 ? [200, 120, 20] : [255, 220, 80]);
    }
  }
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 16; x++) {
      if (x < 3 || x > 12 || y < 3)
        img.put(144 + x, 64 + y, (x + y) % 6 < 3 ? [60, 220, 160] : [30, 120, 90]);
    }
  }
  const defs: PropDef[] = [
    {
      id: 'crate',
      districts: ['rooftops', 'warehouses'],
      sprite: [0, 0, 32, 32],
      offset: [0, 0],
      mask: ['#'],
      layer: 'mid',
    },
    {
      id: 'container',
      districts: ['warehouses'],
      sprite: [32, 0, 96, 64],
      offset: [0, 0],
      mask: ['###', '###'],
      layer: 'mid',
    },
    {
      id: 'ac',
      districts: ['rooftops'],
      sprite: [128, 0, 64, 32],
      offset: [0, 0],
      mask: ['##'],
      layer: 'mid',
    },
    {
      id: 'tank',
      districts: ['rooftops'],
      sprite: [192, 0, 64, 96],
      offset: [0, 0],
      mask: ['##', '..', '..'],
      layer: 'mid',
    },
    {
      id: 'ladder',
      districts: ['rooftops', 'warehouses'],
      sprite: [0, 64, 32, 32],
      offset: [0, 0],
      mask: ['H'],
      layer: 'mid',
    },
    {
      id: 'railing',
      districts: ['rooftops', 'warehouses'],
      sprite: [32, 64, 64, 32],
      offset: [0, 0],
      mask: ['..'],
      layer: 'front',
    },
    {
      id: 'pole',
      districts: ['rooftops'],
      sprite: [96, 64, 32, 32],
      offset: [0, 0],
      mask: ['P'],
      layer: 'mid',
    },
  ];
  const gate: [number, number, number, number] = [144, 64, 16, 48];
  return {
    img,
    defs,
    markers: {
      find: [128, 64, 16, 16],
      'gate.start': gate,
      'gate.checkpoint': gate,
      'gate.finish': gate,
    },
  };
}

/* ---------- backgrounds ---------- */

function skyline(
  w: number,
  h: number,
  colour: RGB,
  window: RGB,
  step: number,
  minH: number,
  s: number,
): Img {
  const img = new Img(w, h);
  seed = s;
  for (let x = 0; x < w;) {
    const bw = 18 + Math.floor(rnd() * step),
      bh = minH + Math.floor(rnd() * (h - minH - 10));
    for (let y = h - bh; y < h; y++) {
      for (let k = 0; k < bw && x + k < w; k++) {
        const win = (k % 6 === 2 || k % 6 === 3) && (y - (h - bh)) % 7 === 3 && rnd() < 0.55;
        img.put(x + k, y, win ? window : colour);
      }
    }
    x += bw + Math.floor(rnd() * 6);
  }
  return img;
}
function racks(w: number, h: number, colour: RGB, s: number): Img {
  const img = new Img(w, h);
  seed = s;
  for (let x = 0; x < w; x += 64) {
    const top = 30 + Math.floor(rnd() * 40);
    for (let y = top; y < h; y++) {
      for (let k = 0; k < 56; k++) {
        const upright = k < 3 || k > 52,
          shelf = (y - top) % 22 < 3;
        const box =
          !upright && !shelf && (y - top) % 22 > 8 && (k >> 3) % 2 === (((y - top) / 22) | 0) % 2;
        if (upright || shelf) img.put(x + k, y, colour);
        else if (box) img.put(x + k, y, colour, 1.35);
      }
    }
  }
  // a gantry crane
  for (let y = 20; y < 26; y++) for (let x = 0; x < w; x++) img.put(x, y, colour, 0.9);
  return img;
}

/* ---------- the level ---------- */

export const WORLD_W = 128;
export const WORLD_H = 64;
/** The walkway's top row: runners stand at y = GROUND_ROW * 32 px. */
export const GROUND_ROW = 44;

export interface SyntheticWorld {
  world: WorldIndex;
  chunks: ChunkFile[];
  art: WorldArt;
  /** Marker sprites in the props atlas. */
  markers: Record<string, [number, number, number, number]>;
  /** Ground height (world px of the top surface) of every px column, for walking runners. */
  ground(xPx: number): number;
  /** Where to start, world units. */
  spawn: [number, number];
}

export function syntheticWorld(): SyntheticWorld {
  seed = 7;
  const W = WORLD_W,
    H = WORLD_H,
    cells = new Uint8Array(W * H),
    mats = new Uint8Array(W * H);
  const matIndex = (id: string): number => MATS.findIndex((m) => m.id === id) + 1;
  const fill = (x0: number, y0: number, x1: number, y1: number, id: string, cls?: number): void => {
    const m = matIndex(id),
      c = cls ?? MATS[m - 1]!.cell;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        cells[y * W + x] = c;
        mats[y * W + x] = m;
      }
    }
  };
  const G = GROUND_ROW;
  // rooftops: the walkway and the building below
  fill(0, G, 63, G + 1, 'roof.concrete');
  fill(0, G + 2, 63, H - 1, 'roof.brick');
  // a pit with a floor
  fill(26, G, 28, G + 9, 'roof.concrete', Cell.EMPTY);
  for (let y = G; y <= G + 9; y++) for (let x = 26; x <= 28; x++) mats[y * W + x] = 0;
  // a ramp: slope up, a raised run, slope down
  fill(34, G - 1, 34, G - 1, 'roof.concrete', Cell.SLOPE_UP);
  fill(35, G - 1, 39, G - 1, 'roof.concrete');
  fill(40, G - 1, 40, G - 1, 'roof.concrete', Cell.SLOPE_DOWN);
  // a low wall (HALF) and a slab overhang
  fill(12, G - 1, 13, G - 1, 'roof.brick', Cell.HALF);
  fill(57, G - 4, 61, G - 4, 'roof.concrete', Cell.SLAB);
  // platforms above the centre: sheet metal (no strips: edge fallback), concrete, one across the
  // chunk border at x = 32, a tower across the chunk-row border at y = 32
  fill(5, G - 8, 10, G - 7, 'roof.sheet');
  fill(16, G - 9, 22, G - 9, 'roof.concrete');
  fill(29, G - 14, 36, G - 13, 'roof.brick');
  fill(44, G - 20, 47, G - 1, 'roof.brick');
  fill(43, G - 21, 48, G - 21, 'roof.concrete');
  // planks (TOP)
  fill(50, G - 5, 55, G - 5, 'roof.plank');
  // across the district border at x = 64
  fill(60, G - 7, 63, G - 7, 'roof.concrete');
  fill(64, G - 7, 68, G - 7, 'wh.concrete');
  // warehouses
  fill(64, G, 127, H - 1, 'wh.concrete');
  fill(72, G - 6, 79, G - 6, 'wh.mezzanine');
  fill(84, G - 10, 88, G - 1, 'wh.corrugated');
  fill(92, G - 3, 99, G - 1, 'wh.dock');
  for (let k = 0; k < 5; k++) fill(102 + k, G - 1 - k, 102 + k, G - 1, 'wh.concrete');
  fill(107, G - 13, 118, G - 12, 'wh.concrete');
  fill(119, G - 5, 119, G - 5, 'wh.concrete', Cell.SLOPE_DOWN);
  fill(107, G - 5, 118, G - 5, 'wh.corrugated');
  fill(120, G - 2, 126, G - 1, 'wh.concrete', Cell.HALF);

  // props
  const { img: propsImg, defs, markers } = paintProps();
  const place: [string, number, number][] = [
    ['crate', 9, G - 1],
    ['crate', 10, G - 1],
    ['crate', 10, G - 2],
    ['ac', 56, G - 1],
    ['tank', 22, G - 3],
    ['railing', 3, G - 1],
    ['railing', 30, G - 1],
    ['railing', 52, G - 1],
    ['pole', 59, G - 1],
    ['pole', 59, G - 2],
    ['pole', 59, G - 3],
    ['container', 70, G - 2],
    ['container', 76, G - 2],
    ['container', 73, G - 4],
    ['crate', 82, G - 1],
    ['railing', 96, G - 4],
    ['railing', 110, G - 14],
  ];
  for (let y = G - 20; y <= G - 1; y++) place.push(['ladder', 43, y]);
  for (let y = G - 9; y <= G - 1; y++) place.push(['ladder', 89, y]);
  const placements = new Map<string, PropPlacement[]>();
  for (const [id, x, y] of place) {
    const p = defs.findIndex((d) => d.id === id),
      def = defs[p]!;
    def.mask.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const ch = row[dx]!;
        if (ch !== '.') cells[(y + dy) * W + x + dx] = CELL_CHARS[ch] ?? Cell.EMPTY;
      }
    });
    const key = `${Math.floor(x / CHUNK_CELLS)},${Math.floor(y / CHUNK_CELLS)}`;
    let l = placements.get(key);
    if (!l) placements.set(key, (l = []));
    l.push({ prop: p, x, y });
  }

  // autotile variants: which neighbours carry the same material
  const variants = new Uint8Array(W * H);
  const same = (x: number, y: number, m: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && mats[y * W + x] === m;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const m = mats[y * W + x]!;
      if (!m) continue;
      variants[y * W + x] =
        (same(x, y - 1, m) ? 1 : 0) |
        (same(x + 1, y, m) ? 2 : 0) |
        (same(x, y + 1, m) ? 4 : 0) |
        (same(x - 1, y, m) ? 8 : 0);
    }
  }

  // art
  const roof = paintAtlas('rooftops'),
    wh = paintAtlas('warehouses');
  const avg = new Map([...roof.avg, ...wh.avg]);
  const backgrounds: Record<string, Pixels> = {
    'rooftops/bg-0.png': skyline(512, 224, [38, 48, 86], [232, 200, 120], 40, 60, 11),
    'rooftops/bg-1.png': skyline(512, 224, [28, 34, 62], [255, 214, 130], 60, 90, 23),
    'warehouses/bg-0.png': racks(512, 224, [58, 54, 50], 5),
    'warehouses/bg-1.png': skyline(512, 224, [44, 40, 38], [200, 170, 90], 70, 110, 41),
  };
  // the art places a layer's top edge at screen y = y - factor * (top of a 683 x 384 view)
  const viewTop = G * CELL_PX - 40 - 192;
  const layer = (file: string, factor: number, bottomOnScreen: number): BackgroundLayer => ({
    file,
    factor,
    y: bottomOnScreen - 224 + factor * viewTop,
    repeatX: true,
  });
  const districts: DistrictDef[] = [
    {
      id: 'rooftops',
      name: 'Rooftops',
      atlas: 'art/rooftops/tiles.png',
      background: [layer('rooftops/bg-0.png', 0.25, 250), layer('rooftops/bg-1.png', 0.5, 262)],
      sky: [26, 34, 66],
      ambience: 'wind',
    },
    {
      id: 'warehouses',
      name: 'Warehouses',
      atlas: 'art/warehouses/tiles.png',
      background: [layer('warehouses/bg-0.png', 0.3, 250), layer('warehouses/bg-1.png', 0.55, 262)],
      sky: [52, 44, 40],
      ambience: 'hall',
    },
  ];
  const materials: MaterialDef[] = [
    {
      id: 'none',
      district: '',
      slot: 0,
      cell: Cell.EMPTY,
      avg: [0, 0, 0],
      depth: 'flat',
      sound: 'concrete',
    },
    ...MATS.map((m): MaterialDef => ({
      id: m.id,
      district: m.district,
      slot: m.slot,
      cell: m.cell as MaterialDef['cell'],
      avg: [...avg.get(m.id)!] as [number, number, number],
      depth: m.depth,
      sound: m.sound,
    })),
  ];

  // chunks
  const lines = outlines(cells, mats, W, H);
  const chunks: ChunkFile[] = [];
  for (let cy = 0; cy < H / CHUNK_CELLS; cy++) {
    for (let cx = 0; cx < W / CHUNK_CELLS; cx++) {
      const grid = (src: Uint8Array): string => {
        const out = new Uint8Array(CHUNK_CELLS * CHUNK_CELLS);
        for (let y = 0; y < CHUNK_CELLS; y++) {
          for (let x = 0; x < CHUNK_CELLS; x++) {
            out[y * CHUNK_CELLS + x] = src[(cy * CHUNK_CELLS + y) * W + cx * CHUNK_CELLS + x]!;
          }
        }
        return bytesToBase64(out);
      };
      chunks.push({
        format: 1,
        cx,
        cy,
        cells: grid(cells),
        materials: grid(mats),
        variants: grid(variants),
        outlines: lines.get(`${cx},${cy}`) ?? [],
        props: placements.get(`${cx},${cy}`) ?? [],
      });
    }
  }

  const world: WorldIndex = {
    format: 1,
    bounds: [0, 0, W / CHUNK_CELLS, H / CHUNK_CELLS],
    chunks: chunks.map((c) => ({ cx: c.cx, cy: c.cy, file: `chunks/${c.cx}-${c.cy}.json` })),
    materials,
    districts,
    regions: [
      { id: 'rooftops', district: 'rooftops', rect: [0, 0, 64, H], hub: 0 },
      { id: 'warehouses', district: 'warehouses', rect: [64, 0, 64, H], hub: 1 },
    ],
    hubs: [
      {
        id: 'rooftops',
        district: 'rooftops',
        name: 'Rooftops hub',
        rect: [14, G - 4, 4, 4],
        spawn: [(15 * CELL_PX + 16) * UNITS_PER_PX, G * CELL_PX * UNITS_PER_PX],
        facing: 1,
      },
      {
        id: 'warehouses',
        district: 'warehouses',
        name: 'Warehouses hub',
        rect: [64, G - 4, 5, 4],
        spawn: [(66 * CELL_PX + 16) * UNITS_PER_PX, G * CELL_PX * UNITS_PER_PX],
        facing: 1,
      },
    ],
    routes: [
      {
        id: 'roof-dash',
        district: 'rooftops',
        name: 'Roof dash',
        difficulty: 1,
        start: [18, G - 6, 1, 6],
        checkpoints: [
          [31, G - 8, 1, 8],
          [38, G - 8, 1, 8],
        ],
        finish: [42, G - 8, 1, 8],
        corridor: [[0, G - 24, 64, 34]],
      },
    ],
    finds: [
      {
        id: 'tower-top',
        district: 'rooftops',
        rect: [43, G - 23, 6, 2],
        clue: 'On top of the brick tower',
      },
      {
        id: 'pit',
        district: 'rooftops',
        rect: [26, G + 8, 3, 2],
        clue: 'At the bottom of the pit',
      },
      {
        id: 'stack',
        district: 'warehouses',
        rect: [73, G - 6, 3, 2],
        clue: 'On the bridged containers',
      },
    ],
    props: defs,
    bots: [],
    startHub: 0,
  };

  // the surface runners walk on: the top of the solid column that holds the walkway (crates and
  // containers included), or the floor of a pit
  const standable = (c: number): boolean =>
    c === Cell.SOLID || c === Cell.HALF || c === Cell.SLOPE_UP || c === Cell.SLOPE_DOWN;
  const groundAt = new Float64Array(W * CELL_PX);
  for (let px = 0; px < W * CELL_PX; px++) {
    const cx = Math.floor(px / CELL_PX),
      lx = px - cx * CELL_PX;
    let cy = G;
    if (!standable(cells[cy * W + cx]!)) {
      while (cy < H - 1 && !standable(cells[cy * W + cx]!)) cy++;
    } else {
      while (cy > 0 && standable(cells[(cy - 1) * W + cx]!)) cy--;
    }
    const c = cells[cy * W + cx]!,
      top = cy * CELL_PX;
    groundAt[px] =
      c === Cell.HALF
        ? top + 16
        : c === Cell.SLOPE_UP
          ? top + 32 - lx
          : c === Cell.SLOPE_DOWN
            ? top + lx
            : top;
  }
  const ground = (xPx: number): number => {
    const i = Math.max(0, Math.min(groundAt.length - 1, Math.floor(xPx)));
    return groundAt[i]!;
  };

  return {
    world,
    chunks,
    art: {
      atlases: { rooftops: roof.img, warehouses: wh.img },
      props: propsImg,
      backgrounds,
    },
    markers,
    ground,
    spawn: [(15 * CELL_PX + 16) * UNITS_PER_PX, G * CELL_PX * UNITS_PER_PX],
  };
}
