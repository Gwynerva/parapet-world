# Runner skins

Skin layers for the 3D runner, in the box-unwrap layout of `packages/schemas/src/skin.ts`
(`SKIN`, `skinFaceRect`). Generated at 1x by `tools/export-skins.mjs` in the graphics demo
(`E:\code\parapet-world-demo`, outside the repository) from its procedural painters; once an artist
repaints a sheet, the PNG is the source.

## Sheet

- 128 x 128 RGBA, one texel per world pixel. A 256 x 256 sheet is a 2x skin with the same layout.
- Top half (rows 0-63): the base layer, painted on the body itself.
- Bottom half (rows 64-127): the overlay layer, same layout, drawn on a shell 0.7 px outside the body
  (1 px on the head), double-sided, with alpha cut-outs. Shell triangles exist only where the
  composited overlay has a texel with alpha 128 or more, so keep the overlay sparse.
- Alpha under 32 counts as empty.
- Every part is a box in the Minecraft cross layout: the top cap above the front, the bottom cap
  above the back, then the strip front | left side | back | right side, each face seen from outside
  and upright. L and R are the runner's own sides; the right side faces the camera when the runner
  faces right. The rig names its bones the other way (rig L = near = the runner's right), so region
  `uarmR` skins bone `uarmL`.

## Layer stack

A look is composited once, alpha over, both halves at the same time, in this order:

| Order | Layer   | File            | Contents                                                                                               |
| ----- | ------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| 1     | body    | `body.png`      | Opaque base: skin, the Classic face, ears, bandeau and briefs. Empty overlay.                          |
| 2     | hair    | `hairRed.png`   | The Classic red hair, swept back: hairline, brows, strands; overlay volume and fringe.                 |
|       |         | `hairShort.png` | Short dark hair parted on the runner's left; overlay crown and quiff.                                  |
| 3     | costume | `classic.png`   | The Classic look: white tank top, belt, jeans capris (cuffs on the overlay), red sneakers, wristbands. |
|       |         | `tee.png`       | T-shirt and jeans; print on the left chest, torn left knee, phone in the right back pocket.            |
|       |         | `hoodie.png`    | Hoodie and joggers; hood down on the overlay, chevron on the left sleeve.                              |
|       |         | `summer.png`    | Sports top and bike shorts, watch on the left wrist. Base only.                                        |
| 4+    | extra   | any PNG         | Painted from `template.png`: stacked on top without code changes.                                      |

Hair is paint only: there is no hair geometry. Every layer except `body` is transparent wherever
it has nothing to say. A hat must go on the overlay, or the hair layer's overlay covers it.

The asymmetric details (prints, the torn knee, the watch, the parting) exist to check that a skin
is right in both facings.

## Template and guide

- `template.png`: the empty sheet to paint on; every face is faintly tinted by its kind (alpha 24,
  below the empty threshold, so a forgotten tint never shows).
- `guide.png`: the same sheet at 8x with labels: part and face names, the face, bust and joint marks,
  and a heat map of how often the camera sees every texel over all lifted clips in both facings.
