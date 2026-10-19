# Warehouses: notes

The warehouses district, world cells x 0-127, rows 32-95 (DESIGN.md "Interfaces: final"). Street
floor top row 88 everywhere; coordinates below are world cells, "row r" is a floor's top row.

| Room                      | Cells x | What                                                              |
| ------------------------- | ------- | ----------------------------------------------------------------- |
| `old-warehouse.room.txt`  | 0-31    | the brick tower block: six storeys, the freight lift shaft        |
| `loading-hall.room.txt`   | 32-63   | galleries, dock, mezzanine, goods lift, catwalks, roof pipes, hub |
| `yard.room.txt`           | 64-111  | the open yard under the gantry girder, fire escapes, containers   |
| `hall-2.room.txt`         | 112-127 | the rack hall with the street gate and the high gate              |

Seams kept: row 32 solid except the yard opening (fire escapes x 64 and x 111 from row 32 down to
the street, gaps x 65 and x 110, the `fac.beam` girder over x 66-109); manholes x 36 and x 100
(ladder in rows 88-95, rows 84-87 clear around them); the factory gates at x 127 (high gate rows
46-49 over a floor at row 50 on x 119-127, street gate rows 82-87).

## Lines

- **Ground (row 88), anyone.** Old warehouse ground floor (forklift and barrel to vault, pallets
  step over) - door - loading hall (dock ramps, two crates to monkey-vault) - hub - yard door -
  container pyramid by crate steps three cells wide - ladder x 87 onto the tower (row 80) - drop
  8 rows by the manhole - forklift - hall 2 - street gate. Back west: the ladder x 94 up the
  tower's east face, then steps down the pyramid.
- **Old warehouse storeys (rows 79, 70, 61, 52, 43).** Inside stairs alternate x 7 / x 27; each
  storey has its own obstacles (racks with crates, a crate block, office partitions with a door
  and a crawl gap to slide, rafters, the attic crate pile and trusses) and grates to drop through
  (F2 x 17-18, F3 x 10-11, F4 x 16-17). Every storey has a door at x 30-31 onto the loading
  hall's galleries (x 32-36), which have their own ladders alternating x 37 / x 32 (the one up
  from the floor stands at x 33, off the manhole's clearance).
- **Middle (rows 70-80).** Loading hall mezzanine (row 70, x 37-61, ladder x 55 from the floor,
  forklift and crate to vault, the goods lift's low doors) - yard opening - fire escape x 64 -
  the gantry's tie beam (row 70, x 65-110, gaps x 76-78 and x 96-98, the cable in the second
  gap: a pole spin carries you over) - east leg ladder x 107. Below it the container tops (rows
  86-80): a wall run from the 3-stack onto the tower instead of its ladder, a running jump and
  ledge grab from the tower onto the hanging container (row 77, x 96-101).
- **High (rows 36-52).** Loading hall catwalks (row 52, gaps, over the goods lift's mouth) -
  yard opening - fire escape - leg landing (row 52) - pipe line (bars, row 52, gaps of 2-3 with
  the cable gap) - east landing. The roof pipes (row 41, x 39-58, 3-cell gaps: run and jump, or
  swing bar to bar) from the old warehouse's F5 gallery to the high opening (row 43) and a
  landing on the yard side. The catwalk under the girder (row 36, x 65-108, three rows of
  headroom): a 5-cell gap only a tiger jump clears, a girder stiffener to slide under, the cable
  at x 97 to drop onto and ride 39 rows down to the hanging container. Hall 2's high floor
  (row 50) to the high gate.
- **Links and expert shortcuts.** The freight lift shaft (x 2-3, doors at the ground floor and
  F3, grates at F1-F4): a two-wide tic-tac chimney from the ground floor to F3 and on. The goods
  lift (x 45-46, walls x 44 and x 47 on the mezzanine): tic-tac from the mezzanine to the
  catwalks. Hall 2's rack column (x 114-116) against the west wall from the mezzanine (row 70)
  to the roof: hop and tic-tac up it, jump off it onto the high floor. Crane legs (ladders x 66
  and x 107) from the street to the catwalk under the girder, landings at rows 43 (west), 52 and
  70. The fire escapes reach the rooftops' yard roofs (row 31).
- Falls are fatal from about 10 rows: the roof pipes and the pipe line are over long drops, and
  the top 18 rows of the freight lift have no grate.

## Hub

`warehouses` "Loading Yard": x 56-61, rows 84-87, spawn x 60, by the loading hall's yard door,
under the west fire escape; sign at x 60. Reachable on foot from the start hub (the rooftops' yard
roofs, the fire escapes x 64 / x 111).

## Time-trial routes

Times: the shared route search's best (`packages/tools/src/world/route-time.ts`) and a scripted
run with plain play and slow ladder stops, both judged by the game's own observer. No route's
line crosses another route's start gate (touching one replaces the run): Dock Run stays east of
the loading dock, and the Mezzanine Line's start gate is halfway up its ladder (x 55, rows 77-80).

| Route                  | Name                | Diff. | Way                                                                                           | Best   | Scripted |
| ---------------------- | ------------------- | ----- | --------------------------------------------------------------------------------------------- | ------ | -------- |
| `warehouses-dock-run`  | Dock Run            | 1     | loading dock - hub - pyramid - tower - hall 2 - street gate, back over the tower to the yard door | 20.7 s | 32 s     |
| `warehouses-mezzanine` | Mezzanine Line      | 2     | up the mezzanine ladder - old warehouse F2 and F3 (vaults, the crawl) - mezzanine - tie beam  | 23.8 s | 42 s     |
| `warehouses-old-climb` | Old Warehouse Climb | 3     | all six storeys (or the freight lift) - F5 - roof pipes - yard high opening                   | 23.7 s | 52 s     |
| `warehouses-gantry`    | Gantry Line         | 4     | catwalk under the girder (tiger jump, slide) - cable drop - tower - hall 2 rack climb - high gate | 20.2 s | 44 s     |

## Finds

| Find                    | Where                          | Clue                                                    | What it takes                                       |
| ----------------------- | ------------------------------ | ------------------------------------------------------- | --------------------------------------------------- |
| `warehouses-rack-nook`  | x 57-59, rows 71-72            | Tucked above the racks under the loading hall mezzanine | drop through the mezzanine onto the hidden rack top |
| `warehouses-attic`      | x 23-25, rows 37-38            | Swinging in the attic of the old brick warehouse        | from the attic crates, grab the trusses and swing   |
| `warehouses-rack-top`   | x 114-116, rows 35-36          | On the highest shelf in hall 2                          | the whole rack climb, hop and tic-tac, 33 rows      |
| `warehouses-lift-top`   | x 2-3, rows 34-35              | At the very top of the old freight lift                 | tic-tac 27 rows up the shaft, the last 18 unbroken  |

## Bots

`content/bots/warehouses-1..8.bot.json`, each a loop back to its start (`npm run check:bots`):
1 Brick (the ground line west), 2 Gantry (the ground line east to the street gate and back over
the tower), 3 Stairs (up all six storeys, down the galleries), 4 Forks (mezzanine and galleries),
5 Beam (the tie beam), 6 Pipes (the pipe line and back on the tie beam), 7 Shelf (hall 2's rack
climb), 8 Lift (the freight lift up to F3 and the stairs down).

## Checked

`npm run bake -- --check` clean; the shared explorer from the start hub reaches the hub, every
gate and every find; each route and find was also completed by a scripted run in the real
simulation; all eight bots pass `check:bots`; walked in the sim debug page and in the game.
