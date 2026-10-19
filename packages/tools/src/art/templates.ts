// Guide templates for artists who repaint the atlases: `node packages/tools/src/art/templates.ts`.
// Writes to packages/tools/out/templates:
//
// - tiles-guide.png: a layer the size of art/<district>/tiles.png (schemas atlas.ts) to lay over
//   the sheet: every rect with its 1 px gutter, the variant and neighbour mask of every front
//   tile, the rim pixels of the edge contract (tiles.ts), the strip edges that meet the front face
//   and the deck rows of one-way floors; the unused space names each slot's materials.
// - tiles-guide-4x.png: the same at 4x with a texel grid, larger labels and a legend.
// - props-guide.png: art/props.png at 4x with every sprite and marker rect of props/props.json,
//   its id, and the cells of its mask placed at its offset with their collision shapes.
//
// Layouts are read from schemas, the district modules and props.json, so the guides follow them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATLAS_PITCH,
  ATLAS_WIDTH,
  CELL_CHARS,
  Cell,
  SLOT_HEIGHT,
  TILE,
  VARIANT,
  atlasHeight,
  frontRect,
  sideStripRect,
  topStripRect,
  type CellClass,
  type PropDef,
  type Rect,
} from '@parapet-world/schemas';
import { decodePng, encodePng } from '../png.ts';
import type { DistrictArt } from './district.ts';
import { factory } from './districts/factory.ts';
import { rooftops } from './districts/rooftops.ts';
import { sewer } from './districts/sewer.ts';
import { warehouses } from './districts/warehouses.ts';
import { text, textWidth } from './font.ts';
import { Canvas, hex, mix, withAlpha, type RGBA } from './paint.ts';
import { PROP_ART } from './props.ts';
import { has } from './tiles.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CONTENT = join(ROOT, 'packages', 'content');
const OUT = join(ROOT, 'packages', 'tools', 'out', 'templates');
const DISTRICTS: readonly DistrictArt[] = [rooftops, warehouses, factory, sewer];

/** The scale of the labelled guides. */
const K = 4;

const BG = hex('#17181d');
const OUTSIDE = hex('#0e0f12');
const INK = hex('#0b0c0f');
const LABEL = hex('#f0f0f0');
const MUTED = hex('#9a9fad');
const EDGE = hex('#d8dbe4');
const GRID = withAlpha(hex('#ffffff'), 12);
const GRID_MAJOR = withAlpha(hex('#ffffff'), 34);
const GUTTER = hex('#8f7cff');
const GUTTER_DARK = hex('#5a4fa8');
const RIM_TOP = hex('#ff9a2e');
const RIM_SIDE = hex('#33ccff');
const CORNER = hex('#ffe84a');
const OPEN = hex('#6ee87a');
const DECK = hex('#ff5fa8');
/** Deck rows on the 1x layer: translucent (alpha under 200), so labels may cover them. */
const DECK_DASH = withAlpha(DECK, 190);
const FRONT_TINT = hex('#5b7fc0');
const TOP_TINT = hex('#c08a4a');
const SIDE_TINT = hex('#5aa872');
const FRONT_LAYER_TINT = hex('#a070c8');
const MARKER_TINT = hex('#c8a040');

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const writePng = (name: string, g: Canvas): void => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), encodePng(g.image()));
  console.log(`templates: ${name} ${g.width} x ${g.height}`);
};

// ---------- drawing ----------

/** How atlas px map to output px: `k` output px per atlas px, (x0, y0) at the top-left. */
interface View {
  k: number;
  x0: number;
  y0: number;
}

const at = (v: View, x: number, y: number): [number, number] => [
  (x - v.x0) * v.k,
  (y - v.y0) * v.k,
];

/** One atlas pixel. */
const dot = (g: Canvas, v: View, x: number, y: number, c: RGBA): void => {
  const [px, py] = at(v, x, y);
  g.rect(px, py, v.k, v.k, c);
};

/** Text scaled by an integer factor with its top-left at (x, y); returns its width. */
const write = (g: Canvas, x: number, y: number, s: string, c: RGBA, k = 1): number => {
  const w = textWidth(s);
  if (w === 0) return 0;
  if (x < 0 || x + w * k > g.width) throw new Error(`templates: "${s}" does not fit at x ${x}`);
  const t = new Canvas(w, 5);
  text(t, 0, 0, s, c);
  g.blit(k === 1 ? t : t.scaled(k), x, y);
  return w * k;
};

/** `write` on a dark box, so the text reads over anything. */
const tag = (g: Canvas, x: number, y: number, s: string, c: RGBA, k = 1): number => {
  g.tint(x - k, y - k, textWidth(s) * k + 2 * k, 7 * k, withAlpha(BG, 220));
  return write(g, x, y, s, c, k);
};

/** Runs of coloured text on one line, two spaces apart. */
const runs = (g: Canvas, x: number, y: number, parts: ReadonlyArray<readonly [string, RGBA]>) => {
  for (const [s, c] of parts) x += write(g, x, y, s, c) + 8;
};

const frame = (g: Canvas, x: number, y: number, w: number, h: number, c: RGBA): void => {
  g.hline(x, x + w - 1, y, c);
  g.hline(x, x + w - 1, y + h - 1, c);
  g.vline(x, y, y + h - 1, c);
  g.vline(x + w - 1, y, y + h - 1, c);
};

const dashH = (g: Canvas, x0: number, x1: number, y: number, c: RGBA, on = 4, off = 4): void => {
  for (let x = x0; x <= x1; x++) if ((x - x0) % (on + off) < on) g.set(x, y, c);
};

/** A filled arrowhead `size` px long with its tip at (x, y), pointing along (dx, dy). */
const arrow = (g: Canvas, x: number, y: number, dx: number, dy: number, size: number, c: RGBA) => {
  for (let t = 0; t < size; t++) {
    for (let s = -t; s <= t; s++)
      g.set(x - dx * t + Math.abs(dy) * s, y - dy * t + Math.abs(dx) * s, c);
  }
};

/** The pixels of the 1 px gutter around a rect. */
const gutterOf = ([x, y, w, h]: Rect): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let i = -1; i <= w; i++) out.push([x + i, y - 1], [x + i, y + h]);
  for (let j = 0; j < h; j++) out.push([x - 1, y + j], [x + w, y + j]);
  return out;
};

/** A rect's tint, its texel grid (above 1x), its gutter and, above 1x, a frame on its edge. */
const drawRect = (g: Canvas, v: View, rect: Rect, tint: RGBA): void => {
  const [x, y, w, h] = rect;
  const [px, py] = at(v, x, y);
  const k = v.k;
  g.rect(px, py, w * k, h * k, k === 1 ? withAlpha(tint, 40) : mix(BG, tint, 0.24));
  if (k > 1) {
    for (let j = 0; j < h * k; j++) {
      for (let i = 0; i < w * k; i++) {
        const vertical = i % k === 0;
        const horizontal = j % k === 0;
        if (!vertical && !horizontal) continue;
        const major = (vertical && (i / k) % 8 === 0) || (horizontal && (j / k) % 8 === 0);
        g.over(px + i, py + j, major ? GRID_MAJOR : GRID);
      }
    }
  }
  for (const [gx, gy] of gutterOf(rect)) {
    dot(g, v, gx, gy, k === 1 ? withAlpha(GUTTER, 210) : (gx + gy) & 1 ? GUTTER : GUTTER_DARK);
  }
  if (k > 1) frame(g, px - 1, py - 1, w * k + 2, h * k + 2, EDGE);
};

// ---------- tile atlas ----------

type Mark = [number, number, RGBA];

/**
 * The pixels the edge contract (tiles.ts) fixes in a front variant, in tile px: an exposed top or
 * bottom row repeats row 0 of the top strip, an exposed left or right column column 0 of the side
 * strip, and the ends of every rim are the one corner colour.
 */
const frontRims = (mask: number): Mark[] => {
  const last = TILE - 1;
  const up = has(mask, VARIANT.UP);
  const right = has(mask, VARIANT.RIGHT);
  const down = has(mask, VARIANT.DOWN);
  const left = has(mask, VARIANT.LEFT);
  const out: Mark[] = [];
  for (let i = 0; i < TILE; i++) {
    if (!up) out.push([i, 0, RIM_TOP]);
    if (!down) out.push([i, last, RIM_TOP]);
    if (!left) out.push([0, i, RIM_SIDE]);
    if (!right) out.push([last, i, RIM_SIDE]);
  }
  const corners: Array<[number, number, boolean]> = [
    [0, 0, !up || !left],
    [last, 0, !up || !right],
    [0, last, !down || !left],
    [last, last, !down || !right],
  ];
  for (const [x, y, rim] of corners) if (rim) out.push([x, y, CORNER]);
  return out;
};

/** Row 0 of the top strip or column 0 of the side strip: the edge that meets the front face. */
const stripRim = (alongX: boolean): Mark[] =>
  Array.from({ length: TILE }, (_, i): Mark => {
    const c = i === 0 || i === TILE - 1 ? CORNER : alongX ? RIM_TOP : RIM_SIDE;
    return alongX ? [i, 0, c] : [0, i, c];
  });

interface SlotInfo {
  materials: Array<{ district: string; id: string; deck: number | undefined }>;
  /** Deck heights of the one-way floors in this slot, in any district. */
  decks: number[];
}

const SLOTS = Math.max(...DISTRICTS.map((d) => d.materials.length));
const SLOT_INFO: SlotInfo[] = Array.from({ length: SLOTS }, (_, slot) => {
  const materials = DISTRICTS.flatMap((d) => {
    const m = d.materials[slot];
    return m ? [{ district: d.id, id: m.id, deck: m.deck }] : [];
  });
  const decks = [...new Set(materials.flatMap((m) => (m.deck ? [m.deck] : [])))];
  return { materials, decks };
});

/** The rects of a slot with their tint and the pixels the edge contract fixes. */
const slotRects = (slot: number): Array<[Rect, RGBA, Mark[]]> => [
  ...Array.from({ length: 16 }, (_, mask): [Rect, RGBA, Mark[]] => [
    frontRect(slot, mask),
    FRONT_TINT,
    frontRims(mask),
  ]),
  [topStripRect(slot), TOP_TINT, stripRim(true)],
  [sideStripRect(slot), SIDE_TINT, stripRim(false)],
];

/** Rects, gutters, rims and deck rows of every slot. */
const drawTiles = (g: Canvas, v: View): void => {
  SLOT_INFO.forEach((info, slot) => {
    for (const [rect, tint, marks] of slotRects(slot)) {
      drawRect(g, v, rect, tint);
      for (const [mx, my, c] of marks) dot(g, v, rect[0] + mx, rect[1] + my, c);
    }
    const decked = [
      ...Array.from({ length: 16 }, (_, m) => frontRect(slot, m)),
      sideStripRect(slot),
    ];
    for (const deck of info.decks) {
      for (const [x, y, w] of decked) {
        if (v.k === 1) {
          for (let i = 0; i < w; i++) if (((i >> 1) & 1) === 0) g.set(x + i, y + deck, DECK_DASH);
        } else {
          const [px, py] = at(v, x, y + deck);
          for (let t = 0; t < 2; t++) dashH(g, px, px + w * v.k - 1, py + t, DECK, 6, 4);
        }
      }
    }
  });
};

/** The four neighbours with where their arrow and letter go in a tile at 1x and at 4x. */
const SIDES = [
  {
    bit: VARIANT.UP,
    letter: 'U',
    dir: [0, -1],
    tip: [15, 1],
    at: [14, 4],
    tip4: [63, 5],
    at4: [60, 16],
  },
  {
    bit: VARIANT.RIGHT,
    letter: 'R',
    dir: [1, 0],
    tip: [30, 15],
    at: [25, 13],
    tip4: [122, 63],
    at4: [106, 59],
  },
  {
    bit: VARIANT.DOWN,
    letter: 'D',
    dir: [0, 1],
    tip: [15, 30],
    at: [14, 22],
    tip4: [63, 122],
    at4: [60, 102],
  },
  {
    bit: VARIANT.LEFT,
    letter: 'L',
    dir: [-1, 0],
    tip: [1, 15],
    at: [4, 13],
    tip4: [5, 63],
    at4: [16, 59],
  },
] as const;

/** The variant's neighbour bits, `U1 R2 D4 L8` for the inside of a mass. */
const maskBits = (mask: number): string => {
  const bits = SIDES.filter((s) => has(mask, s.bit)).map((s) => `${s.letter}${s.bit}`);
  return bits.length ? bits.join(' ') : 'LONE TILE';
};

/** The 1x notes, spread over the unused space right of the strips. */
const LAYER_NOTES: ReadonlyArray<ReadonlyArray<readonly [string, RGBA]>> = [
  [
    [
      'ORANGE: ROW 0 OF THE TOP STRIP MEETS THE FRONT FACE. EXPOSED TOP AND BOTTOM ROWS REPEAT IT.',
      RIM_TOP,
    ],
  ],
  [
    [
      'CYAN: COLUMN 0 OF THE SIDE STRIP MEETS THE FRONT FACE. EXPOSED SIDE COLUMNS REPEAT IT.',
      RIM_SIDE,
    ],
  ],
  [
    ['YELLOW: THE ENDS OF EVERY RIM, ONE COLOUR.', CORNER],
    ['VIOLET: THE 1 PX GUTTER, A COPY OF THE EDGE NEXT TO IT.', GUTTER],
  ],
  [
    [
      'GREEN U R D L: THE SAME MATERIAL IS NEXT DOOR, JOIN IT. VARIANT: THE SUM OF U1 R2 D4 L8.',
      OPEN,
    ],
  ],
  [
    [
      'PINK DASHES: THE DECK OF A ONE-WAY FLOOR. CLEAR BELOW IT, NO BOTTOM RIM, SIDE RIMS STOP.',
      DECK,
    ],
  ],
  [
    [
      'FRONT TILES AND STRIPS ARE OPAQUE. TOP STRIP: TOPS AND UNDERSIDES. SIDE STRIP: SIDE WALLS.',
      LABEL,
    ],
  ],
];

/** The 1x layer: the sheet's rects and contract with small labels outlined in ink. */
const renderTilesLayer = (): Canvas => {
  const v: View = { k: 1, x0: 0, y0: 0 };
  const g = new Canvas(ATLAS_WIDTH, atlasHeight(SLOTS));
  drawTiles(g, v);
  const ink = new Canvas(g.width, g.height);
  const notes = [...LAYER_NOTES];
  SLOT_INFO.forEach((info, slot) => {
    for (let mask = 0; mask < 16; mask++) {
      const [x, y] = frontRect(slot, mask);
      const n = String(mask);
      write(ink, x + 15 - ((textWidth(n) - 1) >> 1), y + 13, n, LABEL);
      for (const s of SIDES) {
        if (!has(mask, s.bit)) continue;
        arrow(ink, x + s.tip[0], y + s.tip[1], s.dir[0], s.dir[1], 2, OPEN);
        write(ink, x + s.at[0], y + s.at[1], s.letter, OPEN);
      }
    }
    const [tx, ty] = topStripRect(slot);
    write(ink, tx + 3, ty + 6, 'TOP', LABEL);
    const [sx, sy] = sideStripRect(slot);
    [...'SIDE'].forEach((ch, i) => write(ink, sx + 6, sy + 9 + 6 * i, ch, LABEL));
    const x = sx + 16 + 5;
    const y = slot * SLOT_HEIGHT + ATLAS_PITCH + 3;
    let to = x + write(ink, x, y, `SLOT ${slot}`, LABEL) + 12;
    for (const m of info.materials) {
      to += write(ink, to, y, m.district, MUTED) + 4;
      to += write(ink, to, y, m.id, LABEL) + 4;
      if (m.deck) to += write(ink, to, y, `DECK ${m.deck}`, DECK) + 4;
      to += 8;
    }
    for (let line = 1; line < 4; line++) {
      const note = notes.shift();
      if (note) runs(ink, x, y + 7 * line, note);
    }
  });
  ink.outlineOutside(INK);
  // Labels give way to rims and gutters (alpha 200 and up), so the contract stays whole.
  g.paint((x, y) => (g.alpha(x, y) < 200 && ink.alpha(x, y) ? ink.get(x, y) : null));
  return g;
};

const TILE_LEGEND: ReadonlyArray<readonly [RGBA, string]> = [
  [
    RIM_TOP,
    'TOP RIM: ROW 0 OF THE TOP STRIP MEETS THE FRONT FACE. A FRONT TILE WITH NO UP NEIGHBOUR REPEATS IT AS ROW 0, WITH NO DOWN NEIGHBOUR AS ROW 31.',
  ],
  [
    RIM_SIDE,
    'SIDE RIM: COLUMN 0 OF THE SIDE STRIP MEETS THE FRONT FACE. A FRONT TILE WITH NO LEFT NEIGHBOUR REPEATS IT AS COLUMN 0, WITH NO RIGHT NEIGHBOUR AS COLUMN 31.',
  ],
  [
    CORNER,
    'RIM ENDS: BOTH ENDS OF BOTH RIMS ARE ONE AND THE SAME COLOUR, SO EVERY CORNER MATCHES.',
  ],
  [
    OPEN,
    'U R D L: THE NEIGHBOUR ON THAT SIDE IS THE SAME MATERIAL. THAT EDGE IS A SEAM: IT JOINS THE OPPOSITE EDGE OF ANY VARIANT. THE VARIANT IS THE SUM OF U1 R2 D4 L8.',
  ],
  [
    GUTTER,
    'GUTTER: THE 1 PX RING AROUND EVERY RECT. PAINT IT AS A COPY OF THE EDGE PIXELS NEXT TO IT, CORNERS INCLUDED, SO SAMPLING AT AN EDGE NEVER PICKS A NEIGHBOUR.',
  ],
  [
    DECK,
    'DECK: A ONE-WAY FLOOR IS CLEAR BELOW ITS DECK, HAS NO BOTTOM RIM, AND ITS SIDE RIMS AND SIDE STRIP STOP AT THE DECK. ITS TOP STRIP IS WHOLE.',
  ],
  [
    LABEL,
    'FRONT TILES AND STRIPS ARE FULLY OPAQUE. THE TOP STRIP IS LAID ALONG TOP FACES AND UNDERSIDES, THE SIDE STRIP ALONG SIDE WALLS. THE SPACE RIGHT OF THE STRIPS IS UNUSED.',
  ],
  [
    MUTED,
    `EVERY DISTRICT HAS THIS LAYOUT IN ITS TILES.PNG, ${ATLAS_WIDTH} X ${atlasHeight(SLOTS)}. THE ART GENERATOR KEEPS A REPAINTED SHEET AND OVERWRITES IT ONLY WITH --FORCE.`,
  ],
];

/** A legend: a title, then a swatch and a line of text per entry; returns the bottom y. */
const legend = (
  g: Canvas,
  y: number,
  title: string,
  entries: ReadonlyArray<readonly [RGBA, string]>,
): number => {
  write(g, 16, y, title, LABEL, 3);
  y += 28;
  for (const [c, s] of entries) {
    g.rect(16, y - 1, 12, 12, c);
    write(g, 40, y, s, c, 2);
    y += 22;
  }
  return y;
};

/** The 4x guide: the layer's structure with a texel grid, larger labels and a legend. */
const renderTilesGuide = (): Canvas => {
  const v: View = { k: K, x0: 0, y0: 0 };
  const sheetH = atlasHeight(SLOTS) * K;
  const g = new Canvas(ATLAS_WIDTH * K, sheetH + 36 + 28 + TILE_LEGEND.length * 22 + 16);
  g.fill(BG);
  drawTiles(g, v);
  SLOT_INFO.forEach((info, slot) => {
    for (let mask = 0; mask < 16; mask++) {
      const [fx, fy] = frontRect(slot, mask);
      const [x, y] = at(v, fx, fy);
      const n = String(mask);
      write(g, x + 63 - ((textWidth(n) * 3 - 1) >> 1), y + 50, n, LABEL, 3);
      const bits = maskBits(mask);
      write(g, x + 63 - ((textWidth(bits) - 1) >> 1), y + 72, bits, MUTED);
      for (const s of SIDES) {
        if (!has(mask, s.bit)) continue;
        arrow(g, x + s.tip4[0], y + s.tip4[1], s.dir[0], s.dir[1], 7, OPEN);
        write(g, x + s.at4[0], y + s.at4[1], s.letter, OPEN, 2);
      }
    }
    const [tx, ty] = at(v, topStripRect(slot)[0], topStripRect(slot)[1]);
    arrow(g, tx + 8, ty + 5, 0, -1, 4, RIM_TOP);
    write(g, tx + 14, ty + 6, 'ROW 0 MEETS THE FRONT FACE', RIM_TOP);
    write(g, tx + 8, ty + 20, 'TOP STRIP', LABEL, 2);
    write(g, tx + 8, ty + 36, '32 X 16', MUTED);
    write(g, tx + 8, ty + 46, 'ALONG TOPS AND UNDERSIDES', MUTED);
    const [sx, sy] = at(v, sideStripRect(slot)[0], sideStripRect(slot)[1]);
    arrow(g, sx + 6, sy + 10, -1, 0, 4, RIM_SIDE);
    write(g, sx + 12, sy + 8, 'COLUMN 0', RIM_SIDE);
    write(g, sx + 12, sy + 15, 'MEETS THE', RIM_SIDE);
    write(g, sx + 12, sy + 22, 'FRONT FACE', RIM_SIDE);
    write(g, sx + 10, sy + 40, 'SIDE', LABEL, 2);
    write(g, sx + 10, sy + 54, 'STRIP', LABEL, 2);
    write(g, sx + 10, sy + 70, '16 X 32', MUTED);
    write(g, sx + 10, sy + 80, 'ALONG', MUTED);
    write(g, sx + 10, sy + 87, 'SIDE WALLS', MUTED);
    const x = (sideStripRect(slot)[0] + 16 + 6) * K;
    const band = (slot * SLOT_HEIGHT + ATLAS_PITCH) * K;
    write(g, x, band + 10, `SLOT ${slot}`, LABEL, 3);
    info.materials.forEach((m, i) => {
      const y = band + 36 + 16 * i;
      write(g, x, y, m.district, MUTED, 2);
      write(g, x + 120, y, m.id, LABEL, 2);
      if (m.deck) write(g, x + 250, y, `DECK ${m.deck} PX, A ONE-WAY FLOOR`, DECK, 2);
    });
  });
  legend(g, sheetH + 36, 'TILE ATLAS GUIDE AT 4X', TILE_LEGEND);
  return g;
};

// ---------- props atlas ----------

interface PropsFile {
  props: PropDef[];
  markers: Record<string, unknown>;
}

const CLASS_COLOUR: Readonly<Record<number, RGBA>> = {
  [Cell.EMPTY]: hex('#a0a4b0'),
  [Cell.SOLID]: hex('#ff5555'),
  [Cell.TOP]: hex('#ffa23a'),
  [Cell.SLOPE_UP]: hex('#ffe04a'),
  [Cell.SLOPE_DOWN]: hex('#ffe04a'),
  [Cell.HALF]: hex('#ff6fd0'),
  [Cell.POST]: hex('#c77dff'),
  [Cell.LADDER]: hex('#5fe07a'),
  [Cell.POLE]: hex('#3fd0ff'),
  [Cell.BAR]: hex('#6f8dff'),
  [Cell.SLAB]: hex('#ff8f6f'),
  [Cell.KILL]: hex('#b6ff3a'),
};

const CLASS_NAME = new Map<number, string>(
  Object.entries(Cell).map(([name, cls]) => [cls, name.replace('_', ' ')]),
);

/** Classes drawn as a hatched area: they have no collision but act over the whole cell. */
const HATCHED: ReadonlySet<number> = new Set<number>([Cell.LADDER, Cell.KILL]);

const CLASS_LEGEND: ReadonlyArray<readonly [CellClass, string]> = [
  [Cell.SOLID, 'SOLID: THE WHOLE CELL'],
  [Cell.TOP, 'TOP: A ONE-WAY FLOOR ON THE TOP EDGE'],
  [Cell.SLOPE_UP, 'SLOPE UP OR DOWN: SOLID BELOW THE DIAGONAL'],
  [Cell.HALF, 'HALF: THE BOTTOM 16 PX'],
  [Cell.SLAB, 'SLAB: THE TOP 16 PX, A LOW CEILING'],
  [Cell.POST, 'POST: 8 PX WIDE IN THE MIDDLE, FULL HEIGHT'],
  [Cell.BAR, 'BAR: 2 PX BELOW THE TOP, HANDS HANG, FEET STAND'],
  [Cell.LADDER, 'LADDER: CLIMBABLE OVER THE CELL, NO COLLISION'],
  [Cell.POLE, 'POLE: ON THE MIDDLE LINE, NO COLLISION'],
  [Cell.KILL, 'KILL: FATAL TO TOUCH, NO COLLISION'],
  [Cell.EMPTY, 'EMPTY: STAMPS NOTHING'],
];

/**
 * Whether texel (i, j) of a cell lies in its class's shape (sim shapes.ts); the one-way floors and
 * the pole, which are lines, are drawn one texel row or two texel columns thick.
 */
const inShape = (cls: CellClass, i: number, j: number): boolean => {
  if (i < 0 || j < 0 || i >= TILE || j >= TILE) return false;
  switch (cls) {
    case Cell.SOLID:
    case Cell.LADDER:
    case Cell.KILL:
      return true;
    case Cell.TOP:
      return j === 0;
    case Cell.SLOPE_UP:
      return i + j >= TILE - 1;
    case Cell.SLOPE_DOWN:
      return j >= i;
    case Cell.HALF:
      return j >= TILE / 2;
    case Cell.SLAB:
      return j < TILE / 2;
    case Cell.POST:
      return i >= 12 && i < 20;
    case Cell.POLE:
      return i === 15 || i === 16;
    case Cell.BAR:
      return j === 2;
    default:
      return false;
  }
};

/**
 * A mask cell at (x, y) in atlas px: its collision shape and a dashed outline, left out where
 * `hidden` says another sprite is.
 */
const drawCell = (
  g: Canvas,
  v: View,
  x: number,
  y: number,
  cls: CellClass,
  hidden: (px: number, py: number) => boolean,
): void => {
  const c = CLASS_COLOUR[cls]!;
  const k = v.k;
  const [px, py] = at(v, x, y);
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      if (!inShape(cls, i, j)) continue;
      const bx = px + i * k;
      const by = py + j * k;
      for (let b = 0; b < k; b++) {
        for (let a = 0; a < k; a++) {
          if (!HATCHED.has(cls)) g.over(bx + a, by + b, withAlpha(c, 80));
          else if ((bx + a + by + b) % 12 < 3) g.over(bx + a, by + b, withAlpha(c, 150));
        }
      }
      if (!inShape(cls, i - 1, j)) g.vline(bx, by, by + k - 1, c);
      if (!inShape(cls, i + 1, j)) g.vline(bx + k - 1, by, by + k - 1, c);
      if (!inShape(cls, i, j - 1)) g.hline(bx, bx + k - 1, by, c);
      if (!inShape(cls, i, j + 1)) g.hline(bx, bx + k - 1, by + k - 1, c);
    }
  }
  const size = TILE * k;
  for (let t = 0; t < size; t += 8) {
    for (let d = t; d < Math.min(t + 4, size); d++) {
      const ends: Array<[number, number]> = [
        [px + d, py],
        [px + d, py + size - 1],
        [px, py + d],
        [px + size - 1, py + d],
      ];
      for (const [ex, ey] of ends) if (!hidden(ex, ey)) g.set(ex, ey, c);
    }
  }
};

const PROPS_LEGEND = (width: number, height: number): ReadonlyArray<readonly [RGBA, string]> => [
  [
    MUTED,
    `ART/PROPS.PNG IS ${width} X ${height}, THE LIGHTER AREA. THE SPRITE AND MARKER RECTS COME FROM PROPS/PROPS.JSON, THEIR POSITION AND SIZE UNDER EACH ID.`,
  ],
  [
    GUTTER,
    'GUTTER: THE 1 PX RING AROUND EVERY RECT. PAINT IT AS A COPY OF THE EDGE PIXELS NEXT TO IT, CORNERS INCLUDED.',
  ],
  [
    EDGE,
    'DASHED SQUARES: THE 32 PX CELLS OF A PROP MASK. THE SPRITE IS DRAWN AT THE MASK CORNER PLUS ITS OFFSET, SO CELLS MAY REACH PAST THE SPRITE.',
  ],
  [EDGE, 'FILLED SHAPES: WHERE EACH CELL COLLIDES OR ACTS, BY ITS CLASS BELOW.'],
  [
    FRONT_TINT,
    'BLUE RECTS: MID LAYER, DRAWN BEFORE THE RUNNERS. PURPLE: FRONT LAYER, DRAWN AFTER THE RUNNERS, NO COLLISION. GOLD: ENTITY MARKERS.',
  ],
  [
    LABEL,
    'REPEATS VERTICALLY OR SIDEWAYS: A SEGMENT PROP STACKS CELL BY CELL, SO ITS FIRST ROW JOINS ITS LAST ROW, OR ITS FIRST COLUMN ITS LAST.',
  ],
  [
    MUTED,
    'LIGHT COMES FROM THE UPPER LEFT. THE ART GENERATOR KEEPS A REPAINTED PROPS.PNG AND ITS RECTS, SO KEEP EVERY SPRITE INSIDE ITS RECT.',
  ],
];

const renderPropsGuide = (): Canvas => {
  const file = readJson<PropsFile>(join(CONTENT, 'props', 'props.json'));
  const atlas = decodePng(readFileSync(join(CONTENT, 'art', 'props.png')));
  const items: Array<{ id: string; rect: Rect; tint: RGBA; def?: PropDef }> = [
    ...file.props.map((def) => ({
      id: def.id,
      rect: def.sprite,
      tint: def.layer === 'front' ? FRONT_LAYER_TINT : FRONT_TINT,
      def,
    })),
    ...Object.entries(file.markers).flatMap(([id, rect]) =>
      Array.isArray(rect) && rect.length === 4
        ? [{ id, rect: rect as Rect, tint: MARKER_TINT }]
        : [],
    ),
  ];
  const cells = file.props.flatMap((def) => {
    const x0 = def.sprite[0] - def.offset[0];
    const y0 = def.sprite[1] - def.offset[1];
    return def.mask.flatMap((row, r) =>
      [...row].map((ch, c) => {
        const cls = CELL_CHARS[ch];
        if (cls === undefined)
          throw new Error(`templates: ${def.id}: unknown mask character ${ch}`);
        return { x: x0 + c * TILE, y: y0 + r * TILE, cls, owner: def.sprite };
      }),
    );
  });
  const margin = 4;
  const x0 = Math.min(0, ...cells.map((c) => c.x)) - margin;
  const y0 = Math.min(0, ...cells.map((c) => c.y)) - margin;
  const x1 = Math.max(atlas.width, ...cells.map((c) => c.x + TILE)) + margin;
  const y1 = Math.max(atlas.height, ...cells.map((c) => c.y + TILE)) + margin;
  const v: View = { k: K, x0, y0 };
  const entries = PROPS_LEGEND(atlas.width, atlas.height);
  const rows = Math.ceil(CLASS_LEGEND.length / 2);
  const sheetH = (y1 - y0) * K;
  const g = new Canvas((x1 - x0) * K, sheetH + 24 + 28 + (entries.length + rows) * 22 + 24);
  g.fill(OUTSIDE);
  const [ax, ay] = at(v, 0, 0);
  g.rect(ax, ay, atlas.width * K, atlas.height * K, BG);
  frame(g, ax - 1, ay - 1, atlas.width * K + 2, atlas.height * K + 2, MUTED);
  for (const it of items) drawRect(g, v, it.rect, it.tint);
  /** Whether output px (px, py) lies on a rect or gutter other than `owner`'s. */
  const onOther = (owner: Rect, px: number, py: number): boolean => {
    const x = x0 + Math.floor(px / K);
    const y = y0 + Math.floor(py / K);
    return items.some(({ rect: [rx, ry, rw, rh] }) =>
      rx !== owner[0] || ry !== owner[1]
        ? x >= rx - 1 && x <= rx + rw && y >= ry - 1 && y <= ry + rh
        : false,
    );
  };
  for (const c of cells) drawCell(g, v, c.x, c.y, c.cls, (px, py) => onOther(c.owner, px, py));
  for (const c of cells) {
    const [px, py] = at(v, c.x, c.y + TILE);
    tag(g, px + 4, py - 10, CLASS_NAME.get(c.cls)!, CLASS_COLOUR[c.cls]!);
  }
  for (const it of items) {
    const [x, y, w, h] = it.rect;
    const [px, py] = at(v, x, y);
    const k = textWidth(it.id) * 2 + 8 <= w * K ? 2 : 1;
    // A sprite under half a cell tall (a bar) carries its label underneath, off its shape.
    const ly = h < TILE / 2 ? py + (h + 1) * K + 4 : py + 4;
    tag(g, px + 4, ly, it.id, it.def ? LABEL : MARKER_TINT, k);
    const lines: Array<[string, RGBA]> = [[`AT ${x} ${y}, ${w} X ${h}`, MUTED]];
    const def = it.def;
    if (!def) lines.push(['ENTITY MARKER', MARKER_TINT]);
    else {
      if (def.offset[0] || def.offset[1]) {
        lines.push([`OFFSET ${def.offset[0]} ${def.offset[1]}`, LABEL]);
      }
      const tile = PROP_ART.find((a) => a.id === def.id)?.tile;
      if (tile) lines.push([tile === 'y' ? 'REPEATS VERTICALLY' : 'REPEATS SIDEWAYS', LABEL]);
      if (def.layer === 'front') lines.push(['FRONT LAYER', FRONT_LAYER_TINT]);
    }
    lines.forEach(([s, c], i) => tag(g, px + 4, ly + 5 * k + 4 + 7 * i, s, c));
  }
  const y = legend(g, sheetH + 24, 'PROPS ATLAS GUIDE AT 4X', entries);
  CLASS_LEGEND.forEach(([cls, s], i) => {
    const x = 16 + (i < rows ? 0 : Math.floor(g.width / 2));
    const ly = y + 22 * (i % rows);
    g.rect(x, ly - 1, 12, 12, CLASS_COLOUR[cls]!);
    write(g, x + 24, ly, s, CLASS_COLOUR[cls]!, 2);
  });
  return g;
};

writePng('tiles-guide.png', renderTilesLayer());
writePng('tiles-guide-4x.png', renderTilesGuide());
writePng('props-guide.png', renderPropsGuide());
