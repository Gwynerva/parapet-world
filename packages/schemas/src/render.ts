/**
 * Render settings (`content/render.json`): visual only, never part of the ruleset hash. A region
 * may override `slabDepth` and `perspective`; the player's settings may lower `perspective` to 0.
 */
export interface RenderSettings {
  /** Logical resolution of the world framebuffer. */
  logical: [number, number];
  /** How deep tile edges are extruded into the screen, in px. */
  slabDepth: number;
  /** A point 32 px deep moves this fraction of the way toward the screen centre. */
  perspective: number;
  /** Where runners and props stand, as a fraction of the slab depth (0 front, 1 back). */
  runnerDepth: number;
  depthFill: 'strip' | 'edge' | 'flat';
}

export const DEFAULT_RENDER: RenderSettings = {
  logical: [683, 384],
  slabDepth: 16,
  perspective: 0.15,
  runnerDepth: 0.5,
  depthFill: 'strip',
};

/** The camera distance that gives a perspective strength (see the level prototype). */
export const cameraDistance = (perspective: number): number =>
  perspective > 0 ? 32 / perspective - 32 : Infinity;
