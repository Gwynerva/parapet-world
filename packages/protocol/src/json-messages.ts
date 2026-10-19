/**
 * Messages that are rare or carry structure, sent as JSON text frames with a `t` tag and checked
 * by hand-written validators (no schema library). A validator returns the typed message or throws
 * a ProtocolError; it never trusts a field it did not check.
 */
import { COSTUMES, HAIRS, type Look } from '@parapet-world/schemas';
import { ProtocolError } from './binary.ts';

export const PROTOCOL_VERSION = 1;

/** What the server keeps about a player and shows them. */
export interface ProfileView {
  name: string;
  look: Look;
  /** Find ids. */
  finds: string[];
  /** Discovered hub ids. */
  hubs: string[];
  /** Best time per route id, in steps. */
  best: Record<string, number>;
}

export type GameEvent =
  | { kind: 'hub'; hub: string }
  | { kind: 'find'; find: string; total: number }
  | { kind: 'unlock'; unlock: 'costume' | 'hair'; id: string }
  | { kind: 'routeStart'; route: string }
  | { kind: 'checkpoint'; route: string; index: number; steps: number }
  | { kind: 'finish'; route: string; steps: number; best: boolean; rank: number }
  | { kind: 'cancel'; route: string }
  | { kind: 'death' };

export interface BoardEntry {
  name: string;
  steps: number;
}

export type ClientJson =
  | {
      t: 'hello';
      v: number;
      /** The device's secret token (random, kept in local storage). */
      token: string;
      name: string;
      /** The compiled ruleset hash the client simulates with. */
      rules: number;
      /** A one-time recovery code to move a claimed name to this token. */
      recovery?: string;
    }
  | { t: 'look'; look: Look }
  | { t: 'resync' }
  | { t: 'board'; route: string }
  | { t: 'ping'; id: number };

export type ServerJson =
  | {
      t: 'welcome';
      v: number;
      /** The own runner's id; its first keyframe follows as a binary KEYFRAME. */
      id: number;
      profile: ProfileView;
      /** The server's global step at the keyframe. */
      serverStep: number;
      /** The global step the own runner's step 0 corresponds to. */
      origin: number;
    }
  | { t: 'recovery'; code: string }
  | { t: 'enter'; id: number; name: string; look: Look; bot: boolean }
  | { t: 'leave'; id: number }
  | { t: 'look'; id: number; look: Look }
  | { t: 'event'; event: GameEvent; profile?: ProfileView }
  | { t: 'board'; route: string; top: BoardEntry[]; mine: number | null }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong'; id: number; serverStep: number };

export type ErrorCode =
  'version' | 'rules' | 'name' | 'nameTaken' | 'recovery' | 'rate' | 'full' | 'bad';

export const NAME_RE = /^[\p{L}\p{N}_ .-]{2,16}$/u;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string' || v.length > max) throw new ProtocolError(`bad ${what}`);
  return v;
};
const int = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new ProtocolError(`bad ${what}`);
  return v;
};

export function validLook(v: unknown): Look {
  if (!isObj(v)) throw new ProtocolError('bad look');
  const hair = v.hair,
    costume = v.costume;
  if (!(HAIRS as readonly unknown[]).includes(hair)) throw new ProtocolError('bad hair');
  if (!(COSTUMES as readonly unknown[]).includes(costume)) throw new ProtocolError('bad costume');
  return { hair: hair as Look['hair'], costume: costume as Look['costume'] };
}

export function parseClientJson(text: string): ClientJson {
  if (text.length > 4096) throw new ProtocolError('message too long');
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new ProtocolError('bad json');
  }
  if (!isObj(v)) throw new ProtocolError('bad message');
  switch (v.t) {
    case 'hello': {
      const name = str(v.name, 32, 'name').trim();
      const m: ClientJson = {
        t: 'hello',
        v: int(v.v, 'version'),
        token: str(v.token, 128, 'token'),
        name,
        rules: int(v.rules, 'rules') >>> 0,
      };
      if (v.recovery !== undefined) m.recovery = str(v.recovery, 64, 'recovery');
      if (m.token.length < 16) throw new ProtocolError('bad token');
      return m;
    }
    case 'look':
      return { t: 'look', look: validLook(v.look) };
    case 'resync':
      return { t: 'resync' };
    case 'board':
      return { t: 'board', route: str(v.route, 64, 'route') };
    case 'ping':
      return { t: 'ping', id: int(v.id, 'id') };
    default:
      throw new ProtocolError('unknown message');
  }
}

/** Server messages are trusted by the client only as far as their shape; still checked. */
export function parseServerJson(text: string): ServerJson {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new ProtocolError('bad json');
  }
  if (!isObj(v) || typeof v.t !== 'string') throw new ProtocolError('bad message');
  switch (v.t) {
    case 'welcome':
      int(v.id, 'id');
      int(v.serverStep, 'serverStep');
      int(v.origin, 'origin');
      if (!isObj(v.profile)) throw new ProtocolError('bad profile');
      return v as unknown as ServerJson;
    case 'enter':
      int(v.id, 'id');
      str(v.name, 32, 'name');
      validLook(v.look);
      return v as unknown as ServerJson;
    case 'leave':
    case 'look':
      int(v.id, 'id');
      return v as unknown as ServerJson;
    case 'event':
      if (!isObj(v.event) || typeof v.event.kind !== 'string') throw new ProtocolError('bad event');
      return v as unknown as ServerJson;
    case 'board':
      str(v.route, 64, 'route');
      if (!Array.isArray(v.top)) throw new ProtocolError('bad board');
      return v as unknown as ServerJson;
    case 'recovery':
    case 'error':
    case 'pong':
      return v as unknown as ServerJson;
    default:
      throw new ProtocolError('unknown message');
  }
}

export const encodeJson = (m: ClientJson | ServerJson): string => JSON.stringify(m);
