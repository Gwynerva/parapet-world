/**
 * Small numeric helpers. Hot-path functions write into caller-owned typed arrays at an offset, so
 * a frame allocates nothing. Matrices are 4 x 4, column-major (WebGL's order); quaternions are
 * (x, y, z, w).
 */

/** A 3-vector for code that runs once (mesh building); per-frame code uses typed arrays. */
export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** out[o..o+15] = a[ao..ao+15] * b[bo..bo+15]; `out` may alias neither input. */
export function mat4Mul(
  out: Float32Array,
  o: number,
  a: Float32Array,
  ao: number,
  b: Float32Array,
  bo: number,
): void {
  for (let c = 0; c < 4; c++) {
    const b0 = b[bo + c * 4]!,
      b1 = b[bo + c * 4 + 1]!,
      b2 = b[bo + c * 4 + 2]!,
      b3 = b[bo + c * 4 + 3]!;
    for (let r = 0; r < 4; r++) {
      out[o + c * 4 + r] =
        a[ao + r]! * b0 + a[ao + 4 + r]! * b1 + a[ao + 8 + r]! * b2 + a[ao + 12 + r]! * b3;
    }
  }
}

/** A rotation by the quaternion at q[qo..qo+3] followed by a translation, into out[o..o+15]. */
export function mat4FromQuat(
  out: Float32Array,
  o: number,
  q: Float32Array,
  qo: number,
  tx: number,
  ty: number,
  tz: number,
): void {
  const x = q[qo]!,
    y = q[qo + 1]!,
    z = q[qo + 2]!,
    w = q[qo + 3]!;
  out[o] = 1 - 2 * (y * y + z * z);
  out[o + 1] = 2 * (x * y + z * w);
  out[o + 2] = 2 * (x * z - y * w);
  out[o + 3] = 0;
  out[o + 4] = 2 * (x * y - z * w);
  out[o + 5] = 1 - 2 * (x * x + z * z);
  out[o + 6] = 2 * (y * z + x * w);
  out[o + 7] = 0;
  out[o + 8] = 2 * (x * z + y * w);
  out[o + 9] = 2 * (y * z - x * w);
  out[o + 10] = 1 - 2 * (x * x + y * y);
  out[o + 11] = 0;
  out[o + 12] = tx;
  out[o + 13] = ty;
  out[o + 14] = tz;
  out[o + 15] = 1;
}

/**
 * Spherical interpolation of the quaternions a[ao..] and b[bo..] into out[o..], along the shorter
 * arc; nearly equal quaternions fall back to a normalised linear blend.
 */
export function quatSlerp(
  out: Float32Array,
  o: number,
  a: Float32Array,
  ao: number,
  b: Float32Array,
  bo: number,
  t: number,
): void {
  const ax = a[ao]!,
    ay = a[ao + 1]!,
    az = a[ao + 2]!,
    aw = a[ao + 3]!;
  let bx = b[bo]!,
    by = b[bo + 1]!,
    bz = b[bo + 2]!,
    bw = b[bo + 3]!;
  let d = ax * bx + ay * by + az * bz + aw * bw;
  if (d < 0) {
    d = -d;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka: number, kb: number;
  if (d > 0.9995) {
    ka = 1 - t;
    kb = t;
  } else {
    const th = Math.acos(d),
      s = Math.sin(th);
    ka = Math.sin((1 - t) * th) / s;
    kb = Math.sin(t * th) / s;
  }
  const x = ax * ka + bx * kb,
    y = ay * ka + by * kb,
    z = az * ka + bz * kb,
    w = aw * ka + bw * kb;
  const l = Math.hypot(x, y, z, w) || 1;
  out[o] = x / l;
  out[o + 1] = y / l;
  out[o + 2] = z / l;
  out[o + 3] = w / l;
}
