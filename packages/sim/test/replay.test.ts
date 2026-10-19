/** Input logs, determinism, save and restore, and chunk-border equality. */
import { Key, KEY_MASK } from '@parapet-world/schemas';
import { describe, expect, it } from 'vitest';
import {
  ChunkWorld,
  GridWorld,
  NO_STATICS,
  copyRunner,
  createRunner,
  decodeInputLog,
  encodeInputLog,
  gridChunks,
  hashRunner,
  inputLength,
  replayRunner,
  runnerCellX,
  runnerCellY,
  stepRunner,
} from '../src/index.ts';
import { CELL, rules } from './helpers.ts';

/** A small deterministic generator for test input. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 8;
  };
}

/** Held masks that mostly run right, with jumps, rolls, turns and pauses. */
function runnerInput(steps: number, seed: number): Uint8Array {
  const next = lcg(seed);
  const out = new Uint8Array(steps);
  let held: number = Key.RIGHT;
  for (let i = 0; i < steps; i++) {
    if (next() % 9 === 0) {
      const r = next() % 10;
      held =
        r < 5
          ? Key.RIGHT
          : r < 7
            ? Key.RIGHT | Key.UP
            : r === 7
              ? Key.RIGHT | Key.DOWN
              : r === 8
                ? Key.LEFT
                : 0;
    }
    out[i] = held;
  }
  return out;
}

/** A 3 x 2 chunk world (96 x 64 cells) whose terrain crosses both chunk borders. */
function borderWorld(): GridWorld {
  const w = 96;
  const h = 64;
  const g = new GridWorld(w, h);
  const set = (x: number, y: number, c: number) => g.set(x, y, c);
  const ground = 36;
  for (let x = 0; x < w; x++) for (let y = ground; y < h; y++) set(x, y, 1);
  // Gaps and steps around the chunk border at x = 32 and x = 64, platforms across y = 32.
  for (let x = 30; x < 33; x++) for (let y = ground; y < h; y++) set(x, y, 0);
  for (let x = 40; x < 44; x++) set(x, ground - 1, 5);
  for (let x = 50; x < 56; x++) set(x, 31, 2);
  set(60, ground - 1, 3);
  for (let x = 61; x < 66; x++) set(x, ground - 1, 1);
  set(66, ground - 1, 4);
  for (let x = 70; x < 80; x++) set(x, 33, 10);
  for (let y = 20; y < ground; y++) set(90, y, 1);
  return g;
}

describe('input log', () => {
  it('round-trips through run-length encoding', () => {
    const held = runnerInput(500, 7);
    const runs = encodeInputLog(held);
    expect(runs.length).toBeLessThan(150);
    expect(inputLength(runs)).toBe(500);
    expect(Array.from(decodeInputLog(runs))).toEqual(Array.from(held));
    expect(encodeInputLog([0, 0, 255, 255]).map((r) => r.held)).toEqual([0, KEY_MASK]);
  });
});

describe('determinism', () => {
  const rs = rules();
  const world = borderWorld();
  const start = createRunner(rs, 4 * CELL + 512, 36 * CELL, 1);

  it('the same log gives the same hashes', () => {
    for (const seed of [1, 2, 3]) {
      const runs = encodeInputLog(runnerInput(600, seed));
      const a = replayRunner(start, runs, [], world, rs, NO_STATICS);
      const b = replayRunner(start, runs, [], world, rs, NO_STATICS);
      expect(Array.from(a.hashes)).toEqual(Array.from(b.hashes));
      expect(a.state).toEqual(b.state);
    }
  });

  it('save and restore mid-run continues identically', () => {
    const held = runnerInput(400, 11);
    const s = copyRunner(start);
    const hashes: number[] = [];
    let saved: Int32Array | null = null;
    for (let i = 0; i < held.length; i++) {
      if (i === 173) saved = copyRunner(s);
      stepRunner(s, held[i]!, null, world, rs, NO_STATICS);
      hashes.push(hashRunner(s));
    }
    const r = copyRunner(saved!);
    for (let i = 173; i < held.length; i++) {
      stepRunner(r, held[i]!, null, world, rs, NO_STATICS);
      expect(hashRunner(r)).toBe(hashes[i]);
    }
  });

  it('a monolithic and a streamed world give identical per-step hashes', () => {
    const chunks = gridChunks(world);
    for (const seed of [21, 22, 23, 24]) {
      const held = runnerInput(700, seed);
      const mono = replayRunner(start, encodeInputLog(held), [], world, rs, NO_STATICS);
      const streamed = new ChunkWorld([0, 0, 3, 2]);
      const s = copyRunner(start);
      let stalls = 0;
      for (let i = 0; i < held.length; i++) {
        // Keep only the 3 x 3 chunks around the runner loaded, loading them one step late.
        const cx = runnerCellX(s) >> 5;
        const cy = runnerCellY(s) >> 5;
        while (!stepRunner(s, held[i]!, null, streamed, rs, NO_STATICS)) {
          stalls++;
          for (const c of chunks) {
            const near = Math.abs(c.cx - cx) <= 1 && Math.abs(c.cy - cy) <= 1;
            if (near) streamed.loadCells(c.cx, c.cy, c.cells);
          }
        }
        for (const c of chunks) {
          if (Math.abs(c.cx - cx) > 1 || Math.abs(c.cy - cy) > 1) streamed.unload(c.cx, c.cy);
        }
        expect(hashRunner(s)).toBe(mono.hashes[i]);
      }
      expect(stalls).toBeGreaterThan(0);
    }
  });
});
