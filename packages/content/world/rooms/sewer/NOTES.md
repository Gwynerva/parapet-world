# Sewer notes

The sewer is chunk row 3 of the city (x 0-255, y 96-127) in four rooms of 64 x 32 cells:
`west`, `junction`, `collector` and `cistern` (regions `sewer-<room>`, all returning to the hub
`sewer`). Rows below are room rows (world y = 96 + row); x is the world column.

## Lines

| Line   | Floor rows      | What it is                                                                                                                       |
| ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Ground | 22 (26 in the siphon) | The concrete walkway, end to end. Grate bridges over every channel, stairs over the weir and the collector, a dry culvert under the siphon. Running and ladders only, nothing to step over; at least 3 empty rows above. |
| Middle | 15-16           | Grate and brick galleries, big pipes, the siphon roof: 3-cell gaps, a slide under an arch, vaults (barrel, crates, posts), a sluice gate to climb, a chain of six bars over the great collector. A fall lands on the walkway or a bridge. |
| High   | 8-12            | Corbels, pipes and landings under the vault: bar chains (galleries, overflow basin), down-pipes to swing round (x 70, x 188), a tic-tac shaft beside the chimney. Over the great collector and the cistern a fall is fatal. |
| Low    | 24 (collector), pillars (cistern) | Stepping stones and the island in the great collector (drop through the bridge grates, a bar under the bridge, a ladder back up at x 152); pillars and a buttress rising out of the east cistern. |

Links between lines: ladders at x 11, 36, 66, 100, 118, 152, 164, 180, 222 and 236; drops through
grates and gallery holes everywhere; expert shortcuts: a wall run from the walkway onto the siphon
roof (x 194), wall runs onto corbels (x 121, x 192), tiger jumps over the 3-cell gaps, a bar jump
from the overflow bars straight to the hub's high landing.

## Chambers (west to east)

1. **Outfall** (x 0-31): the west wall, the old sluice gate stuck a cell open (x 7), the outfall
   ladder (x 11).
2. **Brick galleries** (x 32-63): the west manhole up to the warehouses (x 36), the brick gallery
   with its arch, barrel and crates, bars under the vault.
3. **Overflow weir** (x 64-95): stairs over the weir crest, the overflow basin and its bridge, the
   weir gallery's sluice gate, a down-pipe and bars over the basin.
4. **Old Junction** (x 96-127): the hub (sign at x 107) under the yard manhole (x 100).
5. **Great collector** (x 128-159): the raised bridge (grates, a concrete span over the island),
   stepping stones and the island, six bars, four big pipes along the top.
6. **Pump gallery** (x 160-191): the factory manhole (x 180), pipes, grates, a barrel, a
   down-pipe.
7. **Siphon** (x 192-223): the walkway dives through a culvert; on the roof posts and an arch; the
   brick chimney and a hanging wall form a tic-tac shaft over a high ledge.
8. **East cistern** (x 224-255): a grate bridge to the landing under the east manhole (x 236), a
   parapet, pillars, the buttress and the great pipe.

## Manholes

Ladders from row 0 (world 96) down to the walkway at x 36, 100, 180 and 236, continuing the
warehouse and factory ladders from the street (DESIGN.md "manholes"). The hub is at the foot of
x 100.

## Time trials

Times are the shortest `packages/tools/src/world/route-time.ts` found with the real simulation,
judged by the game's own route observer (tiger jumps everywhere); a good player is a few seconds slower, a careful one up to twice as slow.

| Route           | Difficulty | Line                                                     | Gates                                                                 | Best found |
| --------------- | ---------- | -------------------------------------------------------- | --------------------------------------------------------------------- | ---------- |
| `sew-dry-feet`  | 1 easy     | the walkway, west end to the east manhole                | start x 10, weir crest, collector bridge, factory manhole, culvert, finish x 236 | 24.9 s     |
| `sew-collector` | 2 medium   | the middle line east from the hub to the cistern          | start x 102 (hub grate), x 127, x 160, siphon roof x 205, finish x 233 | 19.4 s     |
| `sew-galleries` | 3 hard     | the high line west from the hub, the middle line back     | start x 97 (hub high landing), arch pier top, outfall grate, under the arch, finish x 98 | 23.2 s     |
| `sew-overflow`  | 4 expert   | the high line east from the hub over open sewage, up the cistern | start x 103 (hub high landing), collector pipes' end, pump gallery grate, ledge under the chimney, the cistern bars, finish on the buttress | 19.1 s     |

Every start gate sits where no other sewer route passes (touching a start gate restarts that route
and cancels the one running), and every corridor covers the district's full height; the checkpoints
keep each route on its line. The middle route's bar chain keeps the speed a runner grabs with: swing in from a run, not from a
tiger jump, or the second bar flies past.

## Finds

| Find          | Difficulty   | Clue                                                   | How                                                                                     |
| ------------- | ------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `sew-sluice`  | tricky       | Behind the old sluice gate at the end of the walkway   | Slide or roll under the gate (one empty row beneath it); out the same way.              |
| `sew-island`  | medium       | On the island in the widest channel                    | Drop through a bridge grate onto a stone, jump or swing the bar under the bridge to the island. |
| `sew-chimney` | hard         | On top of the brick chimney above the siphon           | From the siphon roof onto the arch and the high ledge, then tic-tac up the gap beside the chimney (or a wall run from the arch). |
| `sew-cistern` | really hard  | On the great pipe high in the east cistern             | From the landing up three pillars (jumps and ledge grabs), a wall run up the buttress, a jump onto the pipe. Every fall is fatal. |

## Bots

| File          | Name   | Loop                                                                 |
| ------------- | ------ | -------------------------------------------------------------------- |
| `sewer-1`     | Rill   | hub west along the walkway over the weir to the west manhole and back |
| `sewer-2`     | Grate  | hub east over the collector bridge to the pump gallery and back       |
| `sewer-3`     | Moss   | the middle line west from the hub to the outfall and back             |
| `sewer-4`     | Drip   | the high line of the galleries: corbels, the arch pier, the bar chain  |
| `sewer-5`     | Sluice | the bar chain over the collector, down to the bridge, back by the hub ladder |
| `sewer-6`     | Weir   | the low line: drop to the stones, the island, the ladder back up      |
| `sewer-7`     | Pump   | up the factory manhole ladder, the middle line over the siphon roof, back through the culvert |
| `sewer-8`     | Echo   | the cistern: grates, the east manhole ladder, the first pillar, back over the bridge |

## Checking

The rooms come from a scratch generator (not in the repository); edit the rooms directly from now
on. Everything above was checked with the real simulation: a search for every route gate by gate
inside its corridor and for every find from the hub, `npm run check:bots`, and
`packages/tools/src/world/explore.ts --district sewer` from the start hub through the manholes.
