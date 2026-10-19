/** The baker: room syntax, validation, autotile variants, depth outlines and chunk files. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHUNK_CELLS, Cell, base64ToBytes, frontRect } from '@parapet-world/schemas';
import { assemble } from './assemble.ts';
import { bakeWorld } from './bake.ts';
import { loadContent, type Content } from './content.ts';
import { bakeAll } from './main.ts';
import { autotile, cellOutline, mergeSegments, type TileGrid } from './outline.ts';
import { parseRoom, RoomError } from './room.ts';
import { validateArt } from './validate.ts';
import { decodePng, encodePng } from '../png.ts';

const ROOT = fileURLToPath(new URL('../../../content/', import.meta.url));
const real = loadContent(ROOT);

function content(...rooms: string[]): Content {
  return { ...real, rooms: rooms.map((r, i) => parseRoom(r, `test${i}.room.txt`)), gym: [] };
}

function room(grid: string[], extra = '', pos = '0 0'): string {
  return `@district rooftops\n@pos ${pos}\n@region r hub=h\n${grid.join('\n')}\n\n${extra}`;
}

const HUB = '@hub h 0 0 2 1 spawn=0,0';

function errors(c: Content): string[] {
  return bakeWorld(c, c.rooms)
    .problems.filter((p) => p.level === 'error')
    .map((p) => p.message);
}

describe('room syntax', () => {
  it('parses header, grid and entities', () => {
    const r = parseRoom(
      [
        '; a comment',
        '@district rooftops',
        '@pos 32 -4',
        '@size 6 4',
        '@legend T material=roof.tar cell=HALF',
        '#..',
        '#T#',
        '',
        '@prop ac.unit 3 2',
        '@hub h 0 0 3 2 spawn=1,0 facing=-1 name="The \\"hub\\"" start',
        '@route r1 name="Run" difficulty=3',
        '@start 0 0 1 2',
        '@checkpoint 2 0 1 2',
        '@finish 5 0 1 2',
        '@find f1 4 0 1 1 clue="Up high"',
      ].join('\n'),
      'x.room.txt',
    );
    expect(r.pos).toEqual([32, -4]);
    expect(r.rows).toEqual(['#.....', '#T#...', '......', '......']);
    expect(r.legend[0]).toEqual({ char: 'T', material: 'roof.tar', cell: 'HALF', prop: undefined });
    expect(r.hubs[0]).toMatchObject({ name: 'The "hub"', spawn: [1, 0], facing: -1, start: true });
    expect(r.routes[0]).toMatchObject({
      difficulty: 3,
      checkpoints: [[2, 0, 1, 2]],
      corridor: [[0, 0, 6, 4]],
    });
    expect(r.finds[0]!.clue).toBe('Up high');
  });

  it('reports mistakes with a line number', () => {
    const bad = (text: string, re: RegExp) => {
      expect(() => parseRoom(text, 'x.room.txt')).toThrow(RoomError);
      expect(() => parseRoom(text, 'x.room.txt')).toThrow(re);
    };
    bad('@district rooftops\n@pos 0 0\n#\n@wat 1', /x.room.txt:4: unknown directive @wat/);
    bad('@district rooftops\n#', /@pos missing/);
    bad('@district rooftops\n@pos 0 0\n#\n\n#', /second grid/);
    bad('@district rooftops\n@pos 0 0\n@size 1 1\n##', /exceeds @size/);
    bad('@district rooftops\n@pos 0 0\n#\n@checkpoint 0 0 1 1', /outside a @route/);
    bad('@district rooftops\n@pos 0 0\n#\n@route r\n@start 0 0 1 1', /@finish missing/);
    bad('@district rooftops\n@pos 0 x\n#', /expected an integer/);
  });
});

describe('validation', () => {
  it('accepts a clean room', () => {
    expect(errors(content(room(['..', '##'], HUB)))).toEqual([]);
  });

  it('rejects unknown characters, props outside or over solids, bad references', () => {
    expect(errors(content(room(['.Q', '##'], HUB)))).toEqual([
      expect.stringMatching(/unknown character 'Q'/),
    ]);
    expect(errors(content(room(['...', '###'], `${HUB}\n@prop ac.unit 2 0`)))[0]).toMatch(
      /reaches outside the room/,
    );
    expect(errors(content(room(['...', '###'], `${HUB}\n@prop ac.unit 0 1`)))[0]).toMatch(
      /overlaps a solid/,
    );
    expect(errors(content(room(['..', '##'], HUB.replace('@hub h', '@hub other'))))).toEqual([
      expect.stringMatching(/missing hub h/),
    ]);
    expect(errors(content(room(['..', '##'], `${HUB}\n@find f 5 5 1 1 clue="x"`)))).toEqual([
      expect.stringMatching(/find f lies outside every region/),
    ]);
    expect(errors(content(room(['..', '##'], `${HUB}\n${HUB}`)))).toEqual([
      expect.stringMatching(/hub h is already defined/),
    ]);
    expect(errors(content(room(['..', '..'], HUB)))).toEqual([
      expect.stringMatching(/no floor under the spawn/),
    ]);
  });

  it('rejects overlapping rooms', () => {
    const a = room(['..', '##'], HUB);
    const b = '@district rooftops\n@pos 1 0\n..\n##\n';
    expect(errors(content(a, b))[0]).toMatch(/also belongs to/);
  });

  it('checks the art contract when the art exists', () => {
    expect(validateArt(real).filter((p) => p.level === 'error')).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), 'bake-art-'));
    try {
      cpSync(join(ROOT, 'art', 'rooftops'), join(dir, 'art', 'rooftops'), { recursive: true });
      const png = decodePng(readFileSync(join(dir, 'art', 'rooftops', 'tiles.png')));
      const [fx, fy] = frontRect(0, 0);
      const at = (fy * png.width + fx + 5) * 4;
      png.data[at] = png.data[at]! ^ 0xff;
      writeFileSync(join(dir, 'art', 'rooftops', 'tiles.png'), encodePng(png));
      const broken = validateArt({ ...real, root: dir });
      expect(broken.some((p) => p.level === 'error' && /roof.concrete/.test(p.message))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the real content bakes without errors', () => {
    const all = bakeAll(ROOT);
    expect(all.problems.filter((p) => p.level === 'error')).toEqual([]);
    expect(all.gym.index.hubs.length).toBeGreaterThan(0);
  });
});

function tiles(rows: string[], mats?: string[]): TileGrid {
  const height = rows.length;
  const width = rows[0]!.length;
  const cells = new Uint8Array(width * height);
  const materials = new Uint8Array(width * height);
  const chars: Record<string, number> = { '#': 1, _: 5, s: 10, '/': 3, '\\': 4, '=': 2, '.': 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = chars[rows[y]![x]!]!;
      cells[y * width + x] = c;
      materials[y * width + x] = c === 0 ? 0 : mats ? Number(mats[y]![x]) : 1;
    }
  }
  return { x0: 0, y0: 0, width, height, cells, materials };
}

function outline(g: TileGrid) {
  const segs = [];
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) segs.push(...cellOutline(g, x, y));
  return mergeSegments(segs);
}

describe('depth outlines', () => {
  it('a floating block has four merged faces, clockwise', () => {
    const g = tiles(['....', '.##.', '.##.', '....']);
    expect(outline(g)).toEqual([
      [32, 32, 96, 32, 1, 0],
      [96, 32, 96, 96, 1, 1],
      [96, 96, 32, 96, 1, 2],
      [32, 96, 32, 32, 1, 3],
    ]);
  });

  it('only solid-to-empty boundaries; materials split runs but never hide faces', () => {
    const g = tiles(['....', '.##.', '....'], ['0000', '0120', '0000']);
    const o = outline(g);
    expect(o.filter((s) => s[5] === 0)).toEqual([
      [32, 32, 64, 32, 1, 0],
      [64, 32, 96, 32, 2, 0],
    ]);
    expect(o.some((s) => s[5] === 1 && s[0] === 64)).toBe(false);
  });

  it('partial shapes: a HALF beside a SOLID exposes the upper half of the wall', () => {
    const g = tiles(['....', '._#.', '....']);
    const o = outline(g);
    expect(o).toContainEqual([32, 48, 64, 48, 1, 0]);
    expect(o).toContainEqual([64, 48, 64, 32, 1, 3]);
    expect(o.some((s) => s[5] === 3 && s[0] === 64 && s[1] === 64)).toBe(false);
  });

  it('slopes give sloped top faces, merged along a ramp', () => {
    const g = tiles(['.....', '../##', './###', '#####']);
    const o = outline(g);
    expect(o).toContainEqual([32, 96, 96, 32, 1, 0]);
    expect(o).toContainEqual([96, 32, 160, 32, 1, 0]);
  });

  it('planks are thin', () => {
    const g = tiles(['...', '.=.', '...']);
    expect(outline(g)).toEqual([
      [32, 32, 64, 32, 1, 0],
      [64, 32, 64, 36, 1, 1],
      [64, 36, 32, 36, 1, 2],
      [32, 36, 32, 32, 1, 3],
    ]);
  });
});

describe('autotile', () => {
  it('connects same-material neighbours whose shared edge is full', () => {
    const g = tiles(['###', '#_.', '...']);
    const v = autotile(g);
    expect(v[0]).toBe(2 | 4 | 1 | 8); // top-left: the world edge repeats, so up and left connect
    // The HALF meets the SOLID only along half an edge: neither connects to the other.
    expect(v[1 * 3 + 1]).toBe(0);
    expect(v[1 * 3 + 0]).toBe(1 | 8);
  });
});

describe('chunks', () => {
  it('splits a world into chunk files that agree across borders', () => {
    const wide = Array.from({ length: 4 }, (_, y) => (y < 3 ? '.' : '#').repeat(70));
    const c = content(room(wide, '@hub h 0 0 2 3 spawn=0,2\n@prop ac.unit 33 2'));
    const r = bakeWorld(c, c.rooms);
    expect(r.problems.filter((p) => p.level === 'error')).toEqual([]);
    expect(r.index.bounds).toEqual([0, 0, 3, 1]);
    expect(r.chunks.length).toBe(3);
    // The floor's top face is split at the chunk borders, and the pieces meet.
    const tops = r.chunks.flatMap((k) => {
      const o = k.file.outlines;
      const out: number[][] = [];
      for (let i = 0; i < o.length; i += 6) if (o[i + 5] === 0) out.push(o.slice(i, i + 4));
      return out;
    });
    expect(tops).toEqual([
      [0, 96, 1024, 96],
      [1024, 96, 2048, 96],
      [2048, 96, 2240, 96],
    ]);
    // The prop is listed in the chunk of its anchor and stamped into the cells.
    expect(r.chunks[1]!.file.props).toEqual([
      { prop: real.props.findIndex((p) => p.id === 'ac.unit'), x: 33, y: 2 },
    ]);
    const cells = base64ToBytes(r.chunks[1]!.file.cells);
    expect(cells[(2 << 5) | 1]).toBe(Cell.SOLID);
    expect(base64ToBytes(r.chunks[1]!.file.materials)[(2 << 5) | 1]).toBe(0);
    expect(r.chunks.every((k) => k.name === `chunks/${k.name.slice(7, 23)}.json`)).toBe(true);
    expect(CHUNK_CELLS).toBe(32);
  });

  it('assembly widens bounds to whole chunks, negative positions included', () => {
    const a = assemble(
      content(room(['..', '##'], HUB, '-3 -40')),
      content(room(['..', '##'], HUB, '-3 -40')).rooms,
    );
    expect([a.x0, a.y0, a.width, a.height]).toEqual([-32, -64, 32, 32]);
  });
});
