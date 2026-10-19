/**
 * Golden traces of the gym: every move of the table is reachable, every scenario's input log
 * replays to the recorded hashes, and the same logs give identical per-step hashes on the gym
 * baked as one grid and as streamed chunks with loads and unloads.
 *
 * After an intended change to the move table or the simulation, accept the new traces with
 * `UPDATE_GOLDEN=1 npx vitest run packages/tools` and review the diff of `golden/gym.json`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { CHUNK_CELLS, type InputRun } from '@parapet-world/schemas';
import {
  ChunkWorld,
  R,
  copyRunner,
  decodeInputLog,
  encodeInputLog,
  enterRole,
  fnvWord,
  FNV_OFFSET,
  hashRunner,
  runnerCellX,
  runnerCellY,
  stepRunner,
} from '@parapet-world/sim';
import { bakeWorld } from './bake.ts';
import { loadContent } from './content.ts';
import {
  CONTENT_ROOT,
  SCENARIOS,
  loadGym,
  movesEntered,
  runScenario,
  scenarioStart,
  type StepRecord,
} from './gym.ts';

const GOLDEN = new URL('./golden/gym.json', import.meta.url);
const UPDATE = process.env.UPDATE_GOLDEN === '1';
/** Every this many steps a trace keeps a hash, to locate a divergence. */
const CHECKPOINT = 16;

interface GoldenScenario {
  steps: number;
  input: InputRun[];
  /** [step, move] for every move entered. */
  entered: Array<[number, string]>;
  /** FNV-1a over every step's runner hash. */
  chain: number;
  checkpoints: number[];
  final: { move: string; x: number; y: number };
}

interface GoldenFile {
  comment: string;
  ruleset: number;
  scenarios: Record<string, GoldenScenario>;
}

function summarize(trace: StepRecord[]): GoldenScenario {
  let chain = FNV_OFFSET;
  const checkpoints: number[] = [];
  const entered: Array<[number, string]> = [];
  trace.forEach((r, i) => {
    chain = fnvWord(chain, r.hash);
    if (i % CHECKPOINT === CHECKPOINT - 1) checkpoints.push(r.hash);
    for (const m of r.entered) entered.push([i, m]);
  });
  const last = trace[trace.length - 1]!;
  return {
    steps: trace.length,
    input: encodeInputLog(trace.map((r) => r.held)),
    entered,
    chain: chain >>> 0,
    checkpoints,
    final: { move: last.move, x: last.x, y: last.y },
  };
}

const gym = loadGym(CONTENT_ROOT);
const runs = SCENARIOS.map((sc) => ({ sc, run: runScenario(gym, sc) }));

describe('gym scenarios', () => {
  for (const { sc, run } of runs) {
    it(`${sc.name} enters ${sc.expect.join(', ')}`, () => {
      expect(run.stuck, `hold ${run.stuck} never finished`).toBe(-1);
      const got = movesEntered(run.trace);
      expect(sc.expect.filter((m) => !got.has(m))).toEqual([]);
    });
  }

  it('reach every move of the table (frozen is entered by role)', () => {
    const all = new Set<string>();
    for (const { run } of runs) for (const m of movesEntered(run.trace)) all.add(m);
    const s = scenarioStart(gym, SCENARIOS[0]!);
    enterRole(s, gym.rules, 'frozen', gym.statics);
    all.add(gym.rules.moveNames[s[R.MOVE]!]!);
    const unseen = gym.rules.moveNames.filter(
      (m, i) => !(gym.rules.source.moves[i]!.abstract ?? false) && !all.has(m),
    );
    expect(unseen).toEqual([]);
  });
});

describe('golden traces', async () => {
  const current: GoldenFile = {
    comment:
      'Golden traces of the gym scenarios (packages/tools/src/bake/gym.ts). Regenerate with UPDATE_GOLDEN=1 npx vitest run packages/tools after an intended change.',
    ruleset: gym.rules.hash,
    scenarios: Object.fromEntries(runs.map(({ sc, run }) => [sc.name, summarize(run.trace)])),
  };
  if (UPDATE || !existsSync(GOLDEN)) {
    // Written in prettier's style so `npm run format:check` stays green.
    const text = await format(JSON.stringify(current), { parser: 'json', printWidth: 100 });
    writeFileSync(GOLDEN, text);
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as GoldenFile;

  for (const { sc } of runs) {
    it(`${sc.name} matches its golden trace`, () => {
      const want = golden.scenarios[sc.name];
      expect(want, `no golden trace for ${sc.name}: run with UPDATE_GOLDEN=1`).toBeDefined();
      const got = current.scenarios[sc.name]!;
      const firstDiff = got.checkpoints.findIndex((h, i) => h !== want!.checkpoints[i]);
      expect(
        { ...got, firstDivergence: firstDiff < 0 ? null : firstDiff * CHECKPOINT },
        'the trace changed: review it and accept with UPDATE_GOLDEN=1',
      ).toEqual({ ...want, firstDivergence: null });
    });

    it(`${sc.name} replays its recorded input exactly`, () => {
      const want = golden.scenarios[sc.name]!;
      const replay = runScenario(gym, sc, decodeInputLog(want.input));
      expect(summarize(replay.trace).chain).toBe(want.chain);
    });
  }
});

describe('determinism over the gym', () => {
  it('save and restore mid-scenario continues identically', () => {
    for (const { sc, run } of runs) {
      const held = run.trace.map((r) => r.held);
      const s = scenarioStart(gym, sc);
      const cut = held.length >> 1;
      for (let i = 0; i < cut; i++)
        stepRunner(s, held[i]!, null, gym.world, gym.rules, gym.statics);
      const saved = copyRunner(s);
      for (let i = cut; i < held.length; i++) {
        stepRunner(saved, held[i]!, null, gym.world, gym.rules, gym.statics);
        expect(hashRunner(saved)).toBe(run.trace[i]!.hash);
      }
    }
  });

  it('one grid and streamed chunks with loads and unloads give identical per-step hashes', () => {
    const content = loadContent(CONTENT_ROOT);
    const baked = bakeWorld(content, content.gym);
    const files = baked.chunks.map((c) => c.file);
    let stalls = 0;
    for (const { sc, run } of runs) {
      const world = new ChunkWorld(baked.index.bounds);
      const s = scenarioStart(gym, sc);
      run.trace.forEach((r, i) => {
        const cx = Math.floor(runnerCellX(s) / CHUNK_CELLS);
        const cy = Math.floor(runnerCellY(s) / CHUNK_CELLS);
        while (!stepRunner(s, r.held, null, world, gym.rules, gym.statics)) {
          stalls++;
          for (const f of files) {
            if (Math.abs(f.cx - cx) <= 1 && Math.abs(f.cy - cy) <= 1) world.load(f);
          }
        }
        for (const f of files) {
          if (Math.abs(f.cx - cx) > 1 || Math.abs(f.cy - cy) > 1) world.unload(f.cx, f.cy);
        }
        expect(hashRunner(s), `${sc.name} step ${i}`).toBe(r.hash);
      });
    }
    expect(stalls).toBeGreaterThan(0);
  });
});
