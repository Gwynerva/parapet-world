# The MVP city

One seamless city of 8 x 4 chunks (256 x 128 cells, 8192 x 4096 px) in four districts, each
authored by its own session in `rooms/<district>/`. This file fixes what the districts share: their
rectangles, the street level, every cell where two districts meet, the design principles and the
naming rules. Room syntax: `README.md`. Plan: `docs/MVP-PLAN.md` section 4.

```
        x 0                    x 128                   x 256
  y 0   +-----------------------------------------------+
        | Rooftops (start hub)                          |  rows 0-31
  y 32  +-----------------------+-----------------------+
        | Warehouses            | Factory floor         |  rows 32-95
        |   yard opening        |                       |
  y 88  |== street ======== gate|== street =============|  street floor top row 88
  y 96  +-----------------------+-----------------------+
        | Sewer, under the whole city                   |  rows 96-127
  y 128 +-----------------------------------------------+
```

## Interfaces: final

Coordinates are world cells, x right, y down. "Top row r" means a floor whose top surface is the
top edge of row r: a runner stands with its feet on that edge, its body in rows r-2 and r-1. Every
cell of a district's rectangle belongs to that district's rooms; the seam cells below are drawn by
the side whose rectangle holds them, exactly as listed. Everything not listed is free design.

### Rectangles

| District   | Owner session    | Cells x | Cells y | Rooms folder        |
| ---------- | ---------------- | ------- | ------- | ------------------- |
| rooftops   | art / rooms lead | 0-255   | 0-31    | `rooms/rooftops/`   |
| warehouses | rooms-warehouses | 0-127   | 32-95   | `rooms/warehouses/` |
| factory    | rooms-factory    | 128-255 | 32-95   | `rooms/factory/`    |
| sewer      | rooms-sewer      | 0-255   | 96-127  | `rooms/sewer/`      |

Rooms must not overlap and must stay inside their district's rectangle (props too).

### Street level

- **The street floor's top row is 88** in both warehouses and factory: rows 88-95 are the solid
  street slab wherever nothing below is listed. Inner floors (halls, docks, yards) may sit higher
  or lower, but every seam gate and manhole below meets the street at row 88.

### World edges

- West edge: columns x 0-1 are solid in every district, from the top of the rooftops' firewall
  down to row 127. East edge: columns x 254-255 likewise. Row 127 is solid (sewer bed). Nothing
  may lead out of the world.

### Rooftops | warehouses seam (rows 31 / 32, x 0-127)

| Cells x | Rooftops side (rows 0-31)                                              | Warehouses side (rows 32-95)                                                                                                  |
| ------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0-55    | buildings; row 31 solid                                                | row 32 solid                                                                                                                  |
| 56-63   | **west yard roof**: top row 31 (a short ladder at x 56 leads up west)  | row 32 solid                                                                                                                  |
| 64      | **west fire escape**: `ladder.roof` in row 31 only                     | ladder continues from row 32 down to a floor of yours (landings beside it on x 63 or x 65 below row 34 if you like)           |
| 65      | empty                                                                  | empty in rows 32-33                                                                                                           |
| 66-109  | empty: the yard is open to the sky                                     | **gantry girder**: solid `fac.beam` in row 32 (top row 32) over x 66-109; everything below row 32 is yours (legs, trolley...) |
| 110     | empty                                                                  | empty in rows 32-33                                                                                                           |
| 111     | **east fire escape**: `ladder.roof` in row 31 only                     | ladder continues from row 32 down to a floor of yours                                                                         |
| 112-119 | **east yard roof**: top row 31 (a short ladder at x 119 leads up east) | row 32 solid                                                                                                                  |
| 120-127 | buildings; row 31 solid                                                | row 32 solid                                                                                                                  |

A runner crosses the yard on the girder: from the west yard roof (top row 31) over the ladder
column x 64 and the gap x 65 onto the girder (top row 32), and on the east over x 110-111 onto the
east yard roof. The fire escapes top out onto the yard roofs (ladder top cell level with their top
row 31). Container stacks reaching the landings or the girder are the warehouses' own design.

### Rooftops | factory seam (rows 31 / 32, x 128-255)

| Cells x | Rooftops side (rows 0-31)                                                              | Factory side (rows 32-95)                                                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 128-149 | factory roof; row 31 solid                                                             | row 32 solid                                                                                                                                                                                                            |
| 150     | **roof hatch**: `ladder.fac` in rows 24-31; roof top row 24 at x 149 and x 151         | ladder continues from row 32 down to a floor of yours                                                                                                                                                                   |
| 151-198 | factory roof; row 31 solid                                                             | row 32 solid                                                                                                                                                                                                            |
| 199     | solid rows 24-31 (shaft wall)                                                          | solid from row 32 down to the shaft's floor                                                                                                                                                                             |
| 200-201 | **light shaft**: empty from row 24 down; roof top row 24 at x 197-198 and x 203-204    | empty from row 32 down to a floor of yours, with one-way floors (`fac.grate`) across x 200-201 at rows 32, 40, 48... every 8 rows down to it, so no fall is longer than 8 rows: an expert tic-tac climb up, a drop down |
| 202     | solid rows 24-31 (shaft wall)                                                          | solid from row 32 down to the shaft's floor                                                                                                                                                                             |
| 203-243 | factory roof; row 31 solid                                                             | row 32 solid                                                                                                                                                                                                            |
| 244     | **stair tower ladder**: `ladder.fac` in rows 24-31; roof top row 24 at x 243 and x 245 | ladder continues from row 32 down to a floor of yours                                                                                                                                                                   |
| 245-255 | factory roof; row 31 solid                                                             | row 32 solid                                                                                                                                                                                                            |

### Warehouses | factory seam (x 127 / 128, rows 32-95)

| Rows  | Warehouses side (x 127)                          | Factory side (x 128)          |
| ----- | ------------------------------------------------ | ----------------------------- |
| 32-45 | solid                                            | solid                         |
| 46-49 | **high gate**: empty                             | empty                         |
| 50    | floor top row 50 (solid or one-way) on x 124-127 | floor top row 50 on x 128-131 |
| 51-81 | solid                                            | solid                         |
| 82-87 | **street gate**: empty                           | empty                         |
| 88-95 | street slab (solid)                              | street slab (solid)           |

Both gates keep their floors flat and free of obstacles over x 124-131, with at least 4 empty rows
above the floor.

### Warehouses / factory | sewer seam (rows 95 / 96): manholes

Four manholes, each one ladder column of `ladder.sew`:

| x   | Above            | Above, rows 88-95                                                    | Sewer, rows 96 down                                             |
| --- | ---------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| 36  | warehouses, west | ladder in rows 88-95; street floor top row 88 at x 34-35 and x 37-38 | ladder from row 96 down to a walkway with a floor under x 35-37 |
| 100 | warehouses, yard | same, floors at x 98-99 and x 101-102                                | same, floor under x 99-101; the Old Junction hub is here        |
| 180 | factory          | same, floors at x 178-179 and x 181-182                              | same, floor under x 179-181                                     |
| 236 | factory, east    | same, floors at x 234-235 and x 237-238                              | same, floor under x 235-237                                     |

The ladder's top cell is in row 88, level with the street floor beside it (the sim's ladder
top-out). Keep rows 84-87 empty over x-2 to x+2. Everywhere else row 95 (above) and row 96 (the
sewer's ceiling) are solid.

### Hubs, regions and ids

| Hub id       | Name          | District   | Where                                   | Owner            |
| ------------ | ------------- | ---------- | --------------------------------------- | ---------------- |
| `rooftops`   | Parapet Roof  | rooftops   | on the start roof near x 4-20 (`start`) | rooftops         |
| `warehouses` | Loading Yard  | warehouses | in or by the yard, street level         | rooms-warehouses |
| `factory`    | Foundry Floor | factory    | the factory floor, east half            | rooms-factory    |
| `sewer`      | Old Junction  | sewer      | under the yard manhole (x 100)          | rooms-sewer      |

- Every room declares `@region <id> hub=<its district's hub>`, the id being the district and the
  room's file name (`warehouses-yard`, `sewer-junction`).
- Every other id starts with its district: routes `<district>-<name>`, finds `<district>-<name>`,
  bot files `<district>-<n>.bot.json`. Ids are unique across the city.
- Every hub must be reachable on foot from the start hub, and every route and find completable
  (see "Checking").

## Design principles (every district)

- **Stacked lines.** Each district has several lines across it, one above the other: a **ground
  line** anyone can run (running, 1-cell steps, jumps of up to 3 cells, ladders, drops under 9
  cells); **middle lines** that need vaults, slides, wall runs and ledge grabs (racks, containers,
  catwalks, galleries); and **high lines** over roofs, racks, catwalks, cranes and pipes that need
  chains of advanced moves (tic-tac, bar swings, pole jumps, long and tiger jumps). The lines are
  linked every screen or two by ladders, drops, stacks and climbable walls, so a runner can step up
  or fall back in many places.
- **Many routes.** Between any two landmarks there are several ways, from slow and safe to fast and
  hard. Experts get shortcuts: a wall run that skips a ladder, a tic-tac shaft, a bar swing over a
  gap, a drop through a hole.
- **Readable.** At least 3 empty rows over every walkway. A screen is about 21 x 12 cells, so a
  district spans about a dozen screens; a landmark (a crane, a tower, a press, a sluice) every
  screen or two makes places nameable for clues.
- **Main paths are fair.** Hub-to-hub and district-to-district paths need only ground-line moves.
  Solid things on them are at most 1 cell tall or have steps (crates); tall things one must pass
  are ladder-class lattices (`@legend A material=fac.beam cell=LADDER`) or have a ladder.
- **Ladders** stand beside the floor they lead to, their top cell level with that floor's top row
  (the sim's ladder top-out). A ladder reaching above the floor does not top out; a ladder between
  two walkways leaves a 1-cell gap to hop.
- **Difficulty grows with the districts**: the rooftops teach running, jumps and vaults; the
  warehouses containers, wall runs and ledges; the factory poles, bars and catwalks; the sewer long
  chains over the channels.

## Routes and finds (every district)

- **Four time-trial routes per district, difficulty 1-4**: 1 easy (ground line), 2 medium (middle
  lines), 3 hard (high lines, advanced moves), 4 expert (chains of advanced moves, precise). Each
  takes 20-60 s for a good player: a start gate, two to four checkpoints, a finish and a corridor.
  Syntax: `@route <district>-<name> name="..." difficulty=<1-4>` (the baker parses `difficulty`).
- **Start gates are private.** Touching any route's start gate starts that route and replaces a
  run in progress (the sim's observer), so no two routes share a start gate, and a start gate must
  lie off every other route's line and off its own line after the start: dead ends, a well's
  floor, the top of a tank or a sign are good places.
- **Gates** are small rectangles the body passes through; for a runner standing on top row r use
  rows r-4 to r-1 (for example `@checkpoint 40 84 1 4` on the street).
- **Four finds per district**, from tricky to really hard, no markers, each with a broad clue tied
  to a landmark ("On the tallest crane"). A runner who reaches a find must be able to leave it (or
  die and respawn) without getting stuck.

## Movement budget

From `content/rules/moves.json` and the sim session; re-check when it changes:

| What         | Value                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| runner       | 16 x 56 px (0.5 x 1.75 cells), 27 px crouched                                                               |
| run          | 5.4 cells/s, about 1 cell to reach it                                                                       |
| jump         | apex 1.32 cells standing, 1.54 running; a 1-cell step without hands                                         |
| long jump    | a 4-cell gap at the same height with a good take-off, 3 easily, more when landing lower                     |
| tiger jump   | (coming) forward re-pressed while running: a low leap of about 5 cells                                      |
| ledge grab   | corners 1.25-2.4 cells above the feet; walls up to about 3.7-3.9 cells climbable                            |
| wall run     | about 2.4 cells up at full speed, then a grab (ledges up to 4.7) or over the top; tic-tac up a 2-wide shaft |
| vault        | up to 1.19 cells high, 1 cell long (monkey vault 2 long); step over up to 0.56 cells                        |
| slide        | under a SLAB over one empty row, or a 1-row gap under a solid ceiling                                       |
| ladder, pole | 2.3 cells/s; poles are grabbed at hand height, spun round and left at speed                                 |
| bars         | grabbed 1.56-2.5 cells above the feet; bars and one-way floors are floors too                               |
| landing      | hard above about 3.1 cells (roll with DOWN), fatal above about 9.5                                          |

## Checking

- `npm run bake -- --check`: syntax, overlaps, props, ids, regions, spawns.
- `packages/tools/src/world/`: a breadth-first search with the real simulation from the start hub
  over the baked city (every hub, route gate and find it can touch) and a route timer (the
  shortest time it finds per route; a good player is a few seconds slower). See its README.

## Districts

Each district session documents its own layout, lines, routes and finds under its heading.

### Rooftops

Rooms `rooms/rooftops/1-old-town` (x 0-63), `2-yard` (x 64-127), `3-factory-west` (x 128-191) and
`4-factory-east` (x 192-255), regions `rooftops-old-town`, `rooftops-yard`, `rooftops-factory-west`
and `rooftops-factory-east`. West to east:

- **Old town** (x 0-55): the firewall (x 0-1); **Parapet Roof** (x 2-17, top row 24), the start
  hub, with a stair house (x 2-5, top 20, ladder x 6) carrying a water tank (top 17); light well 1
  (x 18-19) with a ladder up to **B2** (x 20-29, top 23: AC unit, skylight, chimney); light well 2
  (x 30-32) with ladders to B2 and B3; **B3** (x 33-40, top 25); the **brick tower** (x 41-44,
  top 17) with ladders on both faces (x 40, x 45); the **washing line** (bars, row 18, x 29-39) from
  B2's chimney to the tower; **B5** (x 45-51, top 24) with the PARAPET billboard (top 21); terraces
  (x 52-55) with short ladders down to the **west yard roof** (x 56-63, top 31).
- **The yard** (x 64-127): the fire escapes (x 64, x 111) and the gantry girder below (row 32, the
  warehouses'); the **east yard roof** (x 112-119, top 31) with a ladder up to the warehouse roof
  (x 120-127, top 26).
- **Factory roof, west** (x 128-191): a roof with a billboard and an antenna (x 128-138, top 25);
  the sawtooth hall roof (x 139-161, top 24) with skylights and the **roof hatch** (x 150); the
  **office tower T1** (x 162-167, top 14) with ladders on both faces and an antenna; the **cables**
  (bars, row 12, x 169-180) from T1 to the **old water tower** (platform row 15, x 181-185; a
  lattice to climb, x 183; the tank's top row 12).
- **Factory roof, east** (x 192-253): the **light shaft** (x 200-201); the **tower crane** (a
  lattice mast x 214 to the jib, row 10, which reaches west to the water tower at x 186; the
  counter-jib east to x 222 with its weight; the A-frame above the mast, top row 6); the pump house
  (x 228-235, top 19) with an antenna; the **stair tower** ladder (x 244); a water tank
  (x 245-247, top 21) and the **old chimney** (x 250-252, top row 4) with step irons on its west face
  (x 249, rows 4-19); the east wall (x 254-255).

Lines: the **ground line** runs over the roofs (rows 23-31), the light wells, the terraces, the
girder, the sawtooth roof and over T1 by its ladders; the **middle line** over the stair house and
its tank, the chimney, the billboards, the pump house and the water tower's platform; the **high
line** along the washing line, the tower top, T1's top, the cables, the tank, the crane's jib and
counter-jib and the chimney.

| Route                      | Name            | Difficulty | Line                                                                                                                         | Shortest found (game rules) |
| -------------------------- | --------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `rooftops-chimney-pots`    | Chimney Pots    | 1          | from light well 1: B2, B3, over the brick tower, the terraces, the west yard roof, across the girder, up to the factory roof | 17.8 s                      |
| `rooftops-washing-line`    | Washing Line    | 2          | from light well 2: B2's west end, the washing line, the billboard, down the terraces to the yard roof, back up the tower     | 18.9 s                      |
| `rooftops-factory-heights` | Factory Heights | 3          | from the factory billboard: T1's top, the water tower, the crane's jib and counter-jib, down the mast to the stair tower     | 20.8 s                      |
| `rooftops-skyline`         | Skyline         | 4          | from the start roof's water tank: the tower, the girder, T1, the crane, the chimney's top                                    | 45.9 s                      |

| Find                    | Clue                                      | What it takes                                              |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `rooftops-washing-line` | Up on the washing line by the brick tower | a jump from B2's chimney to the line (tricky)              |
| `rooftops-water-tower`  | On the tank of the old water tower        | the lattice or the cables, then a ledge grab onto the tank |
| `rooftops-chimney`      | On top of the old factory chimney         | from the water tank, a jump onto the step irons (hard)     |
| `rooftops-crane-top`    | At the very top of the tower crane        | the mast, then a wall run up the A-frame (really hard)     |

Bots `rooftops-1` to `rooftops-8`: the start roof and B2, the stair house's tank, the washing line
and the tower, the terraces and the yard roof, across the girder, the sawtooth roof and T1, the
cables and the water tower, the crane.

### Warehouses

Rooms `rooms/warehouses/` (old-warehouse, loading-hall, yard, hall-2). Layout, lines, the four
routes, the four finds and the eight bots are documented in
[`rooms/warehouses/NOTES.md`](rooms/warehouses/NOTES.md). Next to the rooftops: a catwalk under the
girder at row 36 (x 65-108) meets the west fire escape (x 64), with a landing at row 43 (x 65-69).

### Factory floor

Rooms `rooms/factory/west` (x 128-191) and `east` (x 192-255), regions `factory-west` and
`factory-east`, both returning to the hub `factory` (Foundry Floor, street level, x 224-232). One
tall hall; layout, lines, links, the four routes, the four finds and the eight bots are documented
in [`rooms/factory/NOTES.md`](rooms/factory/NOTES.md). West to east: the **press shop** (the
street and high gates, the press deck with the big press and the die block, the roof truss), the
**crane hall** (the crane's hook chain over the crane well, the riser, the fireman's pole), the
**boiler house** (the boiler on its stairs, the flue, the light shaft) and the **hub and stair
tower**. Lines (top rows): street 88, low 82, mid 76, high-mid 70, gallery 64, upper catwalks 57,
crane girder 50 (the high gate's floor, through to the stair tower), roof truss 40.

### Sewer

Rooms `rooms/sewer/west` (x 0-63), `junction` (x 64-127), `collector` (x 128-191) and `cistern`
(x 192-255), regions `sewer-west`, `sewer-junction`, `sewer-collector` and `sewer-cistern`, all
returning to the hub `sewer` (Old Junction, at the foot of the yard manhole x 100). Details, times
and bots: `rooms/sewer/NOTES.md`. West to east:

- **Outfall** (x 0-31): the west wall and the old sluice gate (x 7), stuck a cell open; the outfall
  ladder (x 11) through all lines.
- **Brick galleries** (x 32-63): the west manhole (x 36); a brick gallery with an arch to slide
  under, a barrel and two crates; bars under the vault.
- **Overflow weir** (x 64-95): stairs over the weir crest, the overflow basin and its bridge, a
  sluice gate to climb on the weir gallery, a down-pipe and bars over the basin.
- **Old Junction** (x 96-127): the hub and its sign under the yard manhole.
- **Great collector** (x 128-159): a raised bridge over the widest channel; stepping stones and an
  island below, six bars across, big pipes along the vault.
- **Pump gallery** (x 160-191): the factory manhole (x 180), pipes, grates, a down-pipe.
- **Siphon** (x 192-223): the walkway dives through a dry culvert; posts and an arch on the siphon
  roof; a brick chimney with a tic-tac shaft beside it.
- **East cistern** (x 224-255): a grate bridge to the landing under the east manhole (x 236);
  pillars, a buttress and the great pipe over deep sewage.

Lines: the **ground line** is the walkway (top row 118, the culvert 122) with grate bridges over
every channel; the **middle line** the galleries, pipes, the bar chain and the siphon roof (top rows
111-112); the **high line** corbels, pipes, bar chains and down-pipes under the vault (top rows
104-108), fatal over the collector and the cistern; the **low line** the collector's stones and
island and the cistern's pillars. Ladders link them at x 11, 36, 66, 100, 118, 152, 164, 180, 222
and 236.

Routes (shortest found): `sew-dry-feet` "Dry Feet" (1, the whole walkway west to east, 24.9 s),
`sew-collector` "Collector Run" (2, the middle line from the hub to the cistern, 19.4 s),
`sew-galleries` "Brick Galleries" (3, the high line west from the hub and the middle line back,
23.2 s), `sew-overflow` "Overflow" (4, the high line east from the hub over open sewage, down the east
manhole and up the cistern's pillars, 19.1 s). Every start gate sits where no other sewer route
passes, and every corridor covers the district's full height.

Finds: `sew-sluice` "Behind the old sluice gate at the end of the walkway" (tricky: slide under
it), `sew-island` "On the island in the widest channel" (drop through the bridge, jump or swing),
`sew-chimney` "On top of the brick chimney above the siphon" (hard: tic-tac up the shaft),
`sew-cistern` "On the great pipe high in the east cistern" (really hard: pillars, a wall run up the
buttress, every fall fatal).

Bots `sewer-1` to `sewer-8`: the walkway west and east of the hub, the middle line west, the
galleries' high line, the collector's bar chain, the low line and the island, the pump gallery
and the siphon roof, the cistern.
