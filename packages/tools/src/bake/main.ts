/**
 * `npm run bake` (node packages/tools/src/bake/main.ts): reads packages/content and writes
 * packages/content/dist: world.json and gym.json (schemas `WorldIndex`), chunks/<hash>.json
 * (`ChunkFile`), the bot routes (bots/*.bot.json, listed in `WorldIndex.bots`), and copies of art/,
 * skins/, clips/, props/, rules/ and render.json.
 *
 * - `--check` validates without writing.
 * - `--out <dir>` bakes into another folder (replacing it), e.g. a scratch folder for validation.
 * - By default the bake is written to a temporary folder beside `dist` and swapped in at the end,
 *   so a reader (the dev server, the game server) never sees half a dist, and concurrent bakes
 *   never interleave their files.
 *
 * Errors stop the bake (exit code 1, nothing written); warnings are printed.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RENDER } from '@parapet-world/schemas';
import { loadRuleset } from '@parapet-world/sim';
import type { Problem } from './assemble.ts';
import { bakeWorld, type BakeResult } from './bake.ts';
import { ContentError, loadContent } from './content.ts';
import { RoomError } from './room.ts';
import { validateArt } from './validate.ts';

const COPIED = ['art', 'skins', 'clips', 'props', 'rules'];

export interface BakeAll {
  world: BakeResult;
  gym: BakeResult;
  problems: Problem[];
  /** File names of the bot routes in `content/bots`. */
  bots: string[];
}

/** Bakes the city and the gym from a content folder (nothing is written). */
export function bakeAll(root: string): BakeAll {
  const content = loadContent(root);
  loadRuleset(JSON.parse(readFileSync(join(root, 'rules', 'moves.json'), 'utf8')));
  const botsDir = join(root, 'bots');
  const bots = existsSync(botsDir)
    ? readdirSync(botsDir)
        .filter((n) => n.endsWith('.bot.json'))
        .sort()
    : [];
  const world = bakeWorld(content, content.rooms, bots);
  const gym = bakeWorld(content, content.gym);
  const tag = (name: string, list: Problem[]) =>
    list.map((p) => (p.where === '(world)' ? { ...p, where: `(${name})` } : p));
  const problems = [
    ...tag('world', world.problems),
    ...tag('gym', gym.problems),
    ...validateArt(content),
  ];
  return { world, gym, problems, bots };
}

/** Writes a bake into `dist` (replacing whatever is there). */
export function writeDist(root: string, dist: string, all: BakeAll): void {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, 'chunks'), { recursive: true });
  const written = new Set<string>();
  for (const result of [all.world, all.gym]) {
    for (const c of result.chunks) {
      if (written.has(c.name)) continue;
      written.add(c.name);
      writeFileSync(join(dist, c.name), c.json);
    }
  }
  writeFileSync(join(dist, 'world.json'), JSON.stringify(all.world.index, null, 1));
  writeFileSync(join(dist, 'gym.json'), JSON.stringify(all.gym.index, null, 1));
  for (const dir of COPIED) {
    const from = join(root, dir);
    if (existsSync(from)) cpSync(from, join(dist, dir), { recursive: true });
  }
  if (all.bots.length > 0) {
    mkdirSync(join(dist, 'bots'), { recursive: true });
    for (const name of all.bots) cpSync(join(root, 'bots', name), join(dist, 'bots', name));
  }
  const render = join(root, 'render.json');
  if (existsSync(render)) cpSync(render, join(dist, 'render.json'));
  else writeFileSync(join(dist, 'render.json'), JSON.stringify(DEFAULT_RENDER, null, 2) + '\n');
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Renames with a few retries (Windows refuses while another process has a file open). */
function renameRetrying(from: string, to: string): boolean {
  for (let i = 0; i < 20; i++) {
    try {
      renameSync(from, to);
      return true;
    } catch {
      sleep(100);
    }
  }
  return false;
}

/**
 * Writes a bake beside `dist` and swaps it in with two renames. When a rename keeps failing (a
 * process holds the folder open), it falls back to replacing the files in place and says so.
 */
export function writeDistAtomic(root: string, dist: string, all: BakeAll): void {
  const tag = `${process.pid}-${Date.now()}`;
  const tmp = join(dirname(dist), `.dist-new-${tag}`);
  const old = join(dirname(dist), `.dist-old-${tag}`);
  writeDist(root, tmp, all);
  const hadDist = existsSync(dist);
  if (hadDist && !renameRetrying(dist, old)) {
    console.warn('warning: could not move the old dist aside; replacing its files in place');
    writeDist(root, dist, all);
    rmSync(tmp, { recursive: true, force: true });
    return;
  }
  if (!renameRetrying(tmp, dist)) {
    if (hadDist) renameRetrying(old, dist);
    throw new Error(`could not move the new bake into ${dist} (it is in ${tmp})`);
  }
  if (hadDist) rmSync(old, { recursive: true, force: true });
}

function main(): number {
  const root = fileURLToPath(new URL('../../../content/', import.meta.url));
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const outAt = args.indexOf('--out');
  if (outAt >= 0 && args[outAt + 1] === undefined) {
    console.error('--out needs a folder');
    return 1;
  }
  const out = outAt >= 0 ? resolve(args[outAt + 1]!) : null;
  let all: BakeAll;
  try {
    all = bakeAll(root);
  } catch (e) {
    if (e instanceof RoomError || e instanceof ContentError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
  const errors = all.problems.filter((p) => p.level === 'error');
  for (const p of all.problems) console.log(`${p.level}: ${p.where}: ${p.message}`);
  if (errors.length > 0) {
    console.error(`bake failed: ${errors.length} error(s)`);
    return 1;
  }
  const summary = (name: string, r: BakeResult) =>
    `${name}: ${r.chunks.length} chunks, ${r.index.hubs.length} hubs, ${r.index.routes.length} routes, ${r.index.finds.length} finds`;
  console.log(summary('world', all.world));
  console.log(summary('gym', all.gym));
  console.log(`bots: ${all.bots.length}`);
  if (check) return 0;
  if (out !== null) {
    writeDist(root, out, all);
    console.log(`wrote ${out}`);
  } else {
    const dist = join(root, 'dist');
    writeDistAtomic(root, dist, all);
    console.log(`wrote ${dist}`);
  }
  return 0;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exitCode = main();
}
