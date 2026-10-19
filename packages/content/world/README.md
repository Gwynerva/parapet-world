# World rooms

The city is authored as ASCII rooms: `rooms/**/*.room.txt` make the world (`dist/world.json`),
`gym/*.room.txt` make the gym, a separate small world with a room per collision class for testing
moves (`dist/gym.json`). `npm run bake` turns both into chunk files; `npm run bake -- --check`
only validates, and `npm run bake -- --out <dir>` bakes into another folder. The default bake is
written beside `dist` and swapped in at the end, so readers never see half a dist and bakes
running at the same time do not mix their files. Rooms may sit in subfolders of `rooms/` (one
per district).

## A room

```
; Rooftops start: the hub, the first jumps.        <- comment lines start with ';'
@district rooftops
@pos 0 0
@size 64 32
@region rooftops-west hub=rooftops
@legend T material=roof.tar cell=HALF

#.............................................
#........................####.................
#######...######.....#########.....############

@prop ac.unit 12 7
@hub rooftops 1 26 6 4 spawn=3,29 facing=1 name="Rooftops" start
@route roof-chimneys name="Chimney run" difficulty=2
@start 2 26 1 3
@checkpoint 30 20 1 4
@finish 60 26 1 3
@corridor 0 0 64 32
@find roof-antenna 40 2 1 2 clue="Where the tallest antenna hums"
```

- **Grid.** One block of consecutive lines that do not start with `@` or `;`; a blank line ends
  it. Each character is one cell, the top row first. Rows shorter than the room are padded with
  `.`; trailing spaces are ignored. A room has exactly one grid.
- **Coordinates.** Every number after the header is a cell relative to the room's top-left cell
  (`@pos`), x to the right, y down. Rectangles are `x y w h`.
- **Characters** come from `palette.json` for the room's district (with `common` beneath it),
  then from the room's own `@legend` lines. An entry stamps a material (its collision class, or
  `cell=` overriding it), only a collision class, or a single-cell prop.
- **Strings** are double-quoted; `\"` is a quote. `key=value` pairs may come in any order.

## Directives

| Directive                                                                  | Meaning                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@district <id>`                                                           | `rooftops`, `warehouses`, `factory` or `sewer` (required)                                                                    |
| `@pos <x> <y>`                                                             | the world cell of the grid's top-left corner (required)                                                                      |
| `@size <w> <h>`                                                            | the room's size; the grid may be smaller (padded with `.`), never larger                                                     |
| `@legend <char> material=<id> [cell=<CLASS>]`                              | a room-local character for a material, optionally with another collision class                                               |
| `@legend <char> cell=<CLASS>` / `prop=<id>`                                | a room-local character for a bare collision class or a single-cell prop                                                      |
| `@region <id> [x y w h] hub=<hub>`                                         | a region (the whole room without a rectangle); a death inside returns to `hub`                                               |
| `@prop <id> <x> <y>`                                                       | a prop from `props/props.json`, its mask's top-left cell at x, y                                                             |
| `@hub <id> <x> <y> <w> <h> spawn=<x>,<y> [facing=-1] [name="..."] [start]` | a hub area; the runner appears standing in cell `spawn` (its floor is the cell below); `start` marks where new players begin |
| `@route <id> [name="..."] [difficulty=1..4]`                               | a time-trial route, difficulty 1 (easy, the default) to 4 (expert); the lines below until the next `@route` belong to it     |
| `@start x y w h`, `@finish x y w h`                                        | the route's start and finish gates (one each)                                                                                |
| `@checkpoint x y w h`                                                      | a checkpoint gate, in order (any number)                                                                                     |
| `@corridor x y w h`                                                        | a corridor rectangle (any number; the whole room when none); leaving all of them cancels a run                               |
| `@find <id> <x> <y> <w> <h> clue="..."`                                    | a hidden find and its hub clue                                                                                               |

Collision classes are the keys of `Cell` in `packages/schemas/src/cells.ts` (`SOLID`, `TOP`,
`SLOPE_UP`, `SLOPE_DOWN`, `HALF`, `POST`, `LADDER`, `POLE`, `BAR`, `SLAB`, `KILL`, `EMPTY`).

## What the baker checks

- unknown characters, directives, materials, props, classes and districts;
- rooms overlapping each other;
- props reaching outside their room, overlapping a solid tile or another prop, `front` props with
  a collision mask, and props not tagged for the room's district (a warning);
- duplicate ids of regions, hubs, routes and finds; a region returning to a missing hub; hubs,
  finds and route gates outside every region; route gates outside their corridor; more than one
  `start` hub;
- hub spawns without a floor or inside a wall (a spawn outside its hub area is a warning);
- when the district art exists: every front tile's edge row and column equal the first row of its
  material's top depth strip and the first column of its side strip.

Missing art, skins or clips never fail the bake.

## What it writes

`dist/world.json` and `dist/gym.json` (`WorldIndex`), `dist/chunks/<hash>.json` (`ChunkFile`:
collision classes with props stamped in, materials, 4-bit autotile variants, depth outlines merged
along collinear runs and final across chunk borders, and the props whose anchor cell lies in the
chunk), and copies of `art/`, `skins/`, `clips/`, `props/`, `rules/`, `bots/` and `render.json` (the
defaults from `schemas` when the file is absent). Every chunk inside the bounds is written, empty or
not, so a client never waits for a chunk that does not exist.
