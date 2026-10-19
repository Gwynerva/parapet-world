/**
 * Clip playback. A clip file (schemas `clip.ts`) is prepared once into one flat array of frames in
 * the rig's bone order; at render rate a pose is sampled by spherical interpolation between the two
 * neighbouring 30 fps frames, mirrored when the runner faces left, and turned into bone matrices
 * for GPU skinning. Sampling and the matrices allocate nothing.
 *
 * The per-frame `mirror` flag: the lifted Classic clips mark the frames Classic drew flipped, but
 * their quaternions and root already carry the turn, so by default the flag is only kept as
 * information. A clip source that stores flipped frames unturned can ask for them to be mirrored
 * (`applyMirror`).
 */
import { BONES, BONE_NAMES, type BoneName, type ClipFile } from '@parapet-world/schemas';
import { mat4FromQuat, mat4Mul, quatSlerp } from './math.ts';

export const BONE_COUNT = BONES.length;
/** Floats per prepared frame: root position 3, a quaternion per bone, the mirror flag. */
export const FRAME_STRIDE = 3 + BONE_COUNT * 4 + 1;
const MIRROR_AT = FRAME_STRIDE - 1;
export const CLIP_FPS = 30;

export interface Clip {
  name: string;
  loop: boolean;
  frames: number;
  /** Frames of FRAME_STRIDE floats; the last float is 1 where the frame is drawn mirrored. */
  data: Float32Array;
  /** Net travel of the root over a one-shot clip (rig px, x forward, y up). */
  travelX: number;
  travelY: number;
  /** Length in seconds: loops wrap after `frames` frames, one-shots end on the last one. */
  duration: number;
}

/** A sampled pose: the root position (rig px, relative to the anchor) and a rotation per bone. */
export interface Pose {
  root: Float32Array;
  q: Float32Array;
}
export const createPose = (): Pose => ({
  root: new Float32Array(3),
  q: new Float32Array(BONE_COUNT * 4),
});

const BONE_INDEX = new Map<string, number>(BONE_NAMES.map((n, i) => [n, i]));
/** The bone on the other side (uarmL <-> uarmR); the root, chest and head map to themselves. */
export const SWAP = Int8Array.from(BONE_NAMES, (n) => {
  const other = n.endsWith('L') ? n.slice(0, -1) + 'R' : n.endsWith('R') ? n.slice(0, -1) + 'L' : n;
  return BONE_INDEX.get(other) ?? BONE_INDEX.get(n)!;
});
const PARENT = Int8Array.from(BONES, (b) => (b.parent ? BONE_INDEX.get(b.parent)! : -1));

export interface ClipOptions {
  /** Draw frames flagged `mirror` turned the other way (default false: the pose carries it). */
  applyMirror?: boolean;
}

/** Prepares a clip file; bones the file does not list keep the identity rotation. */
export function prepareClip(file: ClipFile, options: ClipOptions = {}): Clip {
  const n = file.frames.length;
  if (!n) throw new Error(`clip ${file.name} has no frames`);
  const order = file.bones.map((b: BoneName) => BONE_INDEX.get(b) ?? -1);
  const data = new Float32Array(n * FRAME_STRIDE);
  for (let f = 0; f < n; f++) {
    const fr = file.frames[f]!,
      o = f * FRAME_STRIDE;
    data[o] = fr.root[0];
    data[o + 1] = fr.root[1];
    data[o + 2] = fr.root[2];
    for (let b = 0; b < BONE_COUNT; b++) data[o + 3 + b * 4 + 3] = 1;
    for (let k = 0; k < order.length; k++) {
      const b = order[k]!;
      if (b < 0) continue;
      for (let c = 0; c < 4; c++) data[o + 3 + b * 4 + c] = fr.q[k * 4 + c] ?? (c === 3 ? 1 : 0);
    }
    data[o + MIRROR_AT] = fr.mirror && options.applyMirror ? 1 : 0;
  }
  return {
    name: file.name,
    loop: file.loop,
    frames: n,
    data,
    travelX: file.travel[0],
    travelY: file.travel[1],
    duration: (file.loop ? n : Math.max(1, n - 1)) / CLIP_FPS,
  };
}

const qa = new Float32Array(4),
  qb = new Float32Array(4);

/**
 * Bone b's rotation in frame f as drawn: a mirrored frame is the figure turned to face the other
 * way, as Classic flips its sprite: sides swap and rotations reflect through the x-y plane, and
 * the root also turns 180 degrees about y, which together reflect the figure in x.
 */
function frameQuat(out: Float32Array, data: Float32Array, f: number, b: number): void {
  const o = f * FRAME_STRIDE;
  if (!data[o + MIRROR_AT]) {
    const s = o + 3 + b * 4;
    out[0] = data[s]!;
    out[1] = data[s + 1]!;
    out[2] = data[s + 2]!;
    out[3] = data[s + 3]!;
    return;
  }
  const s = o + 3 + SWAP[b]! * 4;
  mirrorQuat(out, 0, data[s]!, data[s + 1]!, data[s + 2]!, data[s + 3]!, b === 0);
}

/** The reflection of a bone rotation (the root additionally turns 180 degrees about y). */
function mirrorQuat(
  out: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  w: number,
  root: boolean,
): void {
  if (root) {
    // (0, 1, 0, 0) * (-x, -y, z, w)
    out[o] = z;
    out[o + 1] = w;
    out[o + 2] = x;
    out[o + 3] = y;
  } else {
    out[o] = -x;
    out[o + 1] = -y;
    out[o + 2] = z;
    out[o + 3] = w;
  }
}

/** How the travel of a one-shot clip is shown. */
export type TravelMode =
  /** The simulation moves the anchor along the travel; the clip's root shows only its deviation. */
  | 'anchor'
  /** The anchor stays where the move began; the root carries the whole travel. */
  | 'clip';

/**
 * Samples a clip at `time` seconds into `out`: the frames around the time are interpolated
 * spherically (positions linearly); loops wrap, one-shots hold their last frame. `facing` -1
 * mirrors the whole pose. With `travel` 'anchor' a one-shot's root has its travel taken out in
 * proportion to the progress, so an anchor that moves along the travel shows the clip's motion.
 */
export function samplePose(
  clip: Clip,
  time: number,
  facing: number,
  travel: TravelMode,
  out: Pose,
): void {
  const n = clip.frames,
    data = clip.data;
  let fpos = time * CLIP_FPS,
    i0: number,
    i1: number;
  if (clip.loop) {
    fpos = ((fpos % n) + n) % n;
    i0 = Math.floor(fpos);
    i1 = i0 + 1 >= n ? 0 : i0 + 1;
  } else {
    fpos = fpos < 0 ? 0 : fpos > n - 1 ? n - 1 : fpos;
    i0 = Math.floor(fpos);
    i1 = i0 + 1 >= n ? n - 1 : i0 + 1;
  }
  if (i0 >= n) i0 = n - 1;
  const t = fpos - i0,
    o0 = i0 * FRAME_STRIDE,
    o1 = i1 * FRAME_STRIDE;
  // the root, in the clip's own forward frame (mirrored frames reflect it in x)
  const m0 = data[o0 + MIRROR_AT] ? -1 : 1,
    m1 = data[o1 + MIRROR_AT] ? -1 : 1;
  let rx = data[o0]! * m0 + (data[o1]! * m1 - data[o0]! * m0) * t;
  let ry = data[o0 + 1]! + (data[o1 + 1]! - data[o0 + 1]!) * t;
  const rz = data[o0 + 2]! + (data[o1 + 2]! - data[o0 + 2]!) * t;
  if (!clip.loop && travel === 'anchor' && n > 1) {
    const u = fpos / (n - 1);
    rx -= clip.travelX * u;
    ry -= clip.travelY * u;
  }
  const left = facing < 0;
  out.root[0] = left ? -rx : rx;
  out.root[1] = ry;
  out.root[2] = rz;
  const q = out.q;
  for (let b = 0; b < BONE_COUNT; b++) {
    // facing left draws bone b with the motion of the other side's bone, reflected
    const src = left ? SWAP[b]! : b;
    frameQuat(qa, data, i0, src);
    frameQuat(qb, data, i1, src);
    quatSlerp(q, b * 4, qa, 0, qb, 0, t);
    if (left) mirrorQuat(q, b * 4, q[b * 4]!, q[b * 4 + 1]!, q[b * 4 + 2]!, q[b * 4 + 3]!, b === 0);
  }
}

const local = new Float32Array(16);

/** World matrices of every bone (rig space, relative to the anchor) into out[0 .. 16 * bones]. */
export function boneMatrices(pose: Pose, out: Float32Array): void {
  const q = pose.q,
    r = pose.root;
  mat4FromQuat(out, 0, q, 0, r[0]!, r[1]!, r[2]!);
  for (let b = 1; b < BONE_COUNT; b++) {
    const at = BONES[b]!.at;
    mat4FromQuat(local, 0, q, b * 4, at[0], at[1], at[2]);
    mat4Mul(out, b * 16, out, PARENT[b]! * 16, local, 0);
  }
}

/** The rest pose: every rotation the identity, the root at `rootY` above the anchor. */
export function restPose(out: Pose, rootY = 27.5): void {
  out.root.fill(0);
  out.root[1] = rootY;
  for (let b = 0; b < BONE_COUNT; b++) {
    out.q[b * 4] = out.q[b * 4 + 1] = out.q[b * 4 + 2] = 0;
    out.q[b * 4 + 3] = 1;
  }
}
