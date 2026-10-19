# Lessons from Parapet Classic

Parapet Classic (`github.com/Gwynerva/parapet-classic`) is a faithful remake of _Playman
Extreme Running_ (Mr.Goodliving / RealNetworks, 2007). It is a good reference for building this
kind of game, and a bad source of material: its mechanics were reconstructed from someone else's
decompiled code and its content was extracted from someone else's game. This project takes the
first and leaves the second.

## Take: ideas, architecture, techniques

- **A deterministic integer simulation.** Fixed 30-unit steps, integer and fixed-point math
  only, no floats, no DOM; the same code runs in the browser and on a server. Determinism is
  what makes replays, ghosts, verification and lockstep multiplayer cheap.
- **Moves as a data-driven state machine.** Every move is a row of a table: entry conditions on
  presses and the surroundings, impulses, root motion, phase timing, score type. New moves are
  data, not code paths. Design our own table and tune it ourselves.
- **Press-only input logged as runs.** Inputs are presses (not held keys) OR-ed per step and
  recorded as `(ticks, bits)` runs; a minute of play is a few hundred bytes. Parapet World keeps
  the run-length log but records held keys instead, deriving press edges inside the simulation.
- **Replays as proof.** A replay is the input log plus the simulation version, ruleset id and
  content hashes. Whoever re-runs it computes the result themselves; a claimed number means
  nothing. Classic's `sim/replayCodec.ts` (compact binary in base64url) and `sim/verify.ts`
  show the shape.
- **Ghosts in worlds of their own.** A ghost is a second world stepped in lockstep with the
  player's (`runtime/app/RunSession.ts`): it cannot influence the player's run by construction.
- **Echo holograms.** Ghosts drawn from a recoloured atlas with scanlines, a speed trail,
  materialising and dissolving (`runtime/render/EchoSkin.ts`, `EchoRenderer.ts`); the colour
  of a player's echo comes from their name.
- **Testing against an oracle.** Classic proves its simulation step by step against traces of
  a reference implementation. For our own game the oracle is our own sim: golden traces of
  recorded runs guard every change to the move table.
- **Adaptive canvas UI.** Logical viewport with integer scaling, breakpoints (compact portrait,
  compact landscape, regular), screens that re-flow on resize, pointer-first on touch and
  key-first on desktop, the safe area respected.
- **Own bitmap fonts, own synthesiser.** Fonts rasterised at build time from open TTFs; music
  as MIDI played by a small Web Audio synthesiser. No external CDN or font service.
- **User activation done right.** Clipboard, downloads and file dialogs run synchronously
  inside the browser's input handler (`Screen.onGesture`), as Safari and iOS require.
- **The server design** at Classic's `snapshot/with-server` tag: claimed names with a token
  and a one-time recovery code (hashes on the server), bounded leaderboards (one personal best
  per player and board), plausibility flags instead of refusals, rate limits per address and
  name, JSON-file storage behind an adapter. A starting point for our server, to be rewritten
  for rooms and realtime.

## Leave: everything that is someone else's

- Nothing from Classic's `packages/content-classic`: no sprites, animations, levels, rival
  recordings, music, texts, palettes or fonts derived from the original.
- Not the original move table, its values or its tuning, and not its animation keyframes. One
  recorded exception: the MVP uses clips lifted from those keyframes onto our 3D rig as a
  temporary stand-in, kept apart and blocked from public builds (`docs/MVP-PLAN.md`, section 8).
- Not the code of Classic's simulation copied over: it was written by reading decompiled code.
  Write our own simulation from the techniques above and our own design.
- Not the names: no Playman, no Blaise, no original character or level names.
