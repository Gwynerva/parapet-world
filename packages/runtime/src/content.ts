/**
 * Browser loaders for baked content (`packages/content/dist`, served by URL): JSON, PNG pixels and
 * the art of a world. The renderer itself takes decoded data, so the game may fetch differently
 * (by hash, from a cache) and still use it.
 */
import type { ClipFile, WorldIndex } from '@parapet-world/schemas';
import type { WorldArt } from './renderer.ts';
import type { Pixels } from './skin.ts';

export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return (await r.json()) as T;
}

/** Decodes an image to straight-alpha RGBA pixels. */
export async function pixelsFromBlob(blob: Blob): Promise<Pixels> {
  const bmp = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const w = bmp.width,
    h = bmp.height;
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2D context to decode images');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: img.data };
}

export async function fetchPixels(url: string): Promise<Pixels> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return pixelsFromBlob(await r.blob());
}

export const fetchClip = (url: string): Promise<ClipFile> => fetchJson<ClipFile>(url);

/**
 * Loads every district's tile atlas, its background layers and the props atlas. `base` is the
 * URL of the content root (ending in '/'). A layer file without a folder is looked up beside its
 * district's atlas (`art/<district>/`), otherwise from the root. Missing backgrounds or props are
 * left out rather than failing the world.
 */
export async function loadWorldArt(
  base: string,
  world: WorldIndex,
  propsFile = 'art/props.png',
): Promise<WorldArt> {
  const atlases: Record<string, Pixels> = {},
    backgrounds: Record<string, Pixels> = {};
  const jobs: Promise<void>[] = [];
  for (const d of world.districts) {
    jobs.push(
      fetchPixels(base + d.atlas).then((p) => {
        atlases[d.id] = p;
      }),
    );
    const dir = d.atlas.includes('/') ? d.atlas.slice(0, d.atlas.lastIndexOf('/') + 1) : '';
    for (const l of d.background) {
      const url = base + (l.file.includes('/') ? l.file : dir + l.file);
      jobs.push(
        fetchPixels(url).then(
          (p) => {
            backgrounds[l.file] = p;
          },
          () => undefined,
        ),
      );
    }
  }
  let props: Pixels | null = null;
  jobs.push(
    fetchPixels(base + propsFile).then(
      (p) => {
        props = p;
      },
      () => undefined,
    ),
  );
  await Promise.all(jobs);
  return { atlases, backgrounds, props };
}
