/**
 * Units of the world. One pixel is 32 units, one cell is 32 px, one chunk is 32 x 32 cells.
 * The y axis grows downward everywhere: cells, units, pixels, rooms and images all count rows from
 * the top, and gravity is positive y. Only the 3D rig and its clips use y up (see `rig.ts`).
 */
export const UNITS_PER_PX = 32;
export const CELL_PX = 32;
export const CELL = UNITS_PER_PX * CELL_PX;
export const CHUNK_CELLS = 32;
export const CHUNK_PX = CELL_PX * CHUNK_CELLS;
export const CHUNK = CELL * CHUNK_CELLS;
export const STEPS_PER_SECOND = 30;

/** The chunk that holds a cell; arithmetic shift keeps negative cells correct. */
export const chunkOfCell = (cell: number): number => cell >> 5;

/** A chunk's key: both coordinates packed into one int32. */
export const chunkKey = (cx: number, cy: number): number => ((cx & 0xffff) << 16) | (cy & 0xffff);

/** The chunk coordinates back from a key (sign-extended). */
export const chunkOfKey = (key: number): [number, number] => [key >> 16, (key << 16) >> 16];
