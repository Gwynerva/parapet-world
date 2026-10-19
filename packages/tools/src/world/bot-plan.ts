/**
 * `node packages/tools/src/world/bot-plan.ts --out <file.bot.json> --name <name>
 * --district <id> --look <hair>/<costume> --start <x>,<y>[,<facing>] --via <x>,<y>,<w>,<h> ...
 * [--max <states>] [--margin <cells>]`: plans a bot route with the real simulation. A fresh runner standing in cell
 * `start` (feet on its bottom edge) goes through the `--via` cell rectangles in order (its body
 * touching each) and comes back to stand idle where it started, facing the same way, so the loop
 * passes `npm run check:bots`. Each leg is a breadth-first search over held-key bursts of 3 steps;
 * the search stays within `--margin` cells (12) of the box around the start and the vias. The
 * route is replayed and checked before it is written.
 */
import { writeFileSync } from 'node:fs';
import { CELL, COSTUMES, HAIRS, type CellRect, type InputRun } from '@parapet-world/schemas';
import {
  R,
  copyRunner,
  createRunner,
  createStatics,
  encodeInputLog,
  stepRunner,
  type RunnerState,
} from '@parapet-world/sim';
import { loadWorld, option } from './load.ts';
import { MASKS, touches, type SearchWorld } from './search.ts';

const STEPS = 3;

const coarse = (s: RunnerState): number =>
  ((((((s[R.X]! >> 8) * 1024 + ((s[R.Y]! >> 8) & 1023)) * 64 + (s[R.MOVE]! & 63)) * 2 +
    (s[R.FACING]! > 0 ? 1 : 0)) *
    64 +
    ((s[R.VX]! >> 5) & 63)) *
    32 +
    ((s[R.VY]! >> 6) & 31)) *
    2 +
  (s[R.GROUND]! ? 1 : 0);

/** The held masks (one per step) of the shortest path found from `s0` to a state `goal` accepts. */
function leg(
  w: SearchWorld,
  s0: RunnerState,
  goal: (s: RunnerState) => boolean,
  maxStates: number,
  box: CellRect,
): { held: number[]; end: RunnerState } | null {
  const inBox = (q: RunnerState) =>
    q[R.X]! >= box[0] * CELL &&
    q[R.X]! < (box[0] + box[2]) * CELL &&
    q[R.Y]! >= box[1] * CELL &&
    q[R.Y]! < (box[1] + box[3]) * CELL;
  const statics = createStatics(w.index);
  const dead = new Set(['dead', 'respawn'].map((n) => w.rules.moveNames.indexOf(n)));
  const states: RunnerState[] = [s0];
  const parent: number[] = [-1];
  const mask: number[] = [0];
  const seen = new Set<number>([coarse(s0)]);
  let frontier = [0];
  while (frontier.length > 0 && states.length < maxStates) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const m of MASKS) {
        const c = copyRunner(states[i]!);
        let ok = true;
        let reached = false;
        for (let k = 0; k < STEPS; k++) {
          if (!stepRunner(c, m, null, w.cells, w.rules, statics) || dead.has(c[R.MOVE]!)) {
            ok = false;
            break;
          }
        }
        if (!ok || !inBox(c)) continue;
        reached = goal(c);
        const key = coarse(c);
        if (!reached && seen.has(key)) continue;
        seen.add(key);
        states.push(c);
        parent.push(i);
        mask.push(m);
        const j = states.length - 1;
        if (reached) {
          const held: number[] = [];
          for (let n = j; n > 0; n = parent[n]!)
            for (let k = 0; k < STEPS; k++) held.push(mask[n]!);
          held.reverse();
          return { held, end: c };
        }
        next.push(j);
      }
    }
    frontier = next;
  }
  return null;
}

const args = process.argv.slice(2);
const req = (name: string): string => {
  const v = option(args, name);
  if (v === null) throw new Error(`${name} is required`);
  return v;
};
const out = req('--out');
const name = req('--name');
const district = req('--district');
const [hair, costume] = req('--look').split('/');
if (
  !(HAIRS as readonly string[]).includes(hair!) ||
  !(COSTUMES as readonly string[]).includes(costume!)
) {
  throw new Error(`--look hair/costume from ${HAIRS.join(', ')} and ${COSTUMES.join(', ')}`);
}
const [cx, cy, cf] = req('--start').split(',').map(Number);
const facing = cf === -1 ? -1 : 1;
const vias: CellRect[] = [];
args.forEach((a, i) => {
  if (a === '--via') vias.push(args[i + 1]!.split(',').map(Number) as CellRect);
});
const max = Number(option(args, '--max', '3000000'));
const margin = Number(option(args, '--margin', '12'));
const xs = [cx!, ...vias.flatMap((v) => [v[0], v[0] + v[2]])];
const ys = [cy!, ...vias.flatMap((v) => [v[1], v[1] + v[3]])];
const box: CellRect = [
  Math.min(...xs) - margin,
  Math.min(...ys) - margin,
  Math.max(...xs) - Math.min(...xs) + 2 * margin,
  Math.max(...ys) - Math.min(...ys) + 2 * margin,
];

const w = loadWorld();
const start = { x: cx! * CELL + CELL / 2, y: (cy! + 1) * CELL, facing };
const fresh = () => createRunner(w.rules, start.x, start.y, start.facing);
const hw = w.rules.params['halfWidth'] ?? 256;
const ht = w.rules.params['height'] ?? 1792;
const startMove = fresh()[R.MOVE]!;

let s = fresh();
const held: number[] = [];
for (const [n, v] of vias.entries()) {
  const l = leg(w, s, (q) => touches(q, v, hw, ht), max, box);
  if (l === null) throw new Error(`no path to --via ${n + 1} (${v.join(',')})`);
  held.push(...l.held);
  s = l.end;
}
const home = leg(
  w,
  s,
  (q) =>
    Math.abs(q[R.X]! - start.x) <= CELL / 2 &&
    Math.abs(q[R.Y]! - start.y) <= CELL / 4 &&
    q[R.MOVE] === startMove &&
    q[R.FACING] === start.facing &&
    q[R.VX] === 0,
  max,
  box,
);
if (home === null) throw new Error('no path back to the start');
held.push(...home.held);
while (held.length < 30) held.push(0);

// Replay and check like the server's checker.
const statics = createStatics(w.index);
const r = fresh();
for (const [i, m] of held.entries()) {
  if (!stepRunner(r, m, null, w.cells, w.rules, statics))
    throw new Error(`stalls at step ${i + 1}`);
  if (w.rules.moveNames[r[R.MOVE]!] === 'dead') throw new Error(`dies at step ${i + 1}`);
}
const dist = Math.hypot(r[R.X]! - start.x, r[R.Y]! - start.y);
if (dist > CELL || r[R.MOVE] !== startMove || r[R.FACING] !== start.facing) {
  throw new Error(`does not end at its start (${(dist / 32).toFixed(1)} px away)`);
}
const runs: InputRun[] = encodeInputLog(held);
const file = { format: 1, name, district, look: { hair, costume }, start, runs };
writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
console.log(
  `wrote ${out}: ${held.length} steps (${(held.length / 30).toFixed(1)} s), ${runs.length} runs`,
);
