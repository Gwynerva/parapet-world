/**
 * Procedural clips for the dev harness until the lifted clips are baked: a run loop, an idle loop
 * and a one-shot hop with travel. Rough on purpose (they only exercise playback); the ground
 * contact follows the real rule: the lowest body vertex (never the shell) touches y = 0.
 */
import { BONE_NAMES, type BoneName, type ClipFile, type ClipFrame } from '@parapet-world/schemas';
import { BONE_COUNT, boneMatrices, createPose, prepareClip } from '../src/clip.ts';
import { buildBody, VERTEX_FLOATS } from '../src/mesh.ts';

const D2R = Math.PI / 180;
type Q = [number, number, number, number];
const qz = (deg: number): Q => [0, 0, Math.sin((deg * D2R) / 2), Math.cos((deg * D2R) / 2)];
const qy = (deg: number): Q => [0, Math.sin((deg * D2R) / 2), 0, Math.cos((deg * D2R) / 2)];
const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** Angles in degrees about z (the sagittal plane: + swings a hanging limb forward). */
type Angles = Partial<Record<BoneName, number>>;

/** The lowest base-body vertex of a pose with the root at height 0. */
function lowest(frame: ClipFrame): number {
  const body = buildBody(),
    pose = createPose(),
    m = new Float32Array(BONE_COUNT * 16);
  pose.root.set(frame.root);
  pose.q.set(frame.q);
  boneMatrices(pose, m);
  let low = Infinity;
  const d = body.data;
  for (let i = 0; i < d.length; i += VERTEX_FLOATS) {
    const b = d[i + 8]! * 16,
      y = m[b + 1]! * d[i]! + m[b + 5]! * d[i + 1]! + m[b + 9]! * d[i + 2]! + m[b + 13]!;
    if (y < low) low = y;
  }
  return low;
}

function frame(a: Angles, rootX = 0, lift = 0, yaw = 0): ClipFrame {
  const q: number[] = [];
  for (const name of BONE_NAMES) {
    let r = qz(a[name] ?? 0);
    if (name === 'root' && yaw) r = qmul(qy(yaw), r);
    q.push(...r);
  }
  const f: ClipFrame = { root: [rootX, 0, 0], q };
  // stand on the lowest point of the body, then lift (a jump's flight)
  f.root[1] = -lowest(f) + lift;
  return f;
}

function clip(
  name: string,
  loop: boolean,
  frames: ClipFrame[],
  travel: [number, number],
): ClipFile {
  return { format: 1, name, fps: 30, loop, bones: [...BONE_NAMES], frames, travel };
}

/** A run cycle of 20 frames, the near (L) leg forward at frame 0. */
function run(): ClipFile {
  const frames: ClipFrame[] = [];
  const N = 20;
  for (let i = 0; i < N; i++) {
    const p = (i / N) * 2 * Math.PI,
      s = Math.sin(p),
      c = Math.cos(p);
    const leg = (ph: number): [number, number, number] => {
      const sw = Math.sin(ph),
        back = Math.max(0, -Math.cos(ph + 0.6));
      // thigh swing, knee bend (most while the leg comes forward), foot keeps roughly level
      const thigh = 38 * sw + 8,
        knee = -(12 + 85 * back * back),
        foot = -(thigh + knee) * 0.6 + 6;
      return [thigh, knee, foot];
    };
    const [tL, kL, fL] = leg(p),
      [tR, kR, fR] = leg(p + Math.PI);
    frames.push(
      frame(
        {
          root: -14 + 2 * Math.cos(2 * p),
          chest: -4,
          head: 12,
          ulegL: tL,
          llegL: kL,
          footL: fL,
          ulegR: tR,
          llegR: kR,
          footR: fR,
          uarmL: -40 * s,
          larmL: 75 + 15 * c,
          uarmR: 40 * s,
          larmR: 75 - 15 * c,
          handL: 10,
          handR: 10,
        },
        0,
        1.5 * Math.abs(Math.sin(p)),
      ),
    );
  }
  return clip('run', true, frames, [0, 0]);
}

/** Standing, the body turned toward the viewer, breathing slowly (60 frames). */
function idle(): ClipFile {
  const frames: ClipFrame[] = [];
  const N = 60;
  for (let i = 0; i < N; i++) {
    const b = Math.sin((i / N) * 2 * Math.PI);
    frames.push(
      frame(
        {
          chest: 2 * b,
          head: -2 * b,
          uarmL: 6,
          larmL: 12,
          uarmR: -6,
          larmR: 14,
          ulegL: 4,
          llegL: -4,
          ulegR: -3,
          llegR: -3,
        },
        0,
        0,
        -28,
      ),
    );
  }
  return clip('idle', true, frames, [0, 0]);
}

/** A hop forward: crouch, flight, landing; 24 frames, 48 px of travel. */
function hop(): ClipFile {
  const frames: ClipFrame[] = [];
  const N = 24,
    travel = 48;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1),
      flight = t > 0.25 && t < 0.8 ? Math.sin(((t - 0.25) / 0.55) * Math.PI) : 0,
      crouch =
        t < 0.25
          ? Math.sin((t / 0.25) * Math.PI)
          : t > 0.8
            ? Math.sin(((t - 0.8) / 0.2) * Math.PI)
            : 0;
    const x = travel * (t < 0.25 ? 0 : t > 0.8 ? 1 : (t - 0.25) / 0.55);
    frames.push(
      frame(
        {
          root: -10 - 20 * crouch,
          ulegL: 50 * crouch + 30 * flight,
          llegL: -90 * crouch - 50 * flight,
          footL: 40 * crouch + 20 * flight,
          ulegR: 40 * crouch + 20 * flight,
          llegR: -90 * crouch - 60 * flight,
          footR: 40 * crouch + 30 * flight,
          uarmL: -30 * crouch + 120 * flight,
          uarmR: -30 * crouch + 110 * flight,
          larmL: 30,
          larmR: 30,
        },
        x,
        28 * flight,
      ),
    );
  }
  return clip('hop', false, frames, [travel, 0]);
}

export function syntheticClips(): ClipFile[] {
  const out = [run(), idle(), hop()];
  for (const c of out) prepareClip(c); // fail early on a malformed clip
  return out;
}
