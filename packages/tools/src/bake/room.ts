/**
 * Room files (`content/world/rooms/**\/*.room.txt`, `content/world/gym/*.room.txt`): a header of
 * `@` directives, one grid of cell characters, and entity directives. The syntax is documented in
 * `packages/content/world/README.md`. Coordinates in a room are cells relative to its `@pos`.
 */
import type { CellRect } from '@parapet-world/schemas';

export interface RoomLegend {
  char: string;
  material?: string;
  cell?: string;
  prop?: string;
}

export interface RoomProp {
  id: string;
  x: number;
  y: number;
  line: number;
}

export interface RoomRegion {
  id: string;
  rect: CellRect | null;
  hub: string;
  line: number;
}

export interface RoomHub {
  id: string;
  name: string;
  rect: CellRect;
  spawn: [number, number];
  facing: 1 | -1;
  start: boolean;
  line: number;
}

export interface RoomRoute {
  id: string;
  name: string;
  difficulty: 1 | 2 | 3 | 4;
  start: CellRect | null;
  checkpoints: CellRect[];
  finish: CellRect | null;
  corridor: CellRect[];
  line: number;
}

export interface RoomFind {
  id: string;
  rect: CellRect;
  clue: string;
  line: number;
}

export interface Room {
  file: string;
  district: string;
  pos: [number, number];
  width: number;
  height: number;
  /** Grid rows padded with `.` to `width` x `height`. */
  rows: string[];
  /** Line of each grid row in the file (1-based). */
  rowLines: number[];
  legend: RoomLegend[];
  props: RoomProp[];
  regions: RoomRegion[];
  hubs: RoomHub[];
  routes: RoomRoute[];
  finds: RoomFind[];
}

export class RoomError extends Error {
  readonly file: string;
  readonly line: number;
  constructor(file: string, line: number, message: string) {
    super(`${file}:${line}: ${message}`);
    this.file = file;
    this.line = line;
  }
}

/** Splits a directive line into tokens; double-quoted strings (with `\"`) stay whole. */
export function tokenize(text: string, file: string, line: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (i >= text.length) break;
    let tok = '';
    while (i < text.length && !/\s/.test(text[i]!)) {
      if (text[i] === '"') {
        i++;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\' && i + 1 < text.length) i++;
          tok += text[i];
          i++;
        }
        if (i >= text.length) throw new RoomError(file, line, 'unterminated string');
        i++;
      } else {
        tok += text[i];
        i++;
      }
    }
    out.push(tok);
  }
  return out;
}

interface Args {
  pos: string[];
  keys: Record<string, string>;
}

function splitArgs(tokens: string[]): Args {
  const pos: string[] = [];
  const keys: Record<string, string> = {};
  for (const t of tokens) {
    const eq = t.indexOf('=');
    if (eq > 0 && /^[a-z]+$/.test(t.slice(0, eq))) keys[t.slice(0, eq)] = t.slice(eq + 1);
    else pos.push(t);
  }
  return { pos, keys };
}

const ID = /^[a-z0-9][a-z0-9.-]*$/;

export function parseRoom(text: string, file: string): Room {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const room: Room = {
    file,
    district: '',
    pos: [0, 0],
    width: 0,
    height: 0,
    rows: [],
    rowLines: [],
    legend: [],
    props: [],
    regions: [],
    hubs: [],
    routes: [],
    finds: [],
  };
  let size: [number, number] | null = null;
  let hasPos = false;
  let gridDone = false;
  let route: RoomRoute | null = null;

  const int = (s: string | undefined, line: number, what: string): number => {
    if (s === undefined || !/^-?\d+$/.test(s))
      throw new RoomError(file, line, `${what}: expected an integer, got ${s ?? 'nothing'}`);
    return parseInt(s, 10);
  };
  const rect = (a: string[], at: number, line: number, what: string): CellRect => {
    const r: CellRect = [
      int(a[at], line, what),
      int(a[at + 1], line, what),
      int(a[at + 2], line, what),
      int(a[at + 3], line, what),
    ];
    if (r[2] <= 0 || r[3] <= 0) throw new RoomError(file, line, `${what}: empty rectangle`);
    return r;
  };
  const id = (s: string | undefined, line: number, what: string): string => {
    if (s === undefined || !ID.test(s))
      throw new RoomError(file, line, `${what}: bad id ${s ?? '(none)'}`);
    return s;
  };
  const noExtra = (a: Args, n: number, allowed: string[], line: number, what: string): void => {
    if (a.pos.length > n) throw new RoomError(file, line, `${what}: unexpected ${a.pos[n]}`);
    for (const k of Object.keys(a.keys)) {
      if (!allowed.includes(k)) throw new RoomError(file, line, `${what}: unknown key ${k}`);
    }
  };
  const needRoute = (line: number, what: string): RoomRoute => {
    if (route === null) throw new RoomError(file, line, `${what} outside a @route`);
    return route;
  };

  for (let n = 0; n < lines.length; n++) {
    const line = n + 1;
    const raw = lines[n]!;
    const trimmed = raw.trimEnd();
    if (trimmed.trim() === '') {
      if (room.rows.length > 0) gridDone = true;
      continue;
    }
    if (trimmed.trimStart().startsWith(';')) continue;
    if (!trimmed.startsWith('@')) {
      if (gridDone) throw new RoomError(file, line, 'a second grid block (rooms have one grid)');
      room.rows.push(trimmed);
      room.rowLines.push(line);
      continue;
    }
    if (room.rows.length > 0) gridDone = true;
    const tokens = tokenize(trimmed.slice(1), file, line);
    const name = tokens.shift() ?? '';
    const a = splitArgs(tokens);
    switch (name) {
      case 'district':
        noExtra(a, 1, [], line, '@district');
        room.district = id(a.pos[0], line, '@district');
        break;
      case 'pos':
        noExtra(a, 2, [], line, '@pos');
        room.pos = [int(a.pos[0], line, '@pos'), int(a.pos[1], line, '@pos')];
        hasPos = true;
        break;
      case 'size':
        noExtra(a, 2, [], line, '@size');
        size = [int(a.pos[0], line, '@size'), int(a.pos[1], line, '@size')];
        if (size[0] <= 0 || size[1] <= 0) throw new RoomError(file, line, '@size must be positive');
        break;
      case 'legend': {
        noExtra(a, 1, ['material', 'cell', 'prop'], line, '@legend');
        const ch = a.pos[0];
        if (ch === undefined || [...ch].length !== 1)
          throw new RoomError(file, line, '@legend: one character expected');
        if (ch === '@' || ch === ';')
          throw new RoomError(file, line, `@legend: '${ch}' cannot be a cell`);
        if (
          a.keys.prop !== undefined &&
          (a.keys.material !== undefined || a.keys.cell !== undefined)
        ) {
          throw new RoomError(file, line, '@legend: a prop takes no material or cell');
        }
        if (
          a.keys.prop === undefined &&
          a.keys.material === undefined &&
          a.keys.cell === undefined
        ) {
          throw new RoomError(file, line, '@legend: material=, cell= or prop= expected');
        }
        room.legend.push({
          char: ch,
          material: a.keys.material,
          cell: a.keys.cell,
          prop: a.keys.prop,
        });
        break;
      }
      case 'prop':
        noExtra(a, 3, [], line, '@prop');
        room.props.push({
          id: id(a.pos[0], line, '@prop'),
          x: int(a.pos[1], line, '@prop'),
          y: int(a.pos[2], line, '@prop'),
          line,
        });
        break;
      case 'region':
        noExtra(a, 5, ['hub'], line, '@region');
        if (a.pos.length !== 1 && a.pos.length !== 5)
          throw new RoomError(file, line, '@region: id and an optional x y w h');
        room.regions.push({
          id: id(a.pos[0], line, '@region'),
          rect: a.pos.length === 5 ? rect(a.pos, 1, line, '@region') : null,
          hub: id(a.keys.hub, line, '@region hub='),
          line,
        });
        break;
      case 'hub': {
        const flags = a.pos.slice(5);
        if (flags.some((f) => f !== 'start'))
          throw new RoomError(file, line, `@hub: unexpected ${flags.find((f) => f !== 'start')}`);
        noExtra(
          { pos: a.pos.slice(0, 5), keys: a.keys },
          5,
          ['spawn', 'facing', 'name'],
          line,
          '@hub',
        );
        const sp = (a.keys.spawn ?? '').split(',');
        if (sp.length !== 2) throw new RoomError(file, line, '@hub: spawn=x,y expected');
        const facing = a.keys.facing === undefined ? 1 : int(a.keys.facing, line, '@hub facing');
        if (facing !== 1 && facing !== -1)
          throw new RoomError(file, line, '@hub: facing is 1 or -1');
        room.hubs.push({
          id: id(a.pos[0], line, '@hub'),
          name: a.keys.name ?? a.pos[0]!,
          rect: rect(a.pos, 1, line, '@hub'),
          spawn: [int(sp[0], line, '@hub spawn'), int(sp[1], line, '@hub spawn')],
          facing,
          start: flags.includes('start'),
          line,
        });
        break;
      }
      case 'route': {
        noExtra(a, 1, ['name', 'difficulty'], line, '@route');
        const difficulty =
          a.keys.difficulty === undefined ? 1 : int(a.keys.difficulty, line, '@route difficulty');
        if (difficulty !== 1 && difficulty !== 2 && difficulty !== 3 && difficulty !== 4) {
          throw new RoomError(file, line, '@route: difficulty is 1, 2, 3 or 4');
        }
        route = {
          id: id(a.pos[0], line, '@route'),
          name: a.keys.name ?? a.pos[0]!,
          difficulty,
          start: null,
          checkpoints: [],
          finish: null,
          corridor: [],
          line,
        };
        room.routes.push(route);
        break;
      }
      case 'start':
      case 'checkpoint':
      case 'finish':
      case 'corridor': {
        noExtra(a, 4, [], line, `@${name}`);
        const r = needRoute(line, `@${name}`);
        const box = rect(a.pos, 0, line, `@${name}`);
        if (name === 'start') {
          if (r.start) throw new RoomError(file, line, '@start given twice');
          r.start = box;
        } else if (name === 'finish') {
          if (r.finish) throw new RoomError(file, line, '@finish given twice');
          r.finish = box;
        } else if (name === 'checkpoint') r.checkpoints.push(box);
        else r.corridor.push(box);
        break;
      }
      case 'find':
        noExtra(a, 5, ['clue'], line, '@find');
        if (a.keys.clue === undefined || a.keys.clue.trim() === '')
          throw new RoomError(file, line, '@find: clue="..." expected');
        room.finds.push({
          id: id(a.pos[0], line, '@find'),
          rect: rect(a.pos, 1, line, '@find'),
          clue: a.keys.clue,
          line,
        });
        break;
      default:
        throw new RoomError(file, line, `unknown directive @${name}`);
    }
  }

  if (room.district === '') throw new RoomError(file, 1, '@district missing');
  if (!hasPos) throw new RoomError(file, 1, '@pos missing');
  if (room.rows.length === 0) throw new RoomError(file, 1, 'no grid');
  const gridWidth = room.rows.reduce((w, r) => Math.max(w, [...r].length), 0);
  room.width = size ? size[0] : gridWidth;
  room.height = size ? size[1] : room.rows.length;
  if (gridWidth > room.width || room.rows.length > room.height) {
    throw new RoomError(
      file,
      room.rowLines[0]!,
      `grid ${gridWidth} x ${room.rows.length} exceeds @size ${room.width} x ${room.height}`,
    );
  }
  room.rows = room.rows.map((r) => r + '.'.repeat(room.width - [...r].length));
  while (room.rows.length < room.height) room.rows.push('.'.repeat(room.width));
  for (const r of room.routes) {
    if (r.start === null) throw new RoomError(file, r.line, `route ${r.id}: @start missing`);
    if (r.finish === null) throw new RoomError(file, r.line, `route ${r.id}: @finish missing`);
    if (r.corridor.length === 0) r.corridor.push([0, 0, room.width, room.height]);
  }
  return room;
}
