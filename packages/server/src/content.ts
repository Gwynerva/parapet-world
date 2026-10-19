/**
 * Loads the baked content the server simulates against: `dist/world.json`, every chunk (the MVP
 * city is small, so the server keeps all of it), the ruleset and the bot routes.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ChunkWorld,
  createStatics,
  loadRuleset,
  type Ruleset,
  type WorldStatics,
} from '@parapet-world/sim';
import type { ChunkFile, WorldIndex } from '@parapet-world/schemas';
import { parseBotRoute, type BotRoute } from './bots.ts';

export interface LoadedContent {
  index: WorldIndex;
  world: ChunkWorld;
  rules: Ruleset;
  statics: WorldStatics;
  bots: BotRoute[];
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

/** `indexFile`: the world index to load from `dist` (`world.json`, or `gym.json` for the gym). */
export function loadContent(
  dist: string,
  botsDir?: string,
  indexFile = 'world.json',
): LoadedContent {
  const indexPath = join(dist, indexFile);
  if (!existsSync(indexPath)) throw new Error(`${indexPath} is missing; run npm run bake`);
  const index = readJson(indexPath) as WorldIndex;
  const world = new ChunkWorld(index.bounds);
  for (const ref of index.chunks) world.load(readJson(join(dist, ref.file)) as ChunkFile);
  const rulesPath = join(dist, 'rules', 'moves.json');
  const rules = loadRuleset(readJson(rulesPath));
  const statics = createStatics(index);
  const bots: BotRoute[] = [];
  const dir = botsDir ?? join(dist, 'bots');
  const names = index.bots?.length
    ? index.bots
    : existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.bot.json'))
      : [];
  for (const name of names) {
    const p = join(dir, name);
    if (existsSync(p)) bots.push(parseBotRoute(readJson(p), name));
  }
  return { index, world, rules, statics, bots };
}
