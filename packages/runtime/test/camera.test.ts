import { describe, expect, it } from 'vitest';
import { cameraDistance } from '@parapet-world/schemas';
import {
  createView,
  project,
  projectFb,
  runnerMatrix,
  updateView,
  worldMatrix,
  type View,
} from '../src/camera.ts';

const apply = (
  m: Float32Array,
  x: number,
  y: number,
  z: number,
): [number, number, number, number] => [
  m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
  m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
  m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  m[3]! * x + m[7]! * y + m[11]! * z + m[15]!,
];
let seed = 3;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const views = (): View[] => {
  const out: View[] = [];
  for (const [cw, ch] of [
    [1024, 576],
    [1366, 768],
    [800, 600],
    [2560, 1080],
  ] as const) {
    for (let i = 0; i < 4; i++) {
      const v = createView();
      updateView(v, cw, ch, 683, 384, 4000 * rnd() - 300, 3000 * rnd() - 200, 0.15, 16, 0.5);
      out.push(v);
    }
  }
  return out;
};
const pt = { x: 0, y: 0 };

describe('camera', () => {
  it('shows at least the logical resolution and fills the drawing buffer', () => {
    for (const v of views()) {
      expect(v.lw).toBeGreaterThanOrEqual(683 - 1e-9);
      expect(v.lh).toBeGreaterThanOrEqual(384 - 1e-9);
      expect(v.lw * v.scale).toBeCloseTo(v.cw, 6);
      expect(v.fbW).toBeGreaterThanOrEqual(v.lw + v.fracX);
      expect(v.fbH).toBeGreaterThanOrEqual(v.lh + v.fracY);
    }
  });

  it('keeps front faces pixel-exact in the framebuffer', () => {
    for (const v of views()) {
      for (let i = 0; i < 20; i++) {
        const x = Math.round(v.camX + (rnd() - 0.5) * 800),
          y = Math.round(v.camY + (rnd() - 0.5) * 500);
        projectFb(v, x, y, 0, pt);
        expect(Math.abs(pt.x - Math.round(pt.x))).toBeLessThan(1e-6);
        expect(Math.abs(pt.y - Math.round(pt.y))).toBeLessThan(1e-6);
      }
    }
  });

  it('moves a point 32 px deep the perspective strength toward the centre', () => {
    for (const p of [0.05, 0.15, 0.3]) {
      const v = createView();
      updateView(v, 1366, 768, 683, 384, 500, 700, p, 16, 0.5);
      project(v, 800, 400, 0, pt);
      const fx = pt.x - v.lw / 2,
        fy = pt.y - v.lh / 2;
      project(v, 800, 400, -32, pt);
      expect(1 - (pt.x - v.lw / 2) / fx).toBeCloseTo(p, 9);
      expect(1 - (pt.y - v.lh / 2) / fy).toBeCloseTo(p, 9);
      expect(v.invF).toBeCloseTo(1 / cameraDistance(p), 12);
    }
    const flat = createView();
    updateView(flat, 1366, 768, 683, 384, 500, 700, 0, 16, 0.5);
    expect(flat.invF).toBe(0);
    expect(flat.runnerK).toBe(1);
  });

  it('maps the world pass to the framebuffer as the projection says, from any chunk origin', () => {
    const m = new Float32Array(16);
    for (const v of views()) {
      const ox = Math.floor(v.camX / 1024) * 1024,
        oy = Math.floor(v.camY / 1024) * 1024;
      worldMatrix(v, ox, oy, m);
      for (let i = 0; i < 10; i++) {
        const x = v.camX + (rnd() - 0.5) * 700,
          y = v.camY + (rnd() - 0.5) * 400,
          z = -rnd() * 32;
        const c = apply(m, x - ox, y - oy, z),
          fx = ((c[0] / c[3] + 1) / 2) * v.fbW,
          fy = ((1 - c[1] / c[3]) / 2) * v.fbH;
        projectFb(v, x, y, z, pt);
        expect(fx).toBeCloseTo(pt.x, 3);
        expect(fy).toBeCloseTo(pt.y, 3);
        // nearer is smaller in depth, everything in range
        const zn = c[2] / c[3];
        expect(zn).toBeGreaterThan(-1);
        expect(zn).toBeLessThan(1);
        const back = apply(m, x - ox, y - oy, z - 4);
        expect(back[2] / back[3]).toBeGreaterThan(zn);
      }
    }
  });

  it('puts runners on the same spot as the shifted, upscaled world at the runner depth', () => {
    const m = new Float32Array(16);
    for (const v of views()) {
      // a rig point: x forward, y up, z toward the viewer, from an anchor in world px
      const ax = v.camX + 123.25,
        ay = v.camY + 77.5;
      runnerMatrix(v, ax, ay, m);
      for (const [rx, ry, rz] of [
        [0, 0, 0],
        [3, 20, 4],
        [-6, 50, -5],
      ] as const) {
        const c = apply(m, rx, ry, rz),
          dx = ((c[0] / c[3] + 1) / 2) * v.cw,
          dy = ((1 - c[1] / c[3]) / 2) * v.ch;
        // the world pass draws the same point into the framebuffer; the upscale shifts it back
        projectFb(v, ax + rx, ay - ry, v.runnerZ + rz, pt);
        expect(dx).toBeCloseTo((pt.x - v.fracX) * v.scale, 3);
        expect(dy).toBeCloseTo((pt.y - v.fracY) * v.scale, 3);
      }
    }
  });
});
