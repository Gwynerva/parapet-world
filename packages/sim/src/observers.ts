/**
 * Observers: pure functions of a runner's step-by-step state over the static trigger rects of the
 * world (hubs, route gates and corridors, finds). The client runs them for the HUD, the server for
 * the record; both see the same events because both step the same runner.
 *
 * Feed `observe` once after every step that ran (a stalled step changed nothing). It keeps its own
 * small integer state, separate from the runner's, so a snapshot of both restores both.
 *
 * - A hub, a find or a start gate is touched when the runner's body starts overlapping it (the
 *   cells under the body box, compared with the previous step; the first call, and the first after
 *   a respawn, compare with nothing).
 * - With no run active, touching a route's start gate starts it. During a run the start gates of
 *   other routes are ignored, and touching the run's own start gate restarts it.
 *   Its checkpoints, then its finish, count in order while the body overlaps them; one step may
 *   pass several gates. The time is in steps.
 * - A run is cancelled when the feet have been outside every corridor rect of the route for more
 *   than `corridorGrace` consecutive steps (a ruleset param; a jump arcing over the corridor or a
 *   drop dipping under it does not cancel), and at once on death.
 */
import { R } from './layout.ts';
import { B, type Ruleset } from './ruleset.ts';
import { CELL_SHIFT } from './shapes.ts';
import {
  HUB_WORDS,
  ROUTE_WORDS,
  findCount,
  hubCount,
  routeCount,
  type WorldStatics,
} from './statics.ts';
import { FLAG } from './registry.ts';

export const O = {
  /** 1 once a previous step's body box is known. */
  HAS_PREV: 0,
  /** The body box of the previous step in cells: x0, y0, x1, y1 (inclusive). */
  BOX_X0: 1,
  BOX_Y0: 2,
  BOX_X1: 3,
  BOX_Y1: 4,
  PREV_MOVE: 5,
  /** The active route, -1 when none. */
  ROUTE: 6,
  /** The index of the next gate of the active route (1 = the first checkpoint). */
  NEXT: 7,
  /** `R.STEP` of the runner when the active route started. */
  START_STEP: 8,
  /** Consecutive steps the feet have been outside every corridor rect of the active route. */
  OUTSIDE: 9,
} as const;
export const OBSERVER_WORDS = 10;

/** Steps outside the corridor a run survives when the ruleset has no `corridorGrace`. */
export const DEFAULT_CORRIDOR_GRACE = 20;

export const ObserverEvent = {
  HUB: 'hub',
  ROUTE_START: 'routeStart',
  CHECKPOINT: 'checkpoint',
  FINISH: 'finish',
  ROUTE_CANCEL: 'routeCancel',
  FIND: 'find',
  DEATH: 'death',
  RESPAWN: 'respawn',
} as const;
export type ObserverEventKind = (typeof ObserverEvent)[keyof typeof ObserverEvent];

export interface WorldEvent {
  kind: ObserverEventKind;
  /** The runner's `R.STEP` when it happened. */
  step: number;
  /** The hub, route or find; for a checkpoint the route; -1 for a death. */
  index: number;
  /** Checkpoint: its number (1-based). Others: 0. */
  gate: number;
  /** Checkpoint, finish: steps since the route started. Others: 0. */
  steps: number;
}

export function createObserver(): Int32Array {
  const o = new Int32Array(OBSERVER_WORDS);
  o[O.ROUTE] = -1;
  o[O.PREV_MOVE] = -1;
  return o;
}

export function copyObserver(src: Int32Array, dst?: Int32Array): Int32Array {
  const out = dst ?? new Int32Array(OBSERVER_WORDS);
  for (let i = 0; i < OBSERVER_WORDS; i++) out[i] = src[i]!;
  return out;
}

function overlaps(
  rects: Int32Array,
  at: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const rx = rects[at]!;
  const ry = rects[at + 1]!;
  return x0 < rx + rects[at + 2]! && x1 >= rx && y0 < ry + rects[at + 3]! && y1 >= ry;
}

function contains(rects: Int32Array, at: number, x: number, y: number): boolean {
  const rx = rects[at]!;
  const ry = rects[at + 1]!;
  return x >= rx && y >= ry && x < rx + rects[at + 2]! && y < ry + rects[at + 3]!;
}

const NO_EVENTS: readonly WorldEvent[] = [];

/** Advances an observer by one step of its runner; returns the events of that step. */
export function observe(
  o: Int32Array,
  s: Int32Array,
  rs: Ruleset,
  st: WorldStatics,
): readonly WorldEvent[] {
  let out: WorldEvent[] | null = null;
  const step = s[R.STEP]!;
  const emit = (kind: ObserverEventKind, index: number, gate = 0, steps = 0) => {
    out ??= [];
    out.push({ kind, step, index, gate, steps });
  };
  const move = s[R.MOVE]!;
  const hw = rs.body[B.HW]!;
  const h = (rs.flags[move]! & FLAG.crouch) !== 0 ? rs.body[B.CROUCH_H]! : rs.body[B.H]!;
  const x = s[R.X]!;
  const y = s[R.Y]!;
  const x0 = (x - hw) >> CELL_SHIFT;
  const x1 = (x + hw - 1) >> CELL_SHIFT;
  const y0 = (y - h) >> CELL_SHIFT;
  const y1 = (y - 1) >> CELL_SHIFT;
  const had = o[O.HAS_PREV] === 1;
  const px0 = o[O.BOX_X0]!;
  const py0 = o[O.BOX_Y0]!;
  const px1 = o[O.BOX_X1]!;
  const py1 = o[O.BOX_Y1]!;
  const touched = (rects: Int32Array, at: number) =>
    overlaps(rects, at, x0, y0, x1, y1) && !(had && overlaps(rects, at, px0, py0, px1, py1));

  const dead = rs.roles.dead;
  const respawn = rs.roles.respawn;
  const prevMove = o[O.PREV_MOVE]!;
  if (move === dead && prevMove !== dead) emit(ObserverEvent.DEATH, -1);
  if (move === respawn && prevMove !== respawn) {
    let hub = -1;
    const n = hubCount(st);
    for (let i = 0; i < n && hub < 0; i++) {
      if (st.hubs[i * HUB_WORDS + 4] === x && st.hubs[i * HUB_WORDS + 5] === y) hub = i;
    }
    emit(ObserverEvent.RESPAWN, hub);
  }

  const alive = move !== dead && move !== respawn;
  if (alive) {
    const nh = hubCount(st);
    for (let i = 0; i < nh; i++) if (touched(st.hubs, i * HUB_WORDS)) emit(ObserverEvent.HUB, i);
    const nf = findCount(st);
    for (let i = 0; i < nf; i++) if (touched(st.finds, i * 4)) emit(ObserverEvent.FIND, i);
  }

  // The active route: cancelled at once by death, or after a while outside its corridor.
  let route = o[O.ROUTE]!;
  if (route >= 0) {
    let cancel = move === dead;
    if (!cancel) {
      const fx = x >> CELL_SHIFT;
      const fy = (y - 1) >> CELL_SHIFT;
      const c0 = st.routes[route * ROUTE_WORDS + 2]!;
      const cn = st.routes[route * ROUTE_WORDS + 3]!;
      let inside = false;
      for (let k = 0; k < cn && !inside; k++) {
        inside = contains(st.routeRects, (c0 + k) * 4, fx, fy);
      }
      o[O.OUTSIDE] = inside ? 0 : o[O.OUTSIDE]! + 1;
      cancel = o[O.OUTSIDE]! > (rs.params.corridorGrace ?? DEFAULT_CORRIDOR_GRACE);
    }
    if (cancel) {
      emit(ObserverEvent.ROUTE_CANCEL, route);
      route = -1;
    }
  }

  if (alive) {
    // Start gates: with no run any of them starts its route; during a run only the run's own
    // start gate counts (it restarts the run), the others are ignored.
    const nr = routeCount(st);
    for (let i = 0; i < nr; i++) {
      if (route >= 0 && route !== i) continue;
      if (!touched(st.routeRects, st.routes[i * ROUTE_WORDS]! * 4)) continue;
      route = i;
      o[O.NEXT] = 1;
      o[O.START_STEP] = step;
      o[O.OUTSIDE] = 0;
      emit(ObserverEvent.ROUTE_START, i);
    }
    // The next gates of the active route, as many as the body overlaps in order.
    while (route >= 0) {
      const g0 = st.routes[route * ROUTE_WORDS]!;
      const gn = st.routes[route * ROUTE_WORDS + 1]!;
      const next = o[O.NEXT]!;
      if (next >= gn || !overlaps(st.routeRects, (g0 + next) * 4, x0, y0, x1, y1)) break;
      const steps = step - o[O.START_STEP]!;
      if (next === gn - 1) {
        emit(ObserverEvent.FINISH, route, 0, steps);
        route = -1;
      } else {
        emit(ObserverEvent.CHECKPOINT, route, next, steps);
        o[O.NEXT] = next + 1;
      }
    }
  }

  o[O.ROUTE] = route;
  // Dead or respawning runners touch nothing; after the respawn everything around is new.
  o[O.HAS_PREV] = alive ? 1 : 0;
  o[O.BOX_X0] = x0;
  o[O.BOX_Y0] = y0;
  o[O.BOX_X1] = x1;
  o[O.BOX_Y1] = y1;
  o[O.PREV_MOVE] = move;
  return out ?? NO_EVENTS;
}

/** A world event in the shape the server and the HUD consume (see `createRunnerObserver`). */
export type SimEvent =
  | { kind: 'hub'; hub: number }
  | { kind: 'find'; find: number }
  | { kind: 'routeStart'; route: number }
  | { kind: 'checkpoint'; route: number; index: number; steps: number }
  | { kind: 'finish'; route: number; steps: number }
  | { kind: 'cancel'; route: number }
  | { kind: 'death' }
  | { kind: 'respawn'; hub: number };

export interface RunnerObserver {
  /** Call after every step that ran, with the runner's new state; appends that step's events. */
  step(s: Int32Array, out: SimEvent[]): void;
  /** Forget everything (after a keyframe restore or a teleport): the next step starts a new life. */
  reset(): void;
}

/**
 * The observer of one runner over a world: `observe` plus the rule that a hub or a find is reported
 * only on its first touch in this observer's life (until `reset`). Integer state only.
 */
export function createRunnerObserver(st: WorldStatics, rs: Ruleset): RunnerObserver {
  let o = createObserver();
  const hubs = new Uint8Array(hubCount(st));
  const finds = new Uint8Array(findCount(st));
  return {
    step(s, out) {
      const events = observe(o, s, rs, st);
      for (let i = 0; i < events.length; i++) {
        const e = events[i]!;
        switch (e.kind) {
          case ObserverEvent.HUB:
            if (hubs[e.index] === 0) {
              hubs[e.index] = 1;
              out.push({ kind: 'hub', hub: e.index });
            }
            break;
          case ObserverEvent.FIND:
            if (finds[e.index] === 0) {
              finds[e.index] = 1;
              out.push({ kind: 'find', find: e.index });
            }
            break;
          case ObserverEvent.ROUTE_START:
            out.push({ kind: 'routeStart', route: e.index });
            break;
          case ObserverEvent.CHECKPOINT:
            out.push({ kind: 'checkpoint', route: e.index, index: e.gate, steps: e.steps });
            break;
          case ObserverEvent.FINISH:
            out.push({ kind: 'finish', route: e.index, steps: e.steps });
            break;
          case ObserverEvent.ROUTE_CANCEL:
            out.push({ kind: 'cancel', route: e.index });
            break;
          case ObserverEvent.DEATH:
            out.push({ kind: 'death' });
            break;
          case ObserverEvent.RESPAWN:
            out.push({ kind: 'respawn', hub: e.index });
            break;
        }
      }
    },
    reset() {
      o = createObserver();
      hubs.fill(0);
      finds.fill(0);
    },
  };
}
