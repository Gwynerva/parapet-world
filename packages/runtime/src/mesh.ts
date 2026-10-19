/**
 * The L2 runner mesh: the low-poly mannequin of the graphics demo, cut along the box unwrap of the
 * skin sheet (schemas `skin.ts`), so every loft quarter or ellipsoid octant samples exactly one
 * box face. Built once; the overlay shell is derived per look from the composited overlay's mask.
 *
 * Vertex layout, 12 floats: position 3, normal 3, uv 2 (normalised to a 1x sheet), bone 1, hull 3
 * (the direction the outline and the shell push the vertex out along). Bone-local, rig px, y up.
 */
import {
  BONES,
  SKIN,
  SKIN_HALF,
  SKIN_SHEET,
  SKIN_SHELL,
  SKIN_SHELL_HEAD,
  skinFaceRect,
  type BoneName,
  type SkinFace,
  type SkinPart,
} from '@parapet-world/schemas';
import { add, clamp, cross, dot, len, mul, sub, unit, type Vec3 } from './math.ts';

export const VERTEX_FLOATS = 12;
const D2R = Math.PI / 180;
const S45 = Math.SQRT1_2;
export const FACES: readonly SkinFace[] = ['F', 'L', 'B', 'R', 'T', 'U'];

/** The box axis (0 x forward, 1 y up, 2 z the runner's right) and sign of each face. */
const FACE_AXIS: Readonly<Record<SkinFace, [number, number]>> = {
  F: [0, 1],
  B: [0, -1],
  T: [1, 1],
  U: [1, -1],
  R: [2, 1],
  L: [2, -1],
};

/** A face's size in texels (1x). */
export function faceSize(part: SkinPart, f: SkinFace): [number, number] {
  const [, , w, d, h] = SKIN[part];
  return f === 'F' || f === 'B' ? [w, h] : f === 'L' || f === 'R' ? [d, h] : [w, d];
}

/** A point in the box's normalised coordinates (-1..1 per axis) to its texel position in a face. */
export function faceXY(f: SkinFace, n: Vec3, W: number, H: number): [number, number] {
  const [nx, ny, nz] = n;
  switch (f) {
    case 'F':
      return [((1 - nz) / 2) * W, ((1 - ny) / 2) * H];
    case 'L':
      return [((1 - nx) / 2) * W, ((1 - ny) / 2) * H];
    case 'B':
      return [((1 + nz) / 2) * W, ((1 - ny) / 2) * H];
    case 'R':
      return [((1 + nx) / 2) * W, ((1 - ny) / 2) * H];
    case 'T':
      // the front edge meets the front face below it
      return [((1 - nz) / 2) * W, ((1 + nx) / 2) * H];
    case 'U':
      // the bottom seen from below, front edge up
      return [((1 - nz) / 2) * W, ((1 - nx) / 2) * H];
  }
}

/** The inverse of `faceXY`: a texel position in a face back to box coordinates. */
export function faceN(f: SkinFace, fx: number, fy: number, W: number, H: number): Vec3 {
  const a = fx / W,
    b = fy / H;
  switch (f) {
    case 'F':
      return [1, 1 - 2 * b, 1 - 2 * a];
    case 'L':
      return [1 - 2 * a, 1 - 2 * b, -1];
    case 'B':
      return [-1, 1 - 2 * b, 2 * a - 1];
    case 'R':
      return [2 * a - 1, 1 - 2 * b, 1];
    case 'T':
      return [2 * b - 1, 1, 1 - 2 * a];
    case 'U':
      return [1 - 2 * b, -1, 1 - 2 * a];
  }
}

const UV_INSET = 0.02;
/** Where a box point lands on the sheet, normalised to the 1x sheet; `layer` 1 is the overlay. */
export function uvOf(part: SkinPart, f: SkinFace, n: Vec3, layer: 0 | 1): [number, number] {
  const r = skinFaceRect(part, f),
    p = faceXY(f, n, r[2], r[3]);
  return [
    (r[0] + clamp(p[0], UV_INSET, r[2] - UV_INSET)) / SKIN_SHEET,
    (r[1] + clamp(p[1], UV_INSET, r[3] - UV_INSET) + (layer ? SKIN_HALF : 0)) / SKIN_SHEET,
  ];
}

/** A box face's coordinates back to a direction on a cube-sphere (equal angles across each face). */
export function cubeDir(f: SkinFace, nb: Vec3): Vec3 {
  const [k, s] = FACE_AXIS[f],
    v: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) v[i] = i === k ? s : Math.tan(Math.asin(clamp(nb[i]!, -1, 1) * S45));
  return unit(v);
}

/**
 * A ring of a loft: `at` along the loft's axis (y, or x for the foot), the centre offset `c` on the
 * other in-plane axis (x, or y for the foot) and `cz`, the radii `rc` and `rz`.
 */
export interface Ring {
  at: number;
  c: number;
  cz: number;
  rc: number;
  rz: number;
}
const ring = (at: number, rc: number, rz: number, c = 0): Ring => ({ at, c, cz: 0, rc, rz });

interface PartBase {
  bone: BoneName;
  region: SkinPart;
  smooth: boolean;
}
export interface LoftPart extends PartBase {
  shape: 'loft';
  key?: string;
  rings: Ring[];
  sides: number;
  axis: 'x' | 'y';
  capA: boolean;
  capB: boolean;
}
export interface CubePart extends PartBase {
  shape: 'cube';
  key: string;
  c: Vec3;
  r: Vec3;
  n: number;
}
export interface EllipsoidPart extends PartBase {
  shape: 'ellipsoid';
  host: string;
  c: Vec3;
  r: Vec3;
  sides: number;
  bands: number;
  cull: boolean;
}
export interface ConePart extends PartBase {
  shape: 'cone';
  host: string;
  base: Vec3;
  tip: Vec3;
  r: number;
  sides: number;
}
export type BodyPart = LoftPart | CubePart | EllipsoidPart | ConePart;

/** Detail of a body: side counts of lofts and ellipsoids and the cube-sphere's subdivision. */
export interface BodyLevel {
  id: string;
  sides: number;
  smooth: boolean;
  hs: number;
  hr: number;
  cube: number;
}
export const L2: BodyLevel = { id: 'L2', sides: 8, smooth: false, hs: 10, hr: 7, cube: 4 };

/** The parts of the mannequin (bone-local): lofts, a cube-sphere head and shapes on a host's box. */
export function bodyParts(level: BodyLevel): BodyPart[] {
  const { sides, smooth, hs, hr, cube } = level;
  const L = (
    bone: BoneName,
    region: SkinPart,
    rings: Ring[],
    o: Partial<LoftPart> = {},
  ): LoftPart => ({
    shape: 'loft',
    bone,
    region,
    rings,
    sides,
    smooth,
    axis: 'y',
    capA: false,
    capB: false,
    ...o,
  });
  const parts: BodyPart[] = [
    {
      shape: 'cube',
      key: 'skull',
      bone: 'head',
      region: 'head',
      c: [0.4, 6.4, 0],
      r: [6.6, 7.0, 6.1],
      n: cube,
      smooth,
    },
    {
      // the jaw
      shape: 'ellipsoid',
      bone: 'head',
      region: 'head',
      host: 'skull',
      c: [2.4, 2.9, 0],
      r: [4.2, 3.6, 4.2],
      sides: hs,
      bands: Math.max(5, hr - 2),
      smooth,
      cull: true,
    },
    {
      // the nose
      shape: 'cone',
      bone: 'head',
      region: 'head',
      host: 'skull',
      base: [6.3, 5.5, 0],
      tip: [7.5, 5.0, 0],
      r: 0.85,
      sides: 4,
      smooth: false,
    },
    L('chest', 'neck', [ring(13.4, 1.55, 1.55), ring(9.6, 1.8, 1.8)]),
    L(
      'chest',
      'chest',
      [
        ring(11.0, 2.6, 5.0, -0.3),
        ring(9.8, 3.6, 6.2, -0.2),
        ring(7.6, 4.1, 6.2, 0.2),
        ring(5.2, 4.2, 5.8, 0.6),
        ring(3.2, 3.7, 5.0, 0.2),
        ring(1.4, 3.3, 4.5),
      ],
      { key: 'chest', capA: true },
    ),
  ];
  // the bust, as approved: only its triangles hidden inside the chest are left out
  for (const z of [1.9, -1.9]) {
    parts.push({
      shape: 'ellipsoid',
      bone: 'chest',
      region: 'chest',
      host: 'chest',
      c: [3.0, 5.8, z],
      r: [2.25, 2.2, 1.95],
      sides: hs,
      bands: Math.max(6, hr - 1),
      smooth,
      cull: true,
    });
  }
  parts.push(
    L(
      'root',
      'pelvis',
      [
        ring(4.4, 3.1, 4.2),
        ring(1.35, 3.4, 4.7),
        ring(1.25, 3.8, 5.3),
        ring(-0.6, 3.9, 5.6),
        ring(-0.7, 4.2, 6.0),
        ring(-3.4, 4.7, 6.7),
        ring(-5.8, 4.1, 6.0),
      ],
      { capB: true },
    ),
  );
  // The rig names bones by the near (L) and far (R) side of a runner facing right; the skin by the
  // runner's own sides, so rig L (+z, the runner's right) carries region R.
  for (const s of ['L', 'R'] as const) {
    const a = s === 'L' ? 'R' : 'L';
    parts.push(
      L(
        `uarm${s}`,
        `uarm${a}`,
        [ring(1.9, 2.2, 2.2), ring(0.3, 2.7, 2.7), ring(-4.2, 2.15, 2.15), ring(-9.8, 1.6, 1.6)],
        { capA: true },
      ),
      L(`larm${s}`, `larm${a}`, [
        ring(0.7, 1.9, 1.9),
        ring(-3.0, 1.8, 1.8),
        ring(-7.4, 1.45, 1.45),
      ]),
      L(
        `hand${s}`,
        `hand${a}`,
        [
          ring(0.6, 2.0, 1.65, 0.45),
          ring(-0.55, 2.75, 2.25, 0.45),
          ring(-4.6, 2.8, 2.3, 0.45),
          ring(-5.8, 2.0, 1.65, 0.45),
        ],
        { capA: true, capB: true, sides: Math.min(sides, 8) },
      ),
      // the body's own legs; baggy trousers are the costume's overlay, not the mesh
      L(`uleg${s}`, `uleg${a}`, [
        ring(1.2, 3.4, 3.4),
        ring(-4, 3.5, 3.5),
        ring(-9.5, 3.05, 3.0),
        ring(-13.4, 2.7, 2.6),
      ]),
      L(
        `lleg${s}`,
        `lleg${a}`,
        [
          ring(0.9, 2.75, 2.6),
          ring(-2.6, 3.0, 2.75, -0.25),
          ring(-5.6, 2.45, 2.3, -0.2),
          ring(-8.4, 1.75, 1.7),
          ring(-10.8, 1.5, 1.45),
        ],
        { capA: true, capB: true },
      ),
      L(
        `foot${s}`,
        `foot${a}`,
        [
          ring(-2.9, 1.9, 1.7, -1.6),
          ring(-1.7, 2.25, 1.95, -1.35),
          ring(1.7, 1.9, 2.05, -1.75),
          ring(5.2, 1.35, 2.05, -2.25),
          ring(7.5, 1.05, 1.75, -2.55),
          ring(8.4, 0.8, 1.3, -2.7),
        ],
        { axis: 'x', capA: true, capB: true, sides: smooth ? 12 : Math.min(sides, 8) },
      ),
    );
  }
  return parts;
}

/* ---------- emitters ---------- */

interface V {
  p: Vec3;
  n: Vec3;
  h?: Vec3;
  uv?: [number, number];
}
interface Ctx {
  out: number[];
  head: number[];
}

const BONE_INDEX: Readonly<Record<BoneName, number>> = Object.fromEntries(
  BONES.map((b, i) => [b.name, i]),
) as Record<BoneName, number>;

function pushTri(
  ctx: Ctx,
  bone: number,
  region: SkinPart,
  A: V,
  B: V,
  C: V,
  outward: Vec3,
  smoothN: boolean,
): void {
  let n = unit(cross(sub(B.p, A.p), sub(C.p, A.p)));
  if (dot(n, outward) < 0) {
    const t = B;
    B = C;
    C = t;
    n = mul(n, -1);
  }
  for (const v of [A, B, C]) {
    const sn = smoothN ? v.n : n,
      h = v.h ?? v.n,
      uv = v.uv ?? [0, 0];
    ctx.out.push(v.p[0], v.p[1], v.p[2], sn[0], sn[1], sn[2], uv[0], uv[1], bone, h[0], h[1], h[2]);
  }
  ctx.head.push(region === 'head' ? 1 : 0);
}

/**
 * A loft: every quarter of the rings is one box face (front, right, back, left; for the foot top,
 * right, sole, left), so a column of texels is a line along it; the end caps are the box's caps
 * (the foot's are its heel and toe). A cap's rim keeps the side's normal for the outline and the
 * shell, so neither cracks at the rim.
 */
function emitLoft(ctx: Ctx, bone: number, part: LoftPart): void {
  const S = part.sides,
    rings = part.rings,
    ax = part.axis === 'x',
    n = rings.length,
    q = S / 4,
    reg = part.region;
  const a0 = rings[0]!.at,
    a1 = rings[n - 1]!.at;
  const P = (rg: Ring, th: number): Vec3 =>
    ax
      ? [rg.at, rg.c + rg.rc * Math.cos(th), rg.cz + rg.rz * Math.sin(th)]
      : [rg.c + rg.rc * Math.cos(th), rg.at, rg.cz + rg.rz * Math.sin(th)];
  const N = (rg: Ring, th: number): Vec3 =>
    ax
      ? unit([0, Math.cos(th) / rg.rc, Math.sin(th) / rg.rz])
      : unit([Math.cos(th) / rg.rc, 0, Math.sin(th) / rg.rz]);
  const TH = (j: number): number => (2 * Math.PI * j) / S - Math.PI / 4;
  const box = (k: number, c: number, s: number): Vec3 => {
    const t = (rings[k]!.at - a0) / (a1 - a0);
    return ax ? [2 * t - 1, c, s] : [c, 1 - 2 * t, s];
  };
  const sideFaces: readonly SkinFace[] = ax ? ['T', 'R', 'U', 'L'] : ['F', 'R', 'B', 'L'];
  const vert = (k: number, j: number, f: SkinFace): V => {
    const rg = rings[k]!,
      th = TH(j);
    return {
      p: P(rg, th),
      n: N(rg, th),
      uv: uvOf(
        reg,
        f,
        box(k, clamp(Math.cos(th) / S45, -1, 1), clamp(Math.sin(th) / S45, -1, 1)),
        0,
      ),
    };
  };
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < S; j++) {
      const f = sideFaces[Math.floor(j / q)]!,
        A = vert(k, j, f),
        B = vert(k, j + 1, f),
        C = vert(k + 1, j + 1, f),
        D = vert(k + 1, j, f),
        ow = add(add(A.n, B.n), add(C.n, D.n));
      pushTri(ctx, bone, reg, A, B, C, ow, part.smooth);
      pushTri(ctx, bone, reg, A, C, D, ow, part.smooth);
    }
  }
  for (const k of [0, n - 1]) {
    if (!(k === 0 ? part.capA : part.capB)) continue;
    const rg = rings[k]!,
      end = k === 0 ? -1 : 1,
      dir: Vec3 = ax ? [end, 0, 0] : [0, -end, 0],
      f: SkinFace = ax ? (k === 0 ? 'B' : 'F') : k === 0 ? 'T' : 'U';
    const cn = (c: number, s: number): Vec3 => (ax ? [end, c, s] : [c, -end, s]);
    const C: V = {
      p: ax ? [rg.at, rg.c, rg.cz] : [rg.c, rg.at, rg.cz],
      n: dir,
      uv: uvOf(reg, f, cn(0, 0), 0),
    };
    for (let j = 0; j < S; j++) {
      const t0 = TH(j),
        t1 = TH(j + 1);
      const A: V = {
        p: P(rg, t0),
        n: dir,
        h: N(rg, t0),
        uv: uvOf(reg, f, cn(Math.cos(t0), Math.sin(t0)), 0),
      };
      const B: V = {
        p: P(rg, t1),
        n: dir,
        h: N(rg, t1),
        uv: uvOf(reg, f, cn(Math.cos(t1), Math.sin(t1)), 0),
      };
      pushTri(ctx, bone, reg, C, A, B, dir, false);
    }
  }
}

/** The head: a cube-sphere on the skull's ellipsoid, its six patches exactly the six box faces. */
function emitCube(ctx: Ctx, bone: number, part: CubePart): void {
  const N = part.n,
    c = part.c,
    r = part.r,
    reg = part.region;
  const frac = (i: number): number => (1 + Math.sin((-45 + (90 * i) / N) * D2R) / S45) / 2;
  for (const f of FACES) {
    const vs: V[] = [];
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const nb = faceN(f, frac(i), frac(j), 1, 1),
          d = cubeDir(f, nb);
        vs.push({
          p: [c[0] + r[0] * d[0], c[1] + r[1] * d[1], c[2] + r[2] * d[2]],
          n: unit([d[0] / r[0], d[1] / r[1], d[2] / r[2]]),
          uv: uvOf(reg, f, nb, 0),
        });
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = vs[j * (N + 1) + i]!,
          b = vs[j * (N + 1) + i + 1]!,
          d = vs[(j + 1) * (N + 1) + i + 1]!,
          e = vs[(j + 1) * (N + 1) + i]!,
          ow = sub(add(a.p, d.p), mul(c, 2));
        pushTri(ctx, bone, reg, a, b, d, ow, part.smooth);
        pushTri(ctx, bone, reg, a, d, e, ow, part.smooth);
      }
    }
  }
}

/**
 * Projectors: where a point of a secondary shape (jaw, nose, bust) lands on its host's box. Each
 * face is a region bounded by functions that are >= 0 inside it; a triangle crossing a face border
 * is cut along it, so it samples one face only.
 */
interface Host {
  faces: readonly SkinFace[];
  inside(p: Vec3): boolean;
  faceOf(p: Vec3): SkinFace;
  region(f: SkinFace): ((p: Vec3) => number)[];
  nOf(p: Vec3, f: SkinFace): Vec3;
}

function projEllipsoid(c: Vec3, r: Vec3): Host {
  const D = (p: Vec3): Vec3 => [(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]];
  const AF: [SkinFace, SkinFace][] = [
    ['F', 'B'],
    ['T', 'U'],
    ['R', 'L'],
  ];
  return {
    faces: FACES,
    inside: (p) => len(D(p)) < 0.985,
    faceOf(p) {
      const d = D(p),
        a = d.map(Math.abs) as Vec3,
        k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
      return AF[k]![d[k]! >= 0 ? 0 : 1];
    },
    region(f) {
      const [k, s] = FACE_AXIS[f],
        g: ((p: Vec3) => number)[] = [];
      for (const i of [0, 1, 2]) {
        if (i === k) continue;
        g.push(
          (p) => {
            const d = D(p);
            return s * d[k]! - d[i]!;
          },
          (p) => {
            const d = D(p);
            return s * d[k]! + d[i]!;
          },
        );
      }
      return g;
    },
    nOf(p, f) {
      const d = D(p),
        [k, s] = FACE_AXIS[f],
        n: Vec3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        n[i] = i === k ? s : clamp(d[i]! / (Math.hypot(d[i]!, d[k]!) || 1) / S45, -1, 1);
      }
      return n;
    },
  };
}

function projLoft(part: LoftPart): Host {
  const rg = part.rings,
    y0 = rg[0]!.at,
    yN = rg[rg.length - 1]!.at;
  const ringAt = (y: number): Ring => {
    if (y >= y0) return rg[0]!;
    if (y <= yN) return rg[rg.length - 1]!;
    let k = 0;
    while (k < rg.length - 2 && y < rg[k + 1]!.at) k++;
    const A = rg[k]!,
      B = rg[k + 1]!,
      t = (A.at - y) / (A.at - B.at || 1),
      L = (a: number, b: number): number => a + (b - a) * t;
    return { at: y, c: L(A.c, B.c), cz: L(A.cz, B.cz), rc: L(A.rc, B.rc), rz: L(A.rz, B.rz) };
  };
  const Q = (p: Vec3): [number, number] => {
    const g = ringAt(p[1]);
    return [(p[0] - g.c) / g.rc, (p[2] - g.cz) / g.rz];
  };
  const AX: Readonly<Record<string, [number, number]>> = {
    F: [1, 0],
    R: [0, 1],
    B: [-1, 0],
    L: [0, -1],
  };
  return {
    faces: ['F', 'R', 'B', 'L'],
    inside: (p) => p[1] < y0 && p[1] > yN && Math.hypot(...Q(p)) < 0.97,
    faceOf(p) {
      const [x, z] = Q(p);
      return Math.abs(z) <= x ? 'F' : Math.abs(x) <= z ? 'R' : Math.abs(z) <= -x ? 'B' : 'L';
    },
    region(f) {
      const s = AX[f]!,
        ab = (p: Vec3): [number, number] => {
          const q = Q(p);
          return [s[0] * q[0] + s[1] * q[1], s[1] * q[0] - s[0] * q[1]];
        };
      return [
        (p) => {
          const v = ab(p);
          return v[0] - v[1];
        },
        (p) => {
          const v = ab(p);
          return v[0] + v[1];
        },
      ];
    },
    nOf(p) {
      const q = Q(p),
        th = Math.atan2(q[1], q[0]);
      return [
        clamp(Math.cos(th) / S45, -1, 1),
        clamp(1 - (2 * (y0 - p[1])) / (y0 - yN), -1, 1),
        clamp(Math.sin(th) / S45, -1, 1),
      ];
    },
  };
}

function lerpV(A: V, B: V, t: number): V {
  const L = (a: Vec3, b: Vec3): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  return { p: L(A.p, B.p), n: unit(L(A.n, B.n)), h: unit(L(A.h ?? A.n, B.h ?? B.n)) };
}

function clipPoly(poly: V[], g: (p: Vec3) => number): V[] {
  const out: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i]!,
      B = poly[(i + 1) % poly.length]!,
      ga = g(A.p),
      gb = g(B.p);
    if (ga >= 0) out.push(A);
    if (ga >= 0 !== gb >= 0) out.push(lerpV(A, B, ga / (ga - gb)));
  }
  return out;
}

type TriSink = (A: V, B: V, C: V, outward: Vec3, smooth: boolean) => void;

/** A UV sphere, as raw triangles. */
function ellipsoidTris(part: EllipsoidPart, tri: TriSink): void {
  const S = part.sides,
    Rn = part.bands,
    c = part.c,
    r = part.r;
  const pt = (i: number, j: number): V => {
    const ph = (Math.PI * i) / Rn,
      th = -Math.PI / 4 + (2 * Math.PI * j) / S,
      d: Vec3 = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
    return {
      p: [c[0] + r[0] * d[0], c[1] + r[1] * d[1], c[2] + r[2] * d[2]],
      n: unit([d[0] / r[0], d[1] / r[1], d[2] / r[2]]),
    };
  };
  for (let i = 0; i < Rn; i++) {
    for (let j = 0; j < S; j++) {
      const a = pt(i, j),
        b = pt(i, j + 1),
        d = pt(i + 1, j + 1),
        e = pt(i + 1, j);
      const ow = unit([
        a.p[0] + d.p[0] - 2 * c[0],
        a.p[1] + d.p[1] - 2 * c[1],
        a.p[2] + d.p[2] - 2 * c[2],
      ]);
      if (i > 0) tri(a, b, d, ow, part.smooth);
      if (i < Rn - 1) tri(a, d, e, ow, part.smooth);
    }
  }
}

function coneTris(part: ConePart, tri: TriSink): void {
  const S = part.sides,
    A = part.base,
    B = part.tip,
    axv = unit(sub(B, A)),
    L = len(sub(B, A));
  const up: Vec3 = [0, 1, 0];
  let e1 = sub(up, mul(axv, dot(up, axv)));
  if (len(e1) < 1e-3) e1 = cross(axv, [0, 0, 1]);
  e1 = unit(e1);
  const e2 = cross(axv, e1);
  const ringV = (j: number): V => {
    const th = (2 * Math.PI * j) / S - Math.PI / 4,
      c = Math.cos(th),
      s = Math.sin(th),
      d = add(mul(e1, c * part.r), mul(e2, s * part.r)),
      nd = unit(add(mul(e1, c), mul(e2, s)));
    return { p: add(A, d), n: unit(add(nd, mul(axv, part.r / L))) };
  };
  for (let j = 0; j < S; j++) {
    const a = ringV(j),
      b = ringV(j + 1);
    tri(a, b, { p: B, n: axv }, add(a.n, b.n), part.smooth);
    tri({ p: A, n: mul(axv, -1) }, a, b, mul(axv, -1), false);
  }
}

function emitMapped(ctx: Ctx, bone: number, part: EllipsoidPart | ConePart, host: Host): void {
  const reg = part.region;
  const out = (poly: V[], f: SkinFace, ow: Vec3, sm: boolean): void => {
    for (let i = 1; i + 1 < poly.length; i++) {
      const T = [poly[0]!, poly[i]!, poly[i + 1]!] as const;
      if (len(cross(sub(T[1].p, T[0].p), sub(T[2].p, T[0].p))) < 1e-6) continue;
      const m = (v: V): V => ({ p: v.p, n: v.n, h: v.h, uv: uvOf(reg, f, host.nOf(v.p, f), 0) });
      pushTri(ctx, bone, reg, m(T[0]), m(T[1]), m(T[2]), ow, sm);
    }
  };
  const sink: TriSink = (A, B, C, ow, sm) => {
    // hidden inside the host
    if (
      part.shape === 'ellipsoid' &&
      part.cull &&
      host.inside(A.p) &&
      host.inside(B.p) &&
      host.inside(C.p)
    ) {
      return;
    }
    const fa = host.faceOf(A.p);
    if (fa === host.faceOf(B.p) && fa === host.faceOf(C.p)) return out([A, B, C], fa, ow, sm);
    for (const f of host.faces) {
      let poly = [A, B, C];
      for (const g of host.region(f)) {
        poly = clipPoly(poly, g);
        if (poly.length < 3) break;
      }
      if (poly.length >= 3) out(poly, f, ow, sm);
    }
  };
  if (part.shape === 'cone') coneTris(part, sink);
  else ellipsoidTris(part, sink);
}

/** The base body: vertex data and a flag per triangle that is 1 on the head (for the shell). */
export interface BodyMesh {
  data: Float32Array;
  head: Uint8Array;
  triangles: number;
}

const BODY_CACHE = new Map<string, BodyMesh>();
export function buildBody(level: BodyLevel = L2): BodyMesh {
  const cached = BODY_CACHE.get(level.id);
  if (cached) return cached;
  const parts = bodyParts(level),
    ctx: Ctx = { out: [], head: [] },
    hosts = new Map<string, Host>();
  for (const part of parts) {
    if (part.shape === 'cube') hosts.set(part.key, projEllipsoid(part.c, part.r));
    else if (part.shape === 'loft' && part.key) hosts.set(part.key, projLoft(part));
  }
  for (const part of parts) {
    const bone = BONE_INDEX[part.bone];
    if (part.shape === 'ellipsoid' || part.shape === 'cone') {
      emitMapped(ctx, bone, part, hosts.get(part.host)!);
    } else if (part.shape === 'cube') emitCube(ctx, bone, part);
    else emitLoft(ctx, bone, part);
  }
  const body: BodyMesh = {
    data: new Float32Array(ctx.out),
    head: new Uint8Array(ctx.head),
    triangles: ctx.head.length,
  };
  BODY_CACHE.set(level.id, body);
  return body;
}

/** Does the texel triangle touch an opaque overlay texel (sampled every third of a texel)? */
function covers(
  mask: Uint8Array,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const L = Math.max(
      Math.hypot(bx - ax, by - ay),
      Math.hypot(cx - ax, cy - ay),
      Math.hypot(cx - bx, cy - by),
    ),
    N = Math.max(1, Math.ceil(L * 3));
  for (let i = 0; i <= N; i++) {
    for (let j = 0; i + j <= N; j++) {
      const u = i / N,
        v = j / N,
        x = ax + (bx - ax) * u + (cx - ax) * v,
        y = ay + (by - ay) * u + (cy - ay) * v;
      const k =
        clamp(Math.floor(y), 0, SKIN_HALF - 1) * SKIN_SHEET +
        clamp(Math.floor(x), 0, SKIN_SHEET - 1);
      if (mask[k]) return true;
    }
  }
  return false;
}

/**
 * The overlay shell: the body's triangles pushed out along their hull normals (1 px on the head,
 * 0.7 px elsewhere) and moved to the overlay half of the sheet. A triangle is kept only where the
 * composited overlay (`mask`, one byte per 1x texel of the overlay half) has an opaque texel.
 */
export function buildShell(body: BodyMesh, mask: Uint8Array): Float32Array {
  const src = body.data,
    res: number[] = [],
    S = SKIN_SHEET;
  for (let t = 0; t < body.triangles; t++) {
    const o = t * 36;
    if (
      !covers(
        mask,
        src[o + 6]! * S,
        src[o + 7]! * S,
        src[o + 18]! * S,
        src[o + 19]! * S,
        src[o + 30]! * S,
        src[o + 31]! * S,
      )
    ) {
      continue;
    }
    const k = body.head[t] ? SKIN_SHELL_HEAD : SKIN_SHELL;
    for (let v = 0; v < 3; v++) {
      const b = o + v * 12;
      res.push(
        src[b]! + src[b + 9]! * k,
        src[b + 1]! + src[b + 10]! * k,
        src[b + 2]! + src[b + 11]! * k,
        src[b + 3]!,
        src[b + 4]!,
        src[b + 5]!,
        src[b + 6]!,
        src[b + 7]! + SKIN_HALF / S,
        src[b + 8]!,
        src[b + 9]!,
        src[b + 10]!,
        src[b + 11]!,
      );
    }
  }
  return new Float32Array(res);
}
