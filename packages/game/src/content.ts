/**
 * Loading the game's content. Everything comes from the baked `packages/content/dist` (the dev
 * server's public directory; the built game's own folder). In development the content sources
 * are also served under `content/` (see vite.config.ts), so skins, clips, rules and marker sprites
 * show up before the baker copies them; without a baked world the built-in test world of the
 * runtime is played instead.
 */
import {
  COSTUMES,
  DEFAULT_RENDER,
  HAIRS,
  type ChunkFile,
  type ClipFile,
  type RenderSettings,
  type WorldIndex,
} from '@parapet-world/schemas';
import { loadRuleset, type Ruleset, type RulesetSource } from '@parapet-world/sim';
import { fetchPixels, loadWorldArt, type Pixels, type WorldArt } from '@parapet-world/runtime';
import { syntheticWorld } from '@parapet-world/runtime/testworld.ts';

export type Rect = [number, number, number, number];

export interface GameContent {
  /** Which world is played: the baked city, the baked gym rooms, or the built-in test world. */
  source: 'city' | 'gym' | 'test';
  world: WorldIndex;
  rules: Ruleset;
  settings: RenderSettings;
  art: WorldArt;
  /** Marker sprites in the props atlas: `find`, `gate.start`, `gate.checkpoint`, `gate.finish`. */
  markers: Partial<Record<string, Rect>>;
  /** Skin layers by id: body, the hair styles, the costumes. */
  layers: Map<string, Pixels>;
  clips: ClipFile[];
  /** Move name -> the clip that plays it, from the clip exporter's index. */
  plays: Map<string, string>;
  chunk(file: string): Promise<ChunkFile>;
  /** Notes for the player or developer (missing pieces). */
  notes: string[];
}

async function tryJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function firstJson<T>(urls: readonly string[]): Promise<T | null> {
  for (const u of urls) {
    const v = await tryJson<T>(u);
    if (v) return v;
  }
  return null;
}

async function tryPixels(url: string): Promise<Pixels | null> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('image')) return null;
    return await fetchPixels(url);
  } catch {
    return null;
  }
}

type ClipIndex = string[] | { clips: { name: string; file: string; moves?: string[] }[] };

/** The clips, and which clip the exporter says plays a move (`moves` in its index). */
async function loadClips(): Promise<{ clips: ClipFile[]; plays: Map<string, string> }> {
  const plays = new Map<string, string>();
  for (const dir of ['clips/', 'clips/classic/', 'content/clips/classic/']) {
    const index = await tryJson<ClipIndex>(`${dir}index.json`);
    if (!index) continue;
    const urls = Array.isArray(index) ? index : index.clips.map((c) => dir + c.file);
    if (!Array.isArray(index)) {
      for (const c of index.clips)
        for (const m of c.moves ?? []) if (!plays.has(m)) plays.set(m, c.name);
    }
    const got = await Promise.all(urls.map((u) => tryJson<ClipFile>(u)));
    const clips = got.filter((c): c is ClipFile => !!c && Array.isArray(c.frames));
    if (clips.length) return { clips, plays };
  }
  return { clips: [], plays };
}

async function loadLayers(notes: string[]): Promise<Map<string, Pixels>> {
  const out = new Map<string, Pixels>();
  await Promise.all(
    ['body', ...HAIRS, ...COSTUMES].map(async (id) => {
      const px =
        (await tryPixels(`skins/${id}.png`)) ?? (await tryPixels(`content/skins/${id}.png`));
      if (px) out.set(id, px);
      else notes.push(`skin layer ${id}.png is missing`);
    }),
  );
  return out;
}

const hasChunks = (w: WorldIndex | null): w is WorldIndex =>
  !!w && w.format === 1 && Array.isArray(w.chunks) && w.chunks.length > 0;

/**
 * Loads everything but the chunks (which stream in as the camera moves). `choice` picks the
 * world (`?world=city|gym|test`); by default the city, or the gym rooms while the city is empty.
 */
export async function loadContent(
  progress: (what: string) => void,
  choice: string | null = null,
): Promise<GameContent> {
  const notes: string[] = [];
  progress('rules');
  const rulesSrc = await firstJson<RulesetSource>(['rules/moves.json', 'content/rules/moves.json']);
  if (!rulesSrc) throw new Error('rules/moves.json was not found: run npm run bake');
  const rules = loadRuleset(rulesSrc);
  progress('runner');
  const [layers, { clips, plays }] = await Promise.all([loadLayers(notes), loadClips()]);
  if (!clips.length) notes.push('no clips found');
  const render =
    (await firstJson<Partial<RenderSettings>>(['render.json', 'content/render.json'])) ?? {};
  const settings: RenderSettings = { ...DEFAULT_RENDER, ...render };
  const propsCatalogue = await firstJson<{ markers?: Record<string, Rect> }>([
    'props/props.json',
    'content/props/props.json',
  ]);
  progress('world');
  let world: WorldIndex | null = null,
    source: GameContent['source'] = 'test';
  if (choice !== 'test' && choice !== 'gym') {
    world = await tryJson<WorldIndex>('world.json');
    source = 'city';
    if (!hasChunks(world) && world) notes.push('the city has no rooms yet: playing the gym');
  }
  if (choice !== 'test' && !hasChunks(world)) {
    world = await tryJson<WorldIndex>('gym.json');
    source = 'gym';
  }
  if (hasChunks(world)) {
    const art = await loadWorldArt('./', world);
    const markers =
      (world as WorldIndex & { markers?: Record<string, Rect> }).markers ??
      propsCatalogue?.markers ??
      {};
    return {
      source,
      world,
      rules,
      settings,
      art,
      markers,
      layers,
      clips,
      plays,
      chunk: async (file) => {
        const r = await fetch(file);
        if (!r.ok) throw new Error(`${file}: ${r.status}`);
        return (await r.json()) as ChunkFile;
      },
      notes,
    };
  }
  if (choice !== 'test')
    notes.push('no baked world (npm run bake): playing the built-in test world');
  const t = syntheticWorld(),
    files = new Map(t.world.chunks.map((c, i) => [c.file, t.chunks[i]!]));
  return {
    source: 'test',
    world: t.world,
    rules,
    settings,
    art: t.art,
    markers: t.markers,
    layers,
    clips,
    plays,
    chunk: async (file) => {
      const c = files.get(file);
      if (!c) throw new Error(`${file}: not in the test world`);
      return c;
    },
    notes,
  };
}
