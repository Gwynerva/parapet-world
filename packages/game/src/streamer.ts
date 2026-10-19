/**
 * Chunk streaming: the chunks within `RADIUS` of the camera and of the own runner are fetched and
 * handed on; chunks farther than `RADIUS + 1` from both are dropped again (one chunk of hysteresis
 * against churn). A chunk inside the world's bounds that the bake did not write is loaded as empty
 * air, so a runner never stalls on it. The work is done only when one of the two centre chunks
 * changes or a fetch has finished, so a frame in between costs a comparison.
 */
import { CHUNK_AREA, chunkKey, type ChunkFile, type WorldIndex } from '@parapet-world/schemas';

export const RADIUS = 2;
const CONCURRENT = 4;
const CACHE = 64;
const RETRY_MS = 2000;

export interface ChunkSink {
  /** A fetched chunk: load it into the simulation and the renderer. */
  load(file: ChunkFile): void;
  /** A chunk inside the bounds without a file: air for the simulation. */
  loadEmpty(cx: number, cy: number): void;
  unload(cx: number, cy: number): void;
}

export class ChunkStreamer {
  private readonly refs = new Map<number, string>();
  private readonly loaded = new Set<number>();
  private readonly pending = new Set<number>();
  private readonly cache = new Map<string, ChunkFile>();
  private readonly failed = new Map<number, number>();
  private readonly bounds: readonly [number, number, number, number];
  private readonly fetchChunk: (file: string) => Promise<ChunkFile>;
  private readonly sink: ChunkSink;
  private inFlight = 0;
  /** The centres of the last pass, and whether something changed since. */
  private readonly last = [NaN, NaN, NaN, NaN];
  private dirty = true;
  /** Failed fetches, for the HUD. */
  errors = 0;

  constructor(
    world: WorldIndex,
    fetchChunk: (file: string) => Promise<ChunkFile>,
    sink: ChunkSink,
  ) {
    this.fetchChunk = fetchChunk;
    this.sink = sink;
    this.bounds = world.bounds;
    for (const c of world.chunks) this.refs.set(chunkKey(c.cx, c.cy), c.file);
  }

  /** Whether a chunk is loaded (or known to be air). */
  has(cx: number, cy: number): boolean {
    return this.loaded.has(chunkKey(cx, cy));
  }

  get loadedCount(): number {
    return this.loaded.size;
  }

  /**
   * Brings the chunks around two centre chunks (the camera's and the runner's) in and drops the
   * far ones; does nothing when neither centre moved and no fetch finished since the last call.
   */
  update(ax: number, ay: number, bx: number, by: number): void {
    const l = this.last;
    if (!this.dirty && l[0] === ax && l[1] === ay && l[2] === bx && l[3] === by) return;
    l[0] = ax;
    l[1] = ay;
    l[2] = bx;
    l[3] = by;
    this.dirty = false;
    // nearest first: the 3 x 3 around a runner decide whether it can step
    for (let r = 0; r <= RADIUS; r++) {
      this.ring(ax, ay, r);
      this.ring(bx, by, r);
    }
    for (const key of this.loaded) {
      const cx = key >> 16,
        cy = (key << 16) >> 16;
      const near =
        Math.max(Math.abs(cx - ax), Math.abs(cy - ay)) <= RADIUS + 1 ||
        Math.max(Math.abs(cx - bx), Math.abs(cy - by)) <= RADIUS + 1;
      if (!near) {
        this.loaded.delete(key);
        this.sink.unload(cx, cy);
      }
    }
  }

  /** Requests the chunks at Chebyshev distance `r` from a centre. */
  private ring(ccx: number, ccy: number, r: number): void {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = ccx + dx,
          cy = ccy + dy;
        if (this.inside(cx, cy)) this.request(cx, cy);
      }
    }
  }

  private inside(cx: number, cy: number): boolean {
    const b = this.bounds;
    return cx >= b[0] && cy >= b[1] && cx < b[0] + b[2] && cy < b[1] + b[3];
  }

  private request(cx: number, cy: number): void {
    const key = chunkKey(cx, cy);
    if (this.loaded.has(key) || this.pending.has(key)) return;
    const file = this.refs.get(key);
    if (!file) {
      this.loaded.add(key);
      this.sink.loadEmpty(cx, cy);
      return;
    }
    const cached = this.cache.get(file);
    if (cached) {
      this.loaded.add(key);
      this.sink.load(cached);
      return;
    }
    // at the limit: a finishing fetch marks the streamer dirty and this comes round again
    if (this.inFlight >= CONCURRENT) return;
    const failedAt = this.failed.get(key);
    if (failedAt !== undefined && performance.now() - failedAt < RETRY_MS) {
      this.dirty = true;
      return;
    }
    this.inFlight++;
    this.pending.add(key);
    this.fetchChunk(file).then(
      (c) => {
        this.inFlight--;
        this.pending.delete(key);
        this.cache.set(file, c);
        // keep the most recent files for quick reloads, not the whole world
        if (this.cache.size > CACHE) this.cache.delete(this.cache.keys().next().value!);
        this.dirty = true;
      },
      () => {
        this.inFlight--;
        this.pending.delete(key);
        this.failed.set(key, performance.now());
        this.errors++;
        this.dirty = true;
      },
    );
  }
}

/** The empty cells of a chunk the bake did not write. */
export const EMPTY_CELLS = new Uint8Array(CHUNK_AREA);
