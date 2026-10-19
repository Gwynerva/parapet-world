/** Collision for every cell class, as `schemas/cells.ts` describes it. */
import { CELL_MISSING, Cell, Key } from '@parapet-world/schemas';
import { describe, expect, it } from 'vitest';
import {
  ChunkWorld,
  NO_STATICS,
  R,
  boxHitsSolid,
  createRunner,
  findFloor,
  runnerView,
  stepRunner,
  sweepUp,
  sweepX,
} from '../src/index.ts';
import { CELL, feetAt, grid, rules } from './helpers.ts';

const HW = 256;
const NONE = 0x3fffffff;

/** Steps a runner with a held mask for n steps; returns the views after each step. */
function run(
  rows: string[],
  start: [number, number],
  facing: number,
  plan: Array<[number, number]>,
): Array<ReturnType<typeof runnerView>> {
  const rs = rules();
  const w = grid(rows);
  const s = createRunner(rs, start[0], start[1], facing);
  const out: Array<ReturnType<typeof runnerView>> = [];
  for (const [n, held] of plan) {
    for (let i = 0; i < n; i++) {
      stepRunner(s, held, null, w, rs, NO_STATICS);
      out.push({ ...runnerView(s, rs) });
    }
  }
  return out;
}

describe('floors', () => {
  it('SOLID, HALF, SLAB and POST tops', () => {
    const w = grid(['....', '#_sn']);
    expect(findFloor(w, 512, HW, 0, 2048, true)).toBe(CELL);
    expect(findFloor(w, CELL + 512, HW, 0, 2048, true)).toBe(CELL + 512);
    expect(findFloor(w, 2 * CELL + 512, HW, 0, 2048, true)).toBe(CELL);
    expect(findFloor(w, 3 * CELL + 512, HW, 0, 2048, true)).toBe(CELL);
    // The post is 8 px wide: feet beside it miss it.
    expect(findFloor(w, 3 * CELL + 900, HW, CELL - 10, CELL + 10, true)).toBe(NONE);
  });

  it('the feet span stands on an edge with a toe', () => {
    const w = grid(['..', '#.']);
    expect(findFloor(w, CELL + HW - 1, HW, 0, 2048, true)).toBe(CELL);
    expect(findFloor(w, CELL + HW, HW, 0, 1500, true)).toBe(NONE);
  });

  it('one-way floors: TOP at the cell top, BAR 2 px below it, only when allowed', () => {
    const w = grid(['=-', '..']);
    expect(findFloor(w, 512, HW, 0, 100, true)).toBe(0);
    expect(findFloor(w, CELL + 512, HW, 0, 100, true)).toBe(64);
    expect(findFloor(w, 512, HW, 0, 100, false)).toBe(NONE);
  });

  it('slopes follow the centre column; a flat beside them does not pop', () => {
    const w = grid(['./#', '/##']);
    // Middle of the lower slope: surface at 1.5 cells.
    expect(findFloor(w, 512, HW, 0, 4096, true)).toBe(CELL + 512);
    // Near the top of the upper slope, the flat to the right is ignored.
    expect(findFloor(w, CELL + 1000, HW, 0, 4096, true)).toBe(24);
    const back = grid(['#\\.', '##\\']);
    expect(findFloor(back, CELL + 24, HW, 0, 4096, true)).toBe(24);
    expect(findFloor(back, 2 * CELL + 512, HW, 0, 4096, true)).toBe(CELL + 512);
  });

  it('ladders, poles and KILL have no floor', () => {
    const w = grid(['HP~', '...']);
    for (let c = 0; c < 3; c++) expect(findFloor(w, c * CELL + 512, HW, 0, 1500, true)).toBe(NONE);
  });
});

describe('walls and ceilings', () => {
  const top = 0;
  const bottom = 1500;
  it('SOLID, HALF, SLAB and POST block sideways', () => {
    const w = grid(['..#.', '..#.']);
    expect(sweepX(w, CELL + 512, 900, HW, top, bottom, 2048, 288)).toBe(2 * CELL - HW);
    expect(sweepX(w, 3 * CELL + 512, -900, HW, top, bottom, 2048, 288)).toBe(3 * CELL + HW);
    const post = grid(['.n.', '.n.']);
    expect(sweepX(post, 512, 900, HW, top, bottom, 2048, 288)).toBe(CELL + 384 - HW);
    expect(sweepX(post, 2 * CELL + 512, -900, HW, top, bottom, 2048, 288)).toBe(CELL + 640 + HW);
    // A HALF only blocks the box's lower half of that row; a SLAB its upper half.
    const half = grid(['..', '._']);
    expect(sweepX(half, 512, 900, HW, CELL, 2 * CELL - 288, 2 * CELL, 288)).toBe(CELL - HW);
    expect(sweepX(half, 512, 900, HW, CELL, CELL + 400, CELL + 688, 288)).toBe(512 + 900);
    const slab = grid(['.s', '..']);
    expect(sweepX(slab, 512, 900, HW, 500, 1800, 2088, 288)).toBe(CELL - HW);
    expect(sweepX(slab, 512, 900, HW, 520, 1800, 2088, 288)).toBe(512 + 900);
  });

  it('a box never sticks in a face it already overlaps', () => {
    const w = grid(['##', '..']);
    expect(sweepX(w, CELL, 100, HW, 0, 500, 788, 288)).toBe(CELL + 100);
  });

  it('a slope is a wall only on its high side or from below', () => {
    const w = grid(['....', './\\.', '####']);
    // Walking up / from the left: not blocked (the floor lifts the feet).
    expect(sweepX(w, 512, 600, HW, 300, 2 * CELL - 288, 2 * CELL, 288)).toBe(1112);
    // Coming at / from the right: its high side is a wall.
    expect(sweepX(w, 2 * CELL + 512, -900, HW, CELL, 2 * CELL - 288, 2 * CELL, 288)).toBe(
      2 * CELL + HW,
    );
  });

  it('ceilings: SOLID and SLAB stop the head, one-way floors do not', () => {
    const w = grid(['#s=-', '....', '....']);
    expect(sweepUp(w, 512, HW, 2 * CELL, -1500)).toBe(CELL);
    expect(sweepUp(w, CELL + 512, HW, 2 * CELL, -1700)).toBe(512);
    expect(sweepUp(w, 2 * CELL + 512, HW, 2 * CELL, -1500)).toBe(2 * CELL - 1500);
    expect(sweepUp(w, 3 * CELL + 512, HW, 2 * CELL, -1500)).toBe(2 * CELL - 1500);
  });

  it('overlap tests match the shapes', () => {
    const w = grid(['/\\', 'sn']);
    expect(boxHitsSolid(w, 0, 0, 200, 200)).toBe(false);
    expect(boxHitsSolid(w, 800, 800, 1000, 1000)).toBe(true);
    expect(boxHitsSolid(w, CELL + 10, 10, CELL + 200, 100)).toBe(true);
    expect(boxHitsSolid(w, 0, CELL + 600, 1000, CELL + 900)).toBe(false);
    expect(boxHitsSolid(w, CELL, CELL + 600, CELL + 300, CELL + 900)).toBe(false);
    expect(boxHitsSolid(w, CELL + 400, CELL + 600, CELL + 500, CELL + 900)).toBe(true);
  });
});

describe('runners on every class', () => {
  it('stands on SOLID, walks into a wall and stops at its face', () => {
    const v = run(['......#', '......#', '#######'], feetAt(5, 2), 1, [[30, Key.RIGHT]]);
    const last = v[v.length - 1]!;
    expect(last.x).toBe(6 * CELL - HW);
    expect(last.y).toBe(2 * CELL);
    expect(last.onGround).toBe(true);
    expect(Math.max(...v.map((s) => s.x))).toBe(6 * CELL - HW);
  });

  it('walks up and down slopes without leaving the floor', () => {
    const rows = ['..........', '..........', '.../##\\...', '##########'];
    const v = run(rows, feetAt(1, 3), 1, [[48, Key.RIGHT]]);
    let prevY = v[0]!.y;
    for (const s of v) {
      expect(s.move === 'fall' || s.move === 'jump').toBe(false);
      expect(Math.abs(s.y - prevY)).toBeLessThanOrEqual(Math.abs(s.vx) + 64);
      prevY = s.y;
    }
    expect(Math.min(...v.map((s) => s.y))).toBe(2 * CELL);
    expect(v[v.length - 1]!.y).toBe(3 * CELL);
  });

  it('a HALF is too high to walk onto: runners step over it or jump it', () => {
    const stepped = run(['......', '..._..', '######'], feetAt(0, 2), 1, [[40, Key.RIGHT]]);
    expect(stepped.some((s) => s.move === 'stepOver')).toBe(true);
    expect(stepped[stepped.length - 1]!.x).toBeGreaterThan(4 * CELL);
    const jumped = run(['......', '..._..', '######'], feetAt(0, 2), 1, [
      [10, Key.RIGHT],
      [1, Key.RIGHT | Key.UP],
      [40, Key.RIGHT],
    ]);
    expect(jumped[jumped.length - 1]!.x).toBeGreaterThan(4 * CELL);
  });

  it('jumps up through TOP and BAR, lands on them, drops through TOP with DOWN', () => {
    const rows = ['.....', '.....', '.=-..', '#####'];
    const v = run(rows, feetAt(1, 3), 1, [
      [5, 0],
      [1, Key.UP],
      [40, 0],
    ]);
    expect(v[v.length - 1]!.y).toBe(2 * CELL);
    expect(v[v.length - 1]!.move).toBe('idle');
    const bar = run(rows, feetAt(2, 3), 1, [
      [5, 0],
      [1, Key.UP],
      [40, 0],
    ]);
    expect(bar[bar.length - 1]!.y).toBe(2 * CELL + 64);
    const drop = run(rows, feetAt(1, 2), 1, [
      [5, 0],
      [1, Key.DOWN],
      [40, 0],
    ]);
    expect(drop[drop.length - 1]!.y).toBe(3 * CELL);
  });

  it('a SLAB stops a standing runner, a roll passes under it', () => {
    const rows = ['..........', '...ssss...', '..........', '##########'];
    const walk = run(rows, feetAt(0, 3), 1, [[60, Key.RIGHT]]);
    expect(walk[walk.length - 1]!.x).toBeLessThan(3 * CELL);
    const roll = run(rows, feetAt(0, 3), 1, [
      [16, Key.RIGHT],
      [1, Key.RIGHT | Key.DOWN],
      [60, Key.RIGHT],
    ]);
    expect(roll[roll.length - 1]!.x).toBeGreaterThan(7 * CELL);
  });

  it('walks through ladders and poles', () => {
    const v = run(['......', '.HP...', '.HP...', '######'], feetAt(0, 3), 1, [[40, Key.RIGHT]]);
    expect(v[v.length - 1]!.x).toBeGreaterThan(4 * CELL);
  });

  it('a POST stops a runner; standing on its top', () => {
    const v = run(['....', '..n.', '####'], feetAt(1, 2), 1, [[40, Key.RIGHT]]);
    expect(v[v.length - 1]!.x).toBe(2 * CELL + 384 - HW);
    const top = run(['....', '.n..', '####'], [CELL + 512, CELL], 1, [[5, 0]]);
    expect(top[4]!.y).toBe(CELL);
    expect(top[4]!.onGround).toBe(true);
  });

  it('KILL is fatal', () => {
    const v = run(['....', '.~~.', '####'], feetAt(0, 2), 1, [[30, Key.RIGHT]]);
    expect(v.some((s) => s.dead)).toBe(true);
  });

  it('a runner whose 3 x 3 chunks are not loaded stalls, and missing cells say so', () => {
    const rs = rules();
    const w = new ChunkWorld([0, 0, 3, 1]);
    const floor = new Uint8Array(1024);
    for (let x = 0; x < 32; x++) floor[(20 << 5) | x] = Cell.SOLID;
    w.loadCells(0, 0, floor);
    w.loadCells(1, 0, floor);
    expect(w.cell(70, 3)).toBe(CELL_MISSING);
    const s = createRunner(rs, 40 * CELL, 20 * CELL, 1);
    expect(stepRunner(s, 0, null, w, rs, NO_STATICS)).toBe(false);
    expect(s[R.STEP]).toBe(0);
    w.loadCells(2, 0, floor);
    expect(stepRunner(s, 0, null, w, rs, NO_STATICS)).toBe(true);
    w.unload(2, 0);
    expect(stepRunner(s, 0, null, w, rs, NO_STATICS)).toBe(false);
    // Outside the bounds is air, and below them KILL.
    expect(w.cell(-5, 3)).toBe(Cell.EMPTY);
    expect(w.cell(5, 40)).toBe(Cell.KILL);
  });
});
