import { describe, expect, it } from 'vitest';
import {
  CELL_CHARS,
  Cell,
  base64ToBytes,
  bytesToBase64,
  chunkKey,
  chunkOfCell,
  chunkOfKey,
  frontRect,
  sideStripRect,
  skinFaceRect,
  topStripRect,
} from '../src/index.ts';

describe('schemas', () => {
  it('round-trips bytes through base64', () => {
    for (const n of [0, 1, 2, 3, 4, 1024]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('packs chunk keys with negative coordinates', () => {
    for (const [cx, cy] of [
      [0, 0],
      [-1, 2],
      [3, -4],
      [-300, -7],
    ] as const) {
      expect(chunkOfKey(chunkKey(cx, cy))).toEqual([cx, cy]);
    }
    expect(chunkOfCell(-1)).toBe(-1);
    expect(chunkOfCell(31)).toBe(0);
    expect(chunkOfCell(32)).toBe(1);
  });

  it('maps every mask character to a class', () => {
    expect(CELL_CHARS['#']).toBe(Cell.SOLID);
    expect(new Set(Object.values(CELL_CHARS)).size).toBe(Object.keys(Cell).length);
  });

  it('keeps atlas rects inside their slot', () => {
    expect(frontRect(0, 15)).toEqual([1 + 15 * 34, 1, 32, 32]);
    expect(topStripRect(1)).toEqual([1, 1 + 68 + 34, 32, 16]);
    expect(sideStripRect(1)).toEqual([35, 1 + 68 + 34, 16, 32]);
  });

  it('lays skin faces inside the base half', () => {
    const [x, y, w, h] = skinFaceRect('footR', 'R');
    expect(x + w).toBeLessThanOrEqual(128);
    expect(y + h).toBeLessThanOrEqual(64);
  });
});
