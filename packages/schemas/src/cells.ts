/**
 * Collision classes. Every obstacle a trick uses is a cell class (a technique taken from Classic);
 * tiles and props stamp the same classes, and the simulation never knows which one a cell came
 * from. Shapes, with y growing downward inside a 32 px cell:
 *
 * | id | name       | char | shape                                                                 |
 * | -- | ---------- | ---- | --------------------------------------------------------------------- |
 * | 0  | EMPTY      | `.`  | nothing                                                               |
 * | 1  | SOLID      | `#`  | the whole cell                                                        |
 * | 2  | TOP        | `=`  | a one-way floor along the cell's top edge (catwalks, shelves, planks) |
 * | 3  | SLOPE_UP   | `/`  | solid below the diagonal from bottom-left to top-right                |
 * | 4  | SLOPE_DOWN | `\`  | solid below the diagonal from top-left to bottom-right                |
 * | 5  | HALF       | `_`  | the bottom half (16 px): curbs, pallets, low walls                    |
 * | 6  | POST       | `n`  | a post 8 px wide in the cell's middle, full height; its top corners   |
 * |    |            |      | are ledges (a thin obstacle to vault)                                 |
 * | 7  | LADDER     | `H`  | no collision; climbable over the whole cell                           |
 * | 8  | POLE       | `P`  | no collision; a vertical pole on the cell's middle line               |
 * | 9  | BAR        | `-`  | a horizontal bar 2 px below the cell's top edge: hands hang from it,  |
 * |    |            |      | feet may stand on it like on TOP                                      |
 * | 10 | SLAB       | `s`  | the top half (16 px): a low ceiling to roll or slide under            |
 * | 11 | KILL       | `~`  | no collision; touching it is fatal (sewage)                           |
 *
 * Ledges are not a class: the top corner of any SOLID, HALF or POST cell with free space above
 * and beside it is grabbable. Walls to run on are the sides of SOLID cells.
 */
export const Cell = {
  EMPTY: 0,
  SOLID: 1,
  TOP: 2,
  SLOPE_UP: 3,
  SLOPE_DOWN: 4,
  HALF: 5,
  POST: 6,
  LADDER: 7,
  POLE: 8,
  BAR: 9,
  SLAB: 10,
  KILL: 11,
} as const;
export type CellClass = (typeof Cell)[keyof typeof Cell];

/** Set on a class read from a chunk that is not loaded; the simulation stalls instead of guessing. */
export const CELL_MISSING = 0x80;

/** The characters of collision masks (props) and of the default room legend. */
export const CELL_CHARS: Readonly<Record<string, CellClass>> = {
  '.': Cell.EMPTY,
  '#': Cell.SOLID,
  '=': Cell.TOP,
  '/': Cell.SLOPE_UP,
  '\\': Cell.SLOPE_DOWN,
  _: Cell.HALF,
  n: Cell.POST,
  H: Cell.LADDER,
  P: Cell.POLE,
  '-': Cell.BAR,
  s: Cell.SLAB,
  '~': Cell.KILL,
};

/** Classes whose shape the level extrudes into the slab (the others are drawn flat or not at all). */
export const EXTRUDED: ReadonlySet<CellClass> = new Set<CellClass>([
  Cell.SOLID,
  Cell.TOP,
  Cell.SLOPE_UP,
  Cell.SLOPE_DOWN,
  Cell.HALF,
  Cell.SLAB,
]);
