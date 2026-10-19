/**
 * The local profile: an anonymous device token, the name, the look, finds, discovered hubs, best
 * times and settings, kept in localStorage. Online the server's profile is the record and is
 * merged in when it arrives; offline this is all there is.
 */
import {
  COSTUMES,
  DEFAULT_LOOK,
  DEFAULT_RENDER,
  HAIRS,
  UNLOCKS,
  type CostumeId,
  type HairId,
  type Look,
} from '@parapet-world/schemas';
import { DEFAULT_BINDINGS, type Bindings } from './input.ts';

export interface Settings {
  bindings: Bindings;
  /** Perspective strength, 0 up to the content's default. */
  perspective: number;
  /** 0..1 */
  volume: number;
  /** On-screen buttons: shown on touch devices, always, or never. */
  touch: 'auto' | 'on' | 'off';
}

export interface Profile {
  version: 1;
  token: string;
  name: string;
  look: Look;
  finds: string[];
  hubs: string[];
  /** Best times by route id, in steps. */
  best: Record<string, number>;
  /** The hub to start at next time (index in world.json), -1 for the start hub. */
  lastHub: number;
  /** The controls overlay was shown once (it opens by itself on the first play). */
  seenHelp: boolean;
  /** The hub menu was opened once (until then entering a hub shows a hint). */
  usedHub: boolean;
  settings: Settings;
}

const KEY = 'parapet-world.profile';

export function defaultSettings(perspective = DEFAULT_RENDER.perspective): Settings {
  return { bindings: { ...DEFAULT_BINDINGS }, perspective, volume: 0.7, touch: 'auto' };
}

function randomToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function newProfile(): Profile {
  return {
    version: 1,
    token: randomToken(),
    name: '',
    look: { ...DEFAULT_LOOK },
    finds: [],
    hubs: [],
    best: {},
    lastHub: -1,
    seenHelp: false,
    usedHub: false,
    settings: defaultSettings(),
  };
}

/** Reads the profile, repairing anything missing or malformed field by field. */
export function loadProfile(storage: Pick<Storage, 'getItem'> | null): Profile {
  const p = newProfile();
  let raw: unknown = null;
  try {
    raw = JSON.parse(storage?.getItem(KEY) ?? 'null');
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return p;
  const o = raw as Partial<Profile>;
  if (typeof o.token === 'string' && o.token.length >= 8) p.token = o.token;
  if (typeof o.name === 'string') p.name = o.name.slice(0, 16);
  if (o.look && HAIRS.includes(o.look.hair) && COSTUMES.includes(o.look.costume)) {
    p.look = { hair: o.look.hair, costume: o.look.costume };
  }
  if (Array.isArray(o.finds)) p.finds = o.finds.filter((x) => typeof x === 'string');
  if (Array.isArray(o.hubs)) p.hubs = o.hubs.filter((x) => typeof x === 'string');
  if (o.best && typeof o.best === 'object') {
    for (const [k, v] of Object.entries(o.best)) if (Number.isInteger(v) && v > 0) p.best[k] = v;
  }
  if (Number.isInteger(o.lastHub)) p.lastHub = o.lastHub!;
  if (typeof o.seenHelp === 'boolean') p.seenHelp = o.seenHelp;
  if (typeof o.usedHub === 'boolean') p.usedHub = o.usedHub;
  const s = o.settings;
  if (s && typeof s === 'object') {
    if (s.bindings && typeof s.bindings === 'object') {
      for (const k of Object.keys(p.settings.bindings) as (keyof Bindings)[]) {
        if (typeof s.bindings[k] === 'string') p.settings.bindings[k] = s.bindings[k];
      }
    }
    if (typeof s.perspective === 'number') p.settings.perspective = Math.max(0, s.perspective);
    if (typeof s.volume === 'number') p.settings.volume = Math.min(1, Math.max(0, s.volume));
    if (s.touch === 'on' || s.touch === 'off' || s.touch === 'auto') p.settings.touch = s.touch;
  }
  return p;
}

export function saveProfile(storage: Pick<Storage, 'setItem'> | null, p: Profile): void {
  try {
    storage?.setItem(KEY, JSON.stringify(p));
  } catch {
    // private mode or full storage: the profile lives for this session only
  }
}

/** Costumes and hair styles a number of finds unlocks (the Classic look and red hair are free). */
export function unlocked(finds: number): { costumes: CostumeId[]; hairs: HairId[] } {
  const costumes: CostumeId[] = ['classic'],
    hairs: HairId[] = ['hairRed'];
  for (const u of UNLOCKS) {
    if (finds < u.finds) continue;
    if (u.kind === 'costume') costumes.push(u.id as CostumeId);
    else hairs.push(u.id as HairId);
  }
  return { costumes, hairs };
}

/** The unlocks reached by going from `before` to `after` finds. */
export function newUnlocks(before: number, after: number): (typeof UNLOCKS)[number][] {
  return UNLOCKS.filter((u) => u.finds > before && u.finds <= after);
}

/** A look limited to what the finds unlock (anything locked falls back to the free choice). */
export function allowedLook(look: Look, finds: number): Look {
  const u = unlocked(finds);
  return {
    hair: u.hairs.includes(look.hair) ? look.hair : 'hairRed',
    costume: u.costumes.includes(look.costume) ? look.costume : 'classic',
  };
}

export const COSTUME_NAMES: Readonly<Record<CostumeId, string>> = {
  classic: 'Classic',
  tee: 'T-shirt and jeans',
  hoodie: 'Hoodie',
  summer: 'Summer',
};
export const HAIR_NAMES: Readonly<Record<HairId, string>> = {
  hairRed: 'Red, swept back',
  hairShort: 'Short and dark',
};

/** Route difficulty names by level (schemas `RouteDef.difficulty`). */
export const DIFFICULTY: Readonly<Record<number, string>> = {
  1: 'easy',
  2: 'medium',
  3: 'hard',
  4: 'expert',
};

/** A route's difficulty level, 1..4 (an older bake without one counts as easy). */
export const difficultyOf = (route: { difficulty?: number }): number =>
  Math.min(4, Math.max(1, route.difficulty ?? 1));

/** m:ss.cc of a number of steps. */
export function formatSteps(steps: number): string {
  const cs = Math.round((steps * 100) / 30),
    m = Math.floor(cs / 6000),
    s = Math.floor((cs % 6000) / 100),
    c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
