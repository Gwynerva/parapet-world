/**
 * Bots offline: the routes the baker lists in `world.json` (`dist/bots/`), replayed locally the way
 * the server runs them (a fresh runner at the route's start, its held masks, back to the start at
 * the end of the loop), so the offline world is populated too. A bot whose chunks are not loaded
 * waits, like any runner.
 */
import type { Look } from '@parapet-world/schemas';
import {
  copyRunner,
  createRunner,
  decodeInputLog,
  stepRunner,
  type CellReader,
  type Ruleset,
  type RunnerState,
  type WorldStatics,
} from '@parapet-world/sim';
import type { BotFile } from './recorder.ts';

export interface LocalBot {
  name: string;
  look: Look;
  prev: RunnerState;
  cur: RunnerState;
  held: Uint8Array;
  start: RunnerState;
  at: number;
}

export function createBot(file: BotFile, rules: Ruleset): LocalBot | null {
  const held = decodeInputLog(file.runs);
  if (held.length < 2) return null;
  const start = createRunner(rules, file.start.x, file.start.y, file.start.facing);
  return {
    name: file.name,
    look: file.look,
    start,
    cur: copyRunner(start),
    prev: copyRunner(start),
    held,
    at: 0,
  };
}

/** One step of every bot. */
export function stepBots(
  bots: readonly LocalBot[],
  world: CellReader,
  rules: Ruleset,
  statics: WorldStatics,
): void {
  for (const b of bots) {
    copyRunner(b.cur, b.prev);
    if (b.at >= b.held.length) {
      // the loop ends where it began: restart from the start state
      copyRunner(b.start, b.cur);
      copyRunner(b.start, b.prev);
      b.at = 0;
      continue;
    }
    if (stepRunner(b.cur, b.held[b.at]!, null, world, rules, statics)) b.at++;
  }
}
