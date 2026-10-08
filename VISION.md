# Vision

Directions for the game, roughly in the order they build on each other. Nothing here is
scheduled. One rule runs through all of it: **everything is our own** — the move set and its
tuning, the character and its animation, the city, the music. See `LESSONS-FROM-CLASSIC.md` for
what we take from Parapet Classic (ideas and architecture) and what we do not (its content).

## 1. One big world ("the city")

Instead of picking levels from a menu, every player runs around one huge, connected map and
physically reaches the start gate of a run to activate it. Zones differ in difficulty (low
rooftops near the start, cranes and towers further out), other players are visible all the
time, and races start when someone touches a gate.

Why the architecture proven in Classic supports it:

- A level is a tile map; the world is just a very large one. The engine work is a chunked map
  (load and unload tiles and background art per chunk) and a camera that never clamps.
- A deterministic simulation runs N runners with independent input streams. Runners do not
  collide with each other in parkour, so showing other players needs no physics between them.
- One step of one runner costs a few hundred integer operations; a server core can simulate
  hundreds of runners thirty times per second. Network traffic is presses only: a few bytes per
  press, nothing per step while running straight.
- Fairness stays replay-based: the server receives inputs, not positions, and re-simulates any
  run it puts on a leaderboard.

Building blocks, in order:

1. **Chunked world map** with regions ("zones") carrying metadata: name, difficulty, theme,
   background art, music. Districts are designed for the city, connected by rooftops.
2. **Regions and their hubs.** Every region of the world has a hub: a safe place where its
   runners arrive, meet and set out from. A hub a player has reached once is a destination for
   good: from any hub they can teleport straight to any other hub they know, so the regions
   are quick to move between while the city between hubs is still crossed on foot. A fall or a
   fail ("death") brings the runner back to the hub of the region they are in, and empties
   their inventory, if the game has one (whether it does is open).
3. **Gates.** A run is a trigger at a start line plus its checkpoints and finish. Touching the
   gate starts a timer for that player; the run ends at the finish or when the player leaves
   the route corridor. Several players can be in the same run at once, each on their own timer.
4. **Rooms of dozens of players.** A room is a world instance; the server relays input events
   with step numbers (lockstep with a small fixed delay, no rollback, because runners never
   interact). Late joiners receive a snapshot of every runner and start stepping from there.
5. **Interest management.** Clients only need runners within a few screens; the server filters
   by zone or chunk and the client extrapolates briefly when a packet is late.
6. **Authoritative results.** Run results are computed by the server from the relayed inputs,
   so leaderboards and live races share one source of truth.

Directions this opens up:

- **Live races at gates.** Standing at a gate starts a countdown; everyone there starts together
  and sees each other for the whole route. Small gates for duels, big ones for events.
- **Ghost lines everywhere.** The best replay of every run is available as a ghost to follow
  and learn the route: friends' ghosts, your previous best, the world record.
- **Zone progression without menus.** Harder zones are reachable only by routes that need the
  advanced moves, so the world itself teaches and gates the skills.
- **Territory and "street cred".** Holding the fastest line on a route tags it with your name
  until someone beats it; districts could be "owned" by crews.
- **Asynchronous play.** Daily and weekly routes seeded from the world (same gate, rotating
  checkpoints), replay-verified, so nobody needs to be online at the same time.
- **Spectating and replay theatre.** Any leaderboard run can be watched at its real location
  with a free camera; live races can be watched from the rooftops.
- **Co-op and relay formats.** Relays where each runner covers one segment, chase modes where
  catching means matching a line within a few frames, "follow the leader" trick chains.
- **Secrets, very hard to reach.** Scattered over the whole open world: a ledge only the
  longest wall-run chain reaches, a rooftop behind a gap that needs a perfect line, a room at
  the top of the tallest crane. Nothing marks them on a map; finding one is a story to tell,
  reaching it a feat. They are where the world rewards mastery rather than time spent.
- **Cosmetics tied to exploration.** Hidden spots unlock skins; skins are data and never touch
  the simulation.
- **Dynamic world dressing.** Time of day and weather in the background layers (purely
  visual), seasonal districts, events that open new gates for a while.
- **In-world building.** The level editor as a build mode inside the city: players design
  routes in a sandbox district, submit them, and verified community routes get real gates.
- **Mechanics experiments in isolated districts.** New tiles or moves can be tried in a test
  zone without touching the main move set; the move table is data, so a district can even run
  a table of its own.

Things to keep in mind:

- The move set is the product: once players have learned it, the main districts keep it
  stable; changes go through test districts and versioned rulesets.
- Interpolation between steps is per runner; many visible runners need one animator each
  (cheap), and sprite batching is unnecessary at this scale.
- A fixed-step simulation on a slow device slows its own clock; in a networked room the client
  must run at the server's step count and catch up ("network-paced" loop).
- Anti-cheat beyond replay verification (input timing analysis, rate limits) only once there
  is something worth cheating for.

## 2. Modes beyond plain races

- **Max score.** A time-limited run on tracks built for it (loops and arenas with a mix of
  obstacles) where the goal is the highest score. Repeating the same trick in a row pays less
  each time; chaining distinct tricks restores or raises the bonus, so the best lines alternate
  vaults, flips, wall runs and pole tricks. Candidate rules: a per-move decay counter that
  resets after a few other moves, a "variety" multiplier on top of the flow meter, a bonus for
  using every move family within the limit. The rules live in the ruleset as data.
- **Procedural arenas (endless mastery).** Levels generated from a seed, so no route can be
  memorised, only the moves. The simulation takes a tile map as data; a generator emits tiles,
  start, checkpoints and finish, and seed + generator version + input log is a verifiable
  replay.
  - Generation from a library of hand-authored chunks tagged by the move families they require
    and by their entry/exit ports (height, approach speed), stitched under constraints; the
    simulation doubles as a solver that proves a route exists and grades it.
  - Daily and weekly seeds with their own leaderboards; seeds are shareable codes.
  - Drills: the generator biased toward the move family a player fails most, a "wall-flip gym"
    that gets harder as the success rate climbs.
  - Endless format: chunks appended ahead and dropped behind, scored by distance and flow.
  - Roguelike runs: a sequence of arenas with a budget of fails, a choice of the next chunk at
    forks, modifiers (mirrored arena, fog, time scale) per segment.
  - In the city: outskirts that regenerate weekly, infinite towers, event gates whose route is
    generated at start.

## 3. Content pipeline and editor

- A level editor in the browser: paint tiles, place start, finish and checkpoints, pick a
  background theme, test-run instantly (the simulation takes levels as JSON).
- Skins as data: a manifest that swaps body-part sprites, a tool that imports sprite sheets.
- Custom level sharing through the server (levels are small JSON documents; replays reference a
  level hash so leaderboards stay honest per level version).

## 4. Monetization and analytics (opt-in integrations)

The game core stays isolated from external services. Monetization and analytics are explicit,
opt-in, app-level integrations with their own CSP entries, configured per deployment:

- **Analytics** (GA4 or a privacy-friendly alternative): a thin adapter with a handful of events
  (run started/finished, mode, result) and consent handling; the script loads only when enabled.
- **Banners** in an optional slot beside or below the canvas, never over the play area.
- **In-world advertising as dressing**: billboards, posters and shop fronts whose textures come
  from a campaign manifest served by the game's own server, with impressions counted when a
  billboard is on screen.
- Fairness first: nothing bought or shown may change the simulation.

## 5. Package layout (target)

```
packages/
  schemas/   data formats: types + validators (levels, moves, scenes, skins, fonts, i18n)
  sim/       deterministic mechanics; registries for conditions and impulses; versioned rulesets
  protocol/  client <-> server messages for REST and realtime
  net/       lockstep input relay, step numbering, snapshots, interpolation buffers
  runtime/   browser platform, rendering and UI toolkit (platform, render, ui, audio subpaths)
  game/      the app
  server/    api (leaderboards, replay verification) + realtime (rooms), storage adapters
  tools/     content validation, editor CLI, art import
  content/   our own levels, art, music
```

Boundaries are checked by tooling (dependency-cruiser or ESLint boundary rules) in CI. Not
doing: a general-purpose engine (Phaser/Pixi) or an ECS; a data-driven state machine with a
deterministic integer simulation is the right architecture for these mechanics.
