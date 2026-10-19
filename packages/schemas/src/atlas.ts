/**
 * The tile atlas of a district (`content/art/<district>/tiles.png`). Each material has a slot: a
 * band 68 px tall. Its first row holds the 16 autotile variants of the front tile (32 x 32 each);
 * its second row the top depth strip (32 x 16, laid along top faces and undersides, its first row
 * meets the front face) and the side depth strip (16 x 32, laid along side walls, its first
 * column meets the front face). Every rect has a 1 px gutter that repeats its edge pixels, so
 * sampling at an edge never picks a neighbour.
 *
 * The variant of a cell is a 4-bit mask of which neighbours carry the same material:
 * 1 up, 2 right, 4 down, 8 left. Variant 15 is the inside of a mass, variant 0 a lone tile.
 */
export const TILE = 32;
export const ATLAS_PITCH = TILE + 2;
export const SLOT_HEIGHT = ATLAS_PITCH * 2;
export const ATLAS_WIDTH = ATLAS_PITCH * 16;
export const atlasHeight = (slots: number): number => slots * SLOT_HEIGHT;

export const VARIANT = { UP: 1, RIGHT: 2, DOWN: 4, LEFT: 8 } as const;

export type Rect = [number, number, number, number];
export const frontRect = (slot: number, variant: number): Rect => [
  1 + variant * ATLAS_PITCH,
  1 + slot * SLOT_HEIGHT,
  TILE,
  TILE,
];
export const topStripRect = (slot: number): Rect => [
  1,
  1 + slot * SLOT_HEIGHT + ATLAS_PITCH,
  TILE,
  16,
];
export const sideStripRect = (slot: number): Rect => [
  1 + ATLAS_PITCH,
  1 + slot * SLOT_HEIGHT + ATLAS_PITCH,
  16,
  TILE,
];
