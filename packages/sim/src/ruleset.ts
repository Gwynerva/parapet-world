/**
 * The ruleset: the move table (`content/rules/moves.json`) compiled against the registries into
 * dense integer tables, plus the body and physics parameters, hashed into every replay and
 * handshake. Compilation rejects unknown names, abstract moves that could be entered and cycles of
 * instant moves that no condition breaks.
 */
import { fnvString, fnvWord, fnvWords, FNV_OFFSET } from './hash.ts';
import {
  EFFECTS,
  EFFECT_NAMES,
  E,
  FLAG,
  KEY_NAMES,
  K,
  P,
  PREDICATES,
  PREDICATE_NAMES,
  type ArgKind,
  type EffectName,
  type FlagName,
  type PredicateName,
} from './registry.ts';

/** Bumped whenever the step code changes what a ruleset means. Part of the hash. */
export const SIM_VERSION = 2;

export type IntArg = number | string;
export type EffectSource = [string, ...IntArg[]];

export interface TransitionSource {
  to: string;
  /** Predicates, all of which must hold: `name`, `name:arg:arg`, `!name`. Empty: always. */
  if?: string[];
  /** Higher first; ties keep the order (own transitions before inherited ones). */
  priority?: number;
  comment?: string;
}

export interface MoveSource {
  name: string;
  /** Flags and transitions are inherited (transitions after the move's own). */
  parent?: string;
  /** A move that only carries shared flags and transitions; it can never be entered. */
  abstract?: boolean;
  /** The animation clip; inherited from the parent when absent. */
  clip?: string;
  /** Steps; 0 instant, -1 (default) until a transition; a number or `$param`. */
  duration?: IntArg;
  /** The move entered when a timed or instant move ends. */
  then?: string;
  flags?: FlagName[];
  /** Units travelled per clip loop (`cycle` moves). */
  stride?: IntArg;
  /** Steps per clip loop for looping clips without `cycle`. */
  loop?: IntArg;
  onEnter?: EffectSource[];
  perStep?: EffectSource[];
  onExit?: EffectSource[];
  transitions?: TransitionSource[];
  comment?: string;
}

export interface RulesetSource {
  format: 1;
  version: number;
  comment?: string;
  /** Named integer parameters (`$name` in moves). Body and physics ones are required. */
  params: Record<string, number>;
  /** Moves the code enters by role, never by name. */
  roles: Record<RoleName, string>;
  moves: MoveSource[];
}

export const ROLE_NAMES = ['spawn', 'fall', 'dead', 'respawn', 'frozen'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** Parameters the step code itself reads, in `Ruleset.body` order. */
export const BODY_PARAMS = [
  'halfWidth',
  'height',
  'crouchHeight',
  'stepUp',
  'stepDown',
  'gravity',
  'maxFall',
  'maxSpeed',
] as const;
export const B = {
  HW: 0,
  H: 1,
  CROUCH_H: 2,
  STEP_UP: 3,
  STEP_DOWN: 4,
  GRAVITY: 5,
  MAX_FALL: 6,
  MAX_SPEED: 7,
} as const;

/** Words per compiled effect: id, four arguments. */
export const EFFECT_WORDS = 5;
/** Words per compiled transition: target, consume mask, predicate offset, predicate count. */
export const TRANS_WORDS = 4;
/** Words per compiled predicate: id, negated, three arguments. */
export const PRED_WORDS = 5;
export const MAX_ARGS = 4;

export interface Ruleset {
  readonly hash: number;
  readonly version: number;
  readonly source: RulesetSource;
  readonly params: Readonly<Record<string, number>>;
  readonly body: Int32Array;
  readonly moveNames: readonly string[];
  readonly clips: readonly string[];
  readonly roles: Readonly<Record<RoleName, number>>;
  readonly dur: Int32Array;
  readonly then: Int32Array;
  readonly flags: Int32Array;
  readonly stride: Int32Array;
  readonly loop: Int32Array;
  /** Effect list offsets and lengths (in effects) per move. */
  readonly enterAt: Int32Array;
  readonly enterLen: Int32Array;
  readonly stepAt: Int32Array;
  readonly stepLen: Int32Array;
  readonly exitAt: Int32Array;
  readonly exitLen: Int32Array;
  /** Transition list offsets and lengths per move, own and inherited, in evaluation order. */
  readonly transAt: Int32Array;
  readonly transLen: Int32Array;
  readonly effects: Int32Array;
  readonly trans: Int32Array;
  readonly preds: Int32Array;
  moveIndex(name: string): number;
}

class RulesetError extends Error {}

function fail(msg: string): never {
  throw new RulesetError(`ruleset: ${msg}`);
}

const FLAG_NAMES = Object.keys(FLAG) as FlagName[];

/** Compiles a parsed `moves.json`. Throws with a readable message on any error. */
export function loadRuleset(json: unknown): Ruleset {
  const src = json as RulesetSource;
  if (typeof src !== 'object' || src === null) fail('not an object');
  if (src.format !== 1) fail(`unknown format ${String(src.format)}`);
  if (!Number.isInteger(src.version)) fail('version must be an integer');
  if (typeof src.params !== 'object' || src.params === null) fail('params missing');
  if (!Array.isArray(src.moves)) fail('moves missing');

  const params: Record<string, number> = {};
  const paramNames = Object.keys(src.params);
  for (let i = 0; i < paramNames.length; i++) {
    const n = paramNames[i]!;
    const v = src.params[n];
    if (n === 'comment') continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v > 0x3fffffff || v < -0x3fffffff) {
      fail(`param ${n} must be an integer`);
    }
    params[n] = v;
  }
  const body = new Int32Array(BODY_PARAMS.length);
  for (let i = 0; i < BODY_PARAMS.length; i++) {
    const v = params[BODY_PARAMS[i]!];
    if (v === undefined) fail(`required param ${BODY_PARAMS[i]} missing`);
    body[i] = v;
  }
  if (body[B.HW]! <= 0 || body[B.HW]! >= 512) fail('halfWidth must be in 1..511');
  if (body[B.H]! <= body[B.STEP_UP]! || body[B.H]! > 3072) fail('height out of range');
  if (body[B.CROUCH_H]! <= body[B.STEP_UP]! || body[B.CROUCH_H]! > body[B.H]!) {
    fail('crouchHeight out of range');
  }
  if (body[B.STEP_UP]! < body[B.HW]!) fail('stepUp must be at least halfWidth (45-degree slopes)');
  if (body[B.MAX_SPEED]! <= 0 || body[B.MAX_SPEED]! >= 1024) fail('maxSpeed must be in 1..1023');
  if (body[B.MAX_FALL]! <= 0 || body[B.MAX_FALL]! >= 1024) fail('maxFall must be in 1..1023');

  const intArg = (a: IntArg, where: string): number => {
    if (typeof a === 'number') {
      if (!Number.isInteger(a)) fail(`${where}: ${a} is not an integer`);
      return a;
    }
    if (typeof a === 'string' && a.startsWith('$')) {
      const v = params[a.slice(1)];
      if (v === undefined) fail(`${where}: unknown param ${a}`);
      return v;
    }
    if (typeof a === 'string' && /^-?\d+$/.test(a)) return parseInt(a, 10);
    return fail(`${where}: bad integer argument ${String(a)}`);
  };
  const keyArg = (a: IntArg, where: string): number => {
    const i = (KEY_NAMES as readonly string[]).indexOf(String(a));
    if (i < 0) fail(`${where}: unknown key ${String(a)}`);
    return i;
  };
  const args = (
    name: string,
    kinds: readonly ArgKind[],
    raw: IntArg[],
    where: string,
  ): number[] => {
    if (raw.length !== kinds.length) {
      fail(`${where}: ${name} takes ${kinds.length} argument(s), got ${raw.length}`);
    }
    const out: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      out.push(kinds[i] === 'key' ? keyArg(raw[i]!, where) : intArg(raw[i]!, where));
    }
    return out;
  };

  // Moves by name.
  const moves = src.moves;
  const index: Record<string, number> = {};
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]!;
    if (typeof m.name !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(m.name)) {
      fail(`move ${i}: bad name ${String(m.name)}`);
    }
    if (index[m.name] !== undefined) fail(`duplicate move ${m.name}`);
    index[m.name] = i;
  }
  const ref = (name: string | undefined, where: string): number => {
    if (name === undefined) return -1;
    const i = index[name];
    if (i === undefined) fail(`${where}: unknown move ${name}`);
    return i;
  };
  const enterable = (i: number, where: string): number => {
    if (i >= 0 && moves[i]!.abstract) fail(`${where}: ${moves[i]!.name} is abstract`);
    return i;
  };

  // Parents, without cycles.
  const parent = new Int32Array(moves.length);
  for (let i = 0; i < moves.length; i++) parent[i] = ref(moves[i]!.parent, moves[i]!.name);
  for (let i = 0; i < moves.length; i++) {
    let p = parent[i]!;
    for (let n = 0; p >= 0; n++) {
      if (n > moves.length) fail(`parent cycle at ${moves[i]!.name}`);
      p = parent[p]!;
    }
  }

  const n = moves.length;
  const dur = new Int32Array(n);
  const then = new Int32Array(n);
  const flags = new Int32Array(n);
  const stride = new Int32Array(n);
  const loop = new Int32Array(n);
  const enterAt = new Int32Array(n);
  const enterLen = new Int32Array(n);
  const stepAt = new Int32Array(n);
  const stepLen = new Int32Array(n);
  const exitAt = new Int32Array(n);
  const exitLen = new Int32Array(n);
  const transAt = new Int32Array(n);
  const transLen = new Int32Array(n);
  const clips: string[] = [];
  const effects: number[] = [];
  const trans: number[] = [];
  const preds: number[] = [];

  const compileEffects = (list: EffectSource[] | undefined, where: string): [number, number] => {
    const at = (effects.length / EFFECT_WORDS) | 0;
    if (list === undefined) return [at, 0];
    if (!Array.isArray(list)) fail(`${where}: effects must be a list`);
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (!Array.isArray(e) || typeof e[0] !== 'string') fail(`${where}: effect ${i} malformed`);
      if (!Object.hasOwn(EFFECTS, e[0])) fail(`${where}: unknown effect ${e[0]}`);
      const name = e[0] as EffectName;
      const id = E[name];
      const a = args(name, EFFECTS[name], e.slice(1) as IntArg[], `${where} ${e[0]}`);
      effects.push(id, a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0);
    }
    return [at, list.length];
  };

  const compilePred = (text: string, where: string): [number, number, number, number, number] => {
    if (typeof text !== 'string' || text.length === 0) fail(`${where}: bad predicate`);
    const neg = text.startsWith('!');
    const parts = (neg ? text.slice(1) : text).split(':');
    if (!Object.hasOwn(PREDICATES, parts[0]!)) fail(`${where}: unknown predicate ${parts[0]}`);
    const name = parts[0] as PredicateName;
    const id = P[name];
    const a = args(name, PREDICATES[name], parts.slice(1), `${where} ${text}`);
    return [id, neg ? 1 : 0, a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
  };

  const ownTransitions = (i: number): TransitionSource[] => {
    const t = moves[i]!.transitions ?? [];
    if (!Array.isArray(t)) fail(`${moves[i]!.name}: transitions must be a list`);
    return t;
  };

  for (let i = 0; i < n; i++) {
    const m = moves[i]!;
    const where = m.name;
    // Flags: own plus inherited.
    let f = 0;
    for (let p = i; p >= 0; p = parent[p]!) {
      const list = moves[p]!.flags ?? [];
      for (let k = 0; k < list.length; k++) {
        if (!FLAG_NAMES.includes(list[k]!)) fail(`${moves[p]!.name}: unknown flag ${list[k]}`);
        f |= FLAG[list[k]!];
      }
    }
    flags[i] = f;
    let clip: string | undefined;
    for (let p = i; p >= 0 && clip === undefined; p = parent[p]!) clip = moves[p]!.clip;
    if (!m.abstract && (typeof clip !== 'string' || clip.length === 0)) fail(`${where}: no clip`);
    clips.push(clip ?? '');
    dur[i] = m.duration === undefined ? -1 : intArg(m.duration, `${where} duration`);
    if (dur[i]! < -1) fail(`${where}: duration below -1`);
    then[i] = enterable(ref(m.then, `${where} then`), `${where} then`);
    if (!m.abstract && dur[i]! >= 0 && then[i]! < 0) fail(`${where}: a timed move needs then`);
    stride[i] = m.stride === undefined ? 0 : intArg(m.stride, `${where} stride`);
    loop[i] = m.loop === undefined ? 0 : intArg(m.loop, `${where} loop`);
    if ((f & FLAG.cycle) !== 0 && !m.abstract && stride[i]! <= 0)
      fail(`${where}: cycle needs stride`);
    [enterAt[i], enterLen[i]] = compileEffects(m.onEnter, `${where} onEnter`);
    [stepAt[i], stepLen[i]] = compileEffects(m.perStep, `${where} perStep`);
    [exitAt[i], exitLen[i]] = compileEffects(m.onExit, `${where} onExit`);

    // Transitions: own first, then each ancestor's, ordered by priority (stable insertion sort).
    const list: Array<{ t: TransitionSource; prio: number; owner: string }> = [];
    for (let p = i; p >= 0; p = parent[p]!) {
      const own = ownTransitions(p);
      for (let k = 0; k < own.length; k++) {
        const t = own[k]!;
        const prio = t.priority ?? 0;
        if (!Number.isInteger(prio)) fail(`${moves[p]!.name}: priority must be an integer`);
        list.push({ t, prio, owner: moves[p]!.name });
      }
    }
    for (let a = 1; a < list.length; a++) {
      const item = list[a]!;
      let b = a - 1;
      while (b >= 0 && list[b]!.prio < item.prio) {
        list[b + 1] = list[b]!;
        b--;
      }
      list[b + 1] = item;
    }
    transAt[i] = (trans.length / TRANS_WORDS) | 0;
    transLen[i] = list.length;
    for (let k = 0; k < list.length; k++) {
      const { t, owner } = list[k]!;
      const w = `${owner} -> ${String(t.to)}`;
      const target = enterable(ref(t.to, w), w);
      if (target < 0) fail(`${w}: no target`);
      const conds = t.if ?? [];
      if (!Array.isArray(conds)) fail(`${w}: if must be a list`);
      const predAt = (preds.length / PRED_WORDS) | 0;
      let consume = 0;
      for (let c = 0; c < conds.length; c++) {
        const p = compilePred(conds[c]!, w);
        preds.push(p[0], p[1], p[2], p[3], p[4]);
        if (p[1] === 0 && (p[0] === P.pressed || p[0] === P.recent)) consume |= 1 << p[2];
      }
      trans.push(target, consume, predAt, conds.length);
    }
  }

  const roles = {} as Record<RoleName, number>;
  if (typeof src.roles !== 'object' || src.roles === null) fail('roles missing');
  for (let i = 0; i < ROLE_NAMES.length; i++) {
    const r = ROLE_NAMES[i]!;
    const m = enterable(ref(src.roles[r], `role ${r}`), `role ${r}`);
    if (m < 0) fail(`role ${r} missing`);
    roles[r] = m;
  }

  // Cycles of instant moves joined by unconditional edges (then, or a transition with no `if`).
  const transArr = trans;
  for (let start = 0; start < n; start++) {
    if (moves[start]!.abstract || dur[start] !== 0) continue;
    const seen = new Int32Array(n);
    let cur = start;
    for (let guard = 0; guard <= n; guard++) {
      if (dur[cur] !== 0) break;
      seen[cur] = 1;
      let next = -1;
      for (let k = 0; k < transLen[cur]!; k++) {
        const at = (transAt[cur]! + k) * TRANS_WORDS;
        if (transArr[at + 3] === 0) {
          next = transArr[at]!;
          break;
        }
      }
      if (next < 0) {
        // The first conditional transitions may fire, but `then` is the fallback.
        next = then[cur]!;
      }
      if (next < 0) break;
      if (seen[next] === 1)
        fail(`unconditional cycle of instant moves through ${moves[next]!.name}`);
      cur = next;
    }
  }

  const ruleset: Ruleset = {
    hash: 0,
    version: src.version,
    source: src,
    params,
    body,
    moveNames: moves.map((m) => m.name),
    clips,
    roles,
    dur,
    then,
    flags,
    stride,
    loop,
    enterAt,
    enterLen,
    stepAt,
    stepLen,
    exitAt,
    exitLen,
    transAt,
    transLen,
    effects: Int32Array.from(effects),
    trans: Int32Array.from(trans),
    preds: Int32Array.from(preds),
    moveIndex: (name: string) => index[name] ?? -1,
  };
  return { ...ruleset, hash: hashRuleset(ruleset) };
}

/** FNV-1a over every param, everything the step code reads, the registries and `SIM_VERSION`. */
function hashRuleset(r: Ruleset): number {
  let h = fnvWord(FNV_OFFSET, SIM_VERSION);
  h = fnvWord(h, r.version);
  // Every param, also those only observers read (corridorGrace), in the file's order.
  const names = Object.keys(r.params);
  for (let i = 0; i < names.length; i++) {
    h = fnvString(h, names[i]!);
    h = fnvWord(h, r.params[names[i]!]!);
  }
  for (let i = 0; i < PREDICATE_NAMES.length; i++) h = fnvString(h, PREDICATE_NAMES[i]!);
  for (let i = 0; i < EFFECT_NAMES.length; i++) h = fnvString(h, EFFECT_NAMES[i]!);
  for (let i = 0; i < r.moveNames.length; i++) {
    h = fnvString(h, r.moveNames[i]!);
    h = fnvString(h, r.clips[i]!);
  }
  const arrays = [
    r.body,
    r.dur,
    r.then,
    r.flags,
    r.stride,
    r.loop,
    r.enterAt,
    r.enterLen,
    r.stepAt,
    r.stepLen,
    r.exitAt,
    r.exitLen,
    r.transAt,
    r.transLen,
    r.effects,
    r.trans,
    r.preds,
  ];
  for (let i = 0; i < arrays.length; i++) {
    h = fnvWord(h, arrays[i]!.length);
    h = fnvWords(h, arrays[i]!, arrays[i]!.length);
  }
  for (let i = 0; i < ROLE_NAMES.length; i++) h = fnvWord(h, r.roles[ROLE_NAMES[i]!]);
  return h >>> 0;
}

/** A key index (`K`) resolved against the facing. */
export function keyBit(key: number, facing: number): number {
  if (key === K.FWD) return facing > 0 ? 2 : 1;
  if (key === K.BACK) return facing > 0 ? 1 : 2;
  return 1 << key;
}
