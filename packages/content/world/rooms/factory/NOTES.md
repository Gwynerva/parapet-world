# Factory floor notes

The factory is chunk rows 1-2, chunks 4-7 of the city (x 128-255, y 32-95), in two rooms of
64 x 64 cells: `west` (x 128-191) and `east` (x 192-255), regions `factory-west` and
`factory-east`, both returning to the hub `factory` (Foundry Floor). It is one tall hall under the
roof (row 32) with the street floor at top row 88. Coordinates below are world cells; a room row
is the world row minus 32 and a room column the world column minus 128 (west) or 192 (east).

## Lines

Lines are six rows apart up to the gallery and seven above it, so a wall run climbs one line
below the gallery, a fall of one line is a hard landing and a fall of two is fatal.

| Line            | Floor row | What it is                                                                                                                                                                                                                                                                                                  |
| --------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Street floor    | 88        | End to end, anyone: barrels and crates to vault, pallets and conveyors to step over, the boiler's steel stairs, two manholes. Route 1.                                                                                                                                                                       |
| Low             | 82        | The press deck (x 133-149) with crates, the big press and a machine, ended by the die block; low catwalks through the crane hall with a machine to climb, a duct to slide under, crates and 3-4 cell gaps; the top of the boiler (row 84). Route 2.                                                         |
| Mid             | 76        | Catwalks across the hall, a pipe over the press shop's gap, the crane gap (x 167-179: pipe, spin round the hook chain, pipe), under the boiler flue. Medium to hard.                                                                                                                                       |
| High-mid        | 70        | Catwalk pieces: the staircase landing in the press shop, the crane hall's sides, the boiler house, the stair tower landing.                                                                                                                                                                                |
| Gallery         | 64        | A plate walkway from the west wall to the stair tower, broken by the crane well (x 167-179, the same crossing as the mid line, higher), the fireman's pole gap (x 184-186) and a 3-cell gap (x 222-224, a pole below it); vaults, a machine to climb, a duct, the flue grate. Route 3.                   |
| Upper catwalks  | 57        | Catwalks in every bay; the press shop's long one carries ladders to the girder.                                                                                                                                                                                                                            |
| Crane girder    | 50        | The crane runway from the high gate to the stair tower: a duct and crates, joint 1 (x 156-161) crossed on the truss pipe (row 47), the crane's end carriage (2 high), joint 2 (x 179-185) crossed by spinning round the hoist chain (x 182), the drive housing (x 192-193, 6 high, wall run). Route 4. |
| Roof truss      | 40        | A walkway in the press shop's roof (x 134-148) and the way to the roof lantern (find 4).                                                                                                                                                                                                                  |

Links between lines:

- **Ladders** (easy): street to press deck x 132; deck to mid x 135; mid to high-mid x 131;
  high-mid to gallery x 140; gallery to upper catwalks x 131; upper catwalks to girder x 143;
  girder to roof truss x 133; crane hall: low to street x 167, mid to low x 164, high-mid to gallery
  x 162, upper catwalks to girder x 189; boiler house: low to street x 199, high-mid to mid x 221,
  mid to street x 223; the stair tower: street to low x 241, low to mid x 253, mid to high-mid
  x 242, high-mid to gallery x 253, gallery to upper catwalks x 242, upper catwalks to girder
  x 252.
- **Medium**: the machine and die block ledges on the press deck; the staircase from the mid line
  to the high-mid (machine x 145-147, grate stub x 148-150 row 73, beam x 151-154, ledge); the
  fireman's pole from the gallery to the mid line (x 185) and the pole under the gallery gap
  (x 222); drops through every catwalk; the boiler's stairs.
- **Hard and expert**: a wall run up the die block (deck to its top, then up to the mid line); a
  wall run up the column x 158-159 from the high-mid to the gallery; the bar-and-chain crossings
  of the crane well at the mid line and the gallery; the boiler flue (x 202-203, walls x 200-201
  and 204-205), a tic-tac shaft from the mid line to the gallery with a rest grate at row 70; the
  riser (x 164-165, walls x 163 and 166), a tic-tac shaft from the gallery up through the girder
  with a rest grate at row 57; the girder joints; the light shaft from the girder to the roof.

## Interfaces (DESIGN.md)

- Street gate x 128-129, rows 82-87, floor 88; high gate x 128-129, rows 46-49, floor 50 on
  x 128-131 (the girder starts there). Both keep x 128-131 free.
- Roof hatch: `ladder.fac` x 150 from row 32 down to the girder (bottom row 49). Stair tower
  ladder x 244 likewise.
- Light shaft x 200-201: walls x 199 and x 202 solid rows 33-47 (row 32 is the roof slab),
  `fac.grate` across x 200-201 at rows 32, 40 and 48; its floor is the girder (top row 50), rows
  48-49 are open beside the walls so girder runners pass under.
- Manholes x 180 and x 236: `ladder.sew` rows 88-95, street floor beside, rows 84-87 empty.
- East edge x 254-255 solid from the roof to row 95.

## Bays (west to east)

1. **Press shop** (x 128-159): the street and high gates; the press deck with the big press
   (x 141-142, find 1 in its gap) and the die block (x 150-152); the staircase; the column; the
   roof truss walkway and the lantern.
2. **Crane hall** (x 160-191): the crane's trolley under the girder (x 171-175) and its hook chain
   (x 173) down to the hook at row 78 (find 2); the crane well crossed by pipes at the mid line and
   the gallery; the riser; the fireman's pole; the girder's end carriage and the hoist chain over
   joint 2; the manhole x 180.
3. **Boiler house** (x 192-223): the boiler on its plinth (x 213-218) with steel stairs; the flue
   and, above the gallery, its cap (find 3 inside, rows 58-60); the light shaft above the girder.
4. **Hub and stair tower** (x 224-255): Foundry Floor (hub area x 224-232, rows 83-87, spawn
   x 228), its sign, the manhole x 236, the stair tower's landings and ladders up to the roof.

## Routes

Times are the shortest line found by `node packages/tools/src/world/route-time.ts --district
factory`, judged by the sim's own observer (a good player is a few seconds slower; tiger jumps make
the flat stretches fast). Start gates are private: each lies where no other factory route passes
(the tower's mid landing, the top of the big press, the east end of the gallery, the west end of
the mid line). Every corridor covers the whole district (the girder route's also the roof part of
the light shaft), so dips into manholes and ladder holes, jump arcs and drops never cancel a run.

| Route              | Name             | Difficulty | Line                                                                                                                                                                                                           | Shortest found |
| ------------------ | ---------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `factory-shift`    | Shift Change     | 1          | From the stair tower's mid landing down to the street and west along it (crates, barrels, conveyors, the boiler's stairs, a manhole), up the crane hall's ladder to its low catwalk and down again, to the street gate                                             | 17.4 s         |
| `factory-catwalks` | Catwalk Shift    | 2          | From the top of the big press over the crates and the machine onto the die block, along the low catwalks of the crane hall (machine, duct, gaps), over the boiler, up to the stair tower's high-mid landing    | 18.3 s         |
| `factory-crane`    | Crane Line       | 3          | From the east end of the gallery west along it (vaults, a gap, a machine, a duct, the flue grate, the pole gap, the crane well: pipe, spin round the hook chain, pipe), up to the girder and the high gate      | 21.4 s         |
| `factory-girder`   | Girder and Shaft | 4          | From the west end of the mid line over the pipe gap, up the staircase and the column, the riser by tic-tac into the girder, both joints, the drive housing, then up the light shaft by tic-tac to the roof    | 18.7 s         |

## Finds

| Find              | Clue                                              | What it takes                                                                                                  |
| ----------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `factory-press`   | Under the big press by the street gate            | Jump onto the crates beside the press on the deck and slide (or roll) through the gap under the ram (tricky)    |
| `factory-hook`    | Riding the hook of the crane in the crane hall    | Reach the hook chain slowly enough to grab it instead of spinning (brake after a bar jump) and ride it down (hard) |
| `factory-flue`    | Inside the boiler house flue, right under its cap | Tic-tac up inside the flue's cap from the gallery grate (hard)                                                  |
| `factory-lantern` | In the roof lantern above the crane hall          | From the roof truss walkway or the roof hatch ladder: catch the hanging chain (x 153), pole jump to the pipe (x 156), bar jump to the ledge of the lantern beam (x 159-162, top row 37); a fall is fatal (really hard) |

## Bots

`factory-1` to `factory-8` (`packages/content/bots/`), all looping and passing
`npm run check:bots`:

| Bot         | Name   | Line                                                                                    |
| ----------- | ------ | --------------------------------------------------------------------------------------- |
| `factory-1` | Rivet  | the street floor of the crane hall and back                                             |
| `factory-2` | Anvil  | the press deck: vaults, slides under the press both ways, the machine and the die block |
| `factory-3` | Grease | the low catwalks of the crane hall and the boiler house: ledge, duct, gaps              |
| `factory-4` | Hook   | the crane gap at the mid line: tiger jump, pipe, spin round the hook chain, and back     |
| `factory-5` | Flux   | the gallery of the boiler house and the tower bay: vaults, the gap, the machine, the duct |
| `factory-6` | Spark  | down the fireman's pole, along the mid line, up the boiler flue, back over the gallery  |
| `factory-7` | Ladder | up the stair tower's ladders to the gallery and down through the catwalks               |
| `factory-8` | Crane  | the crane girder: joint 1 on the truss pipe and back, joint 2 round the hoist chain and back |

## Checking

Every connector above, every find and every route line was checked with the real simulation
(searches with a restricted move set per difficulty: easy is running, jumps, vaults, ladders and
drops; medium adds ledges, slides and poles; hard adds wall runs, bars, pole spins and tiger
jumps; expert adds tic-tac and flips), and with `packages/tools/src/world/` (explore, route-time)
and `npm run check:bots`. The intentionally low spots are the slide ducts (girder x 137-139,
low line x 174-176, gallery x 209-210), the press gap, and the walkways under the riser, flue and
light shaft walls (2 rows).
