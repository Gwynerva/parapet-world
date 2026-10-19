/**
 * The runner's 3D rig. Units are world px; unlike the rest of the world the rig uses y up, +x
 * forward (the facing direction) and +z toward the viewer when the runner faces right. The root
 * sits at the hips; the runner is about 57 px tall with a big head (about 4 heads), Classic's
 * proportions. Bones are named by the near (L, +z) and far (R, -z) side of a runner facing right.
 */
export const RIG = {
  hipY: -2.2,
  hipZ: 3.0,
  thigh: 12.6,
  shin: 10.4,
  ankle: 3.5,
  chestY: 2.0,
  neckY: 13.3,
  shX: 0.8,
  shY: 9.4,
  shZ: 5.0,
  uarm: 9.4,
  farm: 6.9,
} as const;

export interface BoneDef {
  name: BoneName;
  parent: BoneName | null;
  /** Offset from the parent's origin in the parent's frame. */
  at: [number, number, number];
}

export const BONE_NAMES = [
  'root',
  'chest',
  'head',
  'uarmL',
  'larmL',
  'handL',
  'uarmR',
  'larmR',
  'handR',
  'ulegL',
  'llegL',
  'footL',
  'ulegR',
  'llegR',
  'footR',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

const R = RIG;
export const BONES: readonly BoneDef[] = [
  { name: 'root', parent: null, at: [0, 0, 0] },
  { name: 'chest', parent: 'root', at: [0, R.chestY, 0] },
  { name: 'head', parent: 'chest', at: [0, R.neckY, 0] },
  { name: 'uarmL', parent: 'chest', at: [R.shX, R.shY, R.shZ] },
  { name: 'larmL', parent: 'uarmL', at: [0, -R.uarm, 0] },
  { name: 'handL', parent: 'larmL', at: [0, -R.farm, 0] },
  { name: 'uarmR', parent: 'chest', at: [R.shX, R.shY, -R.shZ] },
  { name: 'larmR', parent: 'uarmR', at: [0, -R.uarm, 0] },
  { name: 'handR', parent: 'larmR', at: [0, -R.farm, 0] },
  { name: 'ulegL', parent: 'root', at: [0, R.hipY, R.hipZ] },
  { name: 'llegL', parent: 'ulegL', at: [0, -R.thigh, 0] },
  { name: 'footL', parent: 'llegL', at: [0, -R.shin, 0] },
  { name: 'ulegR', parent: 'root', at: [0, R.hipY, -R.hipZ] },
  { name: 'llegR', parent: 'ulegR', at: [0, -R.thigh, 0] },
  { name: 'footR', parent: 'llegR', at: [0, -R.shin, 0] },
];
