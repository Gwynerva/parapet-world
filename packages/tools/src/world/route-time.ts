/**
 * `node packages/tools/src/world/route-time.ts [<route-id> ...] [--district <id>] [--max <states>]`:
 * bakes the city in memory and prints the shortest time the search finds for each route (all
 * routes, or those named, or one district's): a runner starts idle on the floor under the start
 * gate, and the simulation's own observer judges the run as the game does (gates touched in order,
 * a cancel when the feet leave the corridor, another route's start gate replacing the run). A good
 * player is a few seconds slower. A route the search cannot finish is reported with the gate its
 * best line got stuck at. Exit code 1 when a route does not finish.
 */
import { loadWorld, option } from './load.ts';
import { routeTime, stuckAt } from './search.ts';

const args = process.argv.slice(2);
const district = option(args, '--district');
const max = Number(option(args, '--max', '8000000'));
const named = args.filter(
  (a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--')),
);
const w = loadWorld();
let failed = 0;
w.index.routes.forEach((r, i) => {
  if (named.length > 0 && !named.includes(r.id)) return;
  if (district !== null && r.district !== district) return;
  const t0 = Date.now();
  const t = routeTime(w, i, max);
  if (t.seconds === null) failed++;
  const took = ((Date.now() - t0) / 1000).toFixed(0);
  const result =
    t.seconds === null
      ? `NOT FINISHED, ${stuckAt(t.reached, r.checkpoints.length)}`
      : `${t.seconds.toFixed(1)} s`;
  console.log(`${r.id}: ${result} (${t.states} states, ${took} s)`);
});
process.exitCode = failed > 0 ? 1 : 0;
