/** Basic locomotion: idle, start, run, skid, turn, turnFlip, jump, fall, landings, roll, death. */
import { Command, Key, type InputCommand } from '@parapet-world/schemas';
import { describe, expect, it } from 'vitest';
import {
  NO_STATICS,
  R,
  createRunner,
  createStatics,
  runnerView,
  stepRunner,
  type RunnerView,
  type WorldStatics,
} from '../src/index.ts';
import { CELL, feetAt, grid, rules } from './helpers.ts';

type Plan = Array<[number, number] | [number, number, InputCommand]>;

function play(
  rows: string[],
  start: [number, number],
  plan: Plan,
  statics: WorldStatics = NO_STATICS,
  facing = 1,
): RunnerView[] {
  const rs = rules();
  const w = grid(rows);
  const s = createRunner(rs, start[0], start[1], facing);
  const out: RunnerView[] = [];
  for (const [n, held, cmd] of plan) {
    for (let i = 0; i < n; i++) {
      stepRunner(s, held, i === 0 ? (cmd ?? null) : null, w, rs, statics);
      out.push({ ...runnerView(s, rs) });
    }
  }
  return out;
}

/** The distinct moves in order of entry. */
function moves(v: RunnerView[]): string[] {
  const out: string[] = [];
  let nonce = -1;
  for (const s of v) {
    if (s.nonce !== nonce) out.push(s.move);
    nonce = s.nonce;
  }
  return out;
}

const FLAT = ['.'.repeat(60), '.'.repeat(60), '.'.repeat(60), '#'.repeat(60)];

describe('ground moves', () => {
  it('idle, start, run, skid back to idle', () => {
    const v = play(FLAT, feetAt(2, 3), [
      [5, 0],
      [30, Key.RIGHT],
      [30, 0],
    ]);
    // Letting go at speed coasts for a few steps (a re-press there would be a tiger jump).
    expect(moves(v)).toEqual(['idle', 'start', 'run', 'coast', 'skid', 'idle']);
    expect(v[34]!.vx).toBe(rules().params.runSpeed);
    expect(v[v.length - 1]!.vx).toBe(0);
  });

  it('runs at 5-6 cells per second', () => {
    const v = play(FLAT, feetAt(2, 3), [[60, Key.RIGHT]]);
    const cellsPerSecond = ((v[59]!.x - v[29]!.x) / CELL) * (30 / 30);
    expect(cellsPerSecond).toBeGreaterThanOrEqual(5);
    expect(cellsPerSecond).toBeLessThanOrEqual(6);
  });

  it('turn keeps the facing while braking, turnFlip flips it', () => {
    const v = play(FLAT, feetAt(20, 3), [
      [30, Key.RIGHT],
      [30, Key.LEFT],
    ]);
    // turnFlip is instant: it flips the facing and hands over within the same step.
    const seq = moves(v);
    expect(seq.slice(0, 4)).toEqual(['start', 'run', 'turn', 'start']);
    const turnSteps = v.filter((s) => s.move === 'turn');
    expect(turnSteps.every((s) => s.facing === 1)).toBe(true);
    expect(v[v.length - 1]!.facing).toBe(-1);
    expect(v[v.length - 1]!.vx).toBeLessThan(0);
  });

  it('a standing turn', () => {
    const v = play(FLAT, feetAt(20, 3), [
      [3, 0],
      [20, Key.LEFT],
    ]);
    expect(moves(v)).toEqual(['idle', 'turnFast', 'start', 'run']);
    expect(v[v.length - 1]!.facing).toBe(-1);
  });

  it('stops at a wall when slow, crashes into it at full speed', () => {
    const rows = ['..........#', '..........#', '..........#', '###########'];
    const slow = play(rows, feetAt(9, 3), [[60, Key.RIGHT]]);
    expect(slow[slow.length - 1]!.move).toBe('idle');
    const fast = play(rows, feetAt(1, 3), [[120, Key.RIGHT]]);
    expect(moves(fast)).toEqual([
      'start',
      'run',
      'crash',
      'crashFall',
      'crashDown',
      'getUp',
      'idle',
      'start',
      'idle',
    ]);
  });

  it('a roll from a run keeps the speed and uses the low body', () => {
    const v = play(FLAT, feetAt(2, 3), [
      [25, Key.RIGHT],
      [1, Key.RIGHT | Key.DOWN],
      [30, Key.RIGHT],
    ]);
    expect(moves(v)).toEqual(['start', 'run', 'roll', 'run']);
    const roll = v.filter((s) => s.move === 'roll');
    expect(roll.every((s) => s.crouch && Math.abs(s.vx) >= rules().params.rollSpeed!)).toBe(true);
  });
});

describe('air moves', () => {
  it('a running jump clears a 3-cell gap and lands soft', () => {
    const gap = 3;
    const rows = [
      '.'.repeat(40),
      '.'.repeat(40),
      '.'.repeat(40),
      '#'.repeat(15) + '.'.repeat(gap) + '#'.repeat(22 - gap),
    ];
    const rs = rules();
    const w = grid(rows);
    const s = createRunner(rs, ...feetAt(2, 3), 1);
    const seen: string[] = [];
    for (let i = 0; i < 120; i++) {
      // Jump from the last moment the toes are on the edge.
      const edge = 15 * CELL + rs.params.halfWidth!;
      const held =
        s[R.X]! + s[R.VX]! >= edge && s[R.MOVE] === rs.moveIndex('run')
          ? Key.RIGHT | Key.UP
          : Key.RIGHT;
      stepRunner(s, held, null, w, rs, NO_STATICS);
      const v = runnerView(s, rs);
      if (seen[seen.length - 1] !== v.move) seen.push(v.move);
    }
    expect(seen).toContain('jump');
    expect(seen).toContain('landSoft');
    expect(seen).not.toContain('dead');
    expect(s[R.X]).toBeGreaterThan((15 + gap) * CELL);
  });

  it('jump height clears a crate (one cell) standing', () => {
    const v = play(FLAT, feetAt(5, 3), [
      [3, 0],
      [1, Key.UP],
      [40, 0],
    ]);
    const apex = Math.min(...v.map((s) => s.y));
    expect(3 * CELL - apex).toBeGreaterThan(CELL + 64);
    expect(moves(v)).toEqual(['idle', 'jump', 'fall', 'landSoft', 'idle']);
  });

  it('walking off a high ledge lands hard, at speed stumbles; DOWN shortly before rolls', () => {
    const rows = [
      '#####.........',
      '..............',
      '..............',
      '..............',
      '..............',
      '##############',
    ];
    const fast = play(rows, feetAt(3, 0), [[60, Key.RIGHT]]);
    expect(moves(fast)).toContain('stumble');
    const slow = play(rows, feetAt(4, 0), [
      [7, Key.RIGHT],
      [60, 0],
    ]);
    expect(moves(slow)).toContain('landHard');
    const rs = rules();
    const w = grid(rows);
    const s = createRunner(rs, ...feetAt(3, 0), 1);
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      const falling = s[R.MOVE] === rs.moveIndex('fall') && s[R.Y]! > 4 * CELL;
      stepRunner(s, falling ? Key.RIGHT | Key.DOWN : Key.RIGHT, null, w, rs, NO_STATICS);
      const m = runnerView(s, rs).move;
      if (seen[seen.length - 1] !== m) seen.push(m);
    }
    expect(seen).toContain('roll');
    expect(seen).not.toContain('landHard');
  });

  it('coyote time: a jump just after running off an edge', () => {
    const rows = ['.'.repeat(30), '.'.repeat(30), '.'.repeat(30), '#'.repeat(10) + '.'.repeat(20)];
    const rs = rules();
    const w = grid(rows);
    const s = createRunner(rs, ...feetAt(2, 3), 1);
    let jumped = false;
    let pressed = false;
    for (let i = 0; i < 60; i++) {
      const air = s[R.MOVE] === rs.moveIndex('fall') && s[R.AIR_STEPS]! >= 2;
      const held = air && !pressed ? Key.RIGHT | Key.UP : Key.RIGHT;
      if (held & Key.UP) pressed = true;
      stepRunner(s, held, null, w, rs, NO_STATICS);
      if (runnerView(s, rs).move === 'jump') jumped = true;
    }
    expect(jumped).toBe(true);
  });

  it('a fatal fall kills; respawn returns to the region hub', () => {
    const rows = ['#####.....', ...Array.from({ length: 14 }, () => '..........'), '##########'];
    const statics = createStatics({
      regions: [{ id: 'r', district: 'rooftops', rect: [0, 0, 10, 16], hub: 0 }],
      hubs: [
        {
          id: 'h',
          district: 'rooftops',
          name: 'Hub',
          rect: [0, 0, 3, 1],
          spawn: feetAt(1, 0),
          facing: 1,
        },
      ],
      startHub: 0,
    });
    const v = play(
      rows,
      feetAt(3, 0),
      [
        [25, Key.RIGHT],
        [100, 0],
      ],
      statics,
    );
    const seq = moves(v);
    expect(seq).toContain('dead');
    // The respawn step only moves the runner to the hub (the chunks there may still be loading);
    // the next one goes on in the spawn move.
    const back = v.findIndex((s, i) => i > 0 && v[i - 1]!.dead && !s.dead);
    expect(v[back]!.x).toBe(feetAt(1, 0)[0]);
    expect(v[back]!.move).toBe('respawn');
    expect(v[back + 1]!.move).toBe('idle');
    expect(v[v.length - 1]!.y).toBe(0);
  });
});

describe('hub teleport', () => {
  const rows = [...FLAT];
  const statics = createStatics({
    regions: [],
    hubs: [
      {
        id: 'a',
        district: 'rooftops',
        name: 'A',
        rect: [0, 0, 6, 4],
        spawn: feetAt(2, 3),
        facing: 1,
      },
      {
        id: 'b',
        district: 'rooftops',
        name: 'B',
        rect: [40, 0, 6, 4],
        spawn: feetAt(42, 3),
        facing: -1,
      },
    ],
    startHub: 0,
  });
  const tp: InputCommand = { step: 0, kind: Command.TELEPORT, arg: 1 };

  it('works while standing inside a hub area', () => {
    const v = play(
      rows,
      feetAt(2, 3),
      [
        [3, 0],
        [1, 0, tp],
        [3, 0],
      ],
      statics,
    );
    expect(v[3]!.x).toBe(feetAt(42, 3)[0]);
    expect(v[3]!.facing).toBe(-1);
  });

  it('is ignored outside hub areas and for unknown hubs', () => {
    const v = play(
      rows,
      feetAt(20, 3),
      [
        [3, 0],
        [1, 0, tp],
        [3, 0],
      ],
      statics,
    );
    expect(v[3]!.x).toBe(feetAt(20, 3)[0]);
    const bad: InputCommand = { step: 0, kind: Command.TELEPORT, arg: 7 };
    const w = play(
      rows,
      feetAt(2, 3),
      [
        [3, 0],
        [1, 0, bad],
        [3, 0],
      ],
      statics,
    );
    expect(w[3]!.x).toBe(feetAt(2, 3)[0]);
  });
});
