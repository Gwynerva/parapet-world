/**
 * Static world data the simulation and the observers read: regions (death returns the runner to
 * their hub), hubs (spawn points, teleport areas), routes and finds, compiled from `world.json`
 * into integer arrays. Rects are in cells, spawn points in world units.
 */
import type { CellRect, WorldIndex } from '@parapet-world/schemas';

export interface WorldStatics {
  /** Per region: x, y, w, h, hub. */
  regions: Int32Array;
  /** Per hub: x, y, w, h, spawnX, spawnY, facing. */
  hubs: Int32Array;
  /**
   * Per route: offset and count of its gate rects in `routeRects` (start, checkpoints, finish),
   * then offset and count of its corridor rects.
   */
  routes: Int32Array;
  routeRects: Int32Array;
  /** Per find: x, y, w, h. */
  finds: Int32Array;
  startHub: number;
}

export const REGION_WORDS = 5;
export const HUB_WORDS = 7;
export const ROUTE_WORDS = 4;

export type StaticsSource = Pick<WorldIndex, 'regions' | 'hubs' | 'startHub'> &
  Partial<Pick<WorldIndex, 'routes' | 'finds'>>;

function putRect(out: Int32Array, at: number, r: CellRect): void {
  out[at] = r[0];
  out[at + 1] = r[1];
  out[at + 2] = r[2];
  out[at + 3] = r[3];
}

export function createStatics(src: StaticsSource): WorldStatics {
  const regions = new Int32Array(src.regions.length * REGION_WORDS);
  for (let i = 0; i < src.regions.length; i++) {
    const r = src.regions[i]!;
    putRect(regions, i * REGION_WORDS, r.rect);
    regions[i * REGION_WORDS + 4] = r.hub;
  }
  const hubs = new Int32Array(src.hubs.length * HUB_WORDS);
  for (let i = 0; i < src.hubs.length; i++) {
    const h = src.hubs[i]!;
    const at = i * HUB_WORDS;
    putRect(hubs, at, h.rect);
    hubs[at + 4] = h.spawn[0];
    hubs[at + 5] = h.spawn[1];
    hubs[at + 6] = h.facing;
  }
  const routeList = src.routes ?? [];
  const routes = new Int32Array(routeList.length * ROUTE_WORDS);
  const rects: CellRect[] = [];
  for (let i = 0; i < routeList.length; i++) {
    const r = routeList[i]!;
    routes[i * ROUTE_WORDS] = rects.length;
    rects.push(r.start);
    for (let k = 0; k < r.checkpoints.length; k++) rects.push(r.checkpoints[k]!);
    rects.push(r.finish);
    routes[i * ROUTE_WORDS + 1] = r.checkpoints.length + 2;
    routes[i * ROUTE_WORDS + 2] = rects.length;
    for (let k = 0; k < r.corridor.length; k++) rects.push(r.corridor[k]!);
    routes[i * ROUTE_WORDS + 3] = r.corridor.length;
  }
  const routeRects = new Int32Array(rects.length * 4);
  for (let i = 0; i < rects.length; i++) putRect(routeRects, i * 4, rects[i]!);
  const findList = src.finds ?? [];
  const finds = new Int32Array(findList.length * 4);
  for (let i = 0; i < findList.length; i++) putRect(finds, i * 4, findList[i]!.rect);
  return { regions, hubs, routes, routeRects, finds, startHub: src.startHub };
}

/** An empty world: no regions or hubs; respawn falls back to staying in place. */
export const NO_STATICS: WorldStatics = createStatics({ regions: [], hubs: [], startHub: -1 });

export function rectHas(rects: Int32Array, at: number, cx: number, cy: number): boolean {
  return (
    cx >= rects[at]! &&
    cy >= rects[at + 1]! &&
    cx < rects[at]! + rects[at + 2]! &&
    cy < rects[at + 1]! + rects[at + 3]!
  );
}

export function regionCount(st: WorldStatics): number {
  return (st.regions.length / REGION_WORDS) | 0;
}

export function hubCount(st: WorldStatics): number {
  return (st.hubs.length / HUB_WORDS) | 0;
}

export function routeCount(st: WorldStatics): number {
  return (st.routes.length / ROUTE_WORDS) | 0;
}

export function findCount(st: WorldStatics): number {
  return st.finds.length >> 2;
}

/** The hub a death at a cell returns to: the first region holding the cell, else the start hub. */
export function hubForCell(st: WorldStatics, cx: number, cy: number): number {
  const n = regionCount(st);
  for (let i = 0; i < n; i++) {
    if (rectHas(st.regions, i * REGION_WORDS, cx, cy)) return st.regions[i * REGION_WORDS + 4]!;
  }
  return st.startHub;
}

/** The hub whose area holds a cell, or -1. */
export function hubAtCell(st: WorldStatics, cx: number, cy: number): number {
  const n = hubCount(st);
  for (let i = 0; i < n; i++) if (rectHas(st.hubs, i * HUB_WORDS, cx, cy)) return i;
  return -1;
}
