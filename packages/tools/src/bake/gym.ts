/**
 * Scripted runs through the gym (`content/world/gym`): each scenario starts a runner in a gym room
 * and holds keys, for a number of steps or until a condition; the moves it enters prove that every
 * move of the table is reachable. The keys actually held become the golden trace's input log
 * (`gym.test.ts`), so a replay never depends on the conditions. For tuning,
 * `node packages/tools/src/bake/gym.ts [scenario]` prints a scenario step by step.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CELL, Key } from '@parapet-world/schemas';
import {
  GridWorld,
  R,
  createRunner,
  createStatics,
  hashRunner,
  loadRuleset,
  runnerView,
  simDebug,
  stepRunner,
  type RunnerState,
  type RunnerView,
  type Ruleset,
  type WorldStatics,
} from '@parapet-world/sim';
import { bakeWorld } from './bake.ts';
import { loadContent } from './content.ts';
import { gridWorld } from './validate.ts';

const L = Key.LEFT;
const Rt = Key.RIGHT;
const U = Key.UP;
const D = Key.DOWN;
const A = Key.ACTION;

/** What a condition sees: the view, the state and the x within the scenario's room in cells. */
export interface Probe {
  v: RunnerView;
  s: RunnerState;
  cx: number;
  cy: number;
}

/** Hold `held` for n steps, or until `until` holds (at most `max` steps, then the run fails). */
export type Hold = [number, number] | { held: number; until: (p: Probe) => boolean; max?: number };

export interface Scenario {
  name: string;
  /** Gym room (1-based, 32 cells wide each) and the cell the runner stands in (x may be a
   *  fraction of a cell). */
  room: number;
  cell: [number, number];
  facing: 1 | -1;
  input: Hold[];
  /** Moves the run must enter (instant ones count). */
  expect: string[];
}

const at = (move: string) => (p: Probe) => p.v.move === move;
const pastX = (x: number) => (p: Probe) => p.cx >= x;
const beforeX = (x: number) => (p: Probe) => p.cx <= x;

export const SCENARIOS: Scenario[] = [
  {
    name: 'ground',
    room: 1,
    cell: [3, 15],
    facing: 1,
    input: [
      [6, 0],
      [22, Rt],
      [18, 0],
      [16, L],
      [14, Rt],
      [10, 0],
    ],
    expect: ['idle', 'start', 'run', 'skid', 'turnFast', 'turnFlip', 'turn'],
  },
  {
    name: 'crash',
    room: 1,
    cell: [1, 15],
    facing: 1,
    input: [
      { held: Rt, until: at('crash'), max: 90 },
      { held: 0, until: at('idle'), max: 90 },
    ],
    expect: ['crash', 'crashFall', 'crashDown', 'getUp'],
  },
  {
    name: 'ledgeClimb',
    room: 1,
    cell: [12, 15],
    facing: 1,
    input: [
      [3, 0],
      [1, U],
      { held: 0, until: at('ledgeHang'), max: 20 },
      [4, 0],
      [1, U],
      { held: 0, until: at('idle'), max: 40 },
    ],
    expect: ['jump', 'ledgeGrab', 'ledgeHang', 'ledgeClimb'],
  },
  {
    name: 'ledgeDrop',
    room: 1,
    cell: [12, 15],
    facing: 1,
    input: [
      [3, 0],
      [1, U],
      { held: 0, until: at('ledgeHang'), max: 20 },
      [4, 0],
      [1, D],
      { held: 0, until: at('idle'), max: 40 },
    ],
    expect: ['ledgeDrop', 'fall', 'landSoft'],
  },
  {
    name: 'ledgeJumpBack',
    room: 1,
    cell: [12, 15],
    facing: 1,
    input: [
      [3, 0],
      [1, U],
      { held: 0, until: at('ledgeHang'), max: 20 },
      [4, 0],
      [1, L],
      { held: 0, until: at('idle'), max: 60 },
    ],
    expect: ['ledgeJumpBack'],
  },
  {
    name: 'wallRunTop',
    room: 1,
    cell: [15, 15],
    facing: 1,
    input: [
      { held: Rt, until: pastX(18.2), max: 30 },
      { held: Rt | U, until: at('wallRunTop'), max: 40 },
      { held: Rt | U, until: (p) => p.v.move !== 'wallRunTop', max: 40 },
      [6, Rt],
    ],
    expect: ['wallRun', 'wallRunTop'],
  },
  {
    name: 'wallRunLedge',
    room: 1,
    cell: [15, 15],
    facing: 1,
    input: [
      { held: Rt, until: pastX(18.2), max: 30 },
      [1, Rt | U],
      { held: Rt, until: at('ledgeHang'), max: 40 },
      [2, Rt],
      [1, U],
      { held: 0, until: at('idle'), max: 40 },
    ],
    expect: ['wallRun', 'ledgeGrab', 'ledgeHang', 'ledgeClimb'],
  },
  {
    name: 'wallFlip',
    room: 1,
    cell: [21, 15],
    facing: 1,
    input: [
      { held: Rt, until: pastX(24.2), max: 30 },
      [1, Rt | U],
      { held: Rt, until: (p) => p.v.move === 'wallRun' && p.v.timer > 4, max: 20 },
      [1, L],
      { held: 0, until: at('idle'), max: 80 },
    ],
    expect: ['wallRun', 'wallFlip'],
  },
  {
    name: 'ticTacShaft',
    room: 1,
    cell: [27, 15],
    facing: 1,
    input: [
      [2, 0],
      [1, U],
      [3, 0],
      ...Array.from({ length: 8 }, (): Hold[] => [
        {
          held: 0,
          until: (p) => p.v.onGround || (p.v.facing > 0 ? p.cx >= 27.2 : p.cx <= 26.8),
          max: 40,
        },
        [1, U],
      ]).flat(),
      { held: 0, until: (p) => p.v.onGround, max: 200 },
      [10, 0],
    ],
    expect: ['ticTac'],
  },
  {
    name: 'catwalks',
    room: 2,
    cell: [5, 15],
    facing: 1,
    input: [
      [3, 0],
      [1, U],
      { held: 0, until: at('idle'), max: 40 },
      [1, D],
      { held: 0, until: at('idle'), max: 40 },
    ],
    expect: ['jump', 'fall', 'landSoft', 'dropDown'],
  },
  {
    name: 'coyote',
    room: 2,
    cell: [12, 13],
    facing: 1,
    input: [
      { held: Rt, until: (p) => p.v.move === 'fall' && p.s[R.AIR_STEPS]! >= 2, max: 30 },
      [1, Rt | U],
      { held: Rt, until: (p) => p.v.onGround, max: 60 },
      [4, 0],
    ],
    expect: ['fall', 'jump'],
  },
  {
    name: 'landHard',
    room: 2,
    cell: [29, 9],
    facing: 1,
    input: [[7, Rt], { held: 0, until: at('idle'), max: 80 }],
    expect: ['landHard'],
  },
  {
    name: 'stumble',
    room: 2,
    cell: [25, 9],
    facing: 1,
    input: [
      { held: Rt, until: at('stumble'), max: 80 },
      { held: 0, until: at('idle'), max: 60 },
    ],
    expect: ['stumble'],
  },
  {
    name: 'roll',
    room: 2,
    cell: [25, 9],
    facing: 1,
    input: [
      { held: Rt, until: (p) => p.cy > 14.5, max: 60 },
      [1, Rt | D],
      { held: Rt, until: at('run'), max: 60 },
    ],
    expect: ['roll'],
  },
  {
    name: 'fatal',
    room: 2,
    cell: [25, 3],
    facing: 1,
    input: [
      { held: Rt, until: at('dead'), max: 120 },
      { held: 0, until: at('idle'), max: 120 },
    ],
    expect: ['dead', 'respawn'],
  },
  {
    name: 'slopes',
    room: 3,
    cell: [1, 15],
    facing: 1,
    input: [{ held: Rt, until: pastX(29), max: 200 }],
    expect: ['runUphill', 'runDownhill'],
  },
  {
    name: 'curbs',
    room: 4,
    cell: [1, 15],
    facing: 1,
    input: [{ held: Rt, until: pastX(28), max: 200 }],
    expect: ['stepOver'],
  },
  {
    name: 'flips',
    room: 4,
    cell: [26, 15],
    facing: -1,
    input: [
      [3, 0],
      [1, A],
      { held: 0, until: at('idle'), max: 60 },
      [1, U],
      [1, A],
      { held: 0, until: at('idle'), max: 60 },
      [1, U],
      [3, 0],
      [1, A],
      { held: 0, until: at('idle'), max: 60 },
      [1, U],
      [15, 0],
      [1, A],
      { held: 0, until: at('idle'), max: 90 },
    ],
    expect: ['backFlip', 'frontFlip', 'stumble', 'crashDown'],
  },
  {
    name: 'vaultTrip',
    room: 5,
    cell: [1, 15],
    facing: 1,
    input: [
      { held: Rt, until: pastX(4.75), max: 30 },
      [1, Rt | U],
      { held: Rt, until: at('trip'), max: 60 },
      { held: 0, until: at('idle'), max: 90 },
    ],
    expect: ['vault', 'trip', 'crashFall', 'crashDown', 'getUp'],
  },
  {
    name: 'monkeyVault',
    room: 5,
    cell: [20, 15],
    facing: 1,
    input: [
      { held: Rt, until: pastX(23.6), max: 60 },
      [1, Rt | U],
      { held: Rt, until: pastX(29), max: 60 },
    ],
    expect: ['monkeyVault'],
  },
  {
    name: 'postLedge',
    room: 5,
    cell: [17.3, 15],
    facing: 1,
    input: [
      [3, 0],
      [1, U],
      { held: 0, until: at('ledgeHang'), max: 20 },
      [8, 0],
      [1, D],
      { held: 0, until: at('idle'), max: 40 },
    ],
    expect: ['ledgeGrab', 'ledgeHang', 'ledgeDrop'],
  },
  {
    name: 'ladderUp',
    room: 6,
    cell: [9, 15],
    facing: 1,
    input: [
      [3, 0],
      { held: U, until: at('ladderTop'), max: 160 },
      { held: 0, until: at('idle'), max: 40 },
    ],
    expect: ['ladderEnter', 'ladderClimb', 'ladderTop'],
  },
  {
    name: 'ladderDown',
    room: 6,
    cell: [11, 5],
    facing: -1,
    input: [
      { held: L, until: beforeX(9.6), max: 30 },
      { held: D, until: at('ladderSlide'), max: 40 },
      [10, D],
      [6, 0],
      [1, Rt],
      { held: 0, until: at('idle'), max: 80 },
    ],
    expect: ['ladderEnter', 'ladderSlide', 'ladderClimb', 'ladderLeave'],
  },
  {
    name: 'poleSlide',
    room: 7,
    cell: [6, 15],
    facing: 1,
    input: [
      [3, 0],
      [1, U],
      { held: 0, until: at('poleSlide'), max: 20 },
      [2, 0],
      [1, U],
      { held: 0, until: at('idle'), max: 60 },
    ],
    expect: ['poleGrab', 'poleSlide', 'poleJump'],
  },
  {
    name: 'poleDrop',
    room: 7,
    cell: [6, 15],
    facing: 1,
    input: [
      [3, 0],
      [1, U],
      { held: 0, until: at('poleSlide'), max: 20 },
      [1, D],
      { held: 0, until: at('idle'), max: 60 },
    ],
    expect: ['poleGrab', 'letGo'],
  },
  {
    name: 'poleSpin',
    room: 7,
    cell: [12, 12],
    facing: 1,
    input: [
      { held: Rt, until: pastX(16.6), max: 30 },
      [1, Rt | U],
      { held: Rt, until: (p) => p.v.onGround && p.cx > 21, max: 80 },
      [4, 0],
    ],
    expect: ['poleSpin'],
  },
  {
    name: 'bars',
    room: 8,
    cell: [4, 15],
    facing: 1,
    input: [
      { held: Rt, until: pastX(8.3), max: 30 },
      [1, Rt | U],
      { held: Rt, until: at('barSwing'), max: 40 },
      [4, Rt],
      [1, Rt | U],
      { held: Rt, until: (p) => p.v.onGround, max: 60 },
      { held: Rt, until: pastX(20.3), max: 30 },
      [1, Rt | U],
      { held: Rt, until: at('barSwing'), max: 40 },
      [3, 0],
      [1, D],
      { held: 0, until: at('idle'), max: 160 },
    ],
    expect: ['barGrab', 'barSwing', 'barJump', 'letGo', 'dead'],
  },
  {
    name: 'slab',
    room: 9,
    cell: [1, 15],
    facing: 1,
    input: [
      { held: Rt, until: pastX(5.3), max: 30 },
      [1, Rt | D],
      { held: Rt, until: pastX(17), max: 80 },
    ],
    expect: ['slideUnder'],
  },
  {
    name: 'tigerJump',
    room: 10,
    cell: [11, 15],
    facing: 1,
    input: [
      { held: Rt, until: pastX(15.2), max: 40 },
      [3, 0],
      [1, Rt],
      { held: Rt, until: (p) => p.v.onGround && p.cx > 21, max: 60 },
      [6, Rt],
    ],
    expect: ['coast', 'tigerJump'],
  },
  {
    name: 'sewage',
    room: 10,
    cell: [12, 15],
    facing: 1,
    input: [
      { held: Rt, until: at('dead'), max: 60 },
      { held: 0, until: at('idle'), max: 120 },
    ],
    expect: ['dead', 'respawn'],
  },
];

export interface GymWorld {
  rules: Ruleset;
  world: GridWorld;
  statics: WorldStatics;
}

export function loadGym(root: string, rules?: Ruleset): GymWorld {
  const content = loadContent(root);
  const baked = bakeWorld(content, content.gym);
  const rs =
    rules ?? loadRuleset(JSON.parse(readFileSync(join(root, 'rules', 'moves.json'), 'utf8')));
  return { rules: rs, world: gridWorld(baked.world), statics: createStatics(baked.index) };
}

export interface StepRecord {
  held: number;
  move: string;
  x: number;
  y: number;
  facing: number;
  hash: number;
  /** Every move entered during the step, instant ones included. */
  entered: string[];
}

export interface ScenarioRun {
  trace: StepRecord[];
  /** A hold whose condition never came true, if any. */
  stuck: number;
}

export function scenarioStart(gym: GymWorld, sc: Scenario): RunnerState {
  return createRunner(
    gym.rules,
    Math.round(((sc.room - 1) * 32 + sc.cell[0]) * CELL + CELL / 2),
    (sc.cell[1] + 1) * CELL,
    sc.facing,
  );
}

/** Runs a scenario's holds (or, with `log`, exactly these held masks). */
export function runScenario(gym: GymWorld, sc: Scenario, log?: ArrayLike<number>): ScenarioRun {
  const { rules, world, statics } = gym;
  const s = scenarioStart(gym, sc);
  const trace: StepRecord[] = [];
  let entered: string[] = [];
  let stuck = -1;
  const step = (held: number) => {
    entered = [];
    stepRunner(s, held, null, world, rules, statics);
    const v = runnerView(s, rules);
    trace.push({
      held,
      move: v.move,
      x: v.x,
      y: v.y,
      facing: v.facing,
      hash: hashRunner(s),
      entered,
    });
  };
  const probe = (): Probe => ({
    v: runnerView(s, rules),
    s,
    cx: s[R.X]! / CELL - (sc.room - 1) * 32,
    cy: s[R.Y]! / CELL,
  });
  simDebug.onEnter = (_s, m) => entered.push(rules.moveNames[m]!);
  try {
    if (log) {
      for (let i = 0; i < log.length; i++) step(log[i]!);
    } else {
      sc.input.forEach((h, i) => {
        if (stuck >= 0) return;
        if (Array.isArray(h)) {
          for (let k = 0; k < h[0]; k++) step(h[1]);
          return;
        }
        const max = h.max ?? 200;
        let k = 0;
        while (!h.until(probe())) {
          if (k++ >= max) {
            stuck = i;
            return;
          }
          step(h.held);
        }
      });
    }
  } finally {
    simDebug.onEnter = null;
  }
  return { trace, stuck };
}

export function movesEntered(trace: StepRecord[]): Set<string> {
  const out = new Set<string>();
  for (const r of trace) for (const m of r.entered) out.add(m);
  if (trace.length > 0) out.add(trace[0]!.move);
  return out;
}

export const CONTENT_ROOT = fileURLToPath(new URL('../../../content/', import.meta.url));

export function keyNames(h: number): string {
  return [h & L ? 'L' : '', h & Rt ? 'R' : '', h & U ? 'U' : '', h & D ? 'D' : '', h & A ? 'A' : '']
    .join('')
    .padEnd(3);
}

function main(): void {
  const gym = loadGym(CONTENT_ROOT);
  const only = process.argv[2];
  const quiet = process.argv.includes('--summary');
  const all = new Set<string>();
  for (const sc of SCENARIOS) {
    if (only && only !== '--summary' && sc.name !== only) continue;
    const { trace, stuck } = runScenario(gym, sc);
    if (!quiet) {
      console.log(`== ${sc.name}`);
      trace.forEach((r, i) => {
        const cx = (r.x / CELL - (sc.room - 1) * 32).toFixed(2);
        const cy = (r.y / CELL).toFixed(2);
        const e = r.entered.length ? ` <- ${r.entered.join(', ')}` : '';
        const f = r.facing > 0 ? '>' : '<';
        console.log(
          `${String(i).padStart(4)} ${keyNames(r.held)} ${r.move.padEnd(13)} ${cx.padStart(6)} ${cy.padStart(6)} ${f}${e}`,
        );
      });
    }
    const got = movesEntered(trace);
    got.forEach((m) => all.add(m));
    const missing = sc.expect.filter((m) => !got.has(m));
    const status = [
      stuck >= 0 ? `stuck at hold ${stuck}` : '',
      missing.length ? `missing ${missing.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    console.log(`${sc.name}: ${status || 'ok'} (${trace.length} steps)`);
  }
  const unseen = gym.rules.moveNames.filter(
    (m, i) => !all.has(m) && !(gym.rules.source.moves[i]!.abstract ?? false),
  );
  console.log(`moves never entered: ${unseen.length ? unseen.join(', ') : 'none'}`);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main();
