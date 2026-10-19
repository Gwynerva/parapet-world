/**
 * The renderer's dev harness: a scrolling world, props, 30 animated runners in different looks
 * and toggles for the slab. Loads baked content from the public directory when it exists
 * (`world.json`, chunks, art, skins, clips), otherwise a synthetic world, procedural skins and
 * clips. `window.harness` exposes hooks for scripted checks.
 */
import {
  CELL_PX,
  CHUNK_CELLS,
  Cell,
  UNITS_PER_PX,
  base64ToBytes,
  type ChunkFile,
  type ClipFile,
  type RenderSettings,
  type WorldIndex,
} from '@parapet-world/schemas';
import {
  createRenderer,
  fetchJson,
  fetchPixels,
  loadWorldArt,
  type Pixels,
  type Skin,
  type WorldArt,
} from '../src/index.ts';
import { syntheticClips } from './clips.ts';
import { LAYER_NAMES, paintLayer, type LayerName } from './painters.ts';
import { GROUND_ROW, syntheticWorld } from '../src/testworld.ts';

interface Content {
  source: string;
  world: WorldIndex;
  art: WorldArt;
  chunks: ChunkFile[];
  clips: ClipFile[];
  layers: Map<LayerName, Pixels>;
  ground: (xPx: number) => number;
  spawn: [number, number];
  markers: Record<string, [number, number, number, number]>;
  settings: Partial<RenderSettings>;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function tryJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function tryPixels(url: string): Promise<Pixels | null> {
  try {
    const r = await fetch(url);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('image')) return null;
    return await fetchPixels(url);
  } catch {
    return null;
  }
}

/**
 * Skin layers from the baked `skins/<id>.png`, else the content sources (`content/skins/`),
 * painted procedurally where neither has the file.
 */
async function loadLayers(): Promise<[Map<LayerName, Pixels>, number]> {
  const out = new Map<LayerName, Pixels>();
  let real = 0;
  await Promise.all(
    LAYER_NAMES.map(async (name) => {
      const px =
        (await tryPixels(`skins/${name}.png`)) ?? (await tryPixels(`content/skins/${name}.png`));
      if (px) real++;
      out.set(name, px ?? paintLayer(name));
    }),
  );
  return [out, real];
}

/** A clip index: a list of paths, or the exporter's `{ clips: [{ name, file }] }` beside them. */
type ClipIndex = string[] | { clips: { name: string; file: string }[] };
/** Clips from the baked `clips/`, else the content sources' `content/clips/classic/`. */
async function loadClips(): Promise<ClipFile[]> {
  for (const dir of ['clips/', 'clips/classic/', 'content/clips/classic/']) {
    const index = await tryJson<ClipIndex>(`${dir}index.json`);
    if (!index) continue;
    const urls = Array.isArray(index) ? index : index.clips.map((c) => dir + c.file);
    const got = await Promise.all(urls.map((u) => tryJson<ClipFile>(u)));
    const clips = got.filter((c): c is ClipFile => !!c && Array.isArray(c.frames));
    if (clips.length) return clips;
  }
  return [];
}

/** The top surface under every px column of a real world, scanning from a row. */
function groundOf(world: WorldIndex, chunks: ChunkFile[], startRow: number): (x: number) => number {
  const [bx, by, bw, bh] = world.bounds,
    W = bw * CHUNK_CELLS,
    H = bh * CHUNK_CELLS,
    cells = new Uint8Array(W * H);
  for (const c of chunks) {
    const g = base64ToBytes(c.cells);
    for (let y = 0; y < CHUNK_CELLS; y++) {
      for (let x = 0; x < CHUNK_CELLS; x++) {
        const wx = (c.cx - bx) * CHUNK_CELLS + x,
          wy = (c.cy - by) * CHUNK_CELLS + y;
        if (wx >= 0 && wy >= 0 && wx < W && wy < H)
          cells[wy * W + wx] = g[y * CHUNK_CELLS + x]! & 0x7f;
      }
    }
  }
  const ok = (c: number): boolean => c === Cell.SOLID || c === Cell.HALF || c === Cell.TOP;
  return (xPx: number) => {
    const cx = Math.floor(xPx / CELL_PX) - bx * CHUNK_CELLS;
    if (cx < 0 || cx >= W) return startRow * CELL_PX;
    for (let cy = Math.max(0, startRow - by * CHUNK_CELLS); cy < H; cy++) {
      const c = cells[cy * W + cx]!;
      if (ok(c)) return (cy + by * CHUNK_CELLS) * CELL_PX + (c === Cell.HALF ? 16 : 0);
    }
    return startRow * CELL_PX;
  };
}

async function loadContent(): Promise<Content> {
  const [layers, realLayers] = await loadLayers();
  const realClips = await loadClips();
  const clips = realClips.length ? realClips : syntheticClips();
  if (!clips.some((c) => c.name === 'run'))
    clips.push(...syntheticClips().filter((c) => c.name === 'run'));
  if (!clips.some((c) => c.name === 'idle'))
    clips.push(...syntheticClips().filter((c) => c.name === 'idle'));
  if (!clips.some((c) => c.name === 'hop'))
    clips.push(...syntheticClips().filter((c) => c.name === 'hop'));
  const what = `skins: ${realLayers ? `${realLayers} from content` : 'procedural'}, clips: ${realClips.length ? `${realClips.length} from content` : 'procedural'}`;
  const world = await tryJson<WorldIndex>('world.json');
  if (world && world.format === 1 && Array.isArray(world.chunks)) {
    const art = await loadWorldArt('./', world);
    const chunks = await Promise.all(world.chunks.map((c) => fetchJson<ChunkFile>(c.file)));
    const hub = world.hubs[world.startHub];
    const spawn: [number, number] = hub
      ? hub.spawn
      : [(world.bounds[0] + 0.5) * CHUNK_CELLS * CELL_PX * UNITS_PER_PX, 0];
    const settings = (await tryJson<Partial<RenderSettings>>('render.json')) ?? {};
    return {
      source: `content/dist (${chunks.length} chunks), ${what}`,
      world,
      art,
      chunks,
      clips,
      layers,
      ground: groundOf(world, chunks, Math.floor(spawn[1] / UNITS_PER_PX / CELL_PX) - 1),
      spawn,
      markers: {},
      settings,
    };
  }
  const s = syntheticWorld();
  return {
    source: `synthetic world, ${what}`,
    world: s.world,
    art: s.art,
    chunks: s.chunks,
    clips,
    layers,
    ground: s.ground,
    spawn: s.spawn,
    markers: s.markers,
    settings: {},
  };
}

/* ---------- runners ---------- */

interface Bot {
  skin: Skin;
  look: string;
  x: number;
  y: number | null;
  dir: number;
  lo: number;
  hi: number;
  speed: number;
  clip: string;
  t: number;
  hopFrom: number;
}

const COSTUME_ORDER: LayerName[] = ['classic', 'tee', 'hoodie', 'summer'];
const HAIR_ORDER: (LayerName | null)[] = ['hairRed', 'hairShort', null];

async function main(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('view');
  const r = createRenderer(canvas);
  const content = await loadContent();
  $('source').textContent = content.source;
  r.setSettings(content.settings);
  r.setWorld(content.world, content.art);
  for (const c of content.chunks) r.loadChunk(c);
  for (const c of content.clips) r.addClip(c);

  const skins = new Map<string, Skin>();
  const skinOf = (costume: LayerName, hair: LayerName | null): Skin => {
    const key = `${costume}/${hair ?? 'bald'}`;
    let s = skins.get(key);
    if (!s) {
      const stack = [
        content.layers.get('body')!,
        ...(hair ? [content.layers.get(hair)!] : []),
        content.layers.get(costume)!,
      ];
      skins.set(key, (s = r.createSkin(stack)));
    }
    return s;
  };

  const synthetic = content.source.startsWith('synthetic');
  const bots: Bot[] = [];
  const add = (
    costume: LayerName,
    hair: LayerName | null,
    x: number,
    clip: string,
    o: Partial<Bot> = {},
  ): Bot => {
    const b: Bot = {
      skin: skinOf(costume, hair),
      look: `${costume}/${hair ?? 'bald'}`,
      x,
      y: null,
      dir: 1,
      lo: x,
      hi: x,
      speed: 0,
      clip,
      t: bots.length * 0.37,
      hopFrom: x,
      ...o,
    };
    bots.push(b);
    return b;
  };
  const C = CELL_PX;
  // the own runner first: autopilot runs it across the world
  const own = add('classic', 'hairRed', content.spawn[0] / UNITS_PER_PX, 'run', {
    lo: synthetic ? 1 * C : content.spawn[0] / UNITS_PER_PX - 40 * C,
    hi: synthetic ? 126 * C : content.spawn[0] / UNITS_PER_PX + 40 * C,
    speed: 150,
  });
  if (synthetic) {
    const g = GROUND_ROW * C;
    // both facings of asymmetric looks, side by side
    add('hoodie', 'hairShort', 5.5 * C, 'idle', { dir: 1 });
    add('hoodie', 'hairShort', 7 * C, 'idle', { dir: -1 });
    add('tee', 'hairRed', 19.5 * C, 'idle', { dir: 1 });
    add('tee', 'hairRed', 21 * C, 'idle', { dir: -1 });
    // standing on props: crates, the AC unit, containers, a plank, the mezzanine, the dock
    add('summer', 'hairRed', 9.5 * C, 'idle', { y: g - C, dir: -1 });
    add('classic', 'hairShort', 10.5 * C, 'idle', { y: g - 2 * C });
    add('hoodie', null, 57 * C, 'idle', { y: g - C, dir: -1 });
    add('tee', 'hairShort', 71.5 * C, 'idle', { y: g - 2 * C });
    add('summer', null, 77.5 * C, 'idle', { y: g - 2 * C, dir: -1 });
    add('classic', 'hairRed', 74.5 * C, 'idle', { y: g - 4 * C });
    add('hoodie', 'hairRed', 52.5 * C, 'idle', { y: g - 5 * C, dir: -1 });
    add('summer', 'hairShort', 79 * C, 'idle', { y: g - 6 * C });
    add('tee', null, 95.5 * C, 'idle', { y: g - 3 * C, dir: -1 });
    add('classic', null, 46 * C, 'idle', { y: g - 21 * C });
    // one-shot clips on repeat (the anchor moves along their travel), a turn that flips the
    // facing at its end like the simulation's turnFlip, and runners on lanes
    add('hoodie', 'hairShort', 49 * C, 'hop', { lo: 48 * C, hi: 62 * C });
    for (const [name, x, lo, hi] of [
      ['roll', 2, 1, 25],
      ['frontFlip', 65, 64, 69],
      ['turn', 31, 29, 33],
    ] as const) {
      if (r.clip(name)) add('summer', 'hairRed', x * C, name, { lo: lo * C, hi: hi * C });
    }
    const lanes: [number, number][] = [
      [1, 25],
      [29, 43],
      [48, 63],
      [64, 83],
      [100, 126],
    ];
    for (let i = 0; bots.length < 30; i++) {
      const [lo, hi] = lanes[i % lanes.length]!,
        f = ((i * 0.61803) % 1) * (hi - lo) + lo;
      add(COSTUME_ORDER[i % 4]!, HAIR_ORDER[(i + (i >> 2)) % 3]!, f * C, 'run', {
        lo: lo * C,
        hi: hi * C,
        speed: 110 + ((i * 37) % 60),
        dir: i % 2 ? -1 : 1,
      });
    }
  } else {
    for (let i = 0; bots.length < 30; i++) {
      const x0 = own.x + (i - 14) * 48;
      add(COSTUME_ORDER[i % 4]!, HAIR_ORDER[i % 3]!, x0, i % 3 ? 'run' : 'idle', {
        lo: x0 - 200,
        hi: x0 + 200,
        speed: 110 + ((i * 37) % 60),
        dir: i % 2 ? -1 : 1,
      });
    }
  }

  /* ---------- controls ---------- */
  const ui = {
    fill: $<HTMLSelectElement>('fill'),
    slab: $<HTMLInputElement>('slab'),
    persp: $<HTMLInputElement>('persp'),
    rdepth: $<HTMLInputElement>('rdepth'),
    camy: $<HTMLInputElement>('camy'),
    auto: $<HTMLInputElement>('auto'),
    pause: $<HTMLInputElement>('pause'),
  };
  const sync = (): void => {
    r.setSettings({
      depthFill: ui.fill.value as RenderSettings['depthFill'],
      slabDepth: +ui.slab.value,
      perspective: +ui.persp.value,
      runnerDepth: +ui.rdepth.value,
    });
    $('slabv').textContent = `${ui.slab.value} px`;
    $('perspv').textContent = `${Math.round(+ui.persp.value * 100)}%`;
    $('rdepthv').textContent = (+ui.rdepth.value).toFixed(2);
  };
  for (const el of [ui.fill, ui.slab, ui.persp, ui.rdepth]) el.addEventListener('input', sync);
  ui.slab.value = String(r.settings.slabDepth);
  ui.persp.value = String(r.settings.perspective);
  ui.rdepth.value = String(r.settings.runnerDepth);
  ui.fill.value = r.settings.depthFill;
  sync();
  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.key));
  addEventListener('keyup', (e) => keys.delete(e.key));

  /* ---------- the loop ---------- */
  let last = performance.now(),
    ema = 1 / 60,
    frames = 0;
  let fixedCam: [number, number] | null = null;
  const step = (b: Bot, dt: number): void => {
    b.t += dt;
    const clip = r.clip(b.clip);
    if (clip && !clip.loop) {
      // the anchor moves along the travel while the clip plays, then waits; a turn flips facing
      const dur = clip.duration,
        turn = b.clip.startsWith('turn');
      if (b.t >= dur + 0.6) {
        b.t = 0;
        b.hopFrom = b.x;
        if (turn) b.dir = -b.dir;
        else if (b.x + b.dir * clip.travelX > b.hi || b.x + b.dir * clip.travelX < b.lo) {
          b.dir = -b.dir;
        }
      }
      b.x = b.hopFrom + b.dir * clip.travelX * Math.min(1, b.t / dur);
      return;
    }
    if (!b.speed) return;
    b.x += b.dir * b.speed * dt;
    if (b.x > b.hi) {
      b.x = b.hi;
      b.dir = -1;
    } else if (b.x < b.lo) {
      b.x = b.lo;
      b.dir = 1;
    }
  };
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    ema = ema * 0.95 + dt * 0.05;
    const paused = ui.pause.checked;
    if (!paused) {
      // the own runner: autopilot, or the arrow keys (space hops)
      if (ui.auto.checked) {
        own.clip = 'run';
        own.speed = 150;
      } else {
        const l = keys.has('ArrowLeft') || keys.has('a'),
          rt = keys.has('ArrowRight') || keys.has('d');
        own.clip = l || rt ? 'run' : 'idle';
        own.speed = 0;
        if (l !== rt) {
          own.dir = rt ? 1 : -1;
          own.x += own.dir * 150 * dt;
        }
      }
      for (const b of bots) step(b, dt);
    }
    const ownY = own.y ?? content.ground(own.x);
    const camX = fixedCam ? fixedCam[0] : own.x,
      camY = fixedCam ? fixedCam[1] : ownY - 40 + +ui.camy.value;
    r.begin(camX * UNITS_PER_PX, camY * UNITS_PER_PX);
    for (let i = 1; i < bots.length; i++) {
      const b = bots[i]!,
        y = b.y ?? content.ground(b.x);
      // the procedural hop moves its anchor along the travel; the lifted clips carry none
      const travel = b.clip === 'hop' ? 'anchor' : 'clip';
      r.runner(b.skin, b.x * UNITS_PER_PX, y * UNITS_PER_PX, b.dir, b.clip, b.t, false, travel);
    }
    r.runner(own.skin, own.x * UNITS_PER_PX, ownY * UNITS_PER_PX, own.dir, own.clip, own.t, true);
    const find = content.markers.find,
      gate = content.markers['gate.start'];
    if (find) {
      const bob = Math.sin(now / 300) * 3;
      r.marker(
        null,
        find[0],
        find[1],
        find[2],
        find[3],
        33 * C * UNITS_PER_PX,
        (31 * C - 24 + bob) * UNITS_PER_PX,
      );
    }
    if (gate)
      r.marker(
        null,
        gate[0],
        gate[1],
        gate[2],
        gate[3],
        2 * C * UNITS_PER_PX,
        (GROUND_ROW * C - 24) * UNITS_PER_PX,
        0.8,
      );
    r.end();
    if (++frames % 15 === 0) {
      const s = r.stats;
      $('fps').textContent = `${(1 / ema).toFixed(0)} fps`;
      $('stats').textContent =
        `${s.drawCalls} draws, ${s.triangles} triangles, chunks ${s.chunksDrawn}/${s.chunks}, ` +
        `${s.runners} runners, ${s.props} props, world ${s.fbWidth} x ${s.fbHeight} at ${s.scale.toFixed(2)}x, ` +
        `camera ${camX.toFixed(1)}, ${camY.toFixed(1)}`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  (window as unknown as { harness: unknown }).harness = {
    renderer: r,
    bots,
    own,
    skins,
    /** Fixes the camera centre at world px (null: follow the own runner). */
    camera(x: number | null, y?: number): void {
      fixedCam = x === null ? null : [x, y ?? 0];
    },
    fps: (): number => 1 / ema,
  };
}

main().catch((e: unknown) => {
  $('source').textContent = `failed: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
