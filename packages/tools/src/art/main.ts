// The art generator: `node packages/tools/src/art/main.ts`. Writes, under packages/content/art,
// each district's tile atlas, background layers and district.json and the props atlas; fills
// sprite rects into props/props.json and average colours into materials.json; and writes
// previews to packages/tools/out (a sample room per district at 2x and a props contact sheet).
// Optional arguments limit the run to the named districts (props are always written).
//
// Once an artist repaints a PNG, the PNG is the source: art/generated.json records the hash of
// every PNG the generator wrote, and a file whose bytes no longer match is kept (averages and
// previews then read it as it is; props.json is left alone if props.png is kept). `--force`
// overwrites such files.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PropDef } from '@parapet-world/schemas';
import { decodePng, encodePng } from '../png.ts';
import type { DistrictArt } from './district.ts';
import { factory } from './districts/factory.ts';
import { rooftops } from './districts/rooftops.ts';
import { sewer } from './districts/sewer.ts';
import { warehouses } from './districts/warehouses.ts';
import { Canvas } from './paint.ts';
import { renderContactSheet, renderPreview, type LegendEntry, type PropSprite } from './preview.ts';
import { MARKER_IDS, buildPropsAtlas } from './props.ts';
import { buildAtlas, slotAverage } from './tiles.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CONTENT = join(ROOT, 'packages', 'content');
const OUT = join(ROOT, 'packages', 'tools', 'out');
const DISTRICTS: readonly DistrictArt[] = [rooftops, warehouses, factory, sewer];

/** Props the generator adds to the catalogue when they are missing. */
const NEW_PROPS: Readonly<Record<string, Pick<PropDef, 'districts' | 'mask' | 'layer'>>> = {
  'chain.hook': { districts: ['factory'], mask: ['P'], layer: 'mid' },
};

interface MaterialsFile {
  comment: string;
  materials: Array<{ id: string; district: string; slot: number; cell: string; avg: number[] }>;
}

interface PropsFile {
  comment: string;
  props: PropDef[];
  markers: Record<string, unknown>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/** JSON laid out the way prettier prints it: objects expanded, short arrays on one line. */
const formatJson = (value: unknown, indent = '', prefix = 0): string => {
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const flat = value.every((v) => typeof v !== 'object' || v === null);
    const inline = `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    if (flat && prefix + inline.length + 1 <= 100) return inline;
    return `[\n${value.map((v) => inner + formatJson(v, inner, inner.length)).join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([k, v]) => {
      const head = `${inner}${JSON.stringify(k)}: `;
      return head + formatJson(v, inner, head.length);
    });
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
};

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, formatJson(value) + '\n');
};

const writePng = (path: string, g: Canvas): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(g.image()));
};

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const districts = only.length ? DISTRICTS.filter((d) => only.includes(d.id)) : DISTRICTS;

const ART = join(CONTENT, 'art');
const manifestPath = join(ART, 'generated.json');
const manifest: Record<string, string> = existsSync(manifestPath)
  ? readJson<{ files: Record<string, string> }>(manifestPath).files
  : {};
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Writes a generated PNG under art/ unless the file there was changed by hand since the generator
 * wrote it; returns the image that is on disk afterwards.
 */
const writeArt = (rel: string, g: Canvas): { image: Canvas; kept: boolean } => {
  const path = join(ART, rel);
  if (!force && existsSync(path)) {
    const bytes = readFileSync(path);
    if (manifest[rel] !== sha(bytes)) {
      console.log(`art: keeping ${rel}: it was changed by hand (--force overwrites it)`);
      return { image: Canvas.from(decodePng(bytes)), kept: true };
    }
  }
  const png = encodePng(g.image());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  manifest[rel] = sha(png);
  return { image: g, kept: false };
};

// Props first: the previews draw them.
const painted = buildPropsAtlas();
const { image: propsAtlas, kept: propsKept } = writeArt('props.png', painted.atlas);
const packed = painted.packed;
const propsPath = join(CONTENT, 'props', 'props.json');
const propsFile = readJson<PropsFile>(propsPath);
const byId = new Map(packed.map((p) => [p.art.id, p]));
const catalogue: PropDef[] = propsFile.props.map((def) => {
  if (propsKept) return def;
  const p = byId.get(def.id);
  if (!p) throw new Error(`art: no sprite painted for prop ${def.id}`);
  return { ...def, sprite: p.sprite, offset: p.art.offset };
});
for (const [id, extra] of Object.entries(NEW_PROPS)) {
  if (propsKept || catalogue.some((d) => d.id === id)) continue;
  const p = byId.get(id)!;
  catalogue.push({
    id,
    districts: extra.districts,
    sprite: p.sprite,
    offset: p.art.offset,
    mask: extra.mask,
    layer: extra.layer,
  });
}
const markers: Record<string, unknown> = { ...propsFile.markers };
if (!propsKept) for (const id of MARKER_IDS) markers[id] = byId.get(id)!.sprite;
writeJson(propsPath, {
  comment:
    'Prop catalogue (schemas PropDef). sprite and offset are written by the art generator (node packages/tools/src/art/main.ts) for art/props.png; ids, districts, masks and layers are kept. Masks are rows top to bottom in CELL_CHARS. Single-cell segment props (ladder, pole, bar, post, fence, chain) stack in rooms through palette characters and tile seamlessly.',
  props: catalogue,
  markers,
});
const sprites = new Map<string, PropSprite>(
  catalogue.map((d) => [d.id, { sprite: d.sprite, offset: d.offset, layer: d.layer }]),
);
writePng(
  join(OUT, 'art-preview-props.png'),
  renderContactSheet(propsAtlas, [
    ...catalogue.map((d) => {
      const tile = byId.get(d.id)?.art.tile;
      return { id: d.id, sprite: d.sprite, ...(tile ? { tile } : {}) };
    }),
    ...MARKER_IDS.map((id) => ({ id, sprite: markers[id] as PropDef['sprite'] })),
  ]),
);

// Districts: atlases, backgrounds, district.json, previews; average colours into materials.json.
const materialsPath = join(CONTENT, 'materials.json');
const materials = readJson<MaterialsFile>(materialsPath);
const palette = readJson<Record<string, Record<string, LegendEntry>>>(
  join(CONTENT, 'palette.json'),
);
const materialCells = new Map(materials.materials.map((m) => [m.id, m.cell]));
for (const d of districts) {
  d.materials.forEach((art, slot) => {
    const def = materials.materials.find((m) => m.id === art.id);
    if (!def || def.district !== d.id || def.slot !== slot) {
      throw new Error(`art: material ${art.id} is not slot ${slot} of ${d.id} in materials.json`);
    }
  });
  const atlas = writeArt(`${d.id}/tiles.png`, buildAtlas(d.materials)).image;
  d.materials.forEach((art, slot) => {
    materials.materials.find((m) => m.id === art.id)!.avg = slotAverage(atlas, slot);
  });
  const layers = d.layers.map((l) => writeArt(`${d.id}/${l.file}`, l.paint()).image);
  writeJson(join(ART, d.id, 'district.json'), {
    id: d.id,
    name: d.name,
    sky: d.sky,
    background: d.layers.map((l) => ({ file: l.file, factor: l.factor, y: l.y, repeatX: true })),
    ambience: d.ambience,
  });
  const legend = { ...palette['common'], ...palette[d.id] };
  const preview = renderPreview(d, atlas, layers, legend, materialCells, sprites, propsAtlas);
  writePng(join(OUT, `art-preview-${d.id}.png`), preview);
  console.log(`art: ${d.id}: ${d.materials.length} materials, ${layers.length} layers`);
}
writeJson(materialsPath, materials);
writeJson(manifestPath, {
  comment:
    'SHA-256 of every PNG the art generator wrote. A PNG whose bytes differ was repainted by hand and is kept; node packages/tools/src/art/main.ts --force overwrites it.',
  files: Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))),
});
console.log(`art: props.png ${propsAtlas.width} x ${propsAtlas.height}, ${packed.length} sprites`);
