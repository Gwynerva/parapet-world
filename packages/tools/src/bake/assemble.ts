/**
 * Puts rooms together into one world grid: collision classes, materials and prop placements, plus
 * regions, hubs, routes and finds in world cells. Problems are collected, not thrown, so one bake
 * reports every mistake at once.
 */
import {
  CELL,
  CELL_CHARS,
  CHUNK_CELLS,
  Cell,
  type CellRect,
  type FindDef,
  type HubDef,
  type RegionDef,
  type RouteDef,
} from '@parapet-world/schemas';
import { cellClass, type Content, type PaletteEntry } from './content.ts';
import type { Room } from './room.ts';

export interface Problem {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

export interface Placement {
  prop: number;
  x: number;
  y: number;
}

/** Entities keep their region and hub references by id until the index is written. */
export interface PendingRegion extends Omit<RegionDef, 'hub'> {
  hubId: string;
  where: string;
}

export interface Assembled {
  /** The grid's top-left cell and size, aligned to chunks. */
  x0: number;
  y0: number;
  width: number;
  height: number;
  cells: Uint8Array;
  materials: Uint8Array;
  /** 1 where a prop stamped the cell. */
  propCells: Uint8Array;
  placements: Placement[];
  regions: PendingRegion[];
  hubs: Array<HubDef & { start: boolean; where: string }>;
  routes: Array<RouteDef & { where: string }>;
  finds: Array<FindDef & { where: string }>;
  problems: Problem[];
}

const shift = (r: CellRect, x: number, y: number): CellRect => [r[0] + x, r[1] + y, r[2], r[3]];

export function assemble(content: Content, rooms: Room[]): Assembled {
  const problems: Problem[] = [];
  const err = (where: string, message: string) => problems.push({ level: 'error', where, message });
  const warn = (where: string, message: string) =>
    problems.push({ level: 'warning', where, message });

  const materialIndex: Record<string, number> = {};
  content.materials.forEach((m, i) => (materialIndex[m.id] = i + 1));
  const propIndex: Record<string, number> = {};
  content.props.forEach((p, i) => (propIndex[p.id] = i));

  // Bounds: the union of the rooms, widened to whole chunks.
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  rooms.forEach((r, i) => {
    const [x, y] = r.pos;
    if (i === 0 || x < minX) minX = x;
    if (i === 0 || y < minY) minY = y;
    if (i === 0 || x + r.width > maxX) maxX = x + r.width;
    if (i === 0 || y + r.height > maxY) maxY = y + r.height;
  });
  const x0 = rooms.length ? Math.floor(minX / CHUNK_CELLS) * CHUNK_CELLS : 0;
  const y0 = rooms.length ? Math.floor(minY / CHUNK_CELLS) * CHUNK_CELLS : 0;
  const width = rooms.length ? Math.ceil(maxX / CHUNK_CELLS) * CHUNK_CELLS - x0 : 0;
  const height = rooms.length ? Math.ceil(maxY / CHUNK_CELLS) * CHUNK_CELLS - y0 : 0;
  const cells = new Uint8Array(width * height);
  const materials = new Uint8Array(width * height);
  const propCells = new Uint8Array(width * height);
  const owner = new Int32Array(width * height).fill(-1);
  const at = (x: number, y: number) => (y - y0) * width + (x - x0);
  const inside = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + width && y < y0 + height;

  const placements: Placement[] = [];
  const out: Assembled = {
    x0,
    y0,
    width,
    height,
    cells,
    materials,
    propCells,
    placements,
    regions: [],
    hubs: [],
    routes: [],
    finds: [],
    problems,
  };

  // Tiles.
  const pending: Array<{ room: Room; prop: number; x: number; y: number; where: string }> = [];
  rooms.forEach((room, ri) => {
    const palette = content.palette[room.district];
    if (palette === undefined) {
      err(`${room.file}:1`, `unknown district ${room.district}`);
      return;
    }
    const legend: Record<string, PaletteEntry> = { ...palette };
    for (const l of room.legend)
      legend[l.char] = { material: l.material, cell: l.cell, prop: l.prop };
    for (let gy = 0; gy < room.height; gy++) {
      const row = Array.from(room.rows[gy]!);
      const line = room.rowLines[gy] ?? room.rowLines[room.rowLines.length - 1]!;
      for (let gx = 0; gx < room.width; gx++) {
        const ch = row[gx]!;
        const wx = room.pos[0] + gx;
        const wy = room.pos[1] + gy;
        const i = at(wx, wy);
        if (owner[i]! >= 0) {
          err(`${room.file}:${line}`, `cell ${wx},${wy} also belongs to ${rooms[owner[i]!]!.file}`);
          continue;
        }
        owner[i] = ri;
        const e = legend[ch];
        if (e === undefined) {
          err(`${room.file}:${line}`, `unknown character '${ch}' at column ${gx + 1}`);
          continue;
        }
        const where = `${room.file}:${line}`;
        if (e.prop !== undefined) {
          const p = propIndex[e.prop];
          if (p === undefined) err(where, `palette prop ${e.prop} is not in props.json`);
          else pending.push({ room, prop: p, x: wx, y: wy, where });
          continue;
        }
        let mat = 0;
        let cls: number = Cell.EMPTY;
        if (e.material !== undefined) {
          const m = materialIndex[e.material];
          if (m === undefined) {
            err(where, `unknown material ${e.material} for '${ch}'`);
            continue;
          }
          mat = m;
          cls = content.materials[m - 1]!.cell;
        }
        if (e.cell !== undefined) {
          try {
            cls = cellClass(e.cell, where);
          } catch (x) {
            err(where, (x as Error).message);
            continue;
          }
        }
        cells[i] = cls;
        materials[i] = mat;
      }
    }
    for (const p of room.props) {
      const where = `${room.file}:${p.line}`;
      const idx = propIndex[p.id];
      if (idx === undefined) {
        err(where, `unknown prop ${p.id}`);
        continue;
      }
      const def = content.props[idx]!;
      const h = def.mask.length;
      const w = def.mask.reduce((a, r) => Math.max(a, r.length), 0);
      if (p.x < 0 || p.y < 0 || p.x + w > room.width || p.y + h > room.height) {
        err(where, `prop ${p.id} (${w} x ${h}) at ${p.x},${p.y} reaches outside the room`);
        continue;
      }
      pending.push({ room, prop: idx, x: room.pos[0] + p.x, y: room.pos[1] + p.y, where });
    }
  });

  // Props: stamp masks into empty cells, list placements.
  for (const p of pending) {
    const def = content.props[p.prop]!;
    if (!def.districts.includes(p.room.district)) {
      warn(p.where, `prop ${def.id} is not tagged for ${p.room.district}`);
    }
    let ok = true;
    for (let my = 0; my < def.mask.length && ok; my++) {
      const row = Array.from(def.mask[my]!);
      for (let mx = 0; mx < row.length; mx++) {
        const ch = row[mx]!;
        if (ch === '.') continue;
        const cls = CELL_CHARS[ch];
        if (cls === undefined) {
          err(p.where, `prop ${def.id}: unknown mask character '${ch}'`);
          ok = false;
          break;
        }
        if (def.layer === 'front') {
          err(p.where, `prop ${def.id}: a front prop must have an empty mask`);
          ok = false;
          break;
        }
        const x = p.x + mx;
        const y = p.y + my;
        if (!inside(x, y)) {
          err(p.where, `prop ${def.id} reaches outside the world`);
          ok = false;
          break;
        }
        const i = at(x, y);
        if (cells[i] !== Cell.EMPTY || materials[i] !== 0 || propCells[i] !== 0) {
          err(p.where, `prop ${def.id} overlaps a solid or another prop at ${x},${y}`);
          ok = false;
          break;
        }
      }
    }
    if (!ok) continue;
    for (let my = 0; my < def.mask.length; my++) {
      const row = Array.from(def.mask[my]!);
      for (let mx = 0; mx < row.length; mx++) {
        if (row[mx] === '.') continue;
        const i = at(p.x + mx, p.y + my);
        cells[i] = CELL_CHARS[row[mx]!]!;
        propCells[i] = 1;
      }
    }
    placements.push({ prop: p.prop, x: p.x, y: p.y });
  }

  // Entities in world cells.
  for (const room of rooms) {
    const [px, py] = room.pos;
    for (const r of room.regions) {
      out.regions.push({
        id: r.id,
        district: room.district,
        rect: shift(r.rect ?? [0, 0, room.width, room.height], px, py),
        hubId: r.hub,
        where: `${room.file}:${r.line}`,
      });
    }
    for (const h of room.hubs) {
      out.hubs.push({
        id: h.id,
        district: room.district,
        name: h.name,
        rect: shift(h.rect, px, py),
        spawn: [(px + h.spawn[0]) * CELL + CELL / 2, (py + h.spawn[1] + 1) * CELL],
        facing: h.facing,
        start: h.start,
        where: `${room.file}:${h.line}`,
      });
    }
    for (const r of room.routes) {
      out.routes.push({
        id: r.id,
        district: room.district,
        name: r.name,
        difficulty: r.difficulty,
        start: shift(r.start!, px, py),
        checkpoints: r.checkpoints.map((c) => shift(c, px, py)),
        finish: shift(r.finish!, px, py),
        corridor: r.corridor.map((c) => shift(c, px, py)),
        where: `${room.file}:${r.line}`,
      });
    }
    for (const f of room.finds) {
      out.finds.push({
        id: f.id,
        district: room.district,
        rect: shift(f.rect, px, py),
        clue: f.clue,
        where: `${room.file}:${f.line}`,
      });
    }
  }
  return out;
}
