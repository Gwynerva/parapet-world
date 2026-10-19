/**
 * One simulation step of a runner. Order inside a step:
 *
 * 1. Stall check: the 3 x 3 chunks around the runner must be present, else nothing changes.
 * 2. Input: the held mask, press edges and press ages, the held intent.
 * 3. A command (hub teleport), if valid.
 * 4. Sensing: the floor under the feet, re-derived from the position.
 * 5. Transitions of the current move (instant moves chain, at most `MAX_HOPS` per step), then
 *    the end of a timed move.
 * 6. The move's per-step effects.
 * 7. Physics: gravity, speed caps, a horizontal sweep against walls, then the floor, the
 *    ceiling or slopes vertically.
 * 8. The move timer and the countdowns.
 *
 * Integer arithmetic only (see the determinism rules in the README).
 */
import {
  CELL_MISSING,
  Cell,
  Command,
  KEY_MASK,
  Key,
  type InputCommand,
} from '@parapet-world/schemas';
import { boxHasClass, boxHitsSolid, cellAt, findFloor, hit, sweepUp, sweepX } from './collide.ts';
import { fnvWord, fnvWords, FNV_OFFSET } from './hash.ts';
import { AGE_BASE, AGE_MAX, AIR_MAX, HASHED_WORDS, KEY_COUNT, R, STATE_WORDS } from './layout.ts';
import { E, FLAG, K, P } from './registry.ts';
import {
  B,
  EFFECT_WORDS,
  PRED_WORDS,
  TRANS_WORDS,
  keyBit,
  type RoleName,
  type Ruleset,
} from './ruleset.ts';
import {
  bandAhead,
  bodyHeight,
  findBar,
  findLedge,
  findLedgeTop,
  findPole,
  found,
  ladderAtHead,
  ladderHere,
  ladderTop,
  ledgeRoom,
  poleAtHands,
  scanObstacle,
  vaultTarget,
} from './sensors.ts';
import { CELL_SHIFT, NONE, isOneWay, isSlope, slopeTop } from './shapes.ts';
import { HUB_WORDS, hubAtCell, hubCount, hubForCell, type WorldStatics } from './statics.ts';
import type { CellReader } from './world.ts';

/** Instant moves chained within one step, at most. */
export const MAX_HOPS = 8;

/**
 * Debugging and test hooks; never part of the simulation's result. `onEnter` sees every move
 * entry, instant ones included.
 */
export const simDebug: { onEnter: ((s: RunnerState, move: number) => void) | null } = {
  onEnter: null,
};
const TIMER_MAX = 1 << 30;

export type RunnerState = Int32Array;

/**
 * Set when a respawn or teleport moved the runner during the current step. The rest of that step
 * is skipped, because the chunks around the new place may not be loaded; the next step's stall
 * check covers them.
 */
let relocated = false;

/** A runner standing (or falling) at feet point (x, y) in world units, in the spawn move. */
export function createRunner(rs: Ruleset, x: number, y: number, facing: number): RunnerState {
  const s = new Int32Array(STATE_WORDS);
  s[R.X] = x;
  s[R.Y] = y;
  s[R.FACING] = facing < 0 ? -1 : 1;
  for (let k = 0; k < KEY_COUNT; k++) s[AGE_BASE + k] = AGE_MAX;
  const m = rs.roles.spawn;
  s[R.MOVE] = m;
  s[R.DUR] = rs.dur[m]!;
  return s;
}

export function copyRunner(src: RunnerState, dst?: RunnerState): RunnerState {
  const out = dst ?? new Int32Array(STATE_WORDS);
  for (let i = 0; i < STATE_WORDS; i++) out[i] = src[i]!;
  return out;
}

/** FNV-1a over every state word but `ANIM_NONCE` (the step number is `R.STEP`); unsigned. */
export function hashRunner(s: RunnerState): number {
  return fnvWords(FNV_OFFSET, s, HASHED_WORDS) >>> 0;
}

/** Hash of a runner together with an external step number (when the caller counts steps). */
export function hashRunnerAt(s: RunnerState, step: number): number {
  return fnvWord(fnvWords(FNV_OFFSET, s, HASHED_WORDS), step) >>> 0;
}

/** The cell holding the runner's feet point (the lowest row of its body). */
export function runnerCellX(s: RunnerState): number {
  return s[R.X]! >> CELL_SHIFT;
}
export function runnerCellY(s: RunnerState): number {
  return (s[R.Y]! - 1) >> CELL_SHIFT;
}

/** Whether the runner can be stepped: the 3 x 3 chunks around it are present. */
export function runnerReady(s: RunnerState, world: CellReader): boolean {
  return world.ready(runnerCellX(s), runnerCellY(s));
}

/**
 * Advances a runner by one step with the keys held during it (`Key` bits) and an optional command.
 * Returns false, changing nothing, when the chunks around the runner are not all loaded.
 */
export function stepRunner(
  s: RunnerState,
  held: number,
  command: InputCommand | null,
  world: CellReader,
  rs: Ruleset,
  statics: WorldStatics,
): boolean {
  if (!runnerReady(s, world)) return false;
  s[R.STEP] = (s[R.STEP]! + 1) | 0;
  s[R.HOPS] = 0;
  relocated = false;
  input(s, held & KEY_MASK);
  if (command !== null && command.kind === Command.TELEPORT) {
    teleport(s, world, rs, statics, command.arg);
  }
  if (!relocated) {
    sense(s, world, rs);
    transitions(s, world, rs, statics);
  }
  if (!relocated) {
    const m = s[R.MOVE]!;
    runEffects(s, world, rs, rs.stepAt[m]!, rs.stepLen[m]!, statics, false);
    physics(s, world, rs);
  }
  relocated = false;
  if (s[R.TIMER]! < TIMER_MAX) s[R.TIMER] = s[R.TIMER]! + 1;
  if (s[R.DROP]! > 0) s[R.DROP] = s[R.DROP]! - 1;
  if (s[R.LOCK]! > 0) s[R.LOCK] = s[R.LOCK]! - 1;
  return true;
}

/** Enters a role's move outside the step (tools, the server's freeze); clears velocity. */
export function enterRole(
  s: RunnerState,
  rs: Ruleset,
  role: RoleName,
  statics: WorldStatics,
  world: CellReader | null = null,
): void {
  s[R.VX] = 0;
  s[R.VY] = 0;
  enter(s, world, rs, rs.roles[role], statics);
}

function input(s: RunnerState, held: number): void {
  const prev = s[R.HELD]!;
  s[R.PREV_HELD] = prev;
  s[R.HELD] = held;
  const down = held & ~prev;
  for (let k = 0; k < KEY_COUNT; k++) {
    const i = AGE_BASE + k;
    if ((down & (1 << k)) !== 0) s[i] = 0;
    else if (s[i]! < AGE_MAX) s[i] = s[i]! + 1;
  }
  s[R.WANT_X] = ((held & Key.RIGHT) !== 0 ? 1 : 0) - ((held & Key.LEFT) !== 0 ? 1 : 0);
  s[R.WANT_Y] = ((held & Key.DOWN) !== 0 ? 1 : 0) - ((held & Key.UP) !== 0 ? 1 : 0);
}

function teleport(s: RunnerState, w: CellReader, rs: Ruleset, st: WorldStatics, hub: number): void {
  if (hub < 0 || hub >= hubCount(st) || s[R.GROUND] === 0) return;
  if (hubAtCell(st, runnerCellX(s), runnerCellY(s)) < 0) return;
  placeAtHub(s, st, hub);
  enter(s, w, rs, rs.roles.spawn, st);
}

function placeAtHub(s: RunnerState, st: WorldStatics, hub: number): void {
  relocated = true;
  const at = hub * HUB_WORDS;
  s[R.X] = st.hubs[at + 4]!;
  s[R.Y] = st.hubs[at + 5]!;
  s[R.FACING] = st.hubs[at + 6]! < 0 ? -1 : 1;
  s[R.VX] = 0;
  s[R.VY] = 0;
  s[R.LAND_VY] = 0;
  s[R.AIR_STEPS] = 0;
  s[R.DROP] = 0;
  s[R.LOCK] = 0;
  s[R.GROUND] = 0;
  s[R.SLOPE] = 0;
  s[R.WALL] = 0;
  s[R.HEAD] = 0;
  s[R.IMPACT] = 0;
}

/** The floor exactly under the feet (only while not rising). */
function sense(s: RunnerState, w: CellReader, rs: Ruleset): void {
  if (s[R.VY]! < 0 || (rs.flags[s[R.MOVE]!]! & FLAG.noCollide) !== 0) {
    s[R.GROUND] = 0;
    s[R.SLOPE] = 0;
    return;
  }
  const y = s[R.Y]!;
  const f = findFloor(w, s[R.X]!, rs.body[B.HW]!, y, y, s[R.DROP] === 0);
  if (f === NONE) {
    s[R.GROUND] = 0;
    s[R.SLOPE] = 0;
  } else {
    s[R.GROUND] = hit.kind + 1;
    s[R.SLOPE] = hit.slope;
  }
}

function transitions(s: RunnerState, w: CellReader, rs: Ruleset, st: WorldStatics): void {
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const m = s[R.MOVE]!;
    let target = -1;
    let consume = 0;
    const t0 = rs.transAt[m]!;
    const tn = rs.transLen[m]!;
    for (let k = 0; k < tn; k++) {
      const at = (t0 + k) * TRANS_WORDS;
      const p0 = rs.trans[at + 2]!;
      const pn = rs.trans[at + 3]!;
      let ok = true;
      for (let p = 0; p < pn && ok; p++) {
        const pa = (p0 + p) * PRED_WORDS;
        const v = predicate(
          s,
          w,
          rs,
          rs.preds[pa]!,
          rs.preds[pa + 2]!,
          rs.preds[pa + 3]!,
          rs.preds[pa + 4]!,
        );
        ok = rs.preds[pa + 1] === 0 ? v : !v;
      }
      if (ok) {
        target = rs.trans[at]!;
        consume = rs.trans[at + 1]!;
        break;
      }
    }
    if (target < 0) {
      const d = s[R.DUR]!;
      if (d === 0 || (d > 0 && s[R.TIMER]! >= d)) target = rs.then[m]!;
    }
    if (target < 0) return;
    if (consume !== 0 && (rs.flags[target]! & FLAG.keepPresses) === 0) {
      for (let k = 0; k <= K.BACK; k++) {
        if ((consume & (1 << k)) === 0) continue;
        const bit = keyBit(k, s[R.FACING]!);
        for (let i = 0; i < KEY_COUNT; i++) if (bit === 1 << i) s[AGE_BASE + i] = AGE_MAX;
      }
    }
    enter(s, w, rs, target, st);
    s[R.HOPS] = s[R.HOPS]! + 1;
    if (relocated || rs.dur[target] !== 0) return;
  }
}

function enter(
  s: RunnerState,
  w: CellReader | null,
  rs: Ruleset,
  target: number,
  st: WorldStatics,
): void {
  const old = s[R.MOVE]!;
  runEffects(s, w, rs, rs.exitAt[old]!, rs.exitLen[old]!, st, true);
  s[R.MOVE] = target;
  s[R.TIMER] = 0;
  s[R.DUR] = rs.dur[target]!;
  s[R.PHASE] = 0;
  s[R.ANIM_NONCE] = (s[R.ANIM_NONCE]! + 1) | 0;
  runEffects(s, w, rs, rs.enterAt[target]!, rs.enterLen[target]!, st, true);
  if (simDebug.onEnter !== null) simDebug.onEnter(s, target);
}

/** Press age of a key index (`K`), FWD and BACK resolved against the facing. */
function ageOf(s: RunnerState, key: number): number {
  const bit = keyBit(key, s[R.FACING]!);
  for (let i = 0; i < KEY_COUNT; i++) if (bit === 1 << i) return s[AGE_BASE + i]!;
  return AGE_MAX;
}

function opposite(key: number): number {
  switch (key) {
    case K.LEFT:
      return K.RIGHT;
    case K.RIGHT:
      return K.LEFT;
    case K.UP:
      return K.DOWN;
    case K.DOWN:
      return K.UP;
    case K.FWD:
      return K.BACK;
    case K.BACK:
      return K.FWD;
    default:
      return -1;
  }
}

function abs(v: number): number {
  return v < 0 ? -v : v;
}

/** v * n / 256, rounded toward zero so both facings behave alike. */
function scale256(v: number, n: number): number {
  return v < 0 ? -((-v * n) >> 8) : (v * n) >> 8;
}

function predicate(
  s: RunnerState,
  w: CellReader,
  rs: Ruleset,
  id: number,
  a: number,
  b: number,
  c: number,
): boolean {
  const f = s[R.FACING]!;
  const quietBack = a === K.BACK && (rs.flags[s[R.MOVE]!]! & FLAG.noTurn) !== 0;
  const body = rs.body;
  switch (id) {
    case P.true:
      return true;
    case P.onGround:
      return s[R.GROUND] !== 0;
    case P.pressed:
      return !quietBack && ageOf(s, a) === 0;
    case P.recent:
      return !quietBack && ageOf(s, a) <= b;
    case P.held:
      return !quietBack && (s[R.HELD]! & keyBit(a, f)) !== 0;
    case P.want: {
      if (quietBack) return false;
      const o = opposite(a);
      const h = s[R.HELD]!;
      return (h & keyBit(a, f)) !== 0 && (o < 0 || (h & keyBit(o, f)) === 0);
    }
    case P.timer:
      return s[R.TIMER]! >= a;
    case P.ended:
      return s[R.DUR]! > 0 && s[R.TIMER]! >= s[R.DUR]!;
    case P.phase:
      return s[R.PHASE] === a;
    case P.speedAbove:
      return abs(s[R.VX]!) > a;
    case P.speedBelow:
      return abs(s[R.VX]!) < a;
    case P.forwardAbove:
      return s[R.VX]! * f > a;
    case P.forwardBelow:
      return s[R.VX]! * f < a;
    case P.vyAbove:
      return s[R.VY]! > a;
    case P.vyBelow:
      return s[R.VY]! < a;
    case P.landedFaster:
      return s[R.LAND_VY]! > a;
    case P.airSteps:
      return s[R.AIR_STEPS]! >= a;
    case P.inKill: {
      const hw = body[B.HW]!;
      const x = s[R.X]!;
      const y = s[R.Y]!;
      return boxHasClass(w, x - hw, y - bodyHeight(s, rs), x + hw, y, Cell.KILL);
    }
    case P.canStand: {
      const hw = body[B.HW]!;
      const x = s[R.X]!;
      const y = s[R.Y]!;
      return !boxHitsSolid(w, x - hw, y - body[B.H]!, x + hw, y - body[B.STEP_UP]!);
    }
    case P.wallAhead:
    case P.wallBehind: {
      const dir = id === P.wallAhead ? f : -f;
      const hw = body[B.HW]!;
      const x = s[R.X]!;
      const y = s[R.Y]!;
      const top = y - bodyHeight(s, rs);
      const bottom = y - body[B.STEP_UP]!;
      return dir > 0
        ? boxHitsSolid(w, x + hw, top, x + hw + a, bottom)
        : boxHitsSolid(w, x - hw - a, top, x - hw, bottom);
    }
    case P.wallContact:
      return s[R.WALL] === f;
    case P.impactAbove:
      return s[R.WALL] === f && s[R.IMPACT]! > a;
    case P.headBlocked:
      return s[R.HEAD] !== 0;
    case P.slopeUp:
      return s[R.SLOPE] !== 0 && s[R.SLOPE] === f;
    case P.slopeDown:
      return s[R.SLOPE] !== 0 && s[R.SLOPE] === -f;
    case P.onOneWay:
      return isOneWay(s[R.GROUND]! - 1);
    case P.gripLocked:
      return s[R.LOCK]! > 0;
    case P.highWallAhead: {
      const h = bodyHeight(s, rs);
      return bandAhead(s, w, rs, a, h, h - 768);
    }
    case P.lowWallAhead: {
      const h = bodyHeight(s, rs);
      return (
        bandAhead(s, w, rs, 2, a, body[B.STEP_UP]!) && (a >= h || !bandAhead(s, w, rs, 2, h, a))
      );
    }
    case P.ceilingAhead: {
      const crouch = body[B.CROUCH_H]!;
      return (
        bandAhead(s, w, rs, a, body[B.H]!, crouch) &&
        !bandAhead(s, w, rs, a, crouch, body[B.STEP_UP]!)
      );
    }
    case P.obstacleAhead:
      return scanObstacle(s, w, rs, a, b);
    case P.vaultAhead:
      return vaultTarget(s, w, rs, a, b, c);
    case P.ledgeAhead:
      return findLedge(s, w, rs, a, b, c);
    case P.ledgeTopAhead:
      return findLedgeTop(s, w, rs, a, b, c);
    case P.ledgeRoom:
      return ledgeRoom(s, w, rs, a);
    case P.ladderHere:
      return ladderHere(s, w, rs);
    case P.ladderAtHead:
      return ladderAtHead(s, w, rs);
    case P.ladderTop:
      return ladderTop(s, w, rs, a);
    case P.poleHere:
      return findPole(s, w, rs, a);
    case P.poleAtHands:
      return poleAtHands(s, w, rs);
    case P.barHere:
      return findBar(s, w, a, b);
    case P.storedAbove:
      return s[R.SPEED]! > a;
    default:
      return false;
  }
}

function runEffects(
  s: RunnerState,
  w: CellReader | null,
  rs: Ruleset,
  at: number,
  len: number,
  st: WorldStatics,
  entry: boolean,
): void {
  for (let i = 0; i < len; i++) {
    const e = (at + i) * EFFECT_WORDS;
    const fx = rs.effects;
    effect(s, w, rs, fx[e]!, fx[e + 1]!, fx[e + 2]!, fx[e + 3]!, st, entry);
  }
}

/** Starts a glide or hold at a grip: the entry point becomes the glide's start. */
function grip(s: RunnerState, x: number, y: number, kind: number): void {
  s[R.GRIP_X] = x;
  s[R.GRIP_Y] = y;
  s[R.GRIP_KIND] = kind;
  s[R.S0] = s[R.X]!;
  s[R.S1] = s[R.Y]!;
  s[R.S2] = 0;
  s[R.VX] = 0;
  s[R.VY] = 0;
}

/**
 * One effect. `entry` is true for `onEnter` and `onExit` lists: there facing effects always work,
 * while `lockFacing` stops them in `perStep` lists.
 */
function effect(
  s: RunnerState,
  w: CellReader | null,
  rs: Ruleset,
  id: number,
  a: number,
  b: number,
  c: number,
  st: WorldStatics,
  entry: boolean,
): void {
  const f = s[R.FACING]!;
  const lock = !entry && (rs.flags[s[R.MOVE]!]! & FLAG.lockFacing) !== 0;
  switch (id) {
    case E.accelToward: {
      let v = s[R.VX]! * f;
      if (v < a) v = v + b < a ? v + b : a;
      else if (v > a) v = v - b > a ? v - b : a;
      s[R.VX] = v * f;
      return;
    }
    case E.decelTo0: {
      const v = s[R.VX]!;
      s[R.VX] = v > 0 ? (v - a > 0 ? v - a : 0) : v + a < 0 ? v + a : 0;
      return;
    }
    case E.airControl: {
      const want = s[R.WANT_X]!;
      if (want === 0) return;
      let v = s[R.VX]! * f;
      if (want === f) {
        if (v < b) v = v + a < b ? v + a : b;
      } else if (v > 0) v = v - a > 0 ? v - a : 0;
      s[R.VX] = v * f;
      return;
    }
    case E.setVX:
      s[R.VX] = a * f;
      return;
    case E.setVY:
      s[R.VY] = a;
      return;
    case E.addVX:
      s[R.VX] = s[R.VX]! + a * f;
      return;
    case E.addVY:
      s[R.VY] = s[R.VY]! + a;
      return;
    case E.scaleVX:
      s[R.VX] = scale256(s[R.VX]!, a);
      return;
    case E.scaleVY:
      s[R.VY] = scale256(s[R.VY]!, a);
      return;
    case E.minForward:
      if (s[R.VX]! * f < a) s[R.VX] = a * f;
      return;
    case E.maxForward:
      if (s[R.VX]! * f > a) s[R.VX] = a * f;
      return;
    case E.jump:
      s[R.VY] = -(a + scale256(abs(s[R.VX]!), b));
      s[R.GROUND] = 0;
      return;
    case E.flipFacing:
      if (!lock) s[R.FACING] = -f;
      return;
    case E.faceWant:
      if (!lock && s[R.WANT_X] !== 0) s[R.FACING] = s[R.WANT_X]!;
      return;
    case E.zeroV:
      s[R.VX] = 0;
      s[R.VY] = 0;
      return;
    case E.storeSpeed:
      s[R.SPEED] = abs(s[R.VX]!);
      s[R.SPEED_Y] = s[R.VY]!;
      return;
    case E.restoreSpeed:
      s[R.VX] = s[R.SPEED]! * f;
      return;
    case E.setPhase:
      s[R.PHASE] = a;
      return;
    case E.dropThrough:
      s[R.DROP] = a;
      return;
    case E.respawn: {
      const hub = hubForCell(st, runnerCellX(s), runnerCellY(s));
      if (hub >= 0 && hub < hubCount(st)) placeAtHub(s, st, hub);
      else {
        s[R.VX] = 0;
        s[R.VY] = 0;
      }
      return;
    }
    case E.hop:
      if (s[R.GROUND] !== 0) {
        s[R.VY] = -a;
        s[R.GROUND] = 0;
      }
      return;
    case E.maxVY:
      if (s[R.VY]! > a) s[R.VY] = a;
      return;
    case E.lockGrips:
      s[R.LOCK] = a;
      return;
    case E.climbJump: {
      const vx = abs(s[R.VX]!);
      const sp = vx > s[R.IMPACT]! ? vx : s[R.IMPACT]!;
      s[R.VY] = -(a + scale256(sp, b));
      s[R.GROUND] = 0;
      return;
    }
    case E.grabLedge:
      if (w !== null && findLedge(s, w, rs, a, b, c)) grip(s, found.x, found.y, found.kind);
      return;
    case E.grabLadder:
      if (w !== null && ladderHere(s, w, rs)) {
        grip(s, ((s[R.X]! >> CELL_SHIFT) << CELL_SHIFT) + 512, s[R.Y]!, Cell.LADDER);
      }
      return;
    case E.grabPole:
      if (w !== null && findPole(s, w, rs, a)) {
        s[R.SPEED] = abs(s[R.VX]!);
        grip(s, found.x, s[R.Y]!, Cell.POLE);
      }
      return;
    case E.grabBar:
      if (w !== null && findBar(s, w, a, b)) {
        s[R.SPEED] = abs(s[R.VX]!);
        grip(s, s[R.X]!, found.y, Cell.BAR);
      }
      return;
    case E.vaultStart:
      if (w !== null && vaultTarget(s, w, rs, a, b, c)) {
        s[R.SPEED] = abs(s[R.VX]!);
        const top = found.y;
        grip(s, found.landX, found.landY, found.kind);
        const mid = (s[R.S1]! + found.landY) >> 1;
        s[R.S2] = mid > top ? mid - top : 0;
      }
      return;
    case E.ladderExit:
      if (w !== null && ladderTop(s, w, rs, 1 << 20)) {
        s[R.FACING] = found.kind;
        grip(s, found.x, found.y, Cell.LADDER);
      }
      return;
    case E.glide: {
      const d = s[R.DUR]!;
      const tx = s[R.GRIP_X]! + f * a;
      const ty = s[R.GRIP_Y]! + b;
      s[R.VX] = 0;
      s[R.VY] = 0;
      if (d <= 0) {
        s[R.X] = tx;
        s[R.Y] = ty;
        return;
      }
      const k = s[R.TIMER]! + 1 < d ? s[R.TIMER]! + 1 : d;
      const x0 = s[R.S0]!;
      const y0 = s[R.S1]!;
      const lift = c + s[R.S2]!;
      s[R.X] = x0 + ((((tx - x0) * k) / d) | 0);
      s[R.Y] = y0 + ((((ty - y0) * k) / d) | 0) - (((4 * lift * k * (d - k)) / (d * d)) | 0);
      return;
    }
    case E.hold:
      s[R.X] = s[R.GRIP_X]! + f * a;
      s[R.Y] = s[R.GRIP_Y]! + b;
      s[R.VX] = 0;
      s[R.VY] = 0;
      return;
    case E.alignGrip:
      s[R.X] = s[R.GRIP_X]! + f * a;
      s[R.VX] = 0;
      return;
    case E.climbWant: {
      const want = s[R.WANT_Y]!;
      s[R.X] = s[R.GRIP_X]!;
      s[R.VX] = 0;
      if (want < 0) s[R.VY] = w !== null && ladderAtHead(s, w, rs) ? -a : 0;
      else s[R.VY] = want > 0 ? b : 0;
      return;
    }
    default:
      return;
  }
}

function physics(s: RunnerState, w: CellReader, rs: Ruleset): void {
  const m = s[R.MOVE]!;
  const fl = rs.flags[m]!;
  const body = rs.body;
  const hw = body[B.HW]!;
  const h = (fl & FLAG.crouch) !== 0 ? body[B.CROUCH_H]! : body[B.H]!;
  const stepUp = body[B.STEP_UP]!;
  const maxSpeed = body[B.MAX_SPEED]!;
  let vx = s[R.VX]!;
  let vy = s[R.VY]!;
  let x = s[R.X]!;
  let y = s[R.Y]!;
  const yStart = y;
  s[R.WALL] = 0;
  s[R.HEAD] = 0;
  s[R.IMPACT] = 0;
  const grounded = (fl & FLAG.ground) !== 0 && s[R.GROUND] !== 0 && vy >= 0;
  if (grounded) vy = 0;
  else if ((fl & FLAG.noGravity) === 0) vy += body[B.GRAVITY]!;
  if (vx > maxSpeed) vx = maxSpeed;
  else if (vx < -maxSpeed) vx = -maxSpeed;
  if (vy > body[B.MAX_FALL]!) vy = body[B.MAX_FALL]!;
  else if (vy < -maxSpeed) vy = -maxSpeed;

  if ((fl & FLAG.noCollide) !== 0) {
    s[R.X] = x + vx;
    s[R.Y] = y + vy;
    s[R.VX] = vx;
    s[R.VY] = vy;
    s[R.LAND_VY] = 0;
    s[R.GROUND] = 0;
    s[R.SLOPE] = 0;
    s[R.AIR_STEPS] = s[R.AIR_STEPS]! < AIR_MAX ? s[R.AIR_STEPS]! + 1 : AIR_MAX;
    return;
  }

  // Horizontal: walls stop the box above the toes. On a slope the feet rise by up to |vx| during
  // the move, so the toes reach that much higher.
  let moved = 0;
  if (vx !== 0) {
    const toes = grounded && s[R.SLOPE] !== 0 ? stepUp + abs(vx) : stepUp;
    const nx = sweepX(w, x, vx, hw, y - h, y - toes, y, stepUp);
    if (nx !== x + vx) {
      s[R.WALL] = vx > 0 ? 1 : -1;
      s[R.IMPACT] = abs(vx);
      vx = 0;
    }
    moved = nx - x;
    x = nx;
  }
  const adx = abs(moved);
  const oneWay = s[R.DROP] === 0;

  // Vertical.
  let ground = 0;
  let slope = 0;
  if (grounded) {
    // LAND_VY is the speed of the latest touchdown, which landing transitions have read by now.
    s[R.LAND_VY] = 0;
    const fy = findFloor(w, x, hw, y - stepUp - adx, y + adx + body[B.STEP_DOWN]!, oneWay);
    if (fy !== NONE) {
      y = fy;
      ground = hit.kind + 1;
      slope = hit.slope;
    }
  } else if (vy >= 0) {
    const fy = findFloor(w, x, hw, y - stepUp - adx, y + vy, oneWay);
    if (fy !== NONE) {
      s[R.LAND_VY] = vy;
      vy = 0;
      y = fy;
      ground = hit.kind + 1;
      slope = hit.slope;
    } else y += vy;
  } else {
    const top = y - h;
    const nTop = sweepUp(w, x, hw, top, vy);
    if (nTop !== top + vy) {
      s[R.HEAD] = 1;
      vy = 0;
    }
    y = nTop + h;
    // A slope under the centre lifts a rising runner that moves into it.
    const lift = slopeAbove(w, x, y, stepUp + adx);
    if (lift !== NONE) y = lift;
  }

  s[R.X] = x;
  s[R.Y] = y;
  s[R.VX] = vx;
  s[R.VY] = vy;
  s[R.GROUND] = ground;
  s[R.SLOPE] = slope;
  s[R.AIR_STEPS] = ground !== 0 ? 0 : s[R.AIR_STEPS]! < AIR_MAX ? s[R.AIR_STEPS]! + 1 : AIR_MAX;
  if ((fl & FLAG.cycle) !== 0) {
    const stride = rs.stride[m]!;
    let c = s[R.CYCLE]! + adx + abs(y - yStart);
    if (c >= stride) c -= ((c / stride) | 0) * stride;
    s[R.CYCLE] = c;
  }
}

/** The surface of a slope under the centre column within [y - tol, y), or `NONE`. */
function slopeAbove(w: CellReader, x: number, y: number, tol: number): number {
  const cx = x >> CELL_SHIFT;
  const lx = x & 1023;
  const r0 = ((y - tol) >> CELL_SHIFT) - 1;
  const r1 = (y - 1) >> CELL_SHIFT;
  for (let r = r0; r <= r1; r++) {
    const c = cellAt(w, cx, r);
    if (!isSlope(c)) continue;
    const ys = (r << CELL_SHIFT) + slopeTop(c, lx);
    if (ys >= y - tol && ys < y) return ys;
  }
  return NONE;
}

/** Whether any cell the runner's body overlaps reads as missing (a debugging aid). */
export function touchesMissing(s: RunnerState, w: CellReader, rs: Ruleset): boolean {
  const hw = rs.body[B.HW]!;
  const x0 = (s[R.X]! - hw) >> CELL_SHIFT;
  const x1 = (s[R.X]! + hw - 1) >> CELL_SHIFT;
  const y0 = (s[R.Y]! - bodyHeight(s, rs)) >> CELL_SHIFT;
  const y1 = (s[R.Y]! - 1) >> CELL_SHIFT;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) if ((w.cell(cx, cy) & CELL_MISSING) !== 0) return true;
  }
  return false;
}
