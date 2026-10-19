# Bot routes

Bots are runners the server simulates exactly like players: a bot's input is a recording of held
keys that loops. Clients receive bots through the same relay and interest path as players, so the
world feels populated and the netcode is exercised all the time.

A route is `<district>-<n>.bot.json`:

```json
{
  "format": 1,
  "name": "Kite",
  "district": "rooftops",
  "look": { "hair": "hairShort", "costume": "tee" },
  "start": { "x": 123456, "y": 98304, "facing": 1 },
  "runs": [
    { "steps": 30, "held": 2 },
    { "steps": 12, "held": 6 }
  ]
}
```

- `start` is the feet point in world units (y down) and the facing (1 right, -1 left). The bot
  begins as a fresh runner there (the ruleset's `spawn` move) and replays `runs`.
- `runs` are held masks (`Key` bits from `schemas/input.ts`: 1 left, 2 right, 4 up, 8 down, 16
  action) for `steps` consecutive steps; at least a second in all.
- At the end of the loop the server restores the start state and sends a keyframe, so a route must
  end where it began: `npm run check:bots` replays every route against the baked world and fails
  when a bot dies, stalls, or ends more than one cell from its start or in another move or facing
  than at the start.

Routes are recorded in the game with `?dev` (the route recorder) and saved here; the baker copies
them to `dist/bots/` and lists them in `world.json`.
