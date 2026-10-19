# @parapet-world/net

The client side of the netcode as pure state machines: no DOM, no sockets, no timers. The game
owns the WebSocket and the clock and drives a `NetClient`.

## Model

- The server has a global step counter at 30 steps per second. A runner's step `k` is due at
  global step `origin + k`. Every runner is simulated on its own (runners never collide).
- The own runner is **predicted with zero delay**: the client steps it with the local held keys as
  soon as the clock says so, and sends the inputs. The client runs `lead` steps ahead of its
  estimate of the server clock (`lead = ceil(halfRtt / 33) + 1`, nudged by one step at most once
  a second to keep the server-reported slack in 1..3), so inputs arrive just before the server
  needs them.
- If an input is late, the server waits 15 steps, then repeats the last held mask (InputFill),
  and after 60 more steps holds nothing. A late input, a fill, a hash mismatch (hashes every 30
  steps) or a request makes the server send a **resync keyframe**; the client restarts from it and
  replays the inputs it already produced after it, so the prediction stays ahead. More than 60
  steps behind, the client asks for a resync instead of catching up. After the tab was hidden,
  call `requestResync()` (or just let the server resync on the late inputs).
- Other runners (players and bots) arrive as `enter` + a keyframe, then the inputs the server
  simulated them with. The client steps its own copy (deterministic, so it matches the server) and
  shows it about 3 steps behind the newest input; when inputs run late it predicts by repeating
  the last held mask and drops the prediction when the real ones arrive.

## Use

```ts
import { NetClient } from '@parapet-world/net';

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
ws.binaryType = 'arraybuffer';
const net = new NetClient({
  rules,
  world,
  statics,
  token,
  name,
  transport: { send: (d) => ws.send(d) },
});
ws.onopen = () => net.start(); // sends Hello
ws.onmessage = (e) =>
  net.receive(typeof e.data === 'string' ? e.data : new Uint8Array(e.data), performance.now());

net.onEvent = (event, profile) => {
  /* find, unlock, hub, routeStart, checkpoint, finish, cancel, death */
};
net.onBoard = (route, top, mine) => {
  /* leaderboard reply to net.requestBoard(route) */
};
net.onRecovery = (code) => {
  /* show once: the one-time code that moves the name to another device */
};

// every animation frame:
const steps = net.update(performance.now(), heldMask); // steps the own runner, sends inputs
const alpha = net.ownAlpha(performance.now()); // draw lerp(net.ownPrev, net.own, alpha)
for (const r of net.remotes.values()) {
  const f = net.remoteFrame(r); // draw lerp(f.a, f.b, f.alpha) with r.look and r.name
}
```

| Member                      | Meaning                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `phase`                     | `connecting` until Welcome, then `joined`; `closed` after a fatal error (`error`).     |
| `id`, `profile`, `origin`   | The own runner id, the profile (name, look, finds, hubs, best times), its origin step. |
| `own`, `ownPrev`, `ownStep` | The predicted own runner state, the state one step earlier, its step.                  |
| `remotes`                   | `Map<id, RemoteRunner>`: `name`, `look`, `bot`, `confirmed`, `confirmedStep`.          |
| `update(now, held)`         | Advance the own runner to the clock's target, send inputs and hashes, move remotes on. |
| `teleport(hubIndex)`        | Queue a teleport command for the next own step (valid inside a discovered hub's area). |
| `setLook(look)`             | Ask to change the look (the server checks the unlocks and echoes a `look` message).    |
| `requestBoard(route)`       | Ask for a route's top 10 and the own best (answered through `onBoard`).                |
| `requestResync()`           | Not needed normally; a tab returning from hidden may call it.                          |
| `onResync`                  | Called after the own runner was restarted from a server keyframe.                      |

Errors (`error.code`): `version`, `rules` (the server runs another ruleset: reload), `name`
(invalid), `nameTaken` (ask for another name or a recovery code), `recovery`, `rate`, `full`,
`bad`.

The protocol itself is in `@parapet-world/protocol`; the server in `@parapet-world/server`.
