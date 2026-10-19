/**
 * The bake: rooms -> one assembled world -> chunk files (cells with props stamped, materials,
 * autotile variants, depth outlines, prop placements by anchor chunk) and the world index.
 */
import { createHash } from 'node:crypto';
import {
  CHUNK_AREA,
  CHUNK_CELLS,
  bytesToBase64,
  type ChunkFile,
  type DistrictDef,
  type MaterialDef,
  type WorldIndex,
} from '@parapet-world/schemas';
import { assemble, type Assembled, type Problem } from './assemble.ts';
import { DISTRICTS, type Content } from './content.ts';
import { autotile, cellOutline, mergeSegments, type Segment } from './outline.ts';
import type { Room } from './room.ts';
import { validateWorld } from './validate.ts';

export interface BakedChunk {
  name: string;
  file: ChunkFile;
  json: string;
}

export interface BakeResult {
  index: WorldIndex;
  chunks: BakedChunk[];
  problems: Problem[];
  world: Assembled;
  variants: Uint8Array;
}

const NO_MATERIAL: MaterialDef = {
  id: '',
  district: '',
  slot: 0,
  cell: 0,
  avg: [0, 0, 0],
  depth: 'flat',
  sound: 'concrete',
};

function districtDefs(content: Content): DistrictDef[] {
  return DISTRICTS.map((id) => {
    const art = content.art[id];
    return {
      id,
      name: art?.name ?? id[0]!.toUpperCase() + id.slice(1),
      atlas: `art/${id}/tiles.png`,
      background: (art?.background ?? []).map((b) => ({ ...b, file: `art/${id}/${b.file}` })),
      sky: art?.sky ?? [0, 0, 0],
      ambience: art?.ambience ?? '',
    };
  });
}

/** Content hash of a chunk file's JSON: 16 hex digits of SHA-256. */
export function chunkName(json: string): string {
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

export function bakeChunks(a: Assembled, variants: Uint8Array): BakedChunk[] {
  const out: BakedChunk[] = [];
  const cw = a.width / CHUNK_CELLS;
  const ch = a.height / CHUNK_CELLS;
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const cx = a.x0 / CHUNK_CELLS + i;
      const cy = a.y0 / CHUNK_CELLS + j;
      const cells = new Uint8Array(CHUNK_AREA);
      const mats = new Uint8Array(CHUNK_AREA);
      const vars = new Uint8Array(CHUNK_AREA);
      const segs: Segment[] = [];
      for (let y = 0; y < CHUNK_CELLS; y++) {
        for (let x = 0; x < CHUNK_CELLS; x++) {
          const gx = i * CHUNK_CELLS + x;
          const gy = j * CHUNK_CELLS + y;
          const g = gy * a.width + gx;
          const c = (y << 5) | x;
          cells[c] = a.cells[g]!;
          mats[c] = a.materials[g]!;
          vars[c] = variants[g]!;
          if (mats[c] !== 0) segs.push(...cellOutline(a, a.x0 + gx, a.y0 + gy));
        }
      }
      const props = a.placements
        .filter((p) => p.x >> 5 === cx && p.y >> 5 === cy)
        .map((p) => ({ prop: p.prop, x: p.x, y: p.y }))
        .sort((p, q) => p.y - q.y || p.x - q.x || p.prop - q.prop);
      const file: ChunkFile = {
        format: 1,
        cx,
        cy,
        cells: bytesToBase64(cells),
        materials: bytesToBase64(mats),
        variants: bytesToBase64(vars),
        outlines: mergeSegments(segs).flat(),
        props,
      };
      const json = JSON.stringify(file);
      out.push({ name: `chunks/${chunkName(json)}.json`, file, json });
    }
  }
  return out;
}

export function bakeWorld(content: Content, rooms: Room[], bots: string[] = []): BakeResult {
  const world = assemble(content, rooms);
  const problems = [...world.problems];
  if (rooms.length === 0)
    problems.push({ level: 'warning', where: '(world)', message: 'no rooms' });
  problems.push(...validateWorld(world, content));
  const variants = autotile(world);
  const chunks = bakeChunks(world, variants);

  const hubIndex = new Map(world.hubs.map((h, i) => [h.id, i]));
  let startHub = world.hubs.findIndex((h) => h.start);
  if (startHub < 0) startHub = world.hubs.findIndex((h) => h.district === 'rooftops');
  if (startHub < 0) startHub = world.hubs.length > 0 ? 0 : -1;

  const index: WorldIndex = {
    format: 1,
    bounds: [
      world.x0 / CHUNK_CELLS,
      world.y0 / CHUNK_CELLS,
      world.width / CHUNK_CELLS,
      world.height / CHUNK_CELLS,
    ],
    chunks: chunks.map((c) => ({ cx: c.file.cx, cy: c.file.cy, file: c.name })),
    materials: [NO_MATERIAL, ...content.materials],
    districts: districtDefs(content),
    regions: world.regions.map((r) => ({
      id: r.id,
      district: r.district,
      rect: r.rect,
      hub: hubIndex.get(r.hubId) ?? -1,
    })),
    hubs: world.hubs.map((h) => ({
      id: h.id,
      district: h.district,
      name: h.name,
      rect: h.rect,
      spawn: h.spawn,
      facing: h.facing,
    })),
    routes: world.routes.map((r) => ({
      id: r.id,
      district: r.district,
      name: r.name,
      difficulty: r.difficulty,
      start: r.start,
      checkpoints: r.checkpoints,
      finish: r.finish,
      corridor: r.corridor,
    })),
    finds: world.finds.map((f) => ({ id: f.id, district: f.district, rect: f.rect, clue: f.clue })),
    props: content.props,
    bots,
    startHub,
  };
  return { index, chunks, problems, world, variants };
}
