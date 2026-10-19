/**
 * A prop: a static, cell-aligned object drawn flat in the runners' plane (the middle of the slab).
 * The catalogue lives in `content/props/props.json`; sprites are in the single props atlas
 * `content/art/props.png`.
 */
export interface PropDef {
  id: string;
  districts: string[];
  /** The sprite in the props atlas: x, y, width, height in px. */
  sprite: [number, number, number, number];
  /** Where the sprite's top-left goes, in px from the mask's top-left cell corner (may be negative). */
  offset: [number, number];
  /** Collision rows from top to bottom, one `CELL_CHARS` character per cell; `.` stamps nothing. */
  mask: string[];
  /** `mid`: drawn before runners; `front`: decoration drawn after runners (its mask must be empty). */
  layer: 'mid' | 'front';
}
