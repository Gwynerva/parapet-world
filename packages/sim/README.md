# @parapet-world/sim

The deterministic simulation of runners, shared by the browser and the server: integer
arithmetic only, 30 steps per second, no DOM, no Node built-ins, no dependencies besides
`@parapet-world/schemas`. Runners never collide with each other, so each runner is stepped on its
own against a static world.

## Units

One pixel is 32 units, one cell 1024 units (32 px), one chunk 32 x 32 cells. The y axis grows
downward. A runner's position is its **feet point**, the bottom centre of its body box.
Velocities are units per step. The body is 16 px wide and 56 px tall (27 px when crouching), set
by the ruleset's `halfWidth`, `height` and `crouchHeight`.

## API

```ts
import {
  loadRuleset,
  createRunner,
  stepRunner,
  copyRunner,
  hashRunner,
  runnerView,
  ChunkWorld,
  createStatics,
  encodeInputLog,
  decodeInputLog,
  replayRunner,
  R,
} from '@parapet-world/sim';
import { Key } from '@parapet-world/schemas';

const rules = loadRuleset(movesJson); // content/rules/moves.json, parsed; rules.hash: uint32
const world = new ChunkWorld(index.bounds); // WorldIndex.bounds
world.load(chunkFile); // a ChunkFile from dist/chunks/<hash>.json; world.unload(cx, cy)
const statics = createStatics(index); // regions, hubs, routes, finds from world.json

const s = createRunner(rules, hub.spawn[0], hub.spawn[1], hub.facing); // an Int32Array
const stepped = stepRunner(s, Key.RIGHT | Key.UP, null, world, rules, statics);
// stepped === false: the 3 x 3 chunks around the runner are not all loaded; nothing changed,
// retry the same input once they are (the runner's clock stalls).
const view = runnerView(s, rules); // x, y, vx, vy, facing, move, clip, phase, progress, dead, ...
const h = hashRunner(s); // FNV-1a over the state (R.STEP included, R.ANIM_NONCE excluded)
```

| Function                                                | What it does                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `loadRuleset(json)`                                     | Compiles a parsed `moves.json`; throws a readable error on any mistake. `.hash` is a uint32.   |
| `createRunner(rules, x, y, facing)`                     | A runner in the `spawn` role's move at feet point (x, y) units, facing 1 (right) or -1.        |
| `stepRunner(s, held, command, world, rules, statics)`   | One step with the held `Key` mask and an optional `InputCommand`; false when stalled.          |
| `copyRunner(src, dst?)`                                 | Copies the state (snapshots, prediction, save and restore).                                    |
| `hashRunner(s)` / `hashRunnerAt(s, step)`               | Unsigned FNV-1a of the state words (and of an external step number).                           |
| `runnerView(s, rules, out?)`                            | Presentation data: position, velocity, facing, move and clip names, progress 0..1, flags.      |
| `runnerReady(s, world)`                                 | Whether `stepRunner` would run (the 3 x 3 chunks around the runner are present).               |
| `enterRole(s, rules, role, statics, world?)`            | Puts a runner into a role's move outside the step (`frozen` for a server-side hold).           |
| `ChunkWorld(bounds)`                                    | Streamed chunks: `load(file)`, `loadCells(cx, cy, cells)`, `unload`, `has`, `cell`, `ready`.   |
| `GridWorld(w, h, x0?, y0?)`, `GridWorld.fromRows`       | One grid of cells, always ready (tests, tools, the debug page).                                |
| `createStatics(index)`                                  | Integer tables of regions, hubs, routes and finds; `NO_STATICS` is an empty world.             |
| `encodeInputLog(held[])` / `decodeInputLog(runs)`       | Held masks per step to `InputRun[]` and back; `appendInput(runs, held)` for recorders.         |
| `replayRunner(start, runs, commands, world, rules, st)` | Steps a copy of `start` over a log; returns the hash after every step and the final state.     |
| `createObserver()`, `observe(o, s, rules, statics)`     | World events of a step (hubs, routes, finds, death, respawn); see Observers below.             |
| `createRunnerObserver(statics, rules)`                  | The same events per runner as `SimEvent`s, hubs and finds once per life; `step`, `reset`.      |
| `simDebug.onEnter`                                      | A test and tuning hook called on every move entry (instant moves included); never set in play. |

**Input.** `held` is the set of keys held during the step (`Key` bits from `schemas`: LEFT,
RIGHT, UP, DOWN, ACTION), never presses. Press edges are derived inside the simulation from the
previous step's mask, so a frame that runs zero or two steps changes nothing. A press stays usable
for a few steps (input buffering) until a transition that tested it consumes it.

**Commands.** `{ kind: Command.TELEPORT, arg: hubIndex }` moves the runner to that hub's spawn
point at that step, only while it stands inside a hub area; otherwise it is ignored. The server
also refuses hubs the profile has not discovered.

**Death and respawn.** Landing faster than `fatalVY` or touching a `KILL` cell enters the `dead`
role's move; after `deadSteps` the `respawn` move places the runner at the spawn of the hub of the
region it died in (`statics`), or the start hub when no region holds it. Rows below the world's
bounds read as `KILL`.

**Relocation.** A step in which a respawn or a teleport moves the runner ends right there (the
runner stays in the `respawn` or `spawn` move for that step): the chunks around the new place may
not be loaded yet, and the next step's stall check covers them.

**Stalls.** The simulation never reads beyond the 3 x 3 chunks around the runner, so a stepped
runner sees the same cells whether the world is one grid or streamed chunks. A cell of a chunk that
is not loaded reads as `CELL_MISSING`; `stepRunner` refuses to run before that can happen.

## State layout

A runner is an `Int32Array` of `STATE_WORDS` words, indexed by `R`:

| Word                                    | Meaning                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `STEP`                                  | steps since creation                                                     |
| `X`, `Y`, `VX`, `VY`                    | feet point (units) and velocity (units per step)                         |
| `FACING`                                | 1 right, -1 left                                                         |
| `MOVE`, `PHASE`, `TIMER`, `DUR`, `HOPS` | move index, sub-state, steps in the move, its duration, moves entered    |
| `HELD`, `PREV_HELD`                     | held masks of this and the previous step                                 |
| `AGE_LEFT` ... `AGE_ACTION`             | steps since each key went down (`AGE_MAX` when not pressed or consumed)  |
| `WANT_X`, `WANT_Y`                      | held intent, -1 / 0 / 1                                                  |
| `GROUND`, `SLOPE`                       | floor class + 1 (0 airborne), floor slope (1 `/`, -1 `\`)                |
| `WALL`, `HEAD`, `IMPACT`                | wall and ceiling contacts of the last step, speed lost at the wall       |
| `GRIP_X`, `GRIP_Y`, `GRIP_KIND`         | grip anchor of hanging and climbing moves                                |
| `LAND_VY`, `AIR_STEPS`                  | speed at the last landing, steps since the feet last touched a floor     |
| `SPEED`, `SPEED_Y`                      | stored speeds                                                            |
| `CYCLE`                                 | distance travelled in `cycle` moves, wrapped at the stride (clip sync)   |
| `DROP`                                  | steps left during which one-way floors are ignored                       |
| `LOCK`                                  | steps left during which grips (ledges, ladders, poles, bars) are ignored |
| `S0` ... `S3`                           | scratch words of the current move (glides: start point and lift)         |
| `ANIM_NONCE`                            | incremented on every move entry so clips restart; excluded from the hash |

## Step order

1. Stall check (the 3 x 3 chunks around the runner).
2. Input: held mask, press edges and ages, intent.
3. Command (teleport), if valid.
4. Sensing: the floor exactly under the feet, re-derived from the position.
5. Transitions of the current move; instant moves (duration 0) chain within the step, at most
   `MAX_HOPS` (8) moves per step; a timed move that reached its duration enters `then`.
6. The move's `perStep` effects.
7. Physics: gravity (unless `noGravity`, and not on the floor), speed caps (every displacement
   stays under a cell), a horizontal sweep against walls, then vertically the floor (landing, or
   following slopes and small steps), the ceiling, or a slope lifting a rising runner.
8. The move timer and the `DROP` and `LOCK` countdowns.

## Collision

Every collision question goes through the per-class shape functions in `shapes.ts` (the shapes of
`schemas/cells.ts`). Nothing is stored between steps.

- **Walls**: the body box minus its lowest `stepUp` units is swept horizontally; the first solid
  face ahead stops it. Toes may sink into slopes and onto corners. A slope's sloped side is never a
  wall unless the runner is below the slope's cell; its high side always is.
- **Floors**: flat floors count anywhere under the feet span (a toe on an edge stands), slopes only
  under the centre column, and a flat floor beside a slope only when it is more than `halfWidth`
  higher, so walking onto and off slopes never pops. One-way floors (TOP, BAR) catch feet that were
  above them; `dropThrough` ignores them for a while. On the floor the feet follow the surface
  within `stepUp` up and `stepDown` (plus the step's horizontal travel) down.
- **Ceilings**: the box's top edge is swept up against solid bottoms; one-way floors are not
  ceilings.
- Sensors for predicates are read-only tests of the cells (`sensors.ts`):
  - **ledges**: the top corner of a SOLID, HALF or POST cell facing the runner, with nothing on
    top of its edge and room in front of it, within a reach ahead of the body and a height window
    above the feet (`ledgeAhead`; `ledgeTopAhead` also wants room to stand on top);
  - **obstacles**: the first SOLID, HALF or POST face ahead in the row above the floor, its height,
    length (up to 4 cells) and the room above it; a face hidden behind a slope is walked onto
    (`obstacleAhead`; `vaultAhead` also wants room to land beyond it);
  - **walls**: bands of the body ahead (`wallAhead`, `highWallAhead` at head height,
    `lowWallAhead` only below the knees, `ceilingAhead` a low ceiling the crouched body passes);
  - **ladders, poles, bars**: a ladder in the centre column from the body's middle to below the
    feet, a pole line near the centre at the hands, a bar over the centre in a window above the
    feet.
- Grip moves (`anchorHands`, usually `noGravity` and `noCollide`) are positioned by effects
  relative to the grip anchor: `glide` moves from the entry point to the anchor plus an offset
  over the move's duration on an optional arc, `hold` keeps the runner there, `alignGrip` keeps x
  on a vertical grip.

## Move table

`content/rules/moves.json` (`RulesetSource`):

```json
{
  "format": 1,
  "version": 2,
  "params": { "halfWidth": 256, "runSpeed": 184, ... },
  "roles": { "spawn": "idle", "fall": "fall", "dead": "dead", "respawn": "respawn", "frozen": "frozen" },
  "moves": [
    {
      "name": "run",
      "parent": "grounded",
      "clip": "run",
      "flags": ["cycle"],
      "stride": "$runStride",
      "perStep": [["accelToward", "$runSpeed", "$runAccel"]],
      "transitions": [{ "to": "jump", "if": ["recent:UP:$jumpBuffer"] }, { "to": "idle", "if": ["!want:FWD"] }]
    }
  ]
}
```

- **Row fields**: `name`, `parent` (flags and transitions are inherited, the parent's
  transitions after the row's own), `abstract` (shared rows that can never be entered), `clip`
  (inherited when absent), `duration` (steps; 0 instant, -1 until a transition, or `$param`),
  `then` (required for timed and instant moves), `flags`, `stride` (`cycle` moves), `loop` (steps
  per loop of a looping clip), `onEnter`, `perStep`, `onExit` (effect lists) and `transitions`.
- **Transitions**: `{ "to", "if": [predicates], "priority" }`; all predicates must hold; higher
  priority first, ties in order (own before inherited). A transition that tests `pressed:K` or
  `recent:K:n` consumes that press, unless the target has `keepPresses`.
- **Predicates**: `name`, `name:arg:arg:arg`, `!name`. Arguments are integers, `$param`s or keys
  (LEFT, RIGHT, UP, DOWN, ACTION, and FWD / BACK relative to the facing). The list, with what
  each one reads, is `PREDICATES` in `registry.ts`: input (`pressed`, `recent`, `held`, `want`),
  timing (`timer`, `ended`, `phase`, `airSteps`), motion (`speedAbove`, `forwardAbove`, `vyAbove`,
  `landedFaster`, `storedAbove`, ...), contacts (`onGround`, `wallContact`, `impactAbove`,
  `headBlocked`, `slopeUp`, `onOneWay`, `inKill`, `canStand`) and the sensors above.
- **Effects**: `["name", ...args]` (up to four arguments), from `EFFECTS` in `registry.ts`:
  velocity (`accelToward`, `decelTo0`, `airControl`, `setVX`, `addVY`, `minForward`, `maxVY`,
  `jump`, `hop`, `climbJump`, ...), facing (`flipFacing`, `faceWant`: always in `onEnter` and
  `onExit`, never in `perStep` of a `lockFacing` move), grips (`grabLedge`, `grabLadder`,
  `grabPole`, `grabBar`, `vaultStart`, `ladderExit`, `glide`, `hold`, `alignGrip`, `climbWant`,
  `lockGrips`) and the rest (`storeSpeed`, `restoreSpeed`, `dropThrough`, `respawn`, `setPhase`).
- **Flags**: `ground` (feet follow the floor), `noGravity`, `noCollide`, `lockFacing`,
  `keepPresses`, `noTurn` (BACK reads as not held), `anchorHands` (hanging from the grip), `crouch`
  (the low body), `cycle` (distance drives the clip).
- **Roles**: the code enters moves only by role (`spawn`, `fall`, `dead`, `respawn`, `frozen`) and
  through transitions; no move name appears in code.
- **Params**: integers. `halfWidth`, `height`, `crouchHeight`, `stepUp`, `stepDown`, `gravity`,
  `maxFall` and `maxSpeed` are read by the step itself and required.
- **Compilation** resolves every name to dense `Int32Array` tables, rejects unknown names, entering
  abstract moves, timed moves without `then` and cycles of instant moves no condition breaks, and
  hashes the tables, the registries and `SIM_VERSION`.

## Moves

Ruleset v1 (`moves.json` version 2), with the clip each move plays where it differs from the
move's name. Abstract rows: `base` (KILL is fatal), `grounded`, `moving` (what a runner on its
feet and moving can do, in order), `running` (forward held), `airborne` (landings) and `freeAir`
(grabs, wall kicks, flips).

| Group     | Moves (clip)                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Ground    | idle, start, run, runUphill, runDownhill, coast (run), skid (stand), turn, turnFast, turnFlip (turn, instant), dropDown (fall, instant) |
| Air       | jump, tigerJump, fall, landSoft (landing), landHard (landing), roll, frontFlip, backFlip                                                |
| Failure   | stumble, trip (stumble), crash, crashFall, crashDown, getUp, dead (crashDown), respawn (stand), frozen (idle)                           |
| Walls     | wallRun, wallRunTop (wallRunKick), ticTac (wallRunKick), wallFlip                                                                       |
| Ledges    | ledgeGrab, ledgeHang, ledgeClimb, ledgeDrop, ledgeJumpBack                                                                              |
| Obstacles | stepOver, vault, monkeyVault, slideUnder (roll)                                                                                         |
| Ladders   | ladderEnter, ladderClimb, ladderSlide, ladderTop, ladderLeave (fall, instant), letGo (fall, instant)                                    |
| Poles     | poleGrab, poleSlide, poleJump, poleSpin                                                                                                 |
| Bars      | barGrab, barSwing, barJump                                                                                                              |

How they are reached, in short: hold a direction to run, UP to jump (buffered for a few steps,
and for a few steps after running off an edge). Letting go of forward at speed coasts for a few
steps (`coastSteps`) before skidding; pressing forward again during the coast is a tiger jump, a
long low leap (about 5 cells, apex under a cell) that lands in a run or a roll. DOWN to roll (or slide under a low ceiling, or
drop through a catwalk), ACTION for a flip. UP near a wall at speed runs up it; at its top it
grabs the ledge, or with UP held goes over; UP kicks off it (tic-tac), BACK flips off it. In the
air the hands grab ledges, bars, poles and (with UP or DOWN held) ladders; DOWN held grabs
nothing. On a ledge UP (or holding forward) climbs, BACK jumps away, DOWN lets go. UP near a
crate-high obstacle vaults it (one cell long) or monkey-vaults it (two); knee-high ones are
stepped over without a key; running at full speed into a wall crashes, into a crate trips. On a
ladder UP and DOWN climb (holding DOWN slides), a side key leaves it, the top steps off onto the
floor beside it. On a pole UP jumps off (toward a held side), DOWN lets go; at speed a pole is
spun round. On a bar UP jumps off with the speed it was grabbed with, DOWN lets go. Landing too
fast is a hard landing (a stumble at speed, a roll with DOWN pressed shortly before), and landing
during the first part of a flip crashes.

Every move is reached by a scripted run in the gym (`packages/tools/src/bake/gym.ts`); those runs
are the golden traces (`npx vitest run packages/tools`).

## Observers

`observe(o, s, rules, statics)` after every step that ran returns that step's events: `hub` (the
body starts touching a hub area), `find` (the same for a find), `routeStart` (the body starts
touching a route's start gate; with no run active any start gate starts its route, during a run
the other routes' start gates are ignored and the run's own restarts it), `checkpoint` (the next gate
in order, counted while the body overlaps it, with the steps since the start; one step may pass
several gates), `finish` (with the time in steps), `routeCancel` (the feet have been outside every
corridor rect for more than `corridorGrace` consecutive steps, a ruleset param, 20 by default, so
a jump arcing over the corridor or a drop dipping under it does not cancel; death cancels at
once), `death` and `respawn` (with the hub). The observer is an `Int32Array` of `OBSERVER_WORDS`
(`createObserver`, `copyObserver`), so it snapshots with the runner. The client runs it for the
HUD and the server for the record; both get the same events from the same steps.

`createRunnerObserver(statics, rules)` wraps it in the shape the server and the HUD consume: a
`RunnerObserver` with `step(s, out: SimEvent[])` and `reset()` (after a keyframe restore or a
teleport), where a hub or a find is reported only on its first touch in the observer's life and the
events are `{ kind: 'hub', hub }`, `{ kind: 'find', find }`, `{ kind: 'routeStart', route }`,
`{ kind: 'checkpoint', route, index, steps }`, `{ kind: 'finish', route, steps }`,
`{ kind: 'cancel', route }`, `{ kind: 'death' }` and `{ kind: 'respawn', hub }`.

## Determinism rules

In `src` (except `view.ts`, which is presentation): only `Math.imul` from `Math`, divisions
written `(a / b) | 0`, no float literals or `**`, no `Date`, `performance`, `Intl` or locale
functions, no sorting and no iteration that could walk a `Map` or `Set`. Positions stay below
2^30, velocities below 2^10. `test/lint.test.ts` greps for violations.

## Tests

`npx vitest run packages/sim`: the determinism lint, collision per cell class, locomotion, the
compiler's rejections and clip names, observers, input-log round trips, determinism over random
logs, save and restore, and chunk-border equality (one world as a grid and as streamed chunks
loaded one step late gives identical per-step hashes). `npx vitest run packages/tools` adds the
gym: every move reachable, golden traces, replay, save and restore, and the gym baked as one grid
versus streamed chunks with loads and unloads.

The debug page (`npm run bake`, `npm run dev`, then `/dev/sim/`) draws the gym (or `?world=city`)
as plain cells with the runner box and trigger rects, steps a runner from the keyboard and edits
every parameter live.
