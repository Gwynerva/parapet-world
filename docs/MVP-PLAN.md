# MVP plan

Status: draft, rewritten 2026-10-18 before any code exists. This is the plan for the first
playable product of Parapet World: one seamless city of four districts (rooftops, warehouses,
factory floor, sewer), held-key parkour movement with flat props to do tricks on, a server from the
first day that simulates every runner, bots that run looped routes exactly like players, and three
things to do: time trials, hidden finds and free exploration. The simulation is deterministic and
shared by browser and server; runners are 3D over a 2D tile world shown as a shallow slab in
perspective.

Everything here is our own design, with one recorded exception: the runner's animation clips for
the MVP are lifted from Parapet Classic's keyframes onto our 3D rig (section 8). They live in their
own folder, block any public build, and are to be replaced or improved later. Parapet Classic is
otherwise used for techniques only (see `LESSONS-FROM-CLASSIC.md`).

## 1. Scope

**In the MVP:**

- The deterministic simulation, every move in section 3 and collision for tiles and props.
- A world of about 8 x 4 chunks with four extensive districts, a hub in each, death back to the district's hub and
  teleport between discovered hubs.
- The perspective slab (16 px deep, 15% perspective, runners mid-slab, all configurable) and flat
  props in the runners' plane.
- The L2 3D runner with box-unwrapped skin sheets, four costumes and two hair styles, and the
  lifted Classic clips.
- A Node server with `ws`: it simulates every runner, relays inputs, filters interest by chunk,
  checks hashes, resyncs, and stores profiles and leaderboards.
- About 32 bots on looped routes, eight per district.
- 8 time-trial routes, 12 hidden finds that unlock costumes and hair, and free exploration.
- Keyboard, gamepad and touch buttons; sound effects and district ambience.

**Deferred** (they were in the earlier draft of this plan):

- Inventory, items, drops, the thrown-item teleport and items on bone sockets.
- Hit points. A runner dies only from fatal landing speed or `KILL` cells.
- Several shards, "join player", and separate layers for rooms and races. The MVP has one shared
  world layer.
- Doors and any other shared mutable world state, and with them the rewind of the own runner (the
  64-step ring). Without them nothing but the player's own input changes the player's runner, so
  prediction never needs to rewind; the protocol keeps room for it.
- The LDtk importer, the L3 mesh and the pose tool.
- Music. The MVP has sound effects and an ambience loop per district.

## 2. Decisions

- **Stack.** TypeScript everywhere, npm workspaces, packages export raw `./src/index.ts`. Node 24+
  runs the server and tools without a build step; Vite bundles the client; vitest tests; prettier
  formats. Runtime dependencies: `ws` on the server, nothing else. Dev dependencies: `typescript`,
  `vite`, `vitest`, `prettier`, `@types/node`, `@types/ws`. Conventions, tsconfig and formatting are
  inherited from Classic verbatim (English in the repository, British spelling, LF, no enums).
- **Graphics.** One WebGL 1 context renders everything. The tile world is drawn into a framebuffer
  at logical resolution (about 683 x 384 px, 32 px tiles) and upscaled with nearest filtering, so
  the world stays honest pixel art and fill rate on phones drops 9-16x. The flat level is shown as a
  shallow slab in perspective, the way Gravity Defied turns its track lines into planks. Runners and
  props live in the slab's middle plane and are drawn at device resolution. No engine (no Three.js,
  Pixi, Phaser).
- **Simulation.** Deterministic int32 arithmetic, 30 steps per second, zero dependencies, no DOM.
  Runner state is a flat `Int32Array` so copying, hashing and snapshots are loops over integers.
  Moves are a data table compiled against registries of named predicates and effects; a versioned
  ruleset is hashed into every replay and handshake.
- **Input.** Held keys, not presses. The input log stores the held mask per step, run-length
  encoded, plus rare commands (teleport to a hub). Press edges are derived inside the simulation
  from the previous step, so a frame that runs zero or two steps never changes the result. Bits are
  absolute (left, right, up, down, action); facing-relative intent is resolved by predicates.
- **Networking.** Runners never collide, so each runner is simulated on its own. The server
  receives held-mask runs, simulates every runner and relays nearby runners' inputs with step
  numbers. The client predicts its own runner with zero delay and shows other runners a little
  behind, simulated from their relayed inputs. State hashes are exchanged every 30 steps; a mismatch
  triggers a resync from a server snapshot.

## 3. Simulation

- **State layout.** `R.X, R.Y, R.VX, R.VY, R.FACING, R.MOVE, R.PHASE, R.TIMER, R.HOPS, R.HELD,
R.PREV_HELD, R.AGE_*` (press ages per key, saturating), `R.WANT_X, R.WANT_Y` (intent), ground,
  wall, head and grip contacts, `R.LAND_VY, R.AIR_STEPS`, stored speeds, four scratch words,
  `R.ANIM_NONCE` (excluded from the hash). Runner hash: FNV-1a over the state words and the step
  number.
- **Move table.** A row has a name, optional parent, duration (steps, 0 instant, -1 until a
  transition, or a `$param`), `then`, flags (`anchorHands`, `noGravity`, `noCollide`, `lockFacing`,
  `keepPresses`, `noTurn`), `onEnter`, `perStep`, `onExit` effect lists, ordered transitions with
  AND-ed predicates and priorities, and the animation clip name. `compileRuleset` resolves names to
  dense `Int32Array` tables, rejects unknown names and unconditional cycles, and hashes the result.
  Moves are reached only through roles (`spawn`, `fall`, `dead`, `frozen`) and transitions; no move
  id appears in code. Instant chains are capped at 8 hops per step as part of the state.
- **Intent and inertia.** Locomotion effects move velocity toward a target (`accelToward`,
  `decelTo0`, `drag`) instead of setting it, so turning takes time and a trip carries momentum. The
  `turn` move keeps the old facing while decelerating and flips it in an instant `turnFlip`; `trip`
  has no transition to `turn`, so the runner slides in the direction of motion first.
- **Collision.** Stateless between steps: the ground is re-derived from the position every step via
  per-cell shape functions, a body box is pushed out of solids per axis, read-only sensors feed
  predicates (`ledgeAhead`, `ladderHere`, `poleHere`, `barAbove`, `vaultAhead`, `slabAbove`,
  `wallAhead`), grip moves snap to an anchor cell. Speed caps keep every per-step displacement under
  one cell, which rules out tunnelling by construction.
- **Collision classes.** Every obstacle a trick uses is a cell class, a technique taken from
  Classic: solid, top-only floor (catwalks, shelves, planks), wall face, ledge corner (grabbable),
  45-degree slopes, low post (a thin vault obstacle with ledges), ladder, pole (at the cell centre),
  overhead bar (hands hang from it, feet may stand on it), low slab ceiling (roll or slide under),
  `KILL`. Tiles and props share these classes; the simulation never knows which one a cell came
  from.
- **Death and respawn.** Landing faster than the fatal speed or touching `KILL` enters `dead`;
  `respawn` places the runner at the hub of the region it died in. Regions and hubs are static data
  from `world.json`, so respawn is deterministic and needs no server order.
- **Hub teleport.** A teleport command in the input log moves the runner to another hub at that
  step. It is valid only while the runner stands in a hub area, which the simulation checks; the
  server also rejects hubs the profile has not discovered and resyncs the client.
- **Observers.** Gates, checkpoints, finds and hub discovery are observers: pure functions of a
  runner's step-by-step state over trigger cells. The same code runs on the client (for the HUD)
  and on the server (for the record), so the server's own simulation is the verification.
- **Determinism rules.** Only `Math.imul` from `Math`; `(a / b) | 0` division; no floats, Date,
  Map iteration, default sort or locale functions in `sim` and `net`. A vitest "lint" test greps for
  violations. Magnitude policy: positions below 2^30, velocities below 2^16.

### MVP move list

About 45 rows. Values and tuning are our own. "Lifted" means the clip is among the 22 already
lifted and approved; "to lift" means it comes from Classic's 68 clips through the same pipeline and
reviewer (section 8).

| Group     | Moves                                                                    | Needs in the world           | Clips                                |
| --------- | ------------------------------------------------------------------------ | ---------------------------- | ------------------------------------ |
| Ground    | idle, start, run, runUphill, runDownhill, skid, turn, turnFast, turnFlip | floor, slopes                | lifted                               |
| Air       | jump, tigerJump, fall, landSoft, landHard, roll, frontFlip, backFlip     | -                            | lifted; tigerJump to lift            |
| Failure   | stumble, trip, crash, crashFall, crashDown, getUp, dead, respawn         | -                            | lifted                               |
| Walls     | wallRun, wallRunTop, ticTac, wallFlip                                    | tile and prop walls          | lifted; wallFlip to lift             |
| Ledges    | ledgeGrab, ledgeHang, ledgeClimb, ledgeDrop, ledgeJumpBack               | ledge corners, prop edges    | to lift                              |
| Obstacles | stepOver, vault, monkeyVault, slideUnder                                 | low posts, crates, low slabs | slideUnder uses roll; others to lift |
| Ladders   | ladderEnter, ladderClimb, ladderSlide, ladderTop                         | ladder                       | to lift                              |
| Poles     | poleGrab, poleSlide, poleJump, poleSpin                                  | pole                         | to lift                              |
| Bars      | barGrab, barSwing, barJump                                               | bar                          | to lift                              |

**Tiger jump** (user decision, 2026-10-19): pressing the movement key again in the direction the
runner is already running (a release and a re-press of the forward key while running) triggers a
long, low leap forward. A brief release of the forward key therefore does not drop the run into a
skid before the re-press can be read.

About 20 clips are to be lifted. Each passes the independent reviewer (frame-by-frame anatomy,
ground contact from body points only, dynamics like Classic's) before it is baked into the
repository.

## 4. World

- **Coordinates.** Cell = 1024 units = 32 px; chunk = 32 x 32 cells; chunk keys are packed int32
  `(chx & 0xffff) << 16 | (chy & 0xffff)`; arithmetic shifts keep negative coordinates correct.
- **Layout.** The districts must be extensive, with many routes from simple to really hard (user
  direction, 2026-10-19). The MVP city is about 8 x 4 chunks (256 x 128 cells); a screen is about
  21 x 12 cells, so a district spans a dozen screens. `content/world/DESIGN.md` fixes the exact
  rectangles and the connection cells; each district's rooms live in
  `content/world/rooms/<district>/`.

  ```
            x0 .. x3                         x4 .. x7
  y0   [ Rooftops: start hub, roofs, parapets, cranes and towers               ]
  y1   [ Warehouses: hub, racks, docks,  ][ Factory: hub, catwalks, machines,   ]
  y2   [ yard with containers and crane  ][ pipes, chains, presses             ]
  y3   [ Sewer: hub, tunnels, walkways, sewage channels, under the whole city  ]
  ```

- **Lines.** Every district has several stacked lines: a ground line anyone can run, middle lines
  that need vaults, slides, wall runs and ledges, and high lines that need chains of advanced
  moves, with many alternative paths between them and expert shortcuts.

- **Districts.**
  - **Rooftops** (the start): concrete and tar roofs, brick parapets, corrugated sheet. Props: AC
    units, water tanks on legs, ventilation ducts, antennas (poles), fire-escape ladders, washing
    lines and cables (bars), billboard frames (shelves). Hazard: falling from height. Background: a
    city skyline in two or three layers.
  - **Warehouses**: concrete floor, corrugated walls, loading docks. Props: shipping containers
    (walls to run on, roofs to land on), wooden crates (vault, climb), pallets (low obstacles),
    pallet racks (shelves to jump onto), chain-link fence. Background: rows of racks, a gantry crane
    in the yard.
  - **Factory floor**: steel plates, grated catwalks (top-only), riveted beams. Props: vertical
    pipes (poles), horizontal pipes (bars), crane chains and hooks, machines and presses, barrels,
    ladders, railings (front layer). Background: machine silhouettes, windows with light shafts.
  - **Sewer**: wet brick, concrete walkways, cast-iron grates. Props: pipes, ladders up to
    manholes, sluice gates, rubble. Hazard: sewage channels (`KILL`). Background: tunnel arches.
- **Difficulty grows with the districts**, so the world teaches the moves (VISION): rooftops ask
  for running, jumps and vaults; warehouses for containers, wall runs and ledges; the factory for
  poles, bars and catwalks; the sewer for long chains over the channels. Finds need advanced moves.
- **Connections.** Manholes with ladders lead from the sewer to the warehouse yard and to the
  factory; warehouses and factory meet at street level; fire escapes, container stacks and the
  crane gantry lead up to the rooftops.
- **Hubs.** One per district: a safe area with a clear sign, discovered on first touch. The hub
  menu offers teleport to discovered hubs, the wardrobe and the district's leaderboards. Death
  returns the runner to the hub of the region it is in (regions are cell rectangles in
  `world.json`).
- **Goals per district.** Four time-trial routes, one per difficulty (easy, medium, hard, expert;
  20-60 s each: start gate, two to four checkpoints, finish, a route corridor) and four finds with
  no markers, from tricky to really hard: 16 routes and 16 finds in all. The hub
  gives a broad clue tied to a landmark for every find of its district not yet found ("on the
  tallest crane"), as VISION's untimed searches describe. Finds unlock looks: 3 finds the T-shirt
  and jeans, 6 the hoodie, 9 the summer outfit, 12 the short hair; the Classic outfit and the red
  hair are available from the start.
- **Authoring.** Rooms are ASCII files (`content/world/rooms/*.room.txt`) with a header (`@pos`,
  `@size`, `@region`), a character grid, `@prop` lines and `@entity` lines (hubs, gates,
  checkpoints, finds). `palette.json` maps characters to materials (collision class, visual class,
  depth fill); `tiles.rules.json` holds LDtk-style 3x3 autotile rules, so authors paint materials
  and never pick tiles. The baker validates, splits rooms into chunks, stamps props, runs the rules
  and writes content-addressed chunk files plus `world.json` (regions, hubs, routes, finds with
  clues, bots, stable ids).
- **Props.** A prop is a static, cell-aligned object from `content/props/props.json`: id, district
  tags, a rect in the props atlas, an anchor, a footprint in cells, a collision mask and a draw layer
  (`mid` by default, in the runners' plane; `front` for decoration in front of runners, without
  collision). Masks use the room characters, as Classic's ASCII move demos do: a container
  `["######", "######"]`, a catwalk `["===="]`, a ladder `["H", "H", "H"]`, a vertical pipe
  `["P", "P"]`, a horizontal pipe `["--"]`. A room places a prop with `@prop crate 12 7`, and
  single-cell props also by a legend character. The baker stamps the mask into every chunk the prop
  covers and lists the prop for drawing in the chunk of its anchor. Prop cells are never extruded.
- **Depth outlines.** The baker also writes, per chunk, the exposed outline of every solid tile
  shape: the boundary segments between solid and empty space, taken from the same per-cell shape
  functions as collision, so slopes, slabs and one-way platforms get sloped or thin planks for free.
  Collinear segments of one material are merged. Each chunk file carries a one-cell apron of its
  neighbours' solidity, so its outline is final without loading the neighbour. Outlines are purely
  visual; the simulation never reads them.
- **Static only.** In the MVP chunks are immutable and served by hash over HTTP. Shared mutable
  state (doors, cell overrides) is deferred.
- **Windows.** The client loads chunks within radius 2 of the camera; a runner is stepped only when
  the 3 x 3 chunks around it are present, otherwise its clock stalls (own runner) or it freezes until
  its next keyframe (remote). `CellReader` returns a `MISSING` bit instead of throwing. The border
  test bakes one room twice, monolithic and chunked with scheduled loads and unloads, runs the same
  input log and requires identical per-step hashes. The MVP city nearly fits in one 5 x 5 window, so
  streaming and interest are also tested on a large generated test world.

## 5. Bots

- **Route file.** `content/bots/<district>-<n>.bot.json`: a start keyframe of the runner state,
  the held-mask runs, the loop step, a look and a name.
- **Recording.** The client has a developer mode that records a route from the current state,
  stops on a key, and trims the log at the step where the runner is closest to the start in the
  same move and facing.
- **Bake check.** The baker replays every route in the simulation: the bot must not die, and the
  last step must be within one cell of the start in the same move and facing.
- **On the server.** A bot is an ordinary runner whose input source is its recording instead of a
  socket. At the end of the loop the server restores the start keyframe and sends `Keyframe`; the
  client smooths the small jump over a few interpolation steps.
- About eight bots per district, 32 in all, with random costumes and hair. Clients see them through
  the same relay and interest path as players, so the bots also serve as the load test.

## 6. Server and protocol

- **Process.** One Node process: static files for the client and the chunks (node:http, chunks by
  hash), `ws` for the game, one shared world layer. A local run and a single server behind an HTTPS
  proxy are enough for the MVP. The starting point is the server branch of Classic (tag
  `snapshot/with-server`): its static files, names, boards and limits modules and the Caddy and
  systemd deployment in `deploy/`, rewritten for realtime.
- **Simulation.** Each runner is simulated on its own as its input arrives. The number of steps a
  client may submit is bounded by real time since it joined, so a client cannot run faster than the
  clock.
- **Messages.** Client to server: `Hello` (token, name, ruleset hash), `Input` (held-mask runs and
  commands), `SetLook`, `Hash`, `ResyncRequest`, `Ping`. Server to client: `Welcome` (profile,
  runner id, step, keyframe), `Tick` and `InputAck` (clock and slack), `RunnerEnter` (id, name, look,
  keyframe), `RunnerLeave`, `RunnerInput`, `Keyframe`, `InputFill`, `Event` (find, checkpoint,
  finish with time, hub discovered, unlock), `Leaderboard`, `Resync`, `Pong`. Hot-path messages use
  `DataView` codecs; the rest is JSON with hand-written validators.
- **Clock.** The client runs `lead = ceil(halfRtt / 33) + 1` steps ahead, nudged by one step at
  most once a second to keep the server-reported slack in 1-3 steps; more than 60 steps behind means
  resync; a tab returning from hidden always resyncs. A server that waits 15 steps for input repeats
  the last held mask and reports it as `InputFill`; after 60 more steps it substitutes zero.
- **Interest.** Subscriptions are the 5 x 5 chunks around the runner, with one chunk of hysteresis
  against churn.
- **Results.** Route times and finds come from the server's own simulation of the runner; there is
  no separate verification step. A result keeps `(route, steps, keyframe, inputs)` so it can be
  replayed later.
- **Profile.** An anonymous device token, a name, the look, finds, discovered hubs, best times and
  the last hub. Names are claimed with a token and a one-time recovery code, the server keeps only
  hashes, and requests are rate-limited per address and name, as in Classic's server branch. Storage
  is JSON files replaced atomically behind a storage adapter, with no extra dependency.
- **Leaderboards.** Top 10 and the personal best per route.

## 7. Rendering and client

- **World pass.** One static vertex buffer per visible chunk (tile front quads plus the extruded
  depth faces) drawn into the logical-resolution framebuffer; under 20 draw calls. The perspective
  prototype's 90 x 12-cell strip of level costs about 1700 triangles with its depth faces. The world
  camera snaps to whole logical pixels and the remainder shifts the upscaled image, so front faces
  never crawl; runners and props use the exact camera.
- **Level depth (Gravity Defied style).** Front faces lie on the screen plane at their true 2D
  position, so the tile art stays pixel-exact. Each depth outline segment is extruded into the
  screen as a quad, and a perspective camera pulls the far edge toward the screen centre: below the
  centre the tops of platforms show, above it their undersides, beside it their side walls. Depth
  faces are shaded by orientation (top 1.0, side 0.76, underside 0.58).
  - **Fill.** Each material may have a depth texture in the tile atlas: a top strip (32 x 16) laid
    along top faces and undersides and a side strip (16 x 32) along side walls; the GPU redraws the
    perspective every frame. A material without strips falls back to stretching its tile's edge row
    or column through the depth, which needs no art at all; `flat` uses the material's average colour
    (far layers). Strips are drawn calm across the depth and detailed along the edge, because faces
    shrink to a few pixels near the screen centre. The row next to the front face must match the
    front tile's edge; the bake validator checks it.
  - **Settings.** Visual only, kept in `render.json` with these defaults: slab depth 16 px,
    perspective 15% (a point 32 px deep moves 15% of the way toward the screen centre), runners at
    0.5 of the slab depth, depth fill `strip` with per-material fallback. A region may override
    depth and strength, and the player's settings may lower the strength down to 0 for motion
    comfort. None of them changes collision, timing or what any other client sees, so they are
    never part of the ruleset hash.
- **Props pass.** Props are flat pixel-art quads at the runner depth, projected by the same camera
  as runners, so a runner standing on a crate meets its top edge exactly. They are drawn after the
  world, at device resolution with nearest sampling, and before runners: in the logical framebuffer
  their 0.958 perspective scale would drop texel columns that crawl while scrolling. The `front`
  layer is drawn after runners and turns half transparent where it covers the own runner.
- **Backgrounds.** Back walls and far layers are pixel-exact 2D parallax layers. Their scroll factor
  equals the perspective factor of their depth, so they move with the slab's back edges.
- **Runners and the slab.** Runners and markers are projected with the same camera at the runner
  depth, so they stand in the middle of the top face. They are drawn after the world without a
  depth test against it, so a hanging runner is never cut by the front face it hangs on.
- **Runner pass.** GPU skinning with bone matrices in uniforms, L2 only (a smoothed L3 for close-ups
  can reuse the same rig and skins later), and an inverted-hull outline that respects skin alpha. A
  runner is 1300-1700 triangles depending on how much of the overlay shell its look uses (measured
  on the four costumes and two hair styles); thirty runners stay within the 60 fps budget measured
  in the graphics demo.
- **Skins.** One skin sheet is a 128 x 128 PNG: the top half is the base layer on the body mesh, the
  bottom half the overlay layer on a shell inflated by about 0.7 px (1 px on the head) and drawn
  double-sided with alpha discard. Every part (head, neck, chest, pelvis, and separate left and right
  upper arms, forearms, hands, thighs, shins and feet) is unwrapped as a box in the Minecraft cross
  layout: top and bottom caps above a strip of front, outer side, back and inner side. One texel is
  one world pixel, so the base layer of all 16 parts packs into 128 x 64 (89% used). The mesh is cut
  along the box edges, so each loft quarter or ellipsoid octant samples exactly one box face. The
  layout is versioned in `schemas` and generates the artist template: a PNG with a guide layer
  that labels every face (front, side, back, top), marks the face, the bust and the joints, and
  shows which faces the camera sees most (the near side, the chest turned 20 degrees, the face
  30-40 degrees). Artists paint in any editor with layers (Aseprite, Krita, Photoshop, Photopea)
  and save a PNG; layered sources may live next to the PNGs in `content`, but the build reads only
  PNGs. A 256 x 256 sheet is accepted as a 2x skin with the same layout, detected from its size.
- **Layer stack and costumes.** A runner's look is a stack of sheets in the same layout, composited
  once at load into one texture (alpha over, base and overlay halves separately): body (skin tone,
  face, eyes, underwear), hair, costume, then optional accessories. A complete skin may also be a
  single flattened sheet. Openness is only paint: a costume covers the body's texels where it has
  cloth and leaves them transparent where skin shows; loose cloth, cuffs and hoods go on the overlay.
  Overlay shell parts are built only where the composited overlay has opaque texels, so a tight
  costume costs no extra triangles. MVP costumes, from closed to open:
  1. Hoodie and joggers: long sleeves and trousers, the hood down on the neck and back overlay.
  2. T-shirt and jeans: bare forearms, rolled jeans cuffs on the overlay.
  3. Classic: cropped tank top and baggy capris rolled at the calf.
  4. Summer: sports top and bike shorts, bare arms, midriff and legs, tight, base layer only.
- **Hair.** Hair is paint, never geometry: the hairline, fringe and texture on the head's base
  layer, the volume on the head's overlay shell, whose transparent texels give a ragged pixel
  silhouette. There are no hair bones, hair meshes, ponytails or hair physics, and ground contact is
  computed from the body only.
- **Texture memory.** A 1x sheet is 64 KB on the GPU and about 5-10 KB as a PNG; a 2x sheet is
  256 KB. Forty unique runners in view need about 2.6 MB at 1x. Sampling cost depends on screen
  pixels, not on texture size, so resolution is a question of style and painting effort, not of
  speed. 1x matches the world's pixel grid and is the MVP standard; at game zoom the graphics demo's
  1x and 2x skins are almost indistinguishable, and 2x only pays off in close-ups.
- **Clips at runtime.** A clip is baked densely at 30 frames per second after planted feet and
  fists are held and the body is clamped to the ground: local bone quaternions, the root position,
  support flags and a per-frame mirror flag. The client maps `(MOVE, PHASE, FACING)` to a clip and
  only interpolates neighbouring frames (spherically) at render rate, while positions interpolate
  between simulation steps. All heavy lifting stays in the lifting tool.
- **Screens and HUD.** Title with name entry and Play; the game; the hub menu (teleport, wardrobe,
  leaderboards); settings (controls, perspective strength, volume); pause. The HUD shows a district
  banner on entry, the route timer with checkpoint splits, the finds counter, toasts for finds and
  unlocks, and names over runners.
- **Input.** Keyboard, gamepad and on-screen held buttons for touch; the sampler latches a tap so it
  lasts at least one step.
- **Camera.** It follows the own runner with look-ahead along facing and speed, and never clamps to
  the edges of the world.
- **Remote runners.** They are shown a little behind the newest relayed input and simulated from
  it; a late input is extrapolated by repeating the last held mask, the same rule the server's
  `InputFill` uses.
- **Audio.** Footsteps per material class, jump, landing, roll, find, checkpoint, finish and an
  ambience loop per district, synthesised by our own small Web Audio generator.
- **Context loss** is handled by rebuilding buffers and textures from the loaded content; the game
  loop uses the fixed-step clock with fraction carry and a 250 ms clamp.

## 8. Content production

- **Art.** Our own placeholder art comes from generator scripts in `tools/art`, painted
  procedurally like the prototypes and written with our PNG encoder. Per district: a palette, five
  or six materials with autotile variants and top and side depth strips, a props atlas, and two or
  three background layers. Atlas layouts are fixed in `schemas` and come with guide templates for
  artists, like the skin template. Generated sheets are committed to `content`; once an artist
  repaints a sheet, the PNG is the source and the generator leaves it alone.
- **Clips.** The 22 clips already lifted and approved (idle, stand, start, run, runDownhill,
  runUphill, turn, turnFast, jump, fall, landingPrepare, landing, roll, frontFlip, backFlip,
  stumble, crash, crashFall, crashDown, getUp, wallRun, wallRunKick) and the ones still to lift are
  exported by the lifting tool into `content/clips/classic/*.clip.json`. The tool stays outside the
  repository with the graphics demo, because it reads Classic's sources. Ledge, ladder, pole and bar
  clips are lifted first, because the props depend on them.
- **The Classic exception.** Classic's keyframes come from someone else's game (Playman Extreme
  Running). The lifted clips therefore sit in their own folder marked as a temporary stand-in, the
  public-build check fails while any of them is in a build. The owner made the GitHub repository
  public with them on 2026-10-19. Our own or licensed clips replace them later; usable sources:
  Mixamo (free, commercial use in games allowed, no redistribution of the raw files, service in
  maintenance mode), Quaternius (CC0), 100STYLE (CC BY 4.0, credit required), CMU motion capture
  (commercial products allowed, no resale of the data), and paid packs such as the QwertNikol
  parkour pack on Fab (about EUR 53) after reading their licence. ActorCore needs its licence
  checked first; LAFAN1 and the Bandai Namco set are non-commercial and excluded. Techniques worth
  keeping: Prince of Persia's long, rotoscope-timed key sequences for climbs; Celeste's squash and
  stretch on take-off and landing; Overgrowth's few keys per move with procedural blending; Dead
  Cells' 3D models rendered as pixel art.
- **Reviewer loop.** Every new or changed clip goes through the demo's review set (Classic | 3D |
  overlay sheets, 30 fps grids, joint metrics) and an independent frame-by-frame reviewer before it
  is baked.
- **What the code takes from the prototypes** (`E:\code\parapet-world-demo`, rewritten in
  TypeScript): from `core.js` the rig (`BONES`), the mesh emitters (`emitLoft`, `emitCube`,
  `emitMapped`), the `SKIN` layout and `uvOf`, `buildShell`, `buildMesh`, layer compositing
  (`paintLayer`, `overOnto`, `maskOf`), `boneMatrices` and the quaternion helpers; from `render.js`
  the cel shader and the inverted-hull outline; from `level.js` the slab extrusion (`buildLevel`),
  the perspective camera (`viewMatrix`, `camDist`), the depth-fill shader, the world framebuffer
  with its upscale, and atlas edge padding.

## 9. Packages

```
packages/
  schemas/   data formats and validators: ruleset, palette, rooms, props, world index, bots, rig,
             clips, skins, atlas layouts
  sim/       stepRunner, registries, compileRuleset, CellReader, observers, hashing, replay codec
  protocol/  wire messages, binary codecs for the hot path, hand-written validators, versions
  net/       pure state machines: step clock, remote buffers and interpolation, hashes
  runtime/   browser: loop, input sampler and latch, WebGL renderer, skin and clip loaders, UI, audio
  game/      the app: screens, HUD, hub menu, route recorder, wiring net to a WebSocket
  server/    ws world, bot drivers, node:http static files, profiles, leaderboards, storage adapter
  tools/     bake (rooms -> chunks), validate, bot check, art generators, skin template and lint,
             replay tools, boundary check, public-build check
  content/   rooms, palette, props, autotile rules, atlases, depth strips, backgrounds, rig, clips,
             skin layers, bots, render.json; dist/ is baked output
```

Dependency direction is checked by a small script in `tools` that parses import lines; `sim`,
`schemas`, `protocol` and `net` have no DOM lib in their tsconfig.

## 10. Milestones and acceptance

| Milestone                | Deliverables                                                                                                                                                    | Acceptance                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0 Skeleton              | npm workspaces, tsconfig, vitest, prettier, package boundary check, `npm run check`, dev server                                                                 | empty packages build; the check is green                                                                                                                                       |
| M1 Sim core              | runner state, every collision class, sensors, rooms, palette, props catalogue, baker (chunks, depth outlines, prop lists, neighbour apron), running and jumping | golden traces, determinism, save and restore, chunk-border equality, float lint                                                                                                |
| M2 World on screen       | WebGL slab with depth strips, props pass, backgrounds, camera, keyboard, local sim, a placeholder runner, a test room from generated art                        | 60 fps on a mid-range phone with no allocation per frame; depth faces meet across chunk borders; a material without strips falls back to edge fill                             |
| M3 Moves and props       | all ~45 moves, prop interactions, a live tuning panel, ruleset v1, a gym room per collision class                                                               | every move reachable in the gym; new golden traces                                                                                                                             |
| M4 Server, one player    | ws, Hello and Welcome, the input stream, server simulation, hashes, resync, chunks over HTTP, profile with token and name                                       | an hour with no hash mismatch; 200 ms RTT and 5% stalls keep slack in range                                                                                                    |
| M5 Others and bots       | relay, interest by chunk, remote interpolation, route recorder, bot check in the baker, bot drivers                                                             | 32 bots loop their routes; 30 runners in view on a low-end phone at 60 fps                                                                                                     |
| M6 3D runner             | rig, mesh, skins and clip playback ported; missing clips lifted through the reviewer; four costumes, two hair styles, wardrobe                                  | every move plays its clip; an asymmetric skin is right in both facings; a costume painted from the template shows up without code changes; the reviewer approves the new clips |
| M7 Districts             | art generators for four districts, rooms, connections, hubs, `KILL`, backgrounds, ambience                                                                      | the whole city runs through without loading pauses; district borders are seamless                                                                                              |
| M8 Goals                 | gates and routes, server results, leaderboards, finds and unlocks, hub discovery and teleport, death to the hub, profile persistence                            | 16 routes and 16 finds are completable; progress survives a server restart                                                                                                     |
| M9 Polish and acceptance | touch and gamepad, settings, sound, first-time hints, profiling on the weakest target, a day-long run with bots                                                 | the acceptance scenario below passes in full                                                                                                                                   |

**In parallel:** M6 can start right after M1, because the rig and clips do not depend on the
server; the art generators of M7 start after M2, once the atlas layouts are fixed; M4 and M5 follow
M1 alongside M2 and M3.

## 11. Risks to check early

- Props at device resolution over a pixel world: their pixels do not line up with the world grid.
  Check in M2 with a crate and a container next to tiles.
- The bot's jump at the end of a loop: check in M5 on one bot before recording the rest.
- Perspective with fast scrolling and vertical moves between districts: check in M2 in the test
  room.
- Clip coverage for prop moves: lift ledge, ladder, pole and bar first in M6.
- Chunk streaming and interest: the MVP city nearly fits in one 5 x 5 window, so both are checked on
  a large generated test world with injected network delay, in M2 and M5.

## 12. MVP acceptance scenario

1. A new player opens the game, enters a name and appears at the rooftops hub, with bots running
   around.
2. They cross the rooftops, take a fire escape down to the warehouses, vault crates and run along a
   container wall.
3. They climb down a manhole into the sewer, fall into a channel and are back at the sewer hub.
4. They finish a time trial in the factory; the server records the time and it shows on the
   leaderboard.
5. They reach a find, unlock a costume, change into it in the wardrobe and teleport to a discovered
   hub.
6. A server restart keeps the finds, hubs, best times and look.
7. All of this runs at 60 fps on a mid-range phone, and a day-long run with bots shows no hash
   mismatch.

Automatic checks at every milestone: `npm run check` (types, prettier, package boundaries,
vitest), golden move traces, baker checks (bot routes, district connectivity, reachable hubs) and
the server with bots and no clients as a load run. Visual work (slab, props, runner) is checked with
screenshots, animation through the reviewer.

## 13. Open questions

- Whether skins need a slim and a wide rig variant from day one.
- Whether the world framebuffer should follow the device pixel ratio with integer scales only.
- Whether skirts, dresses or long coats are wanted: the overlay shell follows each leg, so they
  would need their own geometry, which the MVP leaves out.
- Whether detailed depth strips shimmer too much when faces shrink near the screen centre; if they
  do, strips get fewer texels across the depth.
- How large a shard should be once there are several (40 players is a guess; the real limit is
  interest management, not simulation).
