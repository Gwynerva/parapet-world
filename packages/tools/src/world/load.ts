/**
 * The city for the search tools, baked in memory from `packages/content` (nothing is written), or
 * the gym with `gym: true`. Bake errors stop the tools; warnings are returned.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuleset } from '@parapet-world/sim';
import type { BakeResult } from '../bake/bake.ts';
import { bakeAll } from '../bake/main.ts';
import { gridWorld } from '../bake/validate.ts';
import type { SearchWorld } from './search.ts';

export const CONTENT_ROOT = fileURLToPath(new URL('../../../content/', import.meta.url));

export function loadWorld(gym = false): SearchWorld & { warnings: string[]; baked: BakeResult } {
  const all = bakeAll(CONTENT_ROOT);
  const errors = all.problems.filter((p) => p.level === 'error');
  if (errors.length > 0) {
    throw new Error(
      `the bake has errors:\n${errors.map((p) => `  ${p.where}: ${p.message}`).join('\n')}`,
    );
  }
  const result = gym ? all.gym : all.world;
  const a = result.world;
  const rules = loadRuleset(
    JSON.parse(readFileSync(join(CONTENT_ROOT, 'rules', 'moves.json'), 'utf8')),
  );
  return {
    index: result.index,
    cells: gridWorld(a),
    rules,
    area: [a.x0, a.y0, a.width, a.height],
    baked: result,
    warnings: all.problems
      .filter((p) => p.level === 'warning')
      .map((p) => `${p.where}: ${p.message}`),
  };
}

/** Reads `--name value` from argv; `fallback` when absent. */
export function option(args: readonly string[], name: string, fallback: string | null = null) {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1]! : fallback;
}
