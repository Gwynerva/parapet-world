/** Observers: hubs, routes (start, checkpoints, finish, cancel), finds, death and respawn. */
import { Key } from '@parapet-world/schemas';
import { describe, expect, it } from 'vitest';
import {
  createObserver,
  createRunner,
  createRunnerObserver,
  createStatics,
  observe,
  stepRunner,
  type SimEvent,
  type WorldEvent,
  type StaticsSource,
} from '../src/index.ts';
import { feetAt, grid, rules } from './helpers.ts';

function world(corridorWidth: number): StaticsSource {
  return {
    regions: [{ id: 'r', district: 'rooftops', rect: [0, 0, 60, 6], hub: 0 }],
    hubs: [
      {
        id: 'h',
        district: 'rooftops',
        name: 'H',
        rect: [0, 0, 4, 4],
        spawn: feetAt(2, 3),
        facing: 1,
      },
    ],
    routes: [
      {
        id: 'run',
        district: 'rooftops',
        name: 'Run',
        difficulty: 1,
        start: [6, 0, 1, 4],
        checkpoints: [[14, 0, 1, 4]],
        finish: [22, 0, 1, 4],
        corridor: [[0, 0, corridorWidth, 6]],
      },
    ],
    finds: [{ id: 'f', district: 'rooftops', rect: [28, 2, 1, 1], clue: 'x' }],
    startHub: 0,
  };
}

function play(rows: string[], src: StaticsSource, plan: Array<[number, number]>): WorldEvent[] {
  const rs = rules();
  const st = createStatics(src);
  const w = grid(rows);
  const s = createRunner(rs, ...feetAt(2, 3), 1);
  const o = createObserver();
  const events: WorldEvent[] = [];
  for (const [n, held] of plan) {
    for (let i = 0; i < n; i++) {
      if (stepRunner(s, held, null, w, rs, st)) events.push(...observe(o, s, rs, st));
    }
  }
  return events;
}

const FLAT = ['.'.repeat(60), '.'.repeat(60), '.'.repeat(60), '#'.repeat(60)];

describe('observers', () => {
  it('report a hub, a route start, its checkpoint and finish with the time, and a find', () => {
    const ev = play(FLAT, world(40), [[170, Key.RIGHT]]);
    expect(ev.map((e) => e.kind)).toEqual(['hub', 'routeStart', 'checkpoint', 'finish', 'find']);
    const start = ev[1]!;
    const finish = ev[3]!;
    expect(finish.steps).toBe(finish.step - start.step);
    expect(finish.steps).toBeGreaterThan(30);
    expect(ev[2]!.gate).toBe(1);
  });

  it('cancel a run once the feet have been out of its corridor for more than the grace', () => {
    const src = world(12);
    src.routes![0]!.checkpoints = [[10, 0, 1, 4]];
    const ev = play(FLAT, src, [[170, Key.RIGHT]]);
    expect(ev.map((e) => e.kind)).toEqual([
      'hub',
      'routeStart',
      'checkpoint',
      'routeCancel',
      'find',
    ]);
    // The feet leave the corridor at x = 12, two cells (about 11 steps) after the checkpoint at 10;
    // the run survives corridorGrace (20) more steps.
    const gap = ev[3]!.step - ev[2]!.step;
    expect(gap).toBeGreaterThan(rules().params.corridorGrace! + 8);
    expect(gap).toBeLessThan(rules().params.corridorGrace! + 16);
  });

  it('keep a run through a short excursion out of its corridor', () => {
    const src = world(12);
    src.routes![0]!.corridor = [
      [0, 0, 12, 6],
      [15, 0, 30, 6],
    ];
    const ev = play(FLAT, src, [[170, Key.RIGHT]]);
    expect(ev.map((e) => e.kind)).toEqual(['hub', 'routeStart', 'checkpoint', 'finish', 'find']);
  });

  it('ignore the start gates of other routes during a run, restart on its own', () => {
    const src = world(40);
    src.routes!.push({
      id: 'other',
      district: 'rooftops',
      name: 'Other',
      difficulty: 2,
      start: [14, 0, 1, 4],
      checkpoints: [],
      finish: [30, 0, 1, 4],
      corridor: [[0, 0, 40, 6]],
    });
    src.routes![0]!.checkpoints = [[10, 0, 1, 4]];
    // Run right past the first route's start (6), its checkpoint (10), the other route's start
    // (14), then back left over the first start and right again: crossing its own start gate
    // restarts the run each time; the other route never starts.
    const ev = play(FLAT, src, [
      [60, Key.RIGHT],
      [60, Key.LEFT],
      [120, Key.RIGHT],
    ]);
    const routeEvents = ev.filter((e) => e.kind !== 'hub' && e.kind !== 'find');
    expect(routeEvents.map((e) => `${e.kind} ${e.index}`)).toEqual([
      'routeStart 0',
      'checkpoint 0',
      'routeStart 0',
      'routeStart 0',
      'checkpoint 0',
      'finish 0',
    ]);
  });

  it('pass several gates in one step, in order', () => {
    const src = world(40);
    src.routes![0]!.checkpoints = [
      [14, 0, 1, 4],
      [14, 0, 1, 4],
    ];
    src.routes![0]!.finish = [14, 0, 1, 4];
    const ev = play(FLAT, src, [[120, Key.RIGHT]]);
    expect(ev.map((e) => e.kind)).toEqual([
      'hub',
      'routeStart',
      'checkpoint',
      'checkpoint',
      'finish',
    ]);
    expect(new Set(ev.slice(2).map((e) => e.step)).size).toBe(1);
    expect(ev.slice(2, 4).map((e) => e.gate)).toEqual([1, 2]);
  });

  it('report death, a cancelled run and the respawn at the hub', () => {
    const rows = [...FLAT.slice(0, 3), '#'.repeat(10) + '~~' + '#'.repeat(48)];
    const ev = play(rows, world(40), [
      [60, Key.RIGHT],
      [90, 0],
    ]);
    expect(ev.map((e) => e.kind)).toEqual([
      'hub',
      'routeStart',
      'death',
      'routeCancel',
      'respawn',
      'hub',
    ]);
    expect(ev[4]!.index).toBe(0);
  });

  it('skip checkpoints out of order', () => {
    const src = world(40);
    src.routes![0]!.checkpoints = [[30, 0, 1, 4]];
    const ev = play(FLAT, src, [[200, Key.RIGHT]]);
    expect(ev.map((e) => e.kind)).toEqual(['hub', 'routeStart', 'find', 'checkpoint']);
  });
});

describe('runner observer', () => {
  it('reports a hub or a find once per life, everything else as it happens', () => {
    const rs = rules();
    const st = createStatics(world(40));
    const w = grid(FLAT);
    const s = createRunner(rs, ...feetAt(2, 3), 1);
    const obs = createRunnerObserver(st, rs);
    const out: SimEvent[] = [];
    const run = (n: number, held: number) => {
      for (let i = 0; i < n; i++) if (stepRunner(s, held, null, w, rs, st)) obs.step(s, out);
    };
    run(170, Key.RIGHT);
    run(40, 0);
    run(170, Key.LEFT);
    expect(out.map((e) => e.kind)).toEqual([
      'hub',
      'routeStart',
      'checkpoint',
      'finish',
      'find',
      'routeStart',
    ]);
    const finish = out[3]!;
    expect(finish.kind === 'finish' && finish.steps > 30).toBe(true);
    obs.reset();
    out.length = 0;
    run(1, 0);
    run(220, Key.RIGHT);
    expect(out.map((e) => e.kind)).toContain('find');
  });
});
