import { describe, expect, it } from 'vitest';
import { BONE_NAMES, type ClipFile } from '@parapet-world/schemas';
import {
  BONE_COUNT,
  CLIP_FPS,
  SWAP,
  boneMatrices,
  createPose,
  prepareClip,
  restPose,
  samplePose,
  type Pose,
} from '../src/clip.ts';
import { quatSlerp } from '../src/math.ts';
import { syntheticClips } from '../dev/clips.ts';

const matrices = (pose: Pose): Float32Array => {
  const m = new Float32Array(BONE_COUNT * 16);
  boneMatrices(pose, m);
  return m;
};
const origin = (m: Float32Array, b: number): number[] => [
  m[b * 16 + 12]!,
  m[b * 16 + 13]!,
  m[b * 16 + 14]!,
];
const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-4): void => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(eps);
};
const run = syntheticClips().find((c) => c.name === 'run')!;
const flagged = (c: ClipFile): ClipFile => ({
  ...c,
  frames: c.frames.map((f) => ({ ...f, mirror: 1 })),
});

describe('clip playback', () => {
  it('chains bone matrices like the demo', () => {
    const pose = createPose();
    restPose(pose);
    pose.root.set([1, 27.5, 0.5]);
    pose.q.set([0, Math.sin(-0.2), 0, Math.cos(-0.2)], 0);
    pose.q.set([0, 0, Math.sin(0.1), Math.cos(0.1)], 4);
    // reference: the demo's boneMatrices for the same pose, the head bone
    close(
      Array.from(matrices(pose).slice(32, 48)),
      [
        0.9027, 0.19867, 0.38166, 0, -0.18299, 0.98007, -0.07737, 0, -0.38942, 0, 0.92106, 0,
        -1.43372, 42.53489, -0.52896, 1,
      ],
    );
  });

  it('facing left reflects the figure in x, the far limbs taking the near ones motion', () => {
    const clip = prepareClip(run),
      a = createPose(),
      b = createPose();
    for (const t of [0, 0.11, 0.37]) {
      samplePose(clip, t, 1, 'anchor', a);
      samplePose(clip, t, -1, 'anchor', b);
      const ma = matrices(a),
        mb = matrices(b);
      for (let i = 0; i < BONE_COUNT; i++) {
        const [x, y, z] = origin(ma, SWAP[i]!);
        close(origin(mb, i), [-x!, y!, z!]);
      }
    }
  });

  it('keeps mirror flags as information unless asked to apply them', () => {
    const plain = prepareClip(run),
      kept = prepareClip(flagged(run)),
      a = createPose(),
      b = createPose();
    samplePose(plain, 0.2, 1, 'anchor', a);
    samplePose(kept, 0.2, 1, 'anchor', b);
    close(matrices(a), matrices(b));
  });

  it('draws frames flagged as mirrored like the other facing, and two mirrors cancel', () => {
    const plain = prepareClip(run),
      mirrored = prepareClip(flagged(run), { applyMirror: true }),
      a = createPose(),
      b = createPose();
    for (const t of [0, 0.2, 0.45]) {
      samplePose(plain, t, -1, 'anchor', a);
      samplePose(mirrored, t, 1, 'anchor', b);
      close(matrices(a), matrices(b));
      samplePose(plain, t, 1, 'anchor', a);
      samplePose(mirrored, t, -1, 'anchor', b);
      close(matrices(a), matrices(b));
    }
  });

  it('wraps loops and interpolates between neighbouring frames spherically', () => {
    const clip = prepareClip(run),
      a = createPose(),
      b = createPose();
    samplePose(clip, 0, 1, 'anchor', a);
    samplePose(clip, clip.frames / CLIP_FPS, 1, 'anchor', b);
    close(a.q, b.q);
    // halfway between frame 3 and 4 is the slerp of the two
    samplePose(clip, 3.5 / CLIP_FPS, 1, 'anchor', a);
    const f3 = clip.data.subarray(3 * 64 + 3, 3 * 64 + 63),
      f4 = clip.data.subarray(4 * 64 + 3, 4 * 64 + 63),
      want = new Float32Array(4);
    for (let k = 0; k < BONE_COUNT; k++) {
      quatSlerp(want, 0, f3, k * 4, f4, k * 4, 0.5);
      close(a.q.subarray(k * 4, k * 4 + 4), want);
    }
  });

  it('holds a one-shot on its last frame and takes its travel out of the root', () => {
    const hop = syntheticClips().find((c) => c.name === 'hop')!,
      clip = prepareClip(hop),
      last = hop.frames[hop.frames.length - 1]!,
      p = createPose();
    samplePose(clip, 10, 1, 'clip', p);
    close(p.root, last.root);
    samplePose(clip, 10, 1, 'anchor', p);
    close(p.root, [last.root[0] - hop.travel[0], last.root[1], last.root[2]]);
    samplePose(clip, 10, -1, 'anchor', p);
    close(p.root, [-(last.root[0] - hop.travel[0]), last.root[1], last.root[2]]);
    // halfway through, half the travel is taken out
    const mid = (clip.frames - 1) / 2 / CLIP_FPS;
    const q = createPose();
    samplePose(clip, mid, 1, 'clip', p);
    samplePose(clip, mid, 1, 'anchor', q);
    expect(p.root[0]! - q.root[0]!).toBeCloseTo(hop.travel[0] / 2, 4);
  });

  it('reorders bones by name and keeps missing ones at rest', () => {
    const file: ClipFile = {
      format: 1,
      name: 'two',
      fps: 30,
      loop: true,
      bones: ['head', 'root', 'nonsense' as never],
      frames: [{ root: [0, 20, 0], q: [0, 0, Math.SQRT1_2, Math.SQRT1_2, 0, 1, 0, 0, 1, 0, 0, 0] }],
      travel: [0, 0],
    };
    const clip = prepareClip(file),
      p = createPose();
    samplePose(clip, 0, 1, 'anchor', p);
    const head = BONE_NAMES.indexOf('head');
    close(p.q.subarray(head * 4, head * 4 + 4), [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    close(p.q.subarray(0, 4), [0, 1, 0, 0]);
    close(p.q.subarray(4, 8), [0, 0, 0, 1]);
  });
});
