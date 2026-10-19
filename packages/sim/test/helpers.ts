import { readFileSync } from 'node:fs';
import { CELL_CHARS } from '@parapet-world/schemas';
import { GridWorld, loadRuleset, type Ruleset } from '../src/index.ts';

const RULES = new URL('../../content/rules/moves.json', import.meta.url);

export function rulesSource(): unknown {
  return JSON.parse(readFileSync(RULES, 'utf8'));
}

let cached: Ruleset | null = null;
export function rules(): Ruleset {
  cached ??= loadRuleset(rulesSource());
  return cached;
}

/** A grid world from rows of collision characters (`CELL_CHARS`). */
export function grid(rows: readonly string[]): GridWorld {
  return GridWorld.fromRows(rows, CELL_CHARS);
}

export const CELL = 1024;
/** Feet point standing on the floor whose top is the top of row `floorRow`, centred in column. */
export function feetAt(col: number, floorRow: number): [number, number] {
  return [col * CELL + 512, floorRow * CELL];
}
