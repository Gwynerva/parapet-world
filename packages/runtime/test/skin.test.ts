import { describe, expect, it } from 'vitest';
import { buildBody, buildShell, VERTEX_FLOATS } from '../src/mesh.ts';
import { cleanLayer, composeSkin, maskOf, overOnto, resample, type Pixels } from '../src/skin.ts';
import { paintLayer, type LayerName } from '../dev/painters.ts';

const hashOf = (px: ArrayLike<number>): number => {
  let h = 0;
  for (let i = 0; i < px.length; i++) h = (h * 31 + px[i]!) >>> 0;
  return h;
};

describe('skin compositing', () => {
  it('ports the demo painters texel for texel', () => {
    // reference hashes of the demo's paintLayer(name, 1)
    const want: Record<LayerName, number> = {
      body: 3304959778,
      hairRed: 579516324,
      hairShort: 2267143120,
      hoodie: 1025763388,
      tee: 614402506,
      classic: 3249985575,
      summer: 3266655348,
    };
    for (const [name, h] of Object.entries(want)) {
      expect([name, hashOf(paintLayer(name as LayerName).data)]).toEqual([name, h]);
    }
  });

  it('composites looks and shells exactly like the demo', () => {
    // triangles (base + shell) and sheet hashes of the demo's composeSkin(['body', hair, costume], 1)
    const want: Record<string, [number, number]> = {
      'hoodie/hairRed': [1487, 1400614416],
      'hoodie/hairShort': [1399, 2286587736],
      'hoodie/': [1359, 691298555],
      'tee/hairRed': [1483, 3784976739],
      'classic/hairRed': [1659, 90778362],
      'classic/hairShort': [1571, 976751682],
      'summer/hairShort': [1363, 2956824700],
      'summer/': [1323, 1361535519],
    };
    const body = buildBody();
    for (const [key, [tris, h]] of Object.entries(want)) {
      const [costume, hair] = key.split('/') as [LayerName, LayerName | ''];
      const layers = [paintLayer('body'), ...(hair ? [paintLayer(hair)] : []), paintLayer(costume)];
      const s = composeSkin(layers);
      const shell = buildShell(body, s.mask);
      expect([key, body.triangles + shell.length / VERTEX_FLOATS / 3, hashOf(s.pixels)]).toEqual([
        key,
        tris,
        h,
      ]);
    }
  });

  it('mixes 1x and 2x sheets at the larger scale', () => {
    const one = paintLayer('body', 1),
      two = paintLayer('classic', 2);
    const s = composeSkin([one, two]);
    expect(s.size).toBe(256);
    expect(s.scale).toBe(2);
    // the 2x mask equals the 1x mask of the same design where texels are fully covered
    const m1 = composeSkin([one, paintLayer('classic', 1)]).mask;
    let same = 0;
    for (let i = 0; i < m1.length; i++) if (m1[i] === s.mask[i]) same++;
    expect(same / m1.length).toBeGreaterThan(0.98);
  });

  it('rejects sheets of the wrong size', () => {
    const bad: Pixels = { width: 100, height: 100, data: new Uint8Array(100 * 100 * 4) };
    expect(() => composeSkin([bad])).toThrow(/128 x 128/);
  });

  it('composites alpha over and resamples with nearest filtering', () => {
    const dst = new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]);
    overOnto(dst, new Uint8Array([200, 100, 0, 128, 50, 60, 70, 255]));
    expect(Array.from(dst)).toEqual([105, 60, 15, 255, 50, 60, 70, 255]);
    const p: Pixels = {
      width: 2,
      height: 2,
      data: new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]),
    };
    expect(Array.from(resample(p, 4)).filter((_, i) => i % 4 === 0)).toEqual([
      1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4,
    ]);
  });

  it('clears faint template tints and marks opaque overlay texels', () => {
    const W = 128,
      data = new Uint8Array(W * W * 4);
    data[(70 * W + 5) * 4 + 3] = 20; // faint: cleared
    data[(80 * W + 6) * 4 + 3] = 255;
    const c = cleanLayer({ width: W, height: W, data });
    expect(c.data[(70 * W + 5) * 4 + 3]).toBe(0);
    const m = maskOf(c.data, 1);
    expect(m[(80 - 64) * W + 6]).toBe(1);
    expect(m.reduce((a, b) => a + b, 0)).toBe(1);
  });
});
