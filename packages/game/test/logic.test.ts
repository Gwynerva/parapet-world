import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CELL, Key, UNITS_PER_PX, type ChunkFile } from '@parapet-world/schemas';
import {
  ChunkWorld,
  OBSERVER_WORDS,
  R,
  createRunner,
  createStatics,
  loadRuleset,
  stepRunner,
  type RulesetSource,
} from '@parapet-world/sim';
import { syntheticWorld } from '@parapet-world/runtime/testworld.ts';
import { StepClock } from '../src/loop.ts';
import { DEFAULT_BINDINGS, HeldLatch, bitOfCode, gamepadMask } from '../src/input.ts';
import { GameCamera } from '../src/camera.ts';
import { createPicture, picture } from '../src/anim.ts';
import { planClips } from '../src/clips.ts';
import { ChunkStreamer } from '../src/streamer.ts';
import { Observers, type GameEvent } from '../src/observers.ts';
import { allowedLook, formatSteps, loadProfile, newUnlocks, unlocked } from '../src/profile.ts';
import { MIN_LOOP_STEPS, RouteRecorder, cannotBegin } from '../src/recorder.ts';

const rules = loadRuleset(
  JSON.parse(
    readFileSync(new URL('../../content/rules/moves.json', import.meta.url), 'utf8'),
  ) as RulesetSource,
);

describe('step clock', () => {
  it('turns real time into whole steps and carries the fraction', () => {
    const c = new StepClock();
    expect(c.advance(1 / 60)).toBe(0);
    expect(c.alpha).toBeCloseTo(0.5, 6);
    expect(c.advance(1 / 60)).toBe(1);
    expect(c.alpha).toBeCloseTo(0, 5);
    let n = 0;
    for (let i = 0; i < 60; i++) n += c.advance(1 / 60);
    expect(n).toBe(30);
  });

  it('clamps a long frame to 250 ms', () => {
    const c = new StepClock();
    expect(c.advance(5)).toBe(7);
    expect(c.advance(-1)).toBe(0);
  });
});

describe('input', () => {
  it('latches a tap shorter than a step', () => {
    const l = new HeldLatch();
    l.press(Key.UP);
    l.release(Key.UP);
    expect(l.take()).toBe(Key.UP);
    expect(l.take()).toBe(0);
    l.press(Key.LEFT);
    expect(l.take()).toBe(Key.LEFT);
    expect(l.take()).toBe(Key.LEFT);
  });

  it('latches a release, so a re-press within a step still makes an edge', () => {
    const l = new HeldLatch();
    l.press(Key.RIGHT);
    expect(l.take()).toBe(Key.RIGHT);
    // let go and press again before the next step: one step up, then down (a fresh press)
    l.release(Key.RIGHT);
    l.press(Key.RIGHT);
    expect(l.take()).toBe(0);
    expect(l.take()).toBe(Key.RIGHT);
    // a double tap while held: up, down again (owed), then up
    l.release(Key.RIGHT);
    l.press(Key.RIGHT);
    l.release(Key.RIGHT);
    expect(l.take()).toBe(0);
    expect(l.take()).toBe(Key.RIGHT);
    expect(l.take()).toBe(0);
    // peek does not spend the edges
    l.press(Key.UP);
    l.release(Key.UP);
    expect(l.peek()).toBe(Key.UP);
    expect(l.take()).toBe(Key.UP);
    expect(l.take()).toBe(0);
  });

  it('latches new presses of polled sources', () => {
    const l = new HeldLatch();
    l.set(Key.ACTION);
    l.set(0);
    expect(l.take()).toBe(Key.ACTION);
    expect(l.take()).toBe(0);
    // a pad button let go and pressed again between two polls of the step
    l.set(Key.RIGHT);
    expect(l.take()).toBe(Key.RIGHT);
    l.set(0);
    l.set(Key.RIGHT);
    expect(l.take()).toBe(0);
    expect(l.take()).toBe(Key.RIGHT);
  });

  it('maps arrows, WASD and bindings to key bits', () => {
    expect(bitOfCode('ArrowLeft', DEFAULT_BINDINGS)).toBe(Key.LEFT);
    expect(bitOfCode('KeyW', DEFAULT_BINDINGS)).toBe(Key.UP);
    expect(bitOfCode('Space', DEFAULT_BINDINGS)).toBe(Key.UP);
    expect(bitOfCode('KeyJ', DEFAULT_BINDINGS)).toBe(Key.ACTION);
    expect(bitOfCode('KeyQ', DEFAULT_BINDINGS)).toBe(0);
    expect(bitOfCode('KeyQ', { ...DEFAULT_BINDINGS, action: 'KeyQ' })).toBe(Key.ACTION);
  });

  it('reads a standard gamepad', () => {
    const buttons = Array.from({ length: 16 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    buttons[0]!.pressed = true;
    const pad = { connected: true, axes: [0.9, 0], buttons } as unknown as Gamepad;
    expect(gamepadMask(pad)).toBe(Key.UP | Key.RIGHT);
    expect(gamepadMask(null)).toBe(0);
  });
});

describe('camera', () => {
  it('looks ahead along the facing and follows without clamping to the world', () => {
    const c = new GameCamera();
    c.snap(-50000, 1000, 1);
    expect(c.x).toBeGreaterThan(-50000);
    for (let i = 0; i < 300; i++) c.update(-50000, 1000, 180, 0, 1, true, 1 / 60);
    expect(c.x).toBeGreaterThan(-50000 + 48 * UNITS_PER_PX);
    expect(c.y).toBeLessThan(1000);
    for (let i = 0; i < 600; i++) c.update(-50000, 1000, -180, 0, -1, true, 1 / 60);
    expect(c.x).toBeLessThan(-50000);
  });

  it('keeps its height through a jump and follows a climb or a long fall', () => {
    const c = new GameCamera(),
      floor = 40 * CELL;
    c.snap(0, floor, 1);
    const y0 = c.y;
    // a jump 1.5 cells high: the camera barely moves
    for (let i = 0; i < 40; i++) {
      const h = Math.sin((i / 40) * Math.PI) * 1.5 * CELL;
      c.update(0, floor - h, 0, i < 20 ? -200 : 200, 1, false, 1 / 30);
    }
    expect(Math.abs(c.y - y0)).toBeLessThan(0.5 * CELL);
    // climbing 10 cells: it follows
    for (let i = 0; i < 120; i++)
      c.update(0, floor - (i / 120) * 10 * CELL, 0, -80, 1, false, 1 / 30);
    expect(c.y).toBeLessThan(y0 - 6 * CELL);
  });

  it('snaps on a teleport', () => {
    const c = new GameCamera();
    c.snap(0, 0, 1);
    c.update(100 * CELL, 0, 0, 0, 1, true, 1 / 60);
    expect(Math.abs(c.x - 100 * CELL)).toBeLessThan(4 * CELL);
  });
});

/** A flat floor of 40 cells at row 10, as a ChunkWorld. */
function floorWorld(): ChunkWorld {
  const w = new ChunkWorld([0, 0, 2, 1]);
  for (const cx of [0, 1]) {
    const cells = new Uint8Array(1024);
    for (let x = 0; x < 32; x++) cells[10 * 32 + x] = 1;
    w.loadCells(cx, 0, cells);
  }
  return w;
}

describe('runner pictures', () => {
  const durations = (c: string): number =>
    ({ run: 19 / 30, idle: 145 / 30, start: 31 / 30 })[c] ?? 1;

  it('interpolates the anchor, follows the run cycle and restarts clips on a new move', () => {
    const world = floorWorld(),
      s = createRunner(rules, 5 * CELL, 10 * CELL, 1),
      prev = new Int32Array(s.length),
      p = createPicture();
    const st = createStatics({ regions: [], hubs: [], startHub: -1 });
    let starts = 0,
      lastClip = '';
    for (let i = 0; i < 90; i++) {
      prev.set(s);
      expect(stepRunner(s, Key.RIGHT, null, world, rules, st)).toBe(true);
      picture(rules, prev, s, 0.5, durations, p);
      expect(p.x).toBeCloseTo((prev[R.X]! + s[R.X]!) / 2, 6);
      expect(p.time).toBeGreaterThanOrEqual(0);
      if (p.clip !== lastClip) {
        starts++;
        lastClip = p.clip;
        // a clip entered in the last step starts at its beginning (a cycle keeps its distance)
        if (p.clip !== 'run') expect(p.time).toBeLessThan(0.2);
      }
      if (p.clip === 'run') {
        const cyc = s[R.CYCLE]! / rules.stride[s[R.MOVE]!]!;
        expect(p.time).toBeLessThanOrEqual(durations('run') + 1e-9);
        expect(cyc).toBeGreaterThanOrEqual(0);
      }
    }
    expect(starts).toBeGreaterThanOrEqual(2);
    expect(lastClip).toBe('run');
  });

  it('does not interpolate across a teleport', () => {
    const a = createRunner(rules, 0, 0, 1),
      b = createRunner(rules, 50 * CELL, 0, 1),
      p = createPicture();
    picture(rules, a, b, 0.5, () => 1, p);
    expect(p.x).toBe(50 * CELL);
  });
});

describe('clip plan', () => {
  it('draws every move with an exported clip, a stand-in, or idle and fall', () => {
    const exported = new Set(
      (
        JSON.parse(
          readFileSync(new URL('../../content/clips/classic/index.json', import.meta.url), 'utf8'),
        ) as { clips: { name: string }[] }
      ).clips.map((c) => c.name),
    );
    const plan = planClips(rules, (c) => exported.has(c), new Map([['ladderTop', 'jump']]));
    expect(plan.clips).toHaveLength(rules.moveNames.length);
    for (const c of plan.clips) expect(exported.has(c) || c === 'idle' || c === 'fall').toBe(true);
    const of = (move: string): string => plan.clips[rules.moveNames.indexOf(move)]!;
    expect(of('run')).toBe('run');
    if (rules.moveNames.includes('tigerJump') && !exported.has('tigerJump')) {
      expect(of('tigerJump')).toBe('jump');
    }
    if (rules.moveNames.includes('vault') && !exported.has('vault'))
      expect(of('vault')).toBe('monkeyVault');
    for (const [move, want, got] of plan.substituted) {
      expect(got).not.toBe(want);
      expect(of(move)).toBe(got);
    }
  });
});

describe('chunk streaming', () => {
  it('loads the chunks around the centre, fills unbaked ones with air and drops far ones', async () => {
    const s = syntheticWorld(),
      files = new Map(s.chunks.map((c) => [`chunks/${c.cx}-${c.cy}.json`, c])),
      loads: string[] = [],
      unloads: string[] = [];
    const world = { ...s.world, bounds: [0, 0, 8, 2] as [number, number, number, number] };
    const st = new ChunkStreamer(world, async (f) => files.get(f) as ChunkFile, {
      load: (c) => loads.push(`${c.cx},${c.cy}`),
      loadEmpty: (cx, cy) => loads.push(`air ${cx},${cy}`),
      unload: (cx, cy) => unloads.push(`${cx},${cy}`),
    });
    st.update(0, 0, 0, 0);
    await new Promise((r) => setTimeout(r, 0));
    st.update(0, 0, 0, 0);
    await new Promise((r) => setTimeout(r, 0));
    st.update(0, 0, 0, 0);
    expect(loads.sort()).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1']);
    // nothing changed: nothing is done
    const before = loads.length;
    st.update(0, 0, 0, 0);
    expect(loads.length).toBe(before);
    st.update(7, 0, 7, 0);
    expect(loads).toContain('air 7,0');
    expect(unloads.sort()).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1']);
    expect(st.has(2, 0)).toBe(false);
  });
});

describe('observers', () => {
  it('reports regions, hubs, finds and a time trial with splits', () => {
    const s = syntheticWorld(),
      w = s.world,
      found = new Set<string>(),
      hubs = new Set<string>(),
      o = new Observers(w, createStatics(w), found, hubs),
      r = createRunner(rules, 0, 0, 1),
      events: GameEvent[] = [];
    const at = (cx: number, cy: number): void => {
      r[R.STEP] = r[R.STEP]! + 1;
      r[R.X] = cx * CELL + CELL / 2;
      r[R.Y] = (cy + 1) * CELL;
      events.push(...o.step(r, rules));
    };
    at(15, 43); // the rooftops hub
    at(17, 43);
    for (let x = 18; x <= 42; x++) at(x, 43); // along the route
    at(44, 21); // the tower top find
    at(66, 43); // the warehouses
    const kinds = events.map((e) => e.kind);
    expect(kinds.slice(0, 3)).toEqual(['region', 'hub', 'discover']);
    expect(events[2]).toEqual({ kind: 'discover', hub: 0 });
    expect(kinds).toContain('hubLeave');
    const cps = events.filter((e) => e.kind === 'checkpoint');
    expect(cps.map((e) => (e.kind === 'checkpoint' ? e.index : -1))).toEqual([0, 1]);
    const fin = events.find((e) => e.kind === 'finish');
    expect(fin).toEqual({ kind: 'finish', route: 0, steps: 42 - 18, splits: [31 - 18, 38 - 18] });
    expect(events).toContainEqual({ kind: 'find', find: 0 });
    expect(found.has('tower-top')).toBe(true);
    expect(events).toContainEqual({ kind: 'region', region: 1, district: 'warehouses' });
    expect(hubs).toEqual(new Set(['rooftops', 'warehouses']));
  });

  /** An observer on the synthetic world and a way to put its runner's feet in a cell. */
  const trial = () => {
    const s = syntheticWorld(),
      o = new Observers(s.world, createStatics(s.world), new Set(), new Set()),
      r = createRunner(rules, 0, 0, 1),
      events: GameEvent[] = [];
    const at = (cx: number, cy: number): void => {
      r[R.STEP] = r[R.STEP]! + 1;
      r[R.X] = cx * CELL + CELL / 2;
      r[R.Y] = (cy + 1) * CELL;
      events.push(...o.step(r, rules));
    };
    const kinds = (): string[] => events.map((e) => e.kind);
    return { o, at, events, kinds };
  };
  // the ruleset's grace: steps outside every corridor rect a run survives
  const grace = rules.params.corridorGrace ?? 20;

  it("keeps the sim's observer state at its full size", () => {
    expect(trial().o.sim.length).toBe(OBSERVER_WORDS);
  });

  it('cancels a time trial that stays outside its corridor longer than the grace', () => {
    const { o, at, kinds } = trial();
    at(17, 43);
    at(18, 43); // the start gate
    expect(o.run).not.toBeNull();
    expect(o.graceLeft(rules)).toBe(1);
    for (let i = 0; i < grace; i++) at(19, 5);
    expect(kinds()).not.toContain('routeCancel');
    expect(o.run).not.toBeNull();
    expect(o.graceLeft(rules)).toBeCloseTo(1 / (grace + 1), 5);
    at(19, 5);
    expect(kinds()).toContain('routeCancel');
    expect(o.run).toBeNull();
    expect(o.graceLeft(rules)).toBe(1);
  });

  it('keeps a time trial through a short excursion off its corridor', () => {
    const { o, at, events, kinds } = trial();
    at(17, 43);
    at(18, 43);
    for (let i = 0; i < Math.floor(grace / 2); i++) at(20, 5);
    expect(o.graceLeft(rules)).toBeLessThan(1);
    expect(o.graceLeft(rules)).toBeGreaterThan(0.4);
    at(21, 43); // back inside: the grace starts over
    expect(o.graceLeft(rules)).toBe(1);
    for (let i = 0; i < grace; i++) at(22, 5);
    for (let x = 23; x <= 42; x++) at(x, 43);
    expect(kinds()).not.toContain('routeCancel');
    expect(events.find((e) => e.kind === 'finish')).toMatchObject({ kind: 'finish', route: 0 });
  });
});

describe('profile', () => {
  it('unlocks costumes and hair by finds', () => {
    expect(unlocked(0)).toEqual({ costumes: ['classic'], hairs: ['hairRed'] });
    expect(unlocked(6).costumes).toEqual(['classic', 'tee', 'hoodie']);
    expect(unlocked(12).hairs).toEqual(['hairRed', 'hairShort']);
    expect(newUnlocks(2, 3).map((u) => u.id)).toEqual(['tee']);
    expect(allowedLook({ hair: 'hairShort', costume: 'summer' }, 3)).toEqual({
      hair: 'hairRed',
      costume: 'classic',
    });
  });

  it('repairs a malformed stored profile field by field', () => {
    const p = loadProfile({
      getItem: () =>
        JSON.stringify({
          token: 'abcdefgh12',
          name: 'A very long name for a runner',
          look: { hair: 'bald', costume: 'tee' },
          finds: ['a', 3],
          best: { r: 90, bad: -1 },
          settings: { volume: 4, touch: 'on' },
        }),
    });
    expect(p.token).toBe('abcdefgh12');
    expect(p.name).toHaveLength(16);
    expect(p.look).toEqual({ hair: 'hairRed', costume: 'classic' });
    expect(p.finds).toEqual(['a']);
    expect(p.best).toEqual({ r: 90 });
    expect(p.settings.volume).toBe(1);
    expect(p.settings.touch).toBe('on');
    expect(loadProfile({ getItem: () => '{nope' }).token).toHaveLength(32);
  });

  it('formats steps as minutes, seconds and hundredths', () => {
    expect(formatSteps(30)).toBe('0:01.00');
    expect(formatSteps(1805)).toBe('1:00.17');
  });
});

describe('route recorder', () => {
  const st = (x: number, move: number, facing: number): Int32Array => {
    const s = createRunner(rules, x, 10 * CELL, facing);
    s[R.MOVE] = move;
    s[R.GROUND] = 2;
    return s;
  };
  const spawn = rules.roles.spawn,
    other = spawn + 1,
    meta = {
      name: 'Test',
      district: 'rooftops',
      look: { hair: 'hairRed', costume: 'classic' },
    } as const;

  it('begins only while the runner stands still in the spawn move on the ground', () => {
    expect(cannotBegin(st(0, spawn, 1), rules)).toBeNull();
    expect(cannotBegin(st(0, other, 1), rules)).not.toBeNull();
    const moving = st(0, spawn, 1);
    moving[R.VX] = 40;
    expect(cannotBegin(moving, rules)).not.toBeNull();
    const air = st(0, spawn, 1);
    air[R.GROUND] = 0;
    expect(cannotBegin(air, rules)).not.toBeNull();
  });

  it('trims at the last step back within a cell in the same move and facing', () => {
    const rec = new RouteRecorder();
    rec.begin(st(1000, spawn, 1), rules);
    // out and back past the start: within a cell (1024 units) from step 73 to 127; step 120 is
    // in another move and step 127 faces the other way, so the loop closes at step 126
    for (let i = 1; i <= 150; i++) {
      const x = 1000 + Math.abs(100 - i) * 37;
      rec.record(i % 7 ? Key.RIGHT : 0, st(x, i === 120 ? other : spawn, i === 127 ? -1 : 1));
    }
    expect(rec.trim()).toEqual({ steps: 126, gap: 26 * 37 });
    const out = rec.finish(meta)!;
    expect(out.file.runs.reduce((a, r) => a + r.steps, 0)).toBe(126);
    expect(out.file.start).toEqual({ x: 1000, y: 10 * CELL, facing: 1 });
    expect(rec.recording).toBe(false);
  });

  it('refuses a recording that never comes back or is shorter than a second', () => {
    const rec = new RouteRecorder();
    rec.begin(st(0, spawn, 1), rules);
    for (let i = 0; i < MIN_LOOP_STEPS + 10; i++) rec.record(0, st((i + 1) * CELL * 2, spawn, 1));
    expect(rec.finish(meta)).toBeNull();
    rec.begin(st(0, spawn, 1), rules);
    for (let i = 0; i < MIN_LOOP_STEPS - 1; i++) rec.record(0, st(0, spawn, 1));
    expect(rec.finish(meta)).toBeNull();
  });
});
