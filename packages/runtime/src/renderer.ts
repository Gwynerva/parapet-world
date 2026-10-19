/**
 * The game's renderer: one WebGL 1 context, no engine. A frame is
 *
 * 1. the world pass into the logical framebuffer: the districts' sky colours and parallax layers
 *    (pixel-exact, each only inside its district's region rects and cross-faded over a few cells
 *    at the borders, see `backdrop.ts`), then the tiles' front faces and the slab's depth faces
 *    with a depth test, the camera snapped to whole logical pixels;
 * 2. the upscale to the screen with nearest filtering, shifted by the camera's remainder;
 * 3. `mid` props and markers at device resolution in the runners' plane;
 * 4. runners, each in its own depth slice (the own runner in front, marking the stencil);
 * 5. `front` props, half transparent where they cover the own runner.
 *
 * Use: `begin(camX, camY)`, then `runner(...)` and `marker(...)` for everything in view, then
 * `end()`. Positions are world units (32 per px), y down. Nothing is allocated per frame.
 */
import {
  CELL_PX,
  CHUNK_PX,
  DEFAULT_RENDER,
  UNITS_PER_PX,
  chunkKey,
  type ChunkFile,
  type ClipFile,
  type RenderSettings,
  type WorldIndex,
} from '@parapet-world/schemas';
import { createDistrictMask, fillDistrictMask, type DistrictArea } from './backdrop.ts';
import { createView, project, runnerMatrix, updateView, worldMatrix, type View } from './camera.ts';
import {
  BONE_COUNT,
  boneMatrices,
  createPose,
  prepareClip,
  samplePose,
  type Clip,
  type ClipOptions,
  type TravelMode,
} from './clip.ts';
import {
  bindAttribs,
  createBuffer,
  createProgram,
  createTexture,
  quadIndices,
  unbindAttribs,
  type Program,
} from './gl.ts';
import { buildBody, buildShell, VERTEX_FLOATS } from './mesh.ts';
import {
  BACKDROP_FS,
  BACKDROP_VS,
  RUNNER_FS,
  RUNNER_VS,
  SPRITE_FS,
  SPRITE_VS,
  WORLD_FS,
  WORLD_VS,
} from './shaders.ts';
import { composeSkin, type ComposedSkin, type Pixels } from './skin.ts';
import {
  MAX_QUADS,
  WORLD_FLOATS,
  buildChunkMesh,
  stripsPresent,
  worldInfo,
  type ChunkMesh,
  type WorldInfo,
} from './world.ts';

export interface RendererOptions {
  settings?: Partial<RenderSettings>;
  /** Multisampling for the runners' edges (default true). */
  antialias?: boolean;
  /** Upper bound of the device pixel ratio used for the drawing buffer (default 2). */
  maxPixelRatio?: number;
}

/** The art a world needs, decoded. */
export interface WorldArt {
  /** Tile atlas of every district, by district id. */
  atlases: Readonly<Record<string, Pixels>>;
  /** The props atlas (sprites of `PropDef.sprite`). */
  props?: Pixels | null;
  /** Background layers by `BackgroundLayer.file`. */
  backgrounds?: Readonly<Record<string, Pixels>>;
}

/** A look ready to draw: composited sheet, its texture and its mesh with the overlay shell. */
export interface Skin {
  readonly id: number;
  /** Triangles of the base body plus the shell. */
  readonly triangles: number;
  readonly scale: number;
  readonly composed: ComposedSkin;
}

/** A texture of sprites for markers. */
export interface SpriteSheet {
  readonly id: number;
  readonly width: number;
  readonly height: number;
}

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  chunks: number;
  chunksDrawn: number;
  runners: number;
  props: number;
  /** Logical framebuffer size and device px per logical px. */
  fbWidth: number;
  fbHeight: number;
  scale: number;
}

const OUTLINE_PX = 0.55;
const SPRITE_FLOATS = 5;
const SPRITE_QUADS = 2048;
const WORLD_LAYOUT = [
  ['aPos', 3],
  ['aUV0', 2],
  ['aUV1', 2],
  ['aCol', 3],
  ['aShadeMode', 2],
] as const;
const SPRITE_LAYOUT = [
  ['aPos', 2],
  ['aUV', 2],
  ['aAlpha', 1],
] as const;
const SCREEN_LAYOUT = [['aPos', 2]] as const;
const RUNNER_LAYOUT = [
  ['aPos', 3],
  ['aNrm', 3],
  ['aUV', 2],
  ['aBone', 1],
  ['aHull', 3],
] as const;
const FILL_CAP: Readonly<Record<RenderSettings['depthFill'], number>> = {
  flat: 0,
  edge: 1,
  strip: 2,
};

interface SkinImpl extends Skin {
  mesh: Float32Array;
  baseVerts: number;
  shellVerts: number;
  tex: WebGLTexture | null;
  buf: WebGLBuffer | null;
}
interface SheetImpl extends SpriteSheet {
  width: number;
  height: number;
  px: Pixels;
  tex: WebGLTexture | null;
}
interface LayerImpl {
  sheet: SheetImpl;
  factor: number;
  y: number;
  repeatX: boolean;
}
interface DistrictImpl {
  id: string;
  atlas: SheetImpl;
  layers: LayerImpl[];
  sky: [number, number, number];
}
interface ChunkImpl {
  file: ChunkFile;
  mesh: ChunkMesh;
  buffers: (WebGLBuffer | null)[];
}

let nextId = 1;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly settings: RenderSettings;
  readonly stats: RenderStats = {
    drawCalls: 0,
    triangles: 0,
    chunks: 0,
    chunksDrawn: 0,
    runners: 0,
    props: 0,
    fbWidth: 0,
    fbHeight: 0,
    scale: 1,
  };
  /** The camera of the last frame (world px). */
  readonly view: View = createView();

  private gl: WebGLRenderingContext;
  private lost = false;
  private readonly maxPixelRatio: number;
  private worldProg!: Program;
  private spriteProg!: Program;
  private runnerProg!: Program;
  private backdropProg!: Program;
  private current: Program | null = null;
  private quadIdx: WebGLBuffer | null = null;
  private spriteBuf: WebGLBuffer | null = null;
  /** A quad over the whole target, clip space. */
  private screenQuad: WebGLBuffer | null = null;
  private white: SheetImpl;
  private fb: WebGLFramebuffer | null = null;
  private fbTex: WebGLTexture | null = null;
  private fbDepth: WebGLRenderbuffer | null = null;
  private fbSize = [0, 0];
  /** A district's backdrop on its own, before it goes through the mask. */
  private bfb: WebGLFramebuffer | null = null;
  private bfbTex: WebGLTexture | null = null;
  private readonly bfbSize = [0, 0];

  // content
  private world: WorldIndex | null = null;
  private info: WorldInfo | null = null;
  private districts: DistrictImpl[] = [];
  private props: SheetImpl | null = null;
  private readonly chunks = new Map<number, ChunkImpl>();
  private chunkList: ChunkImpl[] = [];
  private readonly clips = new Map<string, Clip>();
  private readonly skins = new Set<SkinImpl>();
  private readonly sheets = new Set<SheetImpl>();

  // backdrops
  /** The region rects with their district indices, in the world's order. */
  private areas: DistrictArea[] = [];
  /** The district drawn underneath: the one under the camera (or forced); -1 none. */
  private bgBase = -1;
  /** Districts drawn this frame: 0, 1 (the base alone) or the mask's channels. */
  private bgCount = 0;
  private bgForced: string | null = null;
  private readonly mask = createDistrictMask();
  /** The window the mask holds: x0, y0, w, h, base (NaN: fill it again). */
  private readonly maskKey = [NaN, NaN, NaN, NaN, NaN];
  private maskTex: WebGLTexture | null = null;
  private readonly maskSize = [0, 0];

  // the frame being submitted
  private camX = 0;
  private camY = 0;
  private n = 0;
  private own = -1;
  private rSkin: (SkinImpl | null)[] = [];
  private rClip: (Clip | null)[] = [];
  private rX = new Float64Array(0);
  private rY = new Float64Array(0);
  private rT = new Float64Array(0);
  private rFacing = new Int8Array(0);
  private rTravel = new Uint8Array(0);
  private m = 0;
  private mSheet: (SheetImpl | null)[] = [];
  private mNum = new Float64Array(0);

  // scratch
  private readonly mat = new Float32Array(16);
  private readonly bones = new Float32Array(BONE_COUNT * 16);
  private readonly pose = createPose();
  private readonly sprites = new Float32Array(SPRITE_QUADS * 4 * SPRITE_FLOATS);
  private readonly spriteViews: (Float32Array | undefined)[] = [];
  private spriteCount = 0;
  private spriteSheet: SheetImpl | null = null;
  /** The world framebuffer as a sheet for the upscale. */
  private readonly fbSheet: SheetImpl = {
    id: 0,
    width: 1,
    height: 1,
    px: { width: 1, height: 1, data: new Uint8Array(4) },
    tex: null,
  };

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    this.settings = { ...DEFAULT_RENDER, ...options.settings };
    this.maxPixelRatio = options.maxPixelRatio ?? 2;
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: options.antialias ?? true,
      depth: true,
      stencil: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    this.white = this.sheet({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    this.initGL();
    this.growRunners(64);
    this.growMarkers(64);
  }

  /* ---------- settings and content ---------- */

  /** Changes render settings; none of them needs a rebuild. */
  setSettings(patch: Partial<RenderSettings>): void {
    Object.assign(this.settings, patch);
  }

  /** Replaces the world: its index and art. Loaded chunks are dropped (load them again). */
  setWorld(world: WorldIndex, art: WorldArt): void {
    for (const c of this.chunkList) this.freeChunk(c);
    this.chunks.clear();
    this.chunkList = [];
    for (const d of this.districts) {
      this.freeSheet(d.atlas);
      for (const l of d.layers) this.freeSheet(l.sheet);
    }
    if (this.props) this.freeSheet(this.props);
    this.world = world;
    const hasStrips: boolean[][] = [];
    this.districts = world.districts.map((d) => {
      const px = art.atlases[d.id] ?? {
        width: 1,
        height: 1,
        data: new Uint8Array([255, 0, 255, 255]),
      };
      hasStrips.push(stripsPresent(px));
      const layers: LayerImpl[] = [];
      for (const l of d.background) {
        const bg = art.backgrounds?.[l.file];
        if (bg)
          layers.push({ sheet: this.sheet(bg), factor: l.factor, y: l.y, repeatX: l.repeatX });
      }
      return { id: d.id, atlas: this.sheet(px), layers, sky: d.sky };
    });
    this.props = art.props ? this.sheet(art.props) : null;
    this.info = worldInfo(world, hasStrips);
    this.areas = [];
    for (const r of world.regions) {
      const d = this.districtIndex(r.district);
      if (d >= 0) this.areas.push({ rect: r.rect, district: d });
    }
    this.bgBase = -1;
    this.maskKey[0] = NaN;
  }

  /** Builds and uploads a chunk's mesh; a chunk already loaded at its place is replaced. */
  loadChunk(file: ChunkFile): void {
    if (!this.info) throw new Error('setWorld before loadChunk');
    const key = chunkKey(file.cx, file.cy);
    const old = this.chunks.get(key);
    if (old) this.unloadChunk(file.cx, file.cy);
    const c: ChunkImpl = { file, mesh: buildChunkMesh(file, this.info), buffers: [] };
    this.uploadChunk(c);
    this.chunks.set(key, c);
    this.chunkList.push(c);
  }

  unloadChunk(cx: number, cy: number): void {
    const key = chunkKey(cx, cy),
      c = this.chunks.get(key);
    if (!c) return;
    this.freeChunk(c);
    this.chunks.delete(key);
    this.chunkList.splice(this.chunkList.indexOf(c), 1);
  }

  hasChunk(cx: number, cy: number): boolean {
    return this.chunks.has(chunkKey(cx, cy));
  }

  /** Registers a clip under its name (replacing one of the same name). */
  addClip(file: ClipFile, options?: ClipOptions): Clip {
    const c = prepareClip(file, options);
    this.clips.set(c.name, c);
    return c;
  }

  clip(name: string): Clip | undefined {
    return this.clips.get(name);
  }

  /** Composites a look from its layer sheets (body, hair, costume, extras) and uploads it. */
  createSkin(layers: readonly Pixels[]): Skin {
    const composed = composeSkin(layers),
      body = buildBody(),
      shell = buildShell(body, composed.mask),
      mesh = new Float32Array(body.data.length + shell.length);
    mesh.set(body.data, 0);
    mesh.set(shell, body.data.length);
    const s: SkinImpl = {
      id: nextId++,
      triangles: mesh.length / VERTEX_FLOATS / 3,
      scale: composed.scale,
      composed,
      mesh,
      baseVerts: body.data.length / VERTEX_FLOATS,
      shellVerts: shell.length / VERTEX_FLOATS,
      tex: null,
      buf: null,
    };
    this.uploadSkin(s);
    this.skins.add(s);
    return s;
  }

  releaseSkin(skin: Skin): void {
    const s = skin as SkinImpl;
    if (!this.skins.delete(s)) return;
    if (s.tex) this.gl.deleteTexture(s.tex);
    if (s.buf) this.gl.deleteBuffer(s.buf);
    s.tex = s.buf = null;
  }

  /** A texture of sprites for `marker`. */
  createSpriteSheet(px: Pixels): SpriteSheet {
    return this.sheet(px);
  }

  releaseSpriteSheet(sheet: SpriteSheet): void {
    this.freeSheet(sheet as SheetImpl);
  }

  /**
   * Forces the background of one district over the whole view (null: every district inside its
   * own region rects).
   */
  setBackgroundDistrict(id: string | null): void {
    this.bgForced = id;
  }

  /* ---------- the frame ---------- */

  /** Starts a frame with the camera centre in world units. */
  begin(camX: number, camY: number): void {
    this.camX = camX / UNITS_PER_PX;
    this.camY = camY / UNITS_PER_PX;
    this.n = 0;
    this.own = -1;
    this.m = 0;
  }

  /**
   * Submits a runner: its look, the anchor (feet point, world units, y down), facing (1 right,
   * -1 left), the clip by name and the time into it in seconds. The own runner is drawn in front
   * of the others and fades `front` props over it. A clip that is not registered draws nothing.
   */
  runner(
    skin: Skin,
    x: number,
    y: number,
    facing: number,
    clip: string,
    time: number,
    own = false,
    travel: TravelMode = 'clip',
  ): void {
    if (this.n >= this.rX.length) this.growRunners(this.rX.length * 2);
    const i = this.n++;
    this.rSkin[i] = skin as SkinImpl;
    this.rClip[i] = this.clips.get(clip) ?? null;
    this.rX[i] = x / UNITS_PER_PX;
    this.rY[i] = y / UNITS_PER_PX;
    this.rT[i] = time;
    this.rFacing[i] = facing < 0 ? -1 : 1;
    this.rTravel[i] = travel === 'anchor' ? 1 : 0;
    if (own) this.own = i;
  }

  /**
   * Submits a marker sprite (finds, gates): the rect (sx, sy, sw, sh) of `sheet` (the props
   * atlas when null), centred on (x, y) world units in the runners' plane.
   */
  marker(
    sheet: SpriteSheet | null,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    x: number,
    y: number,
    alpha = 1,
  ): void {
    if (this.m * 7 >= this.mNum.length) this.growMarkers(this.mSheet.length * 2);
    const i = this.m++,
      o = i * 7;
    this.mSheet[i] = (sheet as SheetImpl | null) ?? this.props;
    this.mNum[o] = sx;
    this.mNum[o + 1] = sy;
    this.mNum[o + 2] = sw;
    this.mNum[o + 3] = sh;
    this.mNum[o + 4] = x / UNITS_PER_PX;
    this.mNum[o + 5] = y / UNITS_PER_PX;
    this.mNum[o + 6] = alpha;
  }

  /** Draws the submitted frame. */
  end(): void {
    const st = this.stats;
    st.drawCalls = st.triangles = st.chunksDrawn = st.props = 0;
    st.runners = this.n;
    st.chunks = this.chunkList.length;
    if (this.lost || this.gl.isContextLost()) return;
    const gl = this.gl,
      s = this.settings,
      v = this.view;
    this.resize();
    updateView(
      v,
      this.canvas.width,
      this.canvas.height,
      s.logical[0],
      s.logical[1],
      this.camX,
      this.camY,
      s.perspective,
      s.slabDepth,
      s.runnerDepth,
    );
    this.ensureFramebuffer(v.fbW, v.fbH);
    st.fbWidth = v.fbW;
    st.fbHeight = v.fbH;
    st.scale = v.scale;
    this.updateBackdrops();

    // 1. the world, at logical resolution: the base district's backdrop everywhere, the others
    // laid over it through the mask
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, v.fbW, v.fbH);
    const base = this.bgCount ? this.districts[this.bgBase]! : null;
    const bs = base ? base.sky : NO_SKY;
    gl.clearColor(bs[0] / 255, bs[1] / 255, bs[2] / 255, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.spriteBegin(2 / v.fbW, -2 / v.fbH, -1, 1);
    if (base) this.drawLayers(base);
    this.spriteFlush();
    for (let c = 1; c < this.bgCount; c++) this.drawMaskedBackdrop(c);
    gl.disable(gl.BLEND);
    this.drawTiles();

    // 2. the upscale, shifted by the camera's remainder
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, v.cw, v.ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    this.spriteBegin(2 / v.cw, -2 / v.ch, -1, 1);
    const k = v.scale,
      fb = this.fbSheet;
    fb.width = v.fbW;
    fb.height = v.fbH;
    fb.tex = this.fbTex;
    this.spriteQuad(
      fb,
      -v.fracX * k,
      -v.fracY * k,
      v.fbW * k,
      v.fbH * k,
      0,
      v.fbH,
      v.fbW,
      -v.fbH,
      1,
    );
    this.spriteFlush();

    // 3. mid props and markers, 4. runners, 5. front props
    gl.enable(gl.BLEND);
    this.drawProps(false, 1);
    this.drawMarkers();
    this.spriteFlush();
    gl.disable(gl.BLEND);
    this.drawRunners();
    this.spriteBegin(2 / v.cw, -2 / v.ch, -1, 1);
    gl.enable(gl.BLEND);
    if (this.own >= 0) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.stencilFunc(gl.EQUAL, 0, 0xff);
      this.drawProps(true, 1);
      this.spriteFlush();
      gl.stencilFunc(gl.EQUAL, 1, 0xff);
      this.drawProps(true, 0.5);
      this.spriteFlush();
      gl.disable(gl.STENCIL_TEST);
    } else {
      this.drawProps(true, 1);
      this.spriteFlush();
    }
    gl.disable(gl.BLEND);
    // let go of the frame's references
    for (let i = 0; i < this.n; i++) this.rSkin[i] = this.rClip[i] = null;
    for (let i = 0; i < this.m; i++) this.mSheet[i] = null;
  }

  /**
   * Where a world point (units, y down) in the runners' plane is on the canvas, in CSS px from its
   * top-left, with the last frame's camera (for names over runners and the HUD).
   */
  worldToScreen(x: number, y: number, out: { x: number; y: number }): { x: number; y: number } {
    const v = this.view;
    project(v, x / UNITS_PER_PX, y / UNITS_PER_PX, v.runnerZ, out);
    const css = this.canvas.clientWidth ? this.canvas.clientWidth / v.cw : 1;
    out.x *= v.scale * css;
    out.y *= v.scale * css;
    return out;
  }

  /** Releases every GL resource and the listeners. */
  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    for (const c of this.chunkList) this.freeChunk(c);
    for (const s of [...this.skins]) this.releaseSkin(s);
    for (const s of [...this.sheets]) this.freeSheet(s);
    this.chunks.clear();
    this.chunkList = [];
  }

  /* ---------- passes ---------- */

  private drawLayers(d: DistrictImpl): void {
    const v = this.view,
      LW = this.settings.logical[0],
      LH = this.settings.logical[1];
    for (let i = 0; i < d.layers.length; i++) {
      const l = d.layers[i]!,
        w = l.sheet.width,
        h = l.sheet.height;
      // the layer's top-left in logical screen px: the art places it against the view's top-left
      // at the nominal logical size; a larger view keeps that area centred
      const sx = (v.lw - LW) / 2 - l.factor * (v.camX - LW / 2),
        sy = (v.lh - LH) / 2 + l.y - l.factor * (v.camY - LH / 2);
      const x = Math.round(sx + v.fracX),
        y = Math.round(sy + v.fracY);
      if (y >= v.fbH || y + h <= 0) continue;
      if (l.repeatX) {
        const k0 = Math.floor(-x / w),
          k1 = Math.ceil((v.fbW - x) / w);
        for (let k = k0; k < k1; k++) this.spriteQuad(l.sheet, x + k * w, y, w, h, 0, 0, w, h, 1);
      } else if (x < v.fbW && x + w > 0) {
        this.spriteQuad(l.sheet, x, y, w, h, 0, 0, w, h, 1);
      }
    }
  }

  private drawTiles(): void {
    const gl = this.gl,
      v = this.view,
      s = this.settings,
      p = this.worldProg;
    if (!this.chunkList.length) return;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    this.use(p);
    gl.uniform1f(p.uniforms.uSlab!, s.slabDepth);
    gl.uniform1f(p.uniforms.uCap!, FILL_CAP[s.depthFill]);
    gl.uniform1i(p.uniforms.uTex!, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
    // depth faces pull toward the centre, so a chunk just outside the view may still show
    const mx = (v.lw / 2) * s.slabDepth * v.invF + 2,
      my = (v.lh / 2) * s.slabDepth * v.invF + 2,
      x0 = v.camX - v.lw / 2 - mx,
      x1 = v.camX + v.lw / 2 + mx,
      y0 = v.camY - v.lh / 2 - my,
      y1 = v.camY + v.lh / 2 + my;
    let bound: SheetImpl | null = null;
    for (let i = 0; i < this.chunkList.length; i++) {
      const c = this.chunkList[i]!,
        mesh = c.mesh;
      if (mesh.ox > x1 || mesh.ox + CHUNK_PX < x0 || mesh.oy > y1 || mesh.oy + CHUNK_PX < y0) {
        continue;
      }
      this.stats.chunksDrawn++;
      worldMatrix(v, mesh.ox, mesh.oy, this.mat);
      gl.uniformMatrix4fv(p.uniforms.uMat!, false, this.mat);
      for (let b = 0; b < mesh.batches.length; b++) {
        const batch = mesh.batches[b]!,
          atlas = this.districts[batch.district]?.atlas;
        if (!atlas) continue;
        if (atlas !== bound) {
          gl.bindTexture(gl.TEXTURE_2D, atlas.tex);
          gl.uniform2f(p.uniforms.uInvAtlas!, 1 / atlas.width, 1 / atlas.height);
          bound = atlas;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, c.buffers[b]!);
        bindAttribs(gl, p, WORLD_FLOATS, WORLD_LAYOUT);
        gl.drawElements(gl.TRIANGLES, batch.quads * 6, gl.UNSIGNED_SHORT, 0);
        this.stats.drawCalls++;
        this.stats.triangles += batch.quads * 2;
      }
    }
    gl.disable(gl.DEPTH_TEST);
  }

  private drawProps(front: boolean, alpha: number): void {
    const sheet = this.props;
    if (!sheet) return;
    const v = this.view,
      k = v.runnerK,
      sc = v.scale,
      hw = v.lw / 2,
      hh = v.lh / 2;
    this.spriteTint(1, 1, 1, alpha);
    for (let i = 0; i < this.chunkList.length; i++) {
      const props = this.chunkList[i]!.mesh.props;
      for (let j = 0; j < props.length; j++) {
        const p = props[j]!;
        if (p.front !== front) continue;
        const x = ((p.x - v.camX) * k + hw) * sc,
          y = ((p.y - v.camY) * k + hh) * sc,
          w = p.w * k * sc,
          h = p.h * k * sc;
        if (x > v.cw || y > v.ch || x + w < 0 || y + h < 0) continue;
        this.spriteQuad(sheet, x, y, w, h, p.sx, p.sy, p.w, p.h, 1);
        this.stats.props++;
      }
    }
  }

  private drawMarkers(): void {
    const v = this.view,
      k = v.runnerK,
      sc = v.scale;
    this.spriteTint(1, 1, 1, 1);
    for (let i = 0; i < this.m; i++) {
      const sheet = this.mSheet[i],
        o = i * 7;
      if (!sheet) continue;
      const sw = this.mNum[o + 2]!,
        sh = this.mNum[o + 3]!,
        w = sw * k * sc,
        h = sh * k * sc,
        x = ((this.mNum[o + 4]! - v.camX) * k + v.lw / 2) * sc - w / 2,
        y = ((this.mNum[o + 5]! - v.camY) * k + v.lh / 2) * sc - h / 2;
      if (x > v.cw || y > v.ch || x + w < 0 || y + h < 0) continue;
      this.spriteQuad(
        sheet,
        x,
        y,
        w,
        h,
        this.mNum[o]!,
        this.mNum[o + 1]!,
        sw,
        sh,
        this.mNum[o + 6]!,
      );
    }
  }

  private drawRunners(): void {
    const n = this.n;
    if (!n) return;
    const gl = this.gl,
      v = this.view,
      p = this.runnerProg,
      u = p.uniforms;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    this.use(p);
    gl.uniform1i(u.uTex!, 0);
    gl.activeTexture(gl.TEXTURE0);
    // every runner has its own slice of the depth range; later slices are nearer, the own last
    const slice = 1.8 / n,
      zk = (slice * 0.45) / 16;
    let order = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        if ((i === this.own) !== (pass === 1)) continue;
        const skin = this.rSkin[i],
          clip = this.rClip[i],
          slot = order++;
        if (!skin || !clip || !skin.buf) continue;
        samplePose(
          clip,
          this.rT[i]!,
          this.rFacing[i]!,
          this.rTravel[i] ? 'anchor' : 'clip',
          this.pose,
        );
        boneMatrices(this.pose, this.bones);
        gl.uniformMatrix4fv(u.uBones!, false, this.bones);
        runnerMatrix(v, this.rX[i]!, this.rY[i]!, this.mat);
        gl.uniformMatrix4fv(u.uMat!, false, this.mat);
        gl.uniform2f(u.uSlice!, 0.9 - (slot + 0.5) * slice, zk);
        gl.bindTexture(gl.TEXTURE_2D, skin.tex);
        gl.bindBuffer(gl.ARRAY_BUFFER, skin.buf);
        bindAttribs(gl, p, VERTEX_FLOATS, RUNNER_LAYOUT);
        if (i === this.own) {
          gl.enable(gl.STENCIL_TEST);
          gl.stencilFunc(gl.ALWAYS, 1, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        }
        // the inverted hull for the outline, then the body, then the shell double-sided
        gl.cullFace(gl.FRONT);
        gl.uniform1f(u.uHull!, OUTLINE_PX);
        gl.uniform1f(u.uOutline!, 1);
        gl.drawArrays(gl.TRIANGLES, 0, skin.baseVerts + skin.shellVerts);
        gl.cullFace(gl.BACK);
        gl.uniform1f(u.uHull!, 0);
        gl.uniform1f(u.uOutline!, 0);
        gl.drawArrays(gl.TRIANGLES, 0, skin.baseVerts);
        if (skin.shellVerts) {
          gl.disable(gl.CULL_FACE);
          gl.drawArrays(gl.TRIANGLES, skin.baseVerts, skin.shellVerts);
          gl.enable(gl.CULL_FACE);
        }
        if (i === this.own) gl.disable(gl.STENCIL_TEST);
        this.stats.drawCalls += skin.shellVerts ? 3 : 2;
        this.stats.triangles += (2 * skin.baseVerts + 2 * skin.shellVerts) / 3;
      }
    }
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
  }

  /**
   * Picks the base district (the forced one, else the one under the camera, else the last one)
   * and, when the view has moved to another cell, fills the mask of the cells around it.
   */
  private updateBackdrops(): void {
    const v = this.view;
    let base = -1;
    if (this.bgForced) base = this.districtIndex(this.bgForced);
    else {
      const cx = Math.floor(v.camX / CELL_PX),
        cy = Math.floor(v.camY / CELL_PX);
      for (let i = 0; i < this.areas.length; i++) {
        const rc = this.areas[i]!.rect;
        if (cx >= rc[0] && cy >= rc[1] && cx < rc[0] + rc[2] && cy < rc[1] + rc[3]) {
          base = this.areas[i]!.district;
          break;
        }
      }
      if (base < 0) base = this.bgBase >= 0 ? this.bgBase : this.districts.length ? 0 : -1;
    }
    this.bgBase = base;
    const k = this.maskKey,
      m = this.mask;
    if (base < 0 || this.bgForced || !this.world) {
      this.bgCount = base < 0 ? 0 : 1;
      k[0] = NaN;
      return;
    }
    // every cell a pixel of the framebuffer samples, with its neighbours for the filtering
    const x0 = Math.floor(v.left / CELL_PX) - 1,
      y0 = Math.floor(v.top / CELL_PX) - 1,
      w = Math.ceil(v.fbW / CELL_PX) + 3,
      h = Math.ceil(v.fbH / CELL_PX) + 3;
    if (k[0] !== x0 || k[1] !== y0 || k[2] !== w || k[3] !== h || k[4] !== base) {
      k[0] = x0;
      k[1] = y0;
      k[2] = w;
      k[3] = h;
      k[4] = base;
      fillDistrictMask(m, this.areas, this.world.bounds, base, x0, y0, w, h);
      if (m.used > 1) this.uploadMask();
    }
    this.bgCount = m.used;
  }

  /**
   * Draws the backdrop of the mask's channel `c` on its own and lays it over the world
   * framebuffer with its share of the weights.
   */
  private drawMaskedBackdrop(c: number): void {
    const gl = this.gl,
      v = this.view,
      m = this.mask,
      d = this.districts[m.channels[c]!]!;
    this.ensureBackdropBuffer(v.fbW, v.fbH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bfb);
    gl.clearColor(d.sky[0] / 255, d.sky[1] / 255, d.sky[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.spriteBegin(2 / v.fbW, -2 / v.fbH, -1, 1);
    this.drawLayers(d);
    this.spriteFlush();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    const p = this.backdropProg,
      u = p.uniforms,
      // gl_FragCoord counts from the bottom-left: world px (left + x, top + fbH - y)
      mw = CELL_PX * m.w,
      mh = CELL_PX * m.h;
    this.use(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenQuad);
    bindAttribs(gl, p, 2, SCREEN_LAYOUT);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bfbTex);
    gl.uniform1i(u.uTex!, 0);
    gl.uniform1i(u.uMask!, 1);
    gl.uniform2f(u.uInvSize!, 1 / v.fbW, 1 / v.fbH);
    gl.uniform4f(
      u.uMaskXform!,
      (v.left - CELL_PX * m.x0) / mw,
      1 / mw,
      (v.top + v.fbH - CELL_PX * m.y0) / mh,
      -1 / mh,
    );
    gl.uniform4f(u.uSel!, 0, c === 1 ? 1 : 0, c === 2 ? 1 : 0, c === 3 ? 1 : 0);
    gl.uniform4f(u.uUpTo!, 1, 1, c >= 2 ? 1 : 0, c >= 3 ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.drawCalls++;
    this.stats.triangles += 2;
  }

  private uploadMask(): void {
    const gl = this.gl,
      m = this.mask;
    if (!this.maskTex) {
      this.maskTex = createTexture(gl, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.maskSize[0] = this.maskSize[1] = 0;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (this.maskSize[0] === m.w && this.maskSize[1] === m.h) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, m.w, m.h, gl.RGBA, gl.UNSIGNED_BYTE, m.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, m.w, m.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, m.data);
      this.maskSize[0] = m.w;
      this.maskSize[1] = m.h;
    }
  }

  private districtIndex(id: string): number {
    for (let i = 0; i < this.districts.length; i++) if (this.districts[i]!.id === id) return i;
    return -1;
  }

  /* ---------- sprite batch ---------- */

  private spriteBegin(sx: number, sy: number, ox: number, oy: number): void {
    const gl = this.gl,
      p = this.spriteProg;
    this.spriteFlush();
    this.use(p);
    gl.uniform4f(p.uniforms.uXform!, sx, sy, ox, oy);
    gl.uniform1i(p.uniforms.uTex!, 0);
    gl.uniform4f(p.uniforms.uTint!, 1, 1, 1, 1);
  }

  private spriteTint(r: number, g: number, b: number, a: number): void {
    this.spriteFlush();
    this.gl.uniform4f(this.spriteProg.uniforms.uTint!, r, g, b, a);
  }

  /** A quad at (x, y, w, h) target px sampling (u, v, uw, vh) texel px of the sheet. */
  private spriteQuad(
    sheet: SheetImpl,
    x: number,
    y: number,
    w: number,
    h: number,
    u: number,
    vv: number,
    uw: number,
    vh: number,
    alpha: number,
  ): void {
    if (sheet !== this.spriteSheet || this.spriteCount >= SPRITE_QUADS) {
      this.spriteFlush();
      this.spriteSheet = sheet;
    }
    const d = this.sprites;
    let o = this.spriteCount++ * 4 * SPRITE_FLOATS;
    o = this.spriteVertex(d, o, x, y, u, vv, alpha);
    o = this.spriteVertex(d, o, x + w, y, u + uw, vv, alpha);
    o = this.spriteVertex(d, o, x + w, y + h, u + uw, vv + vh, alpha);
    this.spriteVertex(d, o, x, y + h, u, vv + vh, alpha);
  }

  private spriteVertex(
    d: Float32Array,
    o: number,
    x: number,
    y: number,
    u: number,
    v: number,
    a: number,
  ): number {
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = u;
    d[o + 3] = v;
    d[o + 4] = a;
    return o + SPRITE_FLOATS;
  }

  private spriteFlush(): void {
    const n = this.spriteCount,
      sheet = this.spriteSheet;
    if (!n || !sheet) {
      this.spriteCount = 0;
      return;
    }
    const gl = this.gl,
      p = this.spriteProg;
    let view = this.spriteViews[n];
    if (!view) view = this.spriteViews[n] = this.sprites.subarray(0, n * 4 * SPRITE_FLOATS);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, view);
    bindAttribs(gl, p, SPRITE_FLOATS, SPRITE_LAYOUT);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIdx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sheet.tex);
    gl.uniform2f(p.uniforms.uInvTex!, 1 / sheet.width, 1 / sheet.height);
    gl.drawElements(gl.TRIANGLES, n * 6, gl.UNSIGNED_SHORT, 0);
    this.stats.drawCalls++;
    this.stats.triangles += n * 2;
    this.spriteCount = 0;
  }

  /* ---------- resources ---------- */

  private use(p: Program): void {
    if (this.current === p) return;
    if (this.current) unbindAttribs(this.gl, this.current);
    this.gl.useProgram(p.program);
    this.current = p;
  }

  private initGL(): void {
    const gl = this.gl;
    this.current = null;
    this.worldProg = createProgram(gl, WORLD_VS, WORLD_FS);
    this.spriteProg = createProgram(gl, SPRITE_VS, SPRITE_FS);
    this.runnerProg = createProgram(gl, RUNNER_VS, RUNNER_FS);
    this.backdropProg = createProgram(gl, BACKDROP_VS, BACKDROP_FS);
    this.quadIdx = createBuffer(
      gl,
      gl.ELEMENT_ARRAY_BUFFER,
      quadIndices(MAX_QUADS),
      gl.STATIC_DRAW,
    );
    this.spriteBuf = createBuffer(gl, gl.ARRAY_BUFFER, this.sprites.byteLength, gl.DYNAMIC_DRAW);
    this.screenQuad = createBuffer(
      gl,
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.fb = this.fbTex = this.fbDepth = null;
    this.fbSize[0] = this.fbSize[1] = 0;
    this.bfb = this.bfbTex = null;
    this.bfbSize[0] = this.bfbSize[1] = 0;
    this.maskTex = null;
    this.maskKey[0] = NaN;
    gl.disable(gl.DITHER);
  }

  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
  };

  /** Everything is rebuilt from the content kept on the CPU side. */
  private readonly onRestored = (): void => {
    this.lost = false;
    this.initGL();
    for (const s of this.sheets) this.uploadSheet(s);
    for (const s of this.skins) this.uploadSkin(s);
    if (this.info) {
      for (const c of this.chunkList) {
        c.mesh = buildChunkMesh(c.file, this.info);
        this.uploadChunk(c);
      }
    }
  };

  private resize(): void {
    const c = this.canvas,
      dpr = Math.min(this.maxPixelRatio, globalThis.devicePixelRatio || 1),
      w = Math.max(1, Math.round((c.clientWidth || c.width) * dpr)),
      h = Math.max(1, Math.round((c.clientHeight || c.height) * dpr));
    if (!c.clientWidth || !c.clientHeight) return;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
  }

  private ensureFramebuffer(w: number, h: number): void {
    if (this.fb && this.fbSize[0] === w && this.fbSize[1] === h) return;
    const gl = this.gl;
    if (this.fb) gl.deleteFramebuffer(this.fb);
    if (this.fbTex) gl.deleteTexture(this.fbTex);
    if (this.fbDepth) gl.deleteRenderbuffer(this.fbDepth);
    this.fbTex = createTexture(gl, null);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.fbDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.fbDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    this.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fbDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fbSize[0] = w;
    this.fbSize[1] = h;
  }

  private ensureBackdropBuffer(w: number, h: number): void {
    if (this.bfb && this.bfbSize[0] === w && this.bfbSize[1] === h) return;
    const gl = this.gl;
    if (this.bfb) gl.deleteFramebuffer(this.bfb);
    if (this.bfbTex) gl.deleteTexture(this.bfbTex);
    this.bfbTex = createTexture(gl, null);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.bfb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bfb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bfbTex, 0);
    this.bfbSize[0] = w;
    this.bfbSize[1] = h;
  }

  private sheet(px: Pixels): SheetImpl {
    const s: SheetImpl = { id: nextId++, width: px.width, height: px.height, px, tex: null };
    this.uploadSheet(s);
    this.sheets.add(s);
    return s;
  }

  private uploadSheet(s: SheetImpl): void {
    s.tex = createTexture(this.gl, s.px);
  }

  private freeSheet(s: SheetImpl): void {
    if (s === this.white || !this.sheets.delete(s)) return;
    if (s.tex) this.gl.deleteTexture(s.tex);
    s.tex = null;
  }

  private uploadSkin(s: SkinImpl): void {
    const gl = this.gl,
      c = s.composed;
    s.tex = createTexture(gl, { width: c.size, height: c.size, data: c.pixels });
    s.buf = createBuffer(gl, gl.ARRAY_BUFFER, s.mesh, gl.STATIC_DRAW);
  }

  private uploadChunk(c: ChunkImpl): void {
    const gl = this.gl;
    c.buffers = c.mesh.batches.map((b) =>
      createBuffer(gl, gl.ARRAY_BUFFER, b.data, gl.STATIC_DRAW),
    );
    // the GPU has the vertices; the file is kept to rebuild them after a context loss
    for (const b of c.mesh.batches) b.data = EMPTY;
  }

  private freeChunk(c: ChunkImpl): void {
    for (const b of c.buffers) if (b) this.gl.deleteBuffer(b);
    c.buffers = [];
  }

  private growRunners(cap: number): void {
    const grow = <T extends Float64Array | Int8Array | Uint8Array>(
      a: T,
      make: (n: number) => T,
    ): T => {
      const b = make(cap);
      b.set(a);
      return b;
    };
    this.rX = grow(this.rX, (k) => new Float64Array(k));
    this.rY = grow(this.rY, (k) => new Float64Array(k));
    this.rT = grow(this.rT, (k) => new Float64Array(k));
    this.rFacing = grow(this.rFacing, (k) => new Int8Array(k));
    this.rTravel = grow(this.rTravel, (k) => new Uint8Array(k));
    while (this.rSkin.length < cap) {
      this.rSkin.push(null);
      this.rClip.push(null);
    }
  }

  private growMarkers(cap: number): void {
    const b = new Float64Array(cap * 7);
    b.set(this.mNum);
    this.mNum = b;
    while (this.mSheet.length < cap) this.mSheet.push(null);
  }
}

const EMPTY = new Float32Array(0);
const NO_SKY: readonly [number, number, number] = [24, 31, 58];

/** Creates a renderer on a canvas (WebGL 1). */
export function createRenderer(canvas: HTMLCanvasElement, options?: RendererOptions): Renderer {
  return new Renderer(canvas, options);
}
