/**
 * Checks on an assembled world beyond what assembly itself catches: unique ids, region and hub
 * references, entities inside regions, standable hub spawns, and the art contract (a front tile's
 * edge row and column equal the first row of its top depth strip and the first column of its side
 * strip). Missing art is never an error.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CELL,
  SLOT_HEIGHT,
  VARIANT,
  frontRect,
  sideStripRect,
  topStripRect,
  type CellRect,
} from '@parapet-world/schemas';
import { GridWorld, boxHitsSolid, findFloor, loadRuleset } from '@parapet-world/sim';
import { decodePng, type Image } from '../png.ts';
import type { Assembled, Problem } from './assemble.ts';
import type { Content } from './content.ts';

const NONE = 0x3fffffff;

/** The assembled world as one grid: air beside it, KILL below it (as in a `ChunkWorld`). */
export function gridWorld(a: Assembled): GridWorld {
  return new GridWorld(a.width, a.height, a.x0, a.y0, a.cells);
}

function rectCells(r: CellRect): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = r[1]; y < r[1] + r[3]; y++)
    for (let x = r[0]; x < r[0] + r[2]; x++) out.push([x, y]);
  return out;
}

export function validateWorld(a: Assembled, content: Content): Problem[] {
  const problems: Problem[] = [];
  const err = (where: string, message: string) => problems.push({ level: 'error', where, message });
  const warn = (where: string, message: string) =>
    problems.push({ level: 'warning', where, message });

  const unique = (kind: string, list: Array<{ id: string; where: string }>) => {
    const seen = new Map<string, string>();
    for (const e of list) {
      const first = seen.get(e.id);
      if (first !== undefined) err(e.where, `${kind} ${e.id} is already defined at ${first}`);
      else seen.set(e.id, e.where);
    }
  };
  unique('region', a.regions);
  unique('hub', a.hubs);
  unique('route', a.routes);
  unique('find', a.finds);

  const hubIds = new Set(a.hubs.map((h) => h.id));
  for (const r of a.regions) {
    if (!hubIds.has(r.hubId)) err(r.where, `region ${r.id} returns to a missing hub ${r.hubId}`);
  }
  const inRegion = (x: number, y: number) =>
    a.regions.some(
      (r) =>
        x >= r.rect[0] && y >= r.rect[1] && x < r.rect[0] + r.rect[2] && y < r.rect[1] + r.rect[3],
    );
  const covered = (rect: CellRect) => rectCells(rect).every(([x, y]) => inRegion(x, y));
  for (const h of a.hubs)
    if (!covered(h.rect)) err(h.where, `hub ${h.id} lies outside every region`);
  for (const f of a.finds)
    if (!covered(f.rect)) err(f.where, `find ${f.id} lies outside every region`);
  for (const r of a.routes) {
    const gates = [r.start, ...r.checkpoints, r.finish];
    if (!gates.every(covered)) err(r.where, `route ${r.id} has a gate outside every region`);
    const inCorridor = (g: CellRect) =>
      rectCells(g).every(([x, y]) =>
        r.corridor.some((c) => x >= c[0] && y >= c[1] && x < c[0] + c[2] && y < c[1] + c[3]),
      );
    if (!gates.every(inCorridor)) err(r.where, `route ${r.id} has a gate outside its corridor`);
  }
  if (a.hubs.filter((h) => h.start).length > 1) {
    err(a.hubs.find((h) => h.start)!.where, 'more than one hub is marked start');
  }

  // Hub spawns: feet on a floor, body free.
  if (a.width > 0) {
    const rules = loadRuleset(
      JSON.parse(readFileSync(join(content.root, 'rules', 'moves.json'), 'utf8')),
    );
    const hw = rules.params.halfWidth!;
    const height = rules.params.height!;
    const step = rules.params.stepUp!;
    const g = gridWorld(a);
    for (const h of a.hubs) {
      const [x, y] = h.spawn;
      if (findFloor(g, x, hw, y, y, true) === NONE)
        err(h.where, `hub ${h.id}: no floor under the spawn`);
      else if (boxHitsSolid(g, x - hw, y - height, x + hw, y - step))
        err(h.where, `hub ${h.id}: the spawn is inside a wall`);
      const cx = Math.floor(x / CELL);
      const cy = Math.floor((y - 1) / CELL);
      const [rx, ry, rw, rh] = h.rect;
      if (cx < rx || cy < ry || cx >= rx + rw || cy >= ry + rh)
        warn(h.where, `hub ${h.id}: the spawn is outside the hub area`);
    }
  }
  return problems;
}

function same(img: Image, ax: number, ay: number, bx: number, by: number): boolean {
  const i = (ay * img.width + ax) * 4;
  const j = (by * img.width + bx) * 4;
  const d = img.data;
  return d[i] === d[j] && d[i + 1] === d[j + 1] && d[i + 2] === d[j + 2] && d[i + 3] === d[j + 3];
}

/** The art contract per material with depth strips; problems only where art exists. */
export function validateArt(content: Content): Problem[] {
  const problems: Problem[] = [];
  const byDistrict = new Map<string, Image>();
  for (const m of content.materials) {
    if (m.depth !== 'strip') continue;
    const path = join(content.root, 'art', m.district, 'tiles.png');
    if (!existsSync(path)) continue;
    let img = byDistrict.get(m.district);
    if (img === undefined) {
      img = decodePng(readFileSync(path));
      byDistrict.set(m.district, img);
    }
    const where = `art/${m.district}/tiles.png`;
    if ((m.slot + 1) * SLOT_HEIGHT > img.height) {
      problems.push({ level: 'warning', where, message: `no slot ${m.slot} for ${m.id}` });
      continue;
    }
    const [tx, ty] = topStripRect(m.slot);
    const [sx, sy] = sideStripRect(m.slot);
    let bad = 0;
    for (let v = 0; v < 16; v++) {
      const [fx, fy] = frontRect(m.slot, v);
      if ((v & VARIANT.UP) === 0) {
        for (let x = 0; x < 32; x++) if (!same(img, fx + x, fy, tx + x, ty)) bad++;
      }
      if ((v & VARIANT.LEFT) === 0) {
        for (let y = 0; y < 32; y++) if (!same(img, fx, fy + y, sx, sy + y)) bad++;
      }
    }
    if (bad > 0) {
      problems.push({
        level: 'error',
        where,
        message: `${m.id}: ${bad} edge pixels of its front tiles differ from the first row or column of its depth strips`,
      });
    }
  }
  return problems;
}
