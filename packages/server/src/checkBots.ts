/**
 * Checks every bot route against the baked world: `npm run check:bots`
 * (node packages/server/src/checkBots.ts [--dist packages/content/dist] [--bots packages/content/bots]).
 * A route must never die and must end within one cell of its start, in the start's move and
 * facing. Exits with 1 when any route fails.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBotRoute, parseBotRoute } from './bots.ts';
import { loadContent } from './content.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const dist = resolve(root, opt('dist', 'packages/content/dist'));
const botsDir = resolve(root, opt('bots', 'packages/content/bots'));

const content = loadContent(dist, join(dist, 'none'));
const files = existsSync(botsDir)
  ? readdirSync(botsDir).filter((f) => f.endsWith('.bot.json'))
  : [];
let failed = 0;
for (const f of files.sort()) {
  const route = parseBotRoute(JSON.parse(readFileSync(join(botsDir, f), 'utf8')), f);
  const c = checkBotRoute(route, content.world, content.rules, content.statics);
  if (c.ok) console.log(`ok   ${f}: ${c.steps} steps, ends ${c.endDistancePx.toFixed(1)} px away`);
  else {
    failed++;
    console.log(`FAIL ${f}: ${c.problems.join('; ')}`);
  }
}
console.log(`${files.length - failed}/${files.length} bot routes ok`);
process.exit(failed ? 1 : 0);
