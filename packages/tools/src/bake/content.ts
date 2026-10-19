/**
 * Loads the content the baker reads: materials, palette, props, district art metadata and rooms.
 * Missing optional files (art, skins, clips) never fail; missing required ones do.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  Cell,
  type BackgroundLayer,
  type CellClass,
  type MaterialDef,
  type PropDef,
} from '@parapet-world/schemas';
import { parseRoom, type Room } from './room.ts';

export const DISTRICTS = ['rooftops', 'warehouses', 'factory', 'sewer'] as const;
export type DistrictId = (typeof DISTRICTS)[number];

/** A palette entry: a material (with an optional collision class override), a class, or a prop. */
export interface PaletteEntry {
  material?: string;
  cell?: string;
  prop?: string;
}

export interface DistrictArt {
  id: string;
  name: string;
  sky: [number, number, number];
  background: BackgroundLayer[];
  ambience: string;
}

export interface Content {
  root: string;
  materials: MaterialDef[];
  /** Palette per district (with `common` merged under it). */
  palette: Record<string, Record<string, PaletteEntry>>;
  props: PropDef[];
  art: Record<string, DistrictArt>;
  rooms: Room[];
  gym: Room[];
}

export class ContentError extends Error {}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ContentError(`${path}: ${(e as Error).message}`);
  }
}

export function cellClass(name: string, where: string): CellClass {
  const c = (Cell as Record<string, CellClass>)[name];
  if (c === undefined) throw new ContentError(`${where}: unknown collision class ${name}`);
  return c;
}

/** Every file under a directory whose name ends with a suffix, sorted for a stable bake. */
export function filesUnder(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(suffix)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function loadRooms(dir: string, root: string): Room[] {
  return filesUnder(dir, '.room.txt').map((p) =>
    parseRoom(readFileSync(p, 'utf8'), relative(root, p).split(sep).join('/')),
  );
}

export function loadContent(root: string): Content {
  const mats = readJson(join(root, 'materials.json')) as {
    materials: Array<Record<string, unknown>>;
  };
  const materials: MaterialDef[] = mats.materials.map((m, i) => {
    const where = `materials.json #${i}`;
    if (typeof m.id !== 'string' || typeof m.district !== 'string')
      throw new ContentError(`${where}: id and district`);
    return {
      id: m.id,
      district: m.district,
      slot: Number(m.slot),
      cell: cellClass(String(m.cell), `${where} (${m.id})`),
      avg: m.avg as [number, number, number],
      depth: m.depth as MaterialDef['depth'],
      sound: m.sound as MaterialDef['sound'],
    };
  });

  const pal = readJson(join(root, 'palette.json')) as Record<string, unknown>;
  const common = (pal.common ?? {}) as Record<string, PaletteEntry>;
  const palette: Record<string, Record<string, PaletteEntry>> = {};
  for (const d of DISTRICTS) {
    palette[d] = { ...common, ...((pal[d] ?? {}) as Record<string, PaletteEntry>) };
  }

  const propsFile = readJson(join(root, 'props', 'props.json')) as { props: PropDef[] };
  const props = propsFile.props;

  const art: Record<string, DistrictArt> = {};
  for (const d of DISTRICTS) {
    const p = join(root, 'art', d, 'district.json');
    if (existsSync(p)) art[d] = readJson(p) as DistrictArt;
  }

  return {
    root,
    materials,
    palette,
    props,
    art,
    rooms: loadRooms(join(root, 'world', 'rooms'), root),
    gym: loadRooms(join(root, 'world', 'gym'), root),
  };
}
