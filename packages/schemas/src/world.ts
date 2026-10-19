import type { CellClass } from './cells.ts';
import type { PropDef } from './props.ts';

/** A rectangle in cells: left, top, width, height. */
export type CellRect = [number, number, number, number];

/**
 * The baked world index (`dist/world.json`): everything static the client and the server need
 * besides the chunks themselves. Indices into these arrays are stable for one bake.
 */
export interface WorldIndex {
  format: 1;
  /** Bounds of the world in chunks: first chunk x, y and the number of chunks across and down. */
  bounds: [number, number, number, number];
  chunks: ChunkRef[];
  /** Index 0 is unused (material 0 means "not drawn"). */
  materials: MaterialDef[];
  districts: DistrictDef[];
  regions: RegionDef[];
  hubs: HubDef[];
  routes: RouteDef[];
  finds: FindDef[];
  /** The prop catalogue; `PropPlacement.prop` indexes it. */
  props: PropDef[];
  /** File names of bot routes under `dist/bots/`. */
  bots: string[];
  /** The hub new players start at. */
  startHub: number;
}

export interface ChunkRef {
  cx: number;
  cy: number;
  /** `chunks/<hash>.json` under `dist/`. */
  file: string;
}

export interface MaterialDef {
  id: string;
  district: string;
  /** The material's slot in its district's tile atlas (`atlas.ts`). */
  slot: number;
  /** The collision class its room character stamps. */
  cell: CellClass;
  /** Average colour, for the `flat` depth fill and the minimap. */
  avg: [number, number, number];
  /** How its depth faces are filled; `strip` falls back to `edge` when the atlas has no strips. */
  depth: 'strip' | 'edge' | 'flat';
  /** Footstep sound family. */
  sound: 'concrete' | 'metal' | 'wood' | 'brick' | 'grate' | 'tar' | 'wet';
}

export interface DistrictDef {
  id: 'rooftops' | 'warehouses' | 'factory' | 'sewer';
  name: string;
  /** `art/<district>/tiles.png` under `dist/`. */
  atlas: string;
  /** Parallax layers, far to near. */
  background: BackgroundLayer[];
  /** Clear colour behind every layer. */
  sky: [number, number, number];
  ambience: string;
}

export interface BackgroundLayer {
  file: string;
  /** Scroll factor: 0 never moves, 1 moves with the front faces. */
  factor: number;
  /**
   * The image's top edge sits at screen y = `y - factor * viewTop`, where `viewTop` is the world
   * y (px) of the top edge of the 683 x 384 logical view; x scrolls the same way.
   */
  y: number;
  repeatX: boolean;
}

export interface RegionDef {
  id: string;
  district: string;
  rect: CellRect;
  /** The hub a death in this region returns to. */
  hub: number;
}

export interface HubDef {
  id: string;
  district: string;
  name: string;
  /** Standing anywhere inside allows teleport; touching it discovers the hub. */
  rect: CellRect;
  /** Where a runner appears: world units of the feet point, and the facing (1 right, -1 left). */
  spawn: [number, number];
  facing: 1 | -1;
}

export interface RouteDef {
  id: string;
  district: string;
  name: string;
  /** 1 easy, 2 medium, 3 hard, 4 expert. */
  difficulty: 1 | 2 | 3 | 4;
  start: CellRect;
  checkpoints: CellRect[];
  finish: CellRect;
  /** Leaving every corridor rect cancels the run. */
  corridor: CellRect[];
}

export interface FindDef {
  id: string;
  district: string;
  rect: CellRect;
  /** A broad clue tied to a landmark, shown in the district's hub until found. */
  clue: string;
}

/** Unlocks by the number of finds. */
export const UNLOCKS: ReadonlyArray<{ finds: number; kind: 'costume' | 'hair'; id: string }> = [
  { finds: 3, kind: 'costume', id: 'tee' },
  { finds: 6, kind: 'costume', id: 'hoodie' },
  { finds: 9, kind: 'costume', id: 'summer' },
  { finds: 12, kind: 'hair', id: 'hairShort' },
];
