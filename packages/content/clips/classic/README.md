# Classic clips (temporary stand-in)

**Not ours to ship.** Every clip in this folder is lifted from Parapet Classic's keyframes, and
Classic's keyframes come from someone else's game, Playman Extreme Running. They are a temporary
stand-in so that the runner can move while our own or licensed clips are made (see
`docs/MVP-PLAN.md`, section 8, "The Classic exception"). The public-build check refuses any build
that contains a file from this folder. The repository was made public with them by its owner on
2026-10-19; they still must not ship in a public build of the game.

## How they were made

The lifting tool lives outside the repository, in the graphics demo (`E:\code\parapet-world-demo`),
because it reads Classic's sources:

1. `extract/extract.mjs` and `extract/augment.mjs` read Classic's keyframes (`scenes/k0.json`,
   `anims.json`, `moves.json`) and fit 2D joints to every drawn keyframe.
2. `core.js` lifts each keyframe onto the 3D rig of `packages/schemas/src/rig.ts` (fixed bone
   lengths, knees and elbows on their anatomical side, depth chosen so that the side view draws the
   same storyboard, limb identity chosen for the whole clip at once), then splines the keys at
   30 fps on Classic's own timing. Planted feet and fists are held between keys, grips stay on their
   ledge, bar, pole or obstacle, and the body is kept out of the ground and of solids using body
   points only (never hair).
3. Every clip passed an independent frame-by-frame reviewer (anatomy, contacts, dynamics like
   Classic's) before export; `index.json` records the rounds.
4. `tools/export-clips.mjs` writes the files here.

## Files

- `<name>.clip.json`: a `ClipFile` (`packages/schemas/src/clip.ts`): dense 30 fps frames, 15 bones
  in `BONE_NAMES` order, root relative to the runner's anchor (feet point, centre; x forward, y up),
  per-frame `mirror` (Classic's sprite flips in turns) and `plant` flags (1 near foot, 2 far foot,
  4 near hand, 8 far hand; a gripping hand counts as planted; clips in the air or on a wall carry
  no foot flags).
- `index.json`: per clip its loop flag, frame count, duration, travel, the moves of
  `content/rules/moves.json` that play it (`moves`), the Classic states and clip offset it comes
  from, its review record, and for grip clips: `grip` (the mean fist centre while holding, relative
  to the anchor), `terrain` (the solid it was lifted against), `prop` and `pole` (what the hands
  hold), `anchorShift` (where Classic moves the runner over a hands-pinned move).

## Conventions

- Loops are exported in place, travel `[0, 0]`. A one-shot keeps its travel: the root's net change
  over the clip (the body's displacement relative to the anchor). The simulation moves the anchor;
  Classic's keyframes carry no root motion of their own.
- Moves that Classic anchored at the hands (ledges, ladders, the bar, the vault) are expressed
  relative to the feet point Classic keeps below the hands: on a ledge the anchor hangs 48 px below
  the ledge top (`terrain.top`), about a px in front of its face, and the fists hold the corner at
  `grip`; on the vault the wall top is 32 px above the anchor.
- A move that Classic plays as one held keyframe (ledgeHang, ladderEnter, barGrab, poleSlide) is a
  clip with a single frame. ledgeHang is exactly ledgeGrab's last frame, barGrab barSwing's first.

## Derived clips

Moves with no Classic source of their own are made from approved clips and reviewed the same way.
`derived` in `index.json` names the source:

- `stepOver`: the leaping stride of `jump`.
- `ledgeDrop`: `ledgeGrab` played backwards, as Classic's let-go state plays its grab.
- `ladderTop`: exactly `ledgeClimb`, because Classic leaves a ladder's top through its ledge hang
  and pull-up. Like `ledgeClimb` it ends crouched on the top; `ledgeClimbEnd` is the stand-up that
  can follow.
- `poleGrab`: the `poleSlide` pose.
- `barJump`: the release of `poleJump` (its frames 15-20), 12 px in front of the bar's plane.
  It starts away from the hang's grip, so the move table has to blend the hang into it.

## Spare clips

Lifted and approved, but not played by the current move table:

- `tigerJumpOver`: the second part of Classic's tiger jump. The World lands it into `roll`.
- `ledgeClimbEnd`: Classic's stand-up after the pull-up.
- `ticTac`: the World plays `wallRunKick` instead.
- `skid`: the World plays `stand` instead.
- `landingPrepare`.
