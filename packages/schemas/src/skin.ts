/**
 * Skin sheets. A sheet is 128 x 128 PNG: the base layer in the top half, the overlay layer in the
 * bottom half with the same layout (drawn on a shell 0.7 px out, 1 px on the head, double-sided,
 * alpha cut-out). Every part is a box in the Minecraft cross layout, one texel per world px. A
 * part's region at (x, y) is 2(w + d) wide and d + h tall: the top cap above the front and the
 * bottom cap above the back, then the strip front | left side | back | right side, every face seen
 * from outside and upright. Box sizes: w across the body (z), d along the run (x), h along the bone
 * (y; the foot's box stands upright like every other).
 *
 * L and R here are the runner's own sides. The rig names bones by the near and far side of a runner
 * facing right (its L bones sit on +z, the runner's right), so region `uarmR` skins bone `uarmL`.
 * A 256 x 256 sheet is a 2x skin with the same layout.
 *
 * A look is a stack of sheets composited once (alpha over, each half separately): body, hair,
 * costume. Sheets live in `content/skins/<id>.png`.
 */
export const SKIN_SHEET = 128;
export const SKIN_HALF = 64;
export const SKIN_SHELL = 0.7;
export const SKIN_SHELL_HEAD = 1.0;
export const SKIN_LAYOUT_VERSION = 1;

/** Region x, y and box w, d, h for every part. */
export const SKIN: Readonly<Record<SkinPart, [number, number, number, number, number]>> = {
  head: [0, 0, 12, 13, 14],
  chest: [50, 0, 13, 10, 11],
  ulegL: [96, 0, 7, 7, 13],
  ulegR: [96, 20, 7, 7, 13],
  pelvis: [50, 21, 13, 9, 7],
  llegL: [0, 27, 6, 6, 10],
  llegR: [24, 27, 6, 6, 10],
  footL: [48, 37, 5, 11, 4],
  footR: [80, 40, 5, 11, 4],
  uarmL: [0, 43, 5, 5, 9],
  uarmR: [20, 43, 5, 5, 9],
  larmL: [112, 40, 4, 4, 7],
  larmR: [112, 51, 4, 4, 7],
  handL: [40, 52, 4, 5, 5],
  handR: [58, 52, 4, 5, 5],
  neck: [76, 55, 4, 4, 3],
};
export type SkinPart =
  | 'head'
  | 'chest'
  | 'pelvis'
  | 'neck'
  | 'ulegL'
  | 'ulegR'
  | 'llegL'
  | 'llegR'
  | 'footL'
  | 'footR'
  | 'uarmL'
  | 'uarmR'
  | 'larmL'
  | 'larmR'
  | 'handL'
  | 'handR';

/** Faces: F front, L left side, B back, R right side, T top cap, U bottom cap. */
export type SkinFace = 'F' | 'L' | 'B' | 'R' | 'T' | 'U';

/** A face's rect (x, y, w, h) inside the base layer; add `SKIN_HALF` to y for the overlay. */
export function skinFaceRect(part: SkinPart, f: SkinFace): [number, number, number, number] {
  const [x, y, w, d, h] = SKIN[part];
  switch (f) {
    case 'F':
      return [x, y + d, w, h];
    case 'L':
      return [x + w, y + d, d, h];
    case 'B':
      return [x + w + d, y + d, w, h];
    case 'R':
      return [x + 2 * w + d, y + d, d, h];
    case 'T':
      return [x, y, w, d];
    case 'U':
      return [x + w + d, y, w, d];
  }
}

export const BODIES = ['body'] as const;
export const HAIRS = ['hairRed', 'hairShort'] as const;
export const COSTUMES = ['classic', 'tee', 'hoodie', 'summer'] as const;
export type HairId = (typeof HAIRS)[number];
export type CostumeId = (typeof COSTUMES)[number];

/** What a runner looks like; never part of the simulation. */
export interface Look {
  hair: HairId;
  costume: CostumeId;
}
export const DEFAULT_LOOK: Look = { hair: 'hairRed', costume: 'classic' };
