/**
 * Bot routes (`content/bots/<district>-<n>.bot.json`, copied to `dist/bots/`). A bot starts as a
 * fresh runner at `start` (feet point in world units, facing) and replays `runs` (held masks per
 * step, run-length); at the end of the loop the server restores the start state and sends a
 * keyframe. The route checker (`tools/src/bots/check.ts`) proves that a route never dies and ends
 * within one cell of its start in the start's move and facing, so the restore is a small snap.
 */
import {
  createRunner,
  decodeInputLog,
  runnerView,
  stepRunner,
  type CellReader,
  type RunnerState,
  type Ruleset,
  type WorldStatics,
} from '@parapet-world/sim';
import { CELL, COSTUMES, HAIRS, type InputRun, type Look } from '@parapet-world/schemas';

export interface BotRouteFile {
  format: 1;
  name: string;
  district: string;
  look: Look;
  start: { x: number; y: number; facing: 1 | -1 };
  runs: InputRun[];
}

export interface BotRoute {
  file: BotRouteFile;
  held: Uint8Array;
}

export function parseBotRoute(json: unknown, label: string): BotRoute {
  const f = json as BotRouteFile;
  const bad = (why: string): never => {
    throw new Error(`${label}: ${why}`);
  };
  if (!f || f.format !== 1) bad('format must be 1');
  if (typeof f.name !== 'string' || !f.name) bad('name');
  if (!f.look || !(HAIRS as readonly string[]).includes(f.look.hair)) bad('look.hair');
  if (!(COSTUMES as readonly string[]).includes(f.look.costume)) bad('look.costume');
  if (!f.start || !Number.isInteger(f.start.x) || !Number.isInteger(f.start.y)) bad('start');
  if (f.start.facing !== 1 && f.start.facing !== -1) bad('start.facing');
  if (!Array.isArray(f.runs) || !f.runs.length) bad('runs');
  for (const r of f.runs) {
    if (!Number.isInteger(r.steps) || r.steps <= 0 || !Number.isInteger(r.held)) bad('a run');
  }
  const held = decodeInputLog(f.runs);
  if (held.length < 30) bad('a loop shorter than a second');
  return { file: f, held };
}

export function botStart(route: BotRoute, rules: Ruleset): RunnerState {
  const s = route.file.start;
  return createRunner(rules, s.x, s.y, s.facing);
}

export interface RouteCheck {
  ok: boolean;
  problems: string[];
  steps: number;
  endDistancePx: number;
}

/** Replays a route from its start: it must never die and must end where it began. */
export function checkBotRoute(
  route: BotRoute,
  world: CellReader,
  rules: Ruleset,
  statics: WorldStatics,
): RouteCheck {
  const problems: string[] = [];
  const s = botStart(route, rules);
  const start = runnerView(s, rules);
  const startMove = start.move;
  const startFacing = start.facing;
  const sx = start.x,
    sy = start.y;
  for (let i = 0; i < route.held.length; i++) {
    if (!stepRunner(s, route.held[i]!, null, world, rules, statics)) {
      problems.push(`stalled at step ${i + 1} (chunks missing)`);
      break;
    }
    if (runnerView(s, rules).dead) {
      problems.push(`dies at step ${i + 1}`);
      break;
    }
  }
  const end = runnerView(s, rules);
  const dist = Math.hypot(end.x - sx, end.y - sy);
  if (dist > CELL) problems.push(`ends ${(dist / 32).toFixed(0)} px from its start (max 32)`);
  if (end.move !== startMove) problems.push(`ends in ${end.move}, starts in ${startMove}`);
  if (end.facing !== startFacing) problems.push('ends facing the other way');
  return {
    ok: problems.length === 0,
    problems,
    steps: route.held.length,
    endDistancePx: dist / 32,
  };
}
