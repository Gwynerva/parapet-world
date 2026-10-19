/**
 * Breadth-first search over runner states with the real simulation, for checking rooms: which
 * cells, hubs, route gates and finds a runner can reach from a hub, and the shortest time for a
 * time-trial route. Each edge of the search holds one key mask for a few steps; states are
 * deduplicated by a coarse key (position, move, facing, velocity). It finds what a player with
 * good timing can do; it is not exhaustive, so a "no" is a hint to look, not a proof.
 */
import { CELL, Key, type CellRect, type WorldIndex } from '@parapet-world/schemas';
import {
  O,
  ObserverEvent,
  R,
  copyObserver,
  copyRunner,
  createObserver,
  createRunner,
  createStatics,
  observe,
  stepRunner,
  type CellReader,
  type Ruleset,
  type RunnerState,
  type WorldStatics,
} from '@parapet-world/sim';

export interface SearchWorld {
  index: WorldIndex;
  cells: CellReader;
  rules: Ruleset;
  /** The cell rectangle the world covers: x0, y0, width, height. */
  area: CellRect;
}

const { LEFT: L, RIGHT: RT, UP: U, DOWN: D } = Key;
/** The held masks tried from every state. */
export const MASKS = [0, RT, L, RT | U, L | U, U, D, RT | D, L | D];

/** A numeric key of a state's coarse position, move, facing and velocity (44 bits). */
const coarse = (s: RunnerState): number =>
  ((((((s[R.X]! >> 8) * 1024 + ((s[R.Y]! >> 8) & 1023)) * 64 + (s[R.MOVE]! & 63)) * 2 +
    (s[R.FACING]! > 0 ? 1 : 0)) *
    64 +
    ((s[R.VX]! >> 5) & 63)) *
    32 +
    ((s[R.VY]! >> 6) & 31)) *
    2 +
  (s[R.GROUND]! ? 1 : 0);

const deadMoves = (rules: Ruleset): Set<number> =>
  new Set(['dead', 'respawn'].map((n) => rules.moveNames.indexOf(n)).filter((i) => i >= 0));

/** Steps a copy of `s` with one mask; null when it stalled, died or was moved far (respawn). */
function advance(
  s: RunnerState,
  mask: number,
  steps: number,
  w: SearchWorld,
  statics: WorldStatics,
  dead: Set<number>,
  each?: (c: RunnerState) => void,
): RunnerState | null {
  const c = copyRunner(s);
  for (let i = 0; i < steps; i++) {
    if (!stepRunner(c, mask, null, w.cells, w.rules, statics)) return null;
    if (dead.has(c[R.MOVE]!)) return null;
    each?.(c);
  }
  const far = 4 * CELL;
  if (Math.abs(c[R.X]! - s[R.X]!) > far || Math.abs(c[R.Y]! - s[R.Y]!) > far) return null;
  return c;
}

/** A runner standing at a hub's spawn, settled for a moment. */
export function runnerAtHub(w: SearchWorld, hub: number): RunnerState {
  const h = w.index.hubs[hub]!;
  const s = createRunner(w.rules, h.spawn[0], h.spawn[1], h.facing);
  const statics = createStatics(w.index);
  for (let i = 0; i < 15; i++) stepRunner(s, 0, null, w.cells, w.rules, statics);
  return s;
}

/** A runner standing in cell `x,y` (feet on the cell's bottom edge), facing right. */
export function runnerAtCell(w: SearchWorld, at: string): RunnerState {
  const [x, y] = at.split(',').map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`bad cell ${at}`);
  const s = createRunner(w.rules, x! * CELL + CELL / 2, (y! + 1) * CELL, 1);
  const statics = createStatics(w.index);
  for (let i = 0; i < 15; i++) stepRunner(s, 0, null, w.cells, w.rules, statics);
  return s;
}

/** Whether a runner's body overlaps a cell rectangle. */
export function touches(s: RunnerState, r: CellRect, halfWidth: number, height: number): boolean {
  const x0 = s[R.X]! - halfWidth;
  const x1 = s[R.X]! + halfWidth;
  const y0 = s[R.Y]! - height;
  const y1 = s[R.Y]!;
  return (
    x1 > r[0] * CELL && x0 < (r[0] + r[2]) * CELL && y1 > r[1] * CELL && y0 < (r[1] + r[3]) * CELL
  );
}

export interface Exploration {
  /** 1 for every cell of `area` a runner's body touched (row-major). */
  touched: Uint8Array;
  states: number;
}

/**
 * Explores from a runner state; `steps` per edge, at most `maxStates` states, staying inside the
 * cell rectangle `within` when given.
 */
export function explore(
  w: SearchWorld,
  start: RunnerState,
  maxStates = 4_000_000,
  steps = 4,
  within: CellRect | null = null,
): Exploration {
  const statics = createStatics(w.index);
  const dead = deadMoves(w.rules);
  const [ax, ay, aw, ah] = w.area;
  const touched = new Uint8Array(aw * ah);
  const hw = w.rules.params['halfWidth'] ?? 256;
  const ht = w.rules.params['height'] ?? 1792;
  const mark = (s: RunnerState) => {
    const x0 = (s[R.X]! - hw) >> 10;
    const x1 = (s[R.X]! + hw - 1) >> 10;
    const y0 = (s[R.Y]! - ht) >> 10;
    const y1 = (s[R.Y]! - 1) >> 10;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x >= ax && y >= ay && x < ax + aw && y < ay + ah) touched[(y - ay) * aw + x - ax] = 1;
      }
    }
  };
  const seen = new Set<number>([coarse(start)]);
  let frontier: RunnerState[] = [start];
  mark(start);
  let states = 1;
  while (frontier.length > 0 && states < maxStates) {
    const next: RunnerState[] = [];
    for (const s of frontier) {
      for (const m of MASKS) {
        const c = advance(s, m, steps, w, statics, dead);
        if (c === null) continue;
        if (
          within !== null &&
          (c[R.X]! < within[0] * CELL ||
            c[R.X]! >= (within[0] + within[2]) * CELL ||
            c[R.Y]! < within[1] * CELL ||
            c[R.Y]! > (within[1] + within[3]) * CELL)
        ) {
          continue;
        }
        const k = coarse(c);
        if (seen.has(k)) continue;
        seen.add(k);
        mark(c);
        next.push(c);
        states++;
      }
    }
    frontier = next;
  }
  return { touched, states };
}

/** Whether any touched cell lies in a rectangle. */
export function hit(e: Exploration, area: CellRect, r: CellRect): boolean {
  const [ax, ay, aw, ah] = area;
  for (let y = r[1]; y < r[1] + r[3]; y++) {
    for (let x = r[0]; x < r[0] + r[2]; x++) {
      if (x >= ax && y >= ay && x < ax + aw && y < ay + ah && e.touched[(y - ay) * aw + x - ax]) {
        return true;
      }
    }
  }
  return false;
}

export interface RouteTime {
  /** Seconds from the route's start to its finish, or null when no line finished. */
  seconds: number | null;
  states: number;
  /**
   * How far the best line got: 0 the start gate was never touched, k (1..checkpoints) the run
   * reached checkpoint k - 1 and stalled before checkpoint k, checkpoints + 1 stuck before the
   * finish, checkpoints + 2 finished.
   */
  reached: number;
}

/**
 * The shortest time the search finds for a route, judged by the simulation's own observer (the
 * game's rules for gates and corridors): a runner starts idle on the floor under the start gate,
 * facing the first checkpoint, with an observer stepped alongside it; a line counts only when the
 * observer emits `finish` for the route, and a node is dropped when it emits a cancel (or a death,
 * or another route's start).
 */
export function routeTime(
  w: SearchWorld,
  routeIndex: number,
  maxStates = 8_000_000,
  steps = 3,
): RouteTime {
  const route = w.index.routes[routeIndex]!;
  const statics = createStatics(w.index);
  const dead = deadMoves(w.rules);
  const gateCount = route.checkpoints.length + 1;
  const sx = (route.start[0] * CELL + (route.start[2] * CELL) / 2) | 0;
  const sy = (route.start[1] + route.start[3]) * CELL;
  const firstGate = route.checkpoints[0] ?? route.finish;
  const facing = firstGate[0] >= route.start[0] ? 1 : -1;
  const s0 = createRunner(w.rules, sx, sy, facing);
  const o0 = createObserver();
  let started = -1;
  for (let i = 0; i < 30; i++) {
    stepRunner(s0, 0, null, w.cells, w.rules, statics);
    for (const e of observe(o0, s0, w.rules, statics)) {
      if (e.kind === ObserverEvent.ROUTE_START && e.index === routeIndex) started = e.step;
    }
  }
  // NEXT is the next gate's index in the route's gate list (1 = the first checkpoint).
  const progress = (o: Int32Array) => (o[O.ROUTE] === routeIndex ? o[O.NEXT]! : 0);
  const seen = new Set<number>();
  let frontier: Array<[RunnerState, Int32Array, number]> = [[s0, o0, started]];
  let best = progress(o0);
  let layer = 0;
  while (frontier.length > 0 && seen.size < maxStates) {
    const next: Array<[RunnerState, Int32Array, number]> = [];
    for (const [s, o, st] of frontier) {
      for (const m of MASKS) {
        const c = copyRunner(s);
        const oc = copyObserver(o);
        let startStep = st;
        let alive = true;
        let finished = -1;
        for (let k = 0; k < steps && alive && finished < 0; k++) {
          if (!stepRunner(c, m, null, w.cells, w.rules, statics) || dead.has(c[R.MOVE]!)) {
            alive = false;
            break;
          }
          for (const e of observe(oc, c, w.rules, statics)) {
            if (e.kind === ObserverEvent.ROUTE_START) {
              if (e.index === routeIndex) startStep = e.step;
              else alive = false;
            } else if (e.kind === ObserverEvent.ROUTE_CANCEL && e.index === routeIndex) {
              alive = false;
            } else if (e.kind === ObserverEvent.FINISH && e.index === routeIndex) {
              finished = e.steps;
            } else if (e.kind === ObserverEvent.DEATH) {
              alive = false;
            }
          }
        }
        if (finished >= 0) {
          return { seconds: finished / 30, states: seen.size, reached: gateCount + 1 };
        }
        if (!alive) continue;
        const far = 4 * CELL;
        if (Math.abs(c[R.X]! - s[R.X]!) > far || Math.abs(c[R.Y]! - s[R.Y]!) > far) continue;
        const p = progress(oc);
        if (p > best) best = p;
        const key = coarse(c) * 16 + Math.min(15, p);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push([c, oc, startStep]);
      }
    }
    frontier = next;
    layer++;
  }
  void layer;
  return { seconds: null, states: seen.size, reached: best };
}

/** Words for a route search's `reached`: where the best line stopped. */
export function stuckAt(reached: number, checkpoints: number): string {
  if (reached === 0) return 'never touched the start gate';
  if (reached <= checkpoints) return `stuck before checkpoint ${reached}`;
  if (reached === checkpoints + 1) return 'stuck before the finish';
  return 'finished';
}
