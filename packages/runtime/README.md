# @parapet-world/runtime

The browser runtime. So far: the WebGL renderer (milestones M2 and M6 of `docs/MVP-PLAN.md`), skin
compositing, clip playback and loaders for baked content. One WebGL 1 context, no engine, no
allocation in the frame path. Imports only `@parapet-world/schemas` (and may import `sim`).

## Use

```ts
import { createRenderer, fetchJson, fetchPixels, loadWorldArt } from '@parapet-world/runtime';

const r = createRenderer(canvas, { settings: renderJson }); // Partial<RenderSettings>
r.setWorld(world, await loadWorldArt('./', world)); // world.json and its art
r.loadChunk(await fetchJson(world.chunks[0].file)); // as chunks stream in; unloadChunk(cx, cy)
r.addClip(await fetchJson('clips/classic/run.clip.json')); // registered by name
const look = r.createSkin([body, hair, costume]); // decoded PNG layers, bottom first

function frame(): void {
  r.begin(camX, camY); // camera centre, world units (32 per px), y down
  r.runner(look, x, y, facing, 'run', clipTime, own); // anchor = feet point, world units
  r.marker(null, sx, sy, sw, sh, x, y, alpha); // a sprite of the props atlas, centred on (x, y)
  r.end();
  requestAnimationFrame(frame);
}
```

Everything positional is in world units with y down, like the simulation; the renderer converts to
px (`UNITS_PER_PX`) and from the rig's y-up px.

## Renderer API (`renderer.ts`)

| Member                                                           | What it does                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRenderer(canvas, { settings, antialias, maxPixelRatio })` | One WebGL 1 context (`alpha: false`, depth, stencil, MSAA by default). The drawing buffer follows the canvas's CSS size times `devicePixelRatio` (at most `maxPixelRatio`, default 2), checked every frame. |
| `settings`, `setSettings(patch)`                                 | `RenderSettings` (schemas `render.ts`): logical resolution, slab depth, perspective, runner depth, depth fill. All take effect on the next frame, no rebuild.                                               |
| `setWorld(world, art)`                                           | The world index and its decoded art (`WorldArt`: tile atlas per district id, the props atlas, background layers by file). Drops loaded chunks.                                                              |
| `loadChunk(file)`, `unloadChunk(cx, cy)`, `hasChunk`             | Builds a chunk's mesh once (front quads and depth faces, batched per district atlas) and uploads it; a chunk is drawn when it is near the view.                                                             |
| `addClip(file, { applyMirror })`, `clip(name)`                   | Prepares a `ClipFile` and registers it by name. See "Clips" for `applyMirror`.                                                                                                                              |
| `createSkin(layers)`, `releaseSkin(skin)`                        | Composites a look (see "Skins"), builds its overlay shell and uploads both. Reuse one skin for every runner with that look.                                                                                 |
| `createSpriteSheet(pixels)`, `releaseSpriteSheet(sheet)`         | A texture for `marker` sprites besides the props atlas.                                                                                                                                                     |
| `setBackgroundDistrict(id \| null)`                              | Forces one district's background over the whole view (null: every district inside its own regions).                                                                                                         |
| `begin(camX, camY)`                                              | Starts a frame; the camera centre in world units.                                                                                                                                                           |
| `runner(skin, x, y, facing, clip, time, own?, travel?)`          | Submits a runner: anchor (feet point), facing 1 / -1, clip name and seconds into it. `own` draws it in front of all others and fades `front` props over it. `travel` see "Clips".                           |
| `marker(sheet, sx, sy, sw, sh, x, y, alpha?)`                    | Submits a marker sprite (finds, gates) in the runners' plane; `sheet` null means the props atlas.                                                                                                           |
| `end()`                                                          | Draws the frame.                                                                                                                                                                                            |
| `worldToScreen(x, y, out)`                                       | CSS px from the canvas's top-left of a world point in the runners' plane, with the last frame's camera (names over runners, HUD).                                                                           |
| `stats`, `view`                                                  | Draw calls, triangles, chunks drawn, runners, props, framebuffer size and scale; the last frame's camera.                                                                                                   |
| `dispose()`                                                      | Frees every GL resource and the listeners.                                                                                                                                                                  |

A lost context (`webglcontextlost`) stops drawing; on `webglcontextrestored` programs, textures and
buffers are rebuilt from what the renderer keeps on the CPU side (chunk files, decoded art,
composited skins). The game keeps calling `begin`/`end` throughout.

## A frame

1. **World pass** into a logical framebuffer: at least `settings.logical` (683 x 384) is visible,
   more along the longer side of the canvas; the framebuffer is one pixel larger each way. The
   camera is snapped to whole logical pixels; the remainder shifts the upscaled image, so front
   faces never crawl. The districts' sky colours and background layers, each inside its own
   regions, then tiles with a depth test.
2. **Upscale** with nearest filtering to the drawing buffer.
3. **`mid` props and markers** at device resolution, nearest sampling, projected with the exact
   camera at the runner depth (so a runner on a crate meets its top edge).
4. **Runners**, after the world and without a depth test against it, each in its own slice of the
   depth range (no two runners cut into each other; submission order decides who is in front, the
   own runner always in front). The own runner marks the stencil.
5. **`front` props**, drawn at full alpha outside the own runner and at half alpha over it.

## The slab (`camera.ts`, `world.ts`)

Drawing space is world px, y down, z toward the viewer. Front faces lie at z = 0, the slab's back at
z = -`slabDepth`, runners and props at z = -`runnerDepth * slabDepth`. A point at depth d is drawn
at `centre + (p - camera) * F / (F + d)` with `F = cameraDistance(perspective)`, so a point 32 px
deep moves `perspective` of the way toward the screen centre, and `perspective` 0 is orthographic.

- **Front faces** are shaped by the cell's collision class (the art draws one tile per autotile
  variant): HALF shows the tile's top 16 rows in the cell's bottom half, SLAB the bottom 16 rows in
  the top half, slopes the full tile clipped by their triangle, a TOP plank the tile's top rows down
  to its underside, POST the middle 8 columns, everything else the whole tile.
- **Depth faces**: every `ChunkFile.outlines` segment is cut at cell borders and extruded to unit
  depth (the shader scales it by `slabDepth`). Shading by side: top 1.0, sides 0.76, underside 0.58.
- **Fill**, chosen per vertex in the shader: `strip` lays the material's top strip along top faces,
  undersides and slopes and its side strip along walls (row or column 0 meets the front face, the
  rest spans the slab's depth); `edge` stretches the front tile's texels just inside the edge
  through the depth; `flat` is the material's `avg` colour. A material asks for one mode
  (`MaterialDef.depth`); `strip` falls back to `edge` when its atlas slot has no strips (any opaque
  texel counts). `settings.depthFill` caps every material (`edge` turns strips into edges, `flat`
  makes everything flat).
- Vertices are stored relative to their chunk's corner and every chunk gets its own matrix, so
  large world coordinates never meet float32 in a shader. Pieces never cross a chunk border and end
  on it exactly, so depth faces of neighbouring chunks meet.

**Backgrounds** (`DistrictDef.background`, far to near) are drawn pixel-exact into the framebuffer.
Following the art contract, a layer's top edge is at screen y `y - factor * viewTop`, where `viewTop`
is the world y of a 683 x 384 view's top edge, and its left edge at screen x `-factor * viewLeft`;
a view larger than the logical resolution keeps that area centred. `repeatX` tiles horizontally.
Each district's sky colour and layers show only inside its own region rects (`backdrop.ts`): every
world cell belongs to the district of the first region rect that holds it (a cell beyond the world's
bounds to the nearest cell inside), and the weights are box-blurred by `BLEND_CELLS` (2) cells each
way, so neighbouring districts cross-fade over about five cells centred on their border and nowhere
else. The district under the camera is drawn underneath over the whole view; every other district
in view is drawn on its own into a second framebuffer and laid over it through a small RGBA mask
texture (one texel per cell around the view, one channel per district, linear filtering), refilled
only when the view moves to another cell. Up to four districts can share the view.

## Runners

### Mesh (`mesh.ts`)

The L2 mannequin of the graphics demo, ported unchanged (checked against the demo vertex for
vertex): lofts, a cube-sphere head, jaw, nose and bust mapped onto their host's box, cut along the
box unwrap of `schemas/skin.ts`, 1323 triangles. The overlay shell is the body pushed out 0.7 px
(1 px on the head), built only where the composited overlay has an opaque texel; it is drawn
double-sided with alpha cut-outs. The outline is an inverted hull (0.55 px) that respects alpha;
shading is the demo's cel shader with pixel-art shadows that saturate. Rigid GPU skinning: one bone
per vertex, 15 bone matrices in uniforms.

### Skins (`skin.ts`)

`composeSkin(layers)` composites a stack of sheets bottom first (body, hair, costume, extras),
alpha over, each a 1x 128 x 128 or 2x 256 x 256 PNG in the box-unwrap layout; mixed scales are
resampled with nearest filtering to the largest. Other sizes throw. `cleanLayer` clears texels with
alpha below 32 (the template's faint tints) for layers painted from the template. The overlay mask
is one byte per 1x texel of the overlay half.

### Clips (`clip.ts`)

`prepareClip` packs a `ClipFile` into one array in `BONE_NAMES` order (unknown bones are dropped,
missing ones stay at rest). `samplePose(clip, time, facing, travel, out)` interpolates neighbouring
30 fps frames (quaternions spherically, the root linearly); loops wrap, one-shots hold the last
frame. `boneMatrices(pose, out)` chains the bones.

- **Facing** -1 mirrors the pose as the demo's `mirrorPose`: x reflected, L and R bones swapped,
  quaternions (x, y, z, w) -> (-x, -y, z, w), the root turned 180 degrees about y first. The
  skin's asymmetry follows: facing left shows the runner's left side.
- **`mirror` flags**: the lifted Classic clips mark the frames Classic drew flipped, but their
  quaternions and root already carry the turn, so the flag is kept as information. A clip source
  that stores flipped frames unturned passes `{ applyMirror: true }`.
- **Travel** of a one-shot: with `'clip'` (the default) the root is drawn as stored, which is right
  for the lifted Classic clips: their root is drawn relative to an anchor the simulation moves, and
  their `travel` mixes posture with displacement (crash's root drops 26 px as the body lies down).
  With `'anchor'` the root has `travel * progress` taken out, for clips whose travel is pure
  displacement that a simulation reproduces by moving the anchor along the move.
- The anchor is the feet point; rig space (px, y up, x forward) becomes world px as
  `(x + rx, y - ry, z + rz)`.

## Content loaders (`content.ts`)

`fetchJson`, `fetchPixels` / `pixelsFromBlob` (straight-alpha RGBA via `createImageBitmap`),
`fetchClip`, and `loadWorldArt(base, world)`: every district's atlas, its background layers (a file
without a folder is looked up beside the atlas) and `art/props.png`; missing backgrounds or props
are left out.

## Dev harness

```bash
npx vite packages/runtime/dev --port 5181
```

A scrolling world, props, 30 animated runners in different looks (both facings of the asymmetric
hoodie and tee side by side, runners standing on crates, containers, a plank, the dock; one-shots on
repeat, a turn that flips facing at its end), markers, an fps counter, draw statistics and toggles
for depth fill, slab depth, perspective, runner depth and camera height. The own runner runs on
autopilot or with the arrow keys.

Content, in order of preference: the baked `packages/content/dist` (served as the public directory:
`world.json`, chunks, art, `render.json`, `skins/`, `clips/`), then the content sources served under
`/content/` (`content/skins/*.png`, `content/clips/classic/index.json`), then synthetic data: a
two-district world of 4 x 2 chunks with procedurally painted atlases in the schemas layout (one
material without strips, one flat), props, parallax layers and outlines from `dev/outline.ts`; skin
layers from the demo's painters (`dev/painters.ts`, texel-exact); procedural clips (`dev/clips.ts`).

`window.harness` has hooks for scripted checks: `renderer`, `bots`, `own`, `camera(x, y)` (fix the
camera centre in world px; `camera(null)` follows the own runner), `fps()`.

Measured in the desktop app's browser (1024 x 576 drawing buffer): 30 runners, about 95 draw calls
and 90 000 triangles a frame, 0.26 ms of JavaScript per frame and 0.34 ms including a full GPU
finish.

## Tests

`npx vitest run packages/runtime`: the mesh, painters and composited looks against the demo's
numbers, clip sampling (the demo's bone matrices, facing reflection, mirror flags, loops, travel),
the camera (pixel-exact front faces, perspective strength, the world pass and the device pass
agreeing at the runner depth) and chunk meshes (shapes, fills, fallbacks, pieces meeting at chunk
borders).
