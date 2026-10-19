# World checking tools

Tools for room authors. They bake the city in memory from `packages/content` (they never write
`dist`), so they see the rooms as they are on disk. A bake error stops them with the list of
errors; fix those first (`npm run bake -- --check` shows the same).

## explore.ts: what a runner can reach

```bash
node packages/tools/src/world/explore.ts --district warehouses --map out.png
```

A breadth-first search with the real simulation (`stepRunner`) from a hub's spawn (the start hub
unless `--hub <id>` names another) or from a runner standing in a cell (`--at <x>,<y>`). Each edge
holds one key mask (none, left, right, left+up, right+up, up, down, left+down, right+down) for 4
steps; states are deduplicated by a coarse key of
position, move, facing and velocity, and dying or respawning ends a branch. It prints `yes` or `NO` for every hub and find (of one district with `--district <id>`); every route
is then run by the route search below and judged by the simulation's own observer, so `yes` means
the game would record a finish (`--no-runs` only lists which gates the body touched, + or - per
gate). Exit code 1 when anything is missed. `--map <file.png>` draws the
city at 2 px per cell: solid cells grey, cells the runner's body touched green, entities outlined.
`--max <states>` caps the search (4 million by default); a full 8 x 4 city needs more than that and
several minutes, so check a district with `--within <x>,<y>,<w>,<h>` (the runner's feet stay in
that cell rectangle) and `--hub` or `--at` inside it.
`--gym` searches the gym instead.

The search does what a player with good timing can do with held keys; it is thorough but not
exhaustive, so a `NO` means "look here", and a `yes` for a gate or find means the body touched it.

## route-time.ts: how long a route takes

```bash
node packages/tools/src/world/route-time.ts --district factory
node packages/tools/src/world/route-time.ts factory-catwalks
```

The same search for one route at a time, with the simulation's own observer stepped beside the
runner, so the game's rules apply: gates count when the body enters them, in order; the run is
cancelled when the feet leave every corridor rect; touching another route's start gate replaces the
run. A runner starts idle on the floor under the start gate, facing the first checkpoint (3 steps
per edge). It prints the shortest time to the observer's `finish`, or, when no line finishes, the
gate the best line got stuck at; a good player is a few seconds slower. Exit code 1 when a route
does not finish.

## bot-plan.ts: a bot route that loops

```bash
node packages/tools/src/world/bot-plan.ts --out packages/content/bots/rooftops-1.bot.json   --name Kite --district rooftops --look hairRed/classic --start 9,23 --via 25,19,1,4 --via 36,21,1,4
```

Plans a `<district>-<n>.bot.json` with the same search: a fresh runner standing in cell `--start
x,y[,facing]` passes through each `--via x,y,w,h` cell rectangle in order and comes back to stand
idle where it started, facing the same way, so the loop passes `npm run check:bots`. The route is
replayed and checked before it is written; a leg that cannot be found stops it with an error.

## view.ts: a picture of the rooms

```bash
node packages/tools/src/world/view.ts out.png 0 32 128 64 --scale 0.5
```

Draws a rectangle of cells (the whole city by default) flat with the real tile atlases and props,
each district's sky, and outlines of hubs (green), route gates (start blue, checkpoints amber,
finish red) and finds (magenta), with cell numbers every 8 cells. No slab depth; the game
(`npm run dev`) shows the real thing.

## Library

`search.ts` exports the search (`explore`, `routeTime`, `runnerAtHub`, `touches`, `hit`) for other
tools; `load.ts` bakes the city or the gym in memory (`loadWorld`).
