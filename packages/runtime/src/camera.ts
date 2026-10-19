/**
 * The camera: a perspective view of the slab, pulled toward the screen centre the way Gravity
 * Defied turns track lines into planks. World space for drawing is world px with y down and z
 * toward the viewer: front faces at z = 0, the slab's back at z = -slabDepth, runners and props
 * at z = -runnerDepth * slabDepth. A point at depth d is drawn at
 *
 *   screen = centre + (world - camera) * F / (F + d),   F = cameraDistance(perspective),
 *
 * so front faces stay pixel-exact and a point 32 px deep moves `perspective` of the way toward the
 * centre. The world is drawn into a logical framebuffer with the camera snapped to whole logical
 * pixels; the remainder shifts the upscaled image, so runners and props, drawn at device
 * resolution with the exact camera, line up with it.
 */
import { cameraDistance } from '@parapet-world/schemas';

/** Depth range of the world pass in px toward (near) and away from (far) the viewer. */
const NEAR = 1;
const FAR = 128;

export interface View {
  /** The exact camera centre, world px. */
  camX: number;
  camY: number;
  /** The visible area in logical px (at least the logical resolution in both directions). */
  lw: number;
  lh: number;
  /** Device px per logical px. */
  scale: number;
  /** The drawing buffer, device px. */
  cw: number;
  ch: number;
  /** The world framebuffer, logical px: one more than the visible area, for the shift. */
  fbW: number;
  fbH: number;
  /** The world px at the framebuffer's top-left pixel. */
  left: number;
  top: number;
  /** How far the exact camera is past the snapped one, in logical px (0..1). */
  fracX: number;
  fracY: number;
  /** 1 / camera distance; 0 when the perspective is off. */
  invF: number;
  /** z (world px) of runners and props. */
  runnerZ: number;
  /** The perspective scale at the runner depth. */
  runnerK: number;
}

export const createView = (): View => ({
  camX: 0,
  camY: 0,
  lw: 1,
  lh: 1,
  scale: 1,
  cw: 1,
  ch: 1,
  fbW: 2,
  fbH: 2,
  left: 0,
  top: 0,
  fracX: 0,
  fracY: 0,
  invF: 0,
  runnerZ: 0,
  runnerK: 1,
});

/**
 * Fills `v` for a drawing buffer of cw x ch device px, a logical resolution, the exact camera
 * centre (world px) and the slab settings.
 */
export function updateView(
  v: View,
  cw: number,
  ch: number,
  logicalW: number,
  logicalH: number,
  camX: number,
  camY: number,
  perspective: number,
  slabDepth: number,
  runnerDepth: number,
): void {
  v.cw = cw;
  v.ch = ch;
  v.scale = Math.min(cw / logicalW, ch / logicalH);
  v.lw = cw / v.scale;
  v.lh = ch / v.scale;
  v.fbW = Math.ceil(v.lw) + 1;
  v.fbH = Math.ceil(v.lh) + 1;
  v.camX = camX;
  v.camY = camY;
  const x0 = camX - v.lw / 2,
    y0 = camY - v.lh / 2;
  v.left = Math.floor(x0);
  v.top = Math.floor(y0);
  v.fracX = x0 - v.left;
  v.fracY = y0 - v.top;
  const F = cameraDistance(perspective);
  v.invF = Number.isFinite(F) && F > 0 ? 1 / F : 0;
  v.runnerZ = -runnerDepth * slabDepth;
  v.runnerK = 1 / (1 - v.runnerZ * v.invF);
}

/**
 * The world pass's matrix into the logical framebuffer, for vertices relative to (ox, oy) world
 * px (a chunk's origin), so large world coordinates never meet float32 in the shader.
 */
export function worldMatrix(v: View, ox: number, oy: number, out: Float32Array): void {
  const a = 2 / v.fbW,
    b = 2 / v.fbH,
    c = a * (v.camX - v.left) - 1,
    d = 1 - b * (v.camY - v.top),
    tx = ox - v.camX,
    ty = oy - v.camY,
    invF = v.invF,
    // z = NEAR maps to -1 and z = -FAR to +1 after the divide
    A = -(2 + (FAR - NEAR) * invF) / (NEAR + FAR),
    B = 1 + FAR * invF + A * FAR;
  out.fill(0);
  out[0] = a;
  out[8] = -c * invF;
  out[12] = a * tx + c;
  out[5] = -b;
  out[9] = -d * invF;
  out[13] = -b * ty + d;
  out[10] = A;
  out[14] = B;
  out[11] = -invF;
  out[15] = 1;
}

/**
 * A runner's matrix from rig space (px, y up, z toward the viewer, relative to the anchor at
 * (ax, ay) world px) to the device clip space with the exact camera. Row 2 (z) is left empty:
 * the runner shader writes its own depth slice.
 */
export function runnerMatrix(v: View, ax: number, ay: number, out: Float32Array): void {
  const sx = 2 / v.lw,
    sy = 2 / v.lh;
  out.fill(0);
  out[0] = sx;
  out[12] = sx * (ax - v.camX);
  out[5] = sy;
  out[13] = -sy * (ay - v.camY);
  out[11] = -v.invF;
  out[15] = 1 - v.invF * v.runnerZ;
}

/** Logical screen position (px from the visible area's top-left) of a world point at depth z. */
export function project(v: View, x: number, y: number, z: number, out: { x: number; y: number }) {
  const k = 1 / (1 - z * v.invF);
  out.x = (x - v.camX) * k + v.lw / 2;
  out.y = (y - v.camY) * k + v.lh / 2;
  return out;
}

/** Framebuffer position of a world point (for checks): front faces land on whole pixels. */
export function projectFb(v: View, x: number, y: number, z: number, out: { x: number; y: number }) {
  project(v, x, y, z, out);
  out.x += v.fracX;
  out.y += v.fracY;
  return out;
}
