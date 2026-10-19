import { describe, expect, it } from 'vitest';
import type { CellRect } from '@parapet-world/schemas';
import {
  BLEND_CELLS,
  createDistrictMask,
  fillDistrictMask,
  type DistrictArea,
  type DistrictMask,
} from '../src/backdrop.ts';

// the city's layout in miniature: rooftops over the street (warehouses west, factory east) over
// the sewer, all four bands in one chunk column pair (64 x 128 cells)
const areas: DistrictArea[] = [
  { rect: [0, 0, 64, 32] as CellRect, district: 0 },
  { rect: [0, 32, 32, 64] as CellRect, district: 1 },
  { rect: [32, 32, 32, 64] as CellRect, district: 2 },
  { rect: [0, 96, 64, 32] as CellRect, district: 3 },
];
const bounds = [0, 0, 2, 4] as const;

/** The weights of district `d` at cell (x, y) of the mask, 0..1. */
const weight = (m: DistrictMask, d: number, x: number, y: number): number => {
  const c = m.channels.indexOf(d);
  return c < 0 ? 0 : m.data[((y - m.y0) * m.w + (x - m.x0)) * 4 + c]! / 255;
};

describe('district mask', () => {
  it('gives every cell away from a border to its own district alone', () => {
    const m = createDistrictMask();
    fillDistrictMask(m, areas, bounds, 3, 10, 80, 30, 30);
    expect(m.channels[0]).toBe(3);
    expect(m.used).toBe(3);
    // deep in the sewer, deep in the warehouses' street, deep in the factory's
    expect(weight(m, 3, 15, 105)).toBe(1);
    expect(weight(m, 1, 15, 85)).toBe(1);
    expect(weight(m, 2, 36, 85)).toBe(1);
    expect(weight(m, 3, 15, 85)).toBe(0);
    expect(weight(m, 1, 15, 105)).toBe(0);
    // every cell's channels add up to one
    for (let i = 0; i < m.w * m.h; i++) {
      const s = m.data[i * 4]! + m.data[i * 4 + 1]! + m.data[i * 4 + 2]! + m.data[i * 4 + 3]!;
      expect(Math.abs(s - 255)).toBeLessThanOrEqual(1);
    }
  });

  it('cross-fades only within BLEND_CELLS of a border, half way at the border', () => {
    const m = createDistrictMask();
    fillDistrictMask(m, areas, bounds, 1, 4, 86, 40, 20);
    const r = BLEND_CELLS;
    // the street over the sewer at row 96: texel centres are cell centres, so the two cells on
    // either side of the line share it evenly
    expect(weight(m, 1, 10, 95) + weight(m, 3, 10, 95)).toBeCloseTo(1, 2);
    expect(weight(m, 1, 10, 95)).toBeCloseTo((r + 1) / (2 * r + 1), 2);
    expect(weight(m, 3, 10, 96)).toBeCloseTo((r + 1) / (2 * r + 1), 2);
    expect(weight(m, 1, 10, 96 - r - 1)).toBe(1);
    expect(weight(m, 3, 10, 96 + r)).toBe(1);
    // the warehouses beside the factory at column 32
    expect(weight(m, 1, 32 - r - 1, 90)).toBe(1);
    expect(weight(m, 2, 32 + r, 90)).toBe(1);
    expect(weight(m, 2, 31, 90)).toBeGreaterThan(0);
    expect(weight(m, 2, 31, 90)).toBeLessThan(0.5);
  });

  it('extends the bands beyond the world and draws a single district where it is alone', () => {
    const m = createDistrictMask();
    // above the world's top and left of its left edge: still the rooftops
    fillDistrictMask(m, areas, bounds, 0, -20, -20, 30, 30);
    expect(m.used).toBe(1);
    expect(weight(m, 0, -20, -20)).toBe(1);
    // below the world: still the sewer
    fillDistrictMask(m, areas, bounds, 3, 0, 120, 40, 20);
    expect(m.used).toBe(1);
    expect(weight(m, 3, 10, 139)).toBe(1);
  });

  it('gives cells no region holds to the base district', () => {
    const m = createDistrictMask();
    fillDistrictMask(m, [{ rect: [0, 0, 10, 10], district: 2 }], [0, 0, 1, 1], 5, 0, 0, 20, 20);
    expect(weight(m, 2, 3, 3)).toBe(1);
    expect(weight(m, 5, 15, 15)).toBe(1);
    expect(m.channels[0]).toBe(5);
  });

  it('allocates nothing when the window keeps its size', () => {
    const m = createDistrictMask();
    fillDistrictMask(m, areas, bounds, 1, 0, 80, 30, 20);
    const data = m.data,
      cells = m.cells,
      rows = m.rows;
    for (let x = 0; x < 20; x++) fillDistrictMask(m, areas, bounds, 1, x, 80 + x, 30, 20);
    expect(m.data).toBe(data);
    expect(m.cells).toBe(cells);
    expect(m.rows).toBe(rows);
  });
});
