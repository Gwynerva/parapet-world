import type { BoneName } from './rig.ts';

/**
 * An animation clip (`content/clips/<set>/<name>.clip.json`), baked densely at 30 frames per
 * second after planted feet and fists are held and the body is clamped to the ground. The client
 * only interpolates neighbouring frames (spherically) at render rate.
 *
 * The clips in `clips/classic/` are lifted from Parapet Classic's keyframes: a temporary stand-in
 * that the public-build check refuses (see `docs/MVP-PLAN.md`, section 8).
 */
export interface ClipFile {
  format: 1;
  name: string;
  fps: 30;
  loop: boolean;
  /** Order of the quaternions in every frame. */
  bones: BoneName[];
  frames: ClipFrame[];
  /**
   * Net travel of the root over the clip in rig px (x forward, y up). Loops are exported in place
   * (0, 0); a one-shot move keeps its travel and the simulation's move is tuned to match it.
   */
  travel: [number, number];
}

export interface ClipFrame {
  /** The rig root relative to the runner's anchor (feet point, centre), rig px, y up, x forward. */
  root: [number, number, number];
  /** Local rotation of every bone, (x, y, z, w) each; the root's is in the runner's facing frame. */
  q: number[];
  /**
   * 1 where Classic's sprite was mirrored (its turns flip mid-clip). Informational only: the
   * exported rotations already include the flip, so players must not mirror the frame again.
   */
  mirror?: 1;
  /** Support flags: 1 near foot, 2 far foot, 4 near hand, 8 far hand. */
  plant?: number;
}
