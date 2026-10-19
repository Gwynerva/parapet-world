/**
 * `node packages/tools/src/world/explore.ts [--hub <id> | --at <x>,<y>] [--within <x>,<y>,<w>,<h>]
 * [--district <id>] [--max <states>] [--route-max <states>] [--no-runs] [--map <file.png>] [--gym]`:
 * bakes the city in memory and searches it with the real simulation from a hub (the start hub by
 * default) or from a runner standing in cell x, y, optionally only inside a cell rectangle (the feet
 * point stays in it). Prints, for every hub and find (of one district with `--district`), whether a
 * runner's body touched it. Each route is then run as `route-time.ts` does, judged by the
 * simulation's own observer: it finishes (with the shortest time found) or the gate its best line
 * got stuck at is named; the cells-touched check per gate (+ or -, start, checkpoints, finish) is
 * shown beside it, and `--no-runs` prints only that. `--map` writes a picture at 2 px per cell:
 * solid cells grey, cells the runner touched green, hubs, gates and finds outlined. Exit code 1
 * when something is missed or a route does not finish.
 */
import { writeFileSync } from 'node:fs';
import { Cell, type CellRect } from '@parapet-world/schemas';
import { Canvas, hex, type RGBA } from '../art/paint.ts';
import { encodePng } from '../png.ts';
import { loadWorld, option } from './load.ts';
import { explore, hit, routeTime, runnerAtCell, runnerAtHub, stuckAt } from './search.ts';

const args = process.argv.slice(2);
const w = loadWorld(args.includes('--gym'));
const hubId = option(args, '--hub');
const district = option(args, '--district');
const max = Number(option(args, '--max', '4000000'));
const mapFile = option(args, '--map');
const skipRuns = args.includes('--no-runs');
const routeMax = Number(option(args, '--route-max', '3000000'));
const at = option(args, '--at');
const withinArg = option(args, '--within');
const within = withinArg === null ? null : (withinArg.split(',').map(Number) as CellRect);

const hubIndex = hubId === null ? w.index.startHub : w.index.hubs.findIndex((h) => h.id === hubId);
if (hubIndex < 0) throw new Error(`no hub ${hubId}`);
const t0 = Date.now();
const e = explore(w, at === null ? runnerAtHub(w, hubIndex) : runnerAtCell(w, at), max, 4, within);
console.log(
  `from ${at === null ? `hub ${w.index.hubs[hubIndex]!.id}` : `cell ${at}`}: ${e.states} states in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
);

const mine = (d: string) => district === null || d === district;
let missed = 0;
const line = (ok: boolean, text: string) => {
  if (!ok) missed++;
  console.log(`${ok ? 'yes' : 'NO '} ${text}`);
};
for (const h of w.index.hubs) if (mine(h.district)) line(hit(e, w.area, h.rect), `hub ${h.id}`);
w.index.routes.forEach((r, i) => {
  if (!mine(r.district)) return;
  const gates = [r.start, ...r.checkpoints, r.finish].map((g) => hit(e, w.area, g));
  const touched = gates.map((g) => (g ? '+' : '-')).join('');
  if (skipRuns) {
    line(
      gates.every((g) => g),
      `route ${r.id} gates touched ${touched}`,
    );
    return;
  }
  const t = routeTime(w, i, routeMax);
  line(
    t.seconds !== null,
    `route ${r.id} ${t.seconds !== null ? `finishes in ${t.seconds.toFixed(1)} s` : stuckAt(t.reached, r.checkpoints.length)} (gates touched ${touched})`,
  );
});
for (const f of w.index.finds) if (mine(f.district)) line(hit(e, w.area, f.rect), `find ${f.id}`);

if (mapFile !== null) {
  const [ax, ay, aw, ah] = w.area;
  const g = new Canvas(aw * 2, ah * 2);
  const sky = hex('#1b1d24');
  const solid = hex('#6a6e78');
  const other = hex('#3c4250');
  const reached = hex('#3ad06a');
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const c = w.cells.cell(ax + x, ay + y);
      let col: RGBA = c === Cell.SOLID ? solid : c === Cell.EMPTY ? sky : other;
      if (e.touched[y * aw + x]) col = reached;
      g.rect(x * 2, y * 2, 2, 2, col);
    }
  }
  const box = (r: CellRect, col: RGBA) => {
    const x = (r[0] - ax) * 2;
    const y = (r[1] - ay) * 2;
    for (let i = 0; i < r[2] * 2; i++) {
      g.set(x + i, y, col);
      g.set(x + i, y + r[3] * 2 - 1, col);
    }
    for (let j = 0; j < r[3] * 2; j++) {
      g.set(x, y + j, col);
      g.set(x + r[2] * 2 - 1, y + j, col);
    }
  };
  for (const h of w.index.hubs) box(h.rect, hex('#ffffff'));
  for (const r of w.index.routes)
    for (const q of [r.start, ...r.checkpoints, r.finish]) box(q, hex('#ffb020'));
  for (const f of w.index.finds) box(f.rect, hex('#ff40ff'));
  writeFileSync(mapFile, encodePng(g.image()));
  console.log(`wrote ${mapFile}`);
}
process.exitCode = missed > 0 ? 1 : 0;
