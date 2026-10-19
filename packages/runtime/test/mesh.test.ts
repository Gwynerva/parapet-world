import { describe, expect, it } from 'vitest';
import { SKIN_HALF, SKIN_SHEET } from '@parapet-world/schemas';
import { buildBody, buildShell, VERTEX_FLOATS } from '../src/mesh.ts';

describe('runner mesh', () => {
  const body = buildBody();
  const d = body.data;

  it('matches the approved L2 body of the graphics demo', () => {
    // reference values computed from the demo's core.js (buildBody(LEVELS[0]))
    expect(body.triangles).toBe(1323);
    expect(body.head.reduce((a, b) => a + b, 0)).toBe(270);
    let sp = 0,
      sn = 0,
      su = 0,
      sb = 0,
      sh = 0;
    for (let i = 0; i < d.length; i += VERTEX_FLOATS) {
      sp += d[i]! + d[i + 1]! * 2 + d[i + 2]! * 3;
      sn += d[i + 3]! + d[i + 4]! * 2 + d[i + 5]! * 3;
      su += d[i + 6]! + d[i + 7]! * 2;
      sb += d[i + 8]!;
      sh += d[i + 9]! + d[i + 10]! * 2 + d[i + 11]! * 3;
    }
    expect(sp).toBeCloseTo(4389.5699, 1);
    expect(sn).toBeCloseTo(303.7437, 1);
    expect(su).toBeCloseTo(3831.2258, 1);
    expect(sb).toBe(23019);
    expect(sh).toBeCloseTo(90.81, 1);
    expect(Array.from(d.slice(0, 12)).map((x) => +x.toFixed(4))).toEqual([
      4.2105, 10.4415, 3.5218, 0.7347, 0.4937, 0.4653, 0.0002, 0.1017, 2, 0.5717, 0.539, 0.6186,
    ]);
  });

  it('keeps every base uv in the base half of the sheet', () => {
    for (let i = 0; i < d.length; i += VERTEX_FLOATS) {
      expect(d[i + 6]!).toBeGreaterThanOrEqual(0);
      expect(d[i + 6]!).toBeLessThanOrEqual(1);
      expect(d[i + 7]!).toBeGreaterThanOrEqual(0);
      expect(d[i + 7]!).toBeLessThanOrEqual(SKIN_HALF / SKIN_SHEET);
    }
  });

  it('builds shell triangles only where the overlay is opaque', () => {
    const none = new Uint8Array(SKIN_SHEET * SKIN_HALF);
    expect(buildShell(body, none).length).toBe(0);
    const all = new Uint8Array(SKIN_SHEET * SKIN_HALF).fill(1);
    const shell = buildShell(body, all);
    expect(shell.length).toBe(d.length);
    // moved to the overlay half and pushed out along the hull normal
    expect(shell[7]!).toBeCloseTo(d[7]! + 0.5, 6);
    const k = body.head[0] ? 1.0 : 0.7;
    expect(shell[0]!).toBeCloseTo(d[0]! + d[9]! * k, 5);
  });
});
