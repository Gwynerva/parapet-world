/**
 * Cell readers. The simulation reads collision classes through `CellReader`, never knowing
 * whether the cells come from streamed chunks (`ChunkWorld`) or one grid (`GridWorld`, for tests
 * and tools). A runner is stepped only when the 3 x 3 chunks around it are present (`ready`);
 * a read from a chunk that is not loaded returns `CELL_MISSING` instead of throwing.
 */
import {
  CELL_MISSING,
  CHUNK_AREA,
  CHUNK_CELLS,
  Cell,
  base64ToBytes,
  chunkKey,
  type ChunkFile,
} from '@parapet-world/schemas';

export interface CellReader {
  /** The collision class of a cell, or `CELL_MISSING` when its chunk is not loaded. */
  cell(cx: number, cy: number): number;
  /** Whether every chunk within one chunk of the chunk holding this cell is present. */
  ready(cx: number, cy: number): boolean;
}

/**
 * Bounds in chunks: first chunk x, y and the number of chunks across and down (`WorldIndex`).
 * Outside them the world is open air, and every row below the bottom edge is `KILL`, so a runner
 * that falls out of the world dies instead of falling forever.
 */
export type ChunkBounds = [number, number, number, number];

/** Streamed chunks keyed by `chunkKey`; immutable once loaded. */
export class ChunkWorld implements CellReader {
  readonly bounds: ChunkBounds;
  private readonly chunks = new Map<number, Uint8Array>();
  private lastKey = 0x7fffffff;
  private lastCells: Uint8Array | null = null;

  constructor(bounds: ChunkBounds) {
    this.bounds = [bounds[0], bounds[1], bounds[2], bounds[3]];
  }

  /** Loads a baked chunk file (decodes its cell grid). */
  load(file: ChunkFile): void {
    this.loadCells(file.cx, file.cy, base64ToBytes(file.cells));
  }

  /** Loads a chunk from its 32 x 32 collision classes, row-major from the top-left. */
  loadCells(cx: number, cy: number, cells: Uint8Array): void {
    if (cells.length !== CHUNK_AREA) throw new Error(`chunk ${cx},${cy}: ${cells.length} cells`);
    this.chunks.set(chunkKey(cx, cy), cells);
    this.lastKey = 0x7fffffff;
    this.lastCells = null;
  }

  unload(cx: number, cy: number): void {
    this.chunks.delete(chunkKey(cx, cy));
    this.lastKey = 0x7fffffff;
    this.lastCells = null;
  }

  /** Whether a chunk can be read: loaded, or outside the bounds (known to be air or `KILL`). */
  has(cx: number, cy: number): boolean {
    return !this.inside(cx, cy) || this.chunks.has(chunkKey(cx, cy));
  }

  /** Whether a chunk is inside the bounds. */
  inside(cx: number, cy: number): boolean {
    const b = this.bounds;
    return cx >= b[0] && cy >= b[1] && cx < b[0] + b[2] && cy < b[1] + b[3];
  }

  cell(x: number, y: number): number {
    const cx = x >> 5;
    const cy = y >> 5;
    const key = chunkKey(cx, cy);
    let cells = this.lastCells;
    if (key !== this.lastKey || cells === null) {
      if (!this.inside(cx, cy))
        return cy >= this.bounds[1] + this.bounds[3] ? Cell.KILL : Cell.EMPTY;
      cells = this.chunks.get(key) ?? null;
      if (cells === null) return CELL_MISSING;
      this.lastKey = key;
      this.lastCells = cells;
    }
    return cells[((y & 31) << 5) | (x & 31)]!;
  }

  ready(x: number, y: number): boolean {
    const cx = x >> 5;
    const cy = y >> 5;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (!this.has(cx + dx, cy + dy)) return false;
    }
    return true;
  }
}

/**
 * One grid of cells at an origin cell, always ready. Outside the grid it reads `outside`, and
 * rows below the grid read `below` (by default `KILL`, like the bottom of a `ChunkWorld`).
 */
export class GridWorld implements CellReader {
  readonly x0: number;
  readonly y0: number;
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;
  outside: number = Cell.EMPTY;
  below: number = Cell.KILL;

  constructor(width: number, height: number, x0 = 0, y0 = 0, cells?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.x0 = x0;
    this.y0 = y0;
    this.cells = cells ?? new Uint8Array(width * height);
    if (this.cells.length !== width * height) throw new Error('grid size mismatch');
  }

  /** A grid from rows of `CELL_CHARS` characters (see `schemas/cells.ts`). */
  static fromRows(rows: readonly string[], chars: Readonly<Record<string, number>>): GridWorld {
    const width = rows.reduce((w, r) => (r.length > w ? r.length : w), 0);
    const grid = new GridWorld(width, rows.length);
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y]!;
      for (let x = 0; x < row.length; x++) {
        const c = chars[row[x]!];
        if (c === undefined) throw new Error(`unknown cell character '${row[x]}' at ${x},${y}`);
        grid.cells[y * width + x] = c;
      }
    }
    return grid;
  }

  set(x: number, y: number, c: number): void {
    const gx = x - this.x0;
    const gy = y - this.y0;
    if (gx >= 0 && gy >= 0 && gx < this.width && gy < this.height)
      this.cells[gy * this.width + gx] = c;
  }

  cell(x: number, y: number): number {
    const gx = x - this.x0;
    const gy = y - this.y0;
    if (gy >= this.height) return this.below;
    if (gx < 0 || gy < 0 || gx >= this.width) return this.outside;
    return this.cells[gy * this.width + gx]!;
  }

  ready(): boolean {
    return true;
  }
}

/** Cuts a grid into chunk-sized cell arrays (what the baker writes), keyed by chunk position. */
export function gridChunks(grid: GridWorld): Array<{ cx: number; cy: number; cells: Uint8Array }> {
  const out: Array<{ cx: number; cy: number; cells: Uint8Array }> = [];
  const cx0 = grid.x0 >> 5;
  const cy0 = grid.y0 >> 5;
  const cx1 = (grid.x0 + grid.width - 1) >> 5;
  const cy1 = (grid.y0 + grid.height - 1) >> 5;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const cells = new Uint8Array(CHUNK_AREA);
      for (let y = 0; y < CHUNK_CELLS; y++) {
        for (let x = 0; x < CHUNK_CELLS; x++) {
          const wx = (cx << 5) + x;
          const wy = (cy << 5) + y;
          const gx = wx - grid.x0;
          const gy = wy - grid.y0;
          if (gx >= 0 && gy >= 0 && gx < grid.width && gy < grid.height) {
            cells[(y << 5) | x] = grid.cells[gy * grid.width + gx]!;
          } else cells[(y << 5) | x] = grid.outside;
        }
      }
      out.push({ cx, cy, cells });
    }
  }
  return out;
}
