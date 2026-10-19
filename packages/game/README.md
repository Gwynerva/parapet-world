# @parapet-world/game

The game app: boot, title, the offline and online game, HUD and menus, input, sound, and the
developer's bot route recorder. It wires `sim` (the runner), `runtime` (the renderer) and `net`
(the online session) together; nothing here is simulation.

```bash
npm run dev
```

serves it on port 5180 with `packages/content/dist` as the public directory and `/ws` proxied to
the game server (`npm run serve`, port 8080). URL options: `?world=city|gym|test` (the baked city,
the baked gym rooms, or the runtime's built-in test world; by default the city, or the gym while
the city has no rooms), `?offline` (never try the server), `?online` (try the server with a world
other than the city; the server plays its own `world.json`), `?dev` (developer info, the bot
route recorder, the clips drawn with stand-ins in the console, and `?bots=N` local runners around
the start hub for profiling crowds).

## How it runs

- **Boot** (`content.ts`): the rules, render settings, skin layers, clips and marker sprites from
  the baked dist; in development the content sources under `/content/` (a Vite plugin) fill in
  what the baker has not copied yet. Chunks stream in later.
- **Title** (`menus.ts`): name entry and Play over the world. Play joins the server when one
  answers within 4 s (`online.ts`), otherwise the game plays offline; a refused name or another
  ruleset is shown and the game plays offline.
- **Offline loop** (`loop.ts`, `app.ts`): 30 steps a second with the fraction carried and a
  250 ms clamp; the own runner steps against the sim's `ChunkWorld`, and stalls (no step, no time
  carried) until the 3 x 3 chunks around it are loaded. Bot routes listed in `world.json` are
  replayed locally (`bots.ts`).
- **Online loop**: the net client steps the predicted own runner to the server clock with the
  held keys (`NetClient.update`), relays other players and the server's bots, and its events (finds,
  unlocks, hubs, times, ranks) and profile are the record. When the connection drops (or no server
  answered at Play) the game carries on offline from where the runner is and tries again after 3,
  6, 12, 20 and then every 30 s; when the server is back it rejoins ("Back online", the server
  places the runner). A refused name or another ruleset is not retried. A tab coming back from
  hidden asks for a resync.
- **Streaming** (`streamer.ts`): chunks within 2 of the camera and of the own runner are fetched
  (four at a time, nearest first); chunks more than 3 away from both are dropped. The work runs only
  when one of the two centre chunks changes or a fetch finishes. A fetched chunk's cells go to the
  simulation at once; its mesh is built within 3 ms per frame (nearest to the camera first, at
  least one a frame), so a row of chunks at a border spreads over a few frames. A chunk inside the
  bounds that the bake did not write is air.
- **Drawing** (`anim.ts`, `clips.ts`): the anchor is interpolated between the last two states
  (not across teleports). The clip is resolved once per move: its own clip if exported, else the
  clip the exporter's index says plays it, else a stand-in that reads as the same motion (the tiger
  jump plays jump, a vault the monkey vault, ladders the wall run, ledge holds fall, ...), else idle
  on the ground and fall in the air; `?dev` lists the stand-ins once in the console. A timed move plays its whole clip over its
  duration, a `cycle` move (running) follows the distance, a `loop` move its loop, others play at
  the clip's speed from the move's first step; a new move entry (the state's animation nonce)
  restarts the clip. The lifted clips draw their root as stored (`'clip'` travel): their root is
  drawn relative to an anchor the simulation moves.
- **Camera** (`camera.ts`): follows with a look-ahead along facing and speed, eases, snaps on
  teleports, never clamps to the world's edges. Vertically it frames the last floor: within a band
  (88 px up, 40 px down) jumps and short drops do not move it; beyond the band (climbs, wall runs,
  long drops in the tall districts) it follows, and a fall faster than a jump's descent pulls it
  down to show the landing.
- **Death**: a moment to see the fall, then a short fade to black that lifts at the respawn (also a
  quick one on teleports and on rejoining the server).

## Input (`input.ts`, `touch.ts`)

Held keys per step (`schemas` `Key`): arrows and WASD always, plus rebindable keys (Space jumps,
J acts by default); a standard gamepad (d-pad or left stick, A jumps, B/X/RB/RT act); on-screen
held buttons on touch screens (setting: on touch screens, always, never). Every edge the player
makes reaches a step: a press is latched until a step takes it (a tap shorter than a step still
lasts one step), and so is a release (letting go and pressing again within one step shows the key
up for a step, then down), which is what the tiger jump's re-press of forward needs on a keyboard,
a pad or a touch button. Online the latch is kept until the net client actually runs a step.
Gamepads are polled only while one is connected.

## HUD and menus (`hud.ts`, `menus.ts`)

The first play opens the controls (keyboard with the player's bindings, or the touch buttons):
running, jump, wall run, tiger jump, roll, slide, ledges, ladders, flips; the pause menu reopens
them. Until the hub menu was opened once, entering a hub shows a hint how to open it.
District banner on entering a district, the route timer with checkpoint splits and the best time,
the finds counter, toasts (hub discovered, finds, unlocks, results), names over runners and the
route labels over start gates (drawn on one 2D canvas, text widths measured once), the hub prompt; route gates (the start gates, then the next gate of the run in progress) and found finds as
markers (unfound finds have none). Each start gate is labelled with its route's name and difficulty
(easy, medium, hard, expert, colour-coded), as is every route in the hub's leaderboards. The hub menu (E or the prompt, inside a hub area): teleport to
discovered hubs, the wardrobe limited to unlocked looks (`schemas` `UNLOCKS`), rumours for the
district's unfound finds, the district's leaderboards (the server's top 10 and own best online,
local bests offline). Settings: key bindings, perspective strength from 0 to the content's
default, volume, touch buttons. Esc or P pauses.

## Records (`observers.ts`, `profile.ts`)

The record of a run comes from the simulation's observer (`observe`), the same the server runs;
the game adds the region (district banner, ambience) and the hub area (menu). The local profile
(localStorage) holds the device token, name, look, finds, discovered hubs, best times, the last hub,
the settings (bindings, perspective strength, volume, touch buttons) and whether the controls and
the hub menu were seen; it is saved on every change and repaired field by field when read. Online
the server's profile replaces its finds, hubs, times and look.

## Sound (`audio.ts`)

Generated with Web Audio, nothing loaded: footsteps by the floor's material sound family (two per
stride), jump, landings, roll, death, find, checkpoint, finish, unlock, a UI tick, and an ambience
loop per district (wind, a hall hum with clanks, machines, water and drips) cross-faded on district
changes. It starts on the first key or touch.

## Bot route recorder (`?dev`, `recorder.ts`)

Offline, R starts recording, only while the own runner stands still in the spawn move on the
ground; it is replaced by a fresh runner at its feet point and facing (a bot starts every loop so).
R again stops: the recording is trimmed at the last step (at least a second in) where the runner is
back in the same move and facing within one cell of the start, or refused; it is saved through the
dev server
(`POST /__dev/bots`, a plugin in `vite.config.ts`) as
`packages/content/bots/<district>-<n>.bot.json` (format in `packages/content/bots/README.md`).
`npm run check:bots` then replays it against the baked world.

## Performance

Measured in the desktop app's browser pane (1127 x 908 drawing buffer) on the baked city with
`?bots=30` (31 runners, about 100 draw calls and 96 000 triangles a frame): the whole frame
(simulation of 31 runners, observers, streaming, the renderer, the HUD) takes 0.3-0.4 ms of
JavaScript at the median, 0.5-0.6 ms at p95. Sweeping the whole city at 720 px/s with 31 runners:
median 0.4 ms, p99 1.5 ms, worst 4.5 ms (the first frame after a jump across the city); a chunk
mesh costs 0.6-1.7 ms to build and upload. The pane cannot throttle the CPU; a mid-range phone is
roughly 5-8 times slower in JavaScript, which still leaves most of a 16.7 ms frame. The game's own
frame path allocates nothing in steady play; what remains is about 1 KB a frame from the browser's
WebGL bindings (typed-array uniform uploads), number boxing and the simulation's `observe`.

## Tests

`npx vitest run packages/game`: the step clock, the input latch (taps, re-presses, double taps, pad
edges), key and gamepad mapping, the camera (look-ahead, framing through a jump and a climb), the
clip plan against the real move table and clips, clip timing, chunk streaming, the observers on the
test world, the profile (unlocks, repair of stored data), and the recorder.
