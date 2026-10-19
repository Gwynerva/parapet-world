/** Thin WebGL 1 helpers: programs with their locations, textures and buffers. */
import type { Pixels } from './skin.ts';

export interface Program {
  program: WebGLProgram;
  attribs: Record<string, number>;
  /** Every active attribute location, to disable them when switching programs. */
  locations: number[];
  uniforms: Record<string, WebGLUniformLocation>;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`shader: ${gl.getShaderInfoLog(s) ?? '?'}`);
  }
  return s;
}

/** Compiles and links a program and collects every active attribute and uniform location. */
export function createProgram(gl: WebGLRenderingContext, vs: string, fs: string): Program {
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`program: ${gl.getProgramInfoLog(program) ?? '?'}`);
  }
  const attribs: Record<string, number> = {},
    uniforms: Record<string, WebGLUniformLocation> = {};
  const na = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) as number,
    nu = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < na; i++) {
    const a = gl.getActiveAttrib(program, i);
    if (a) attribs[a.name] = gl.getAttribLocation(program, a.name);
  }
  for (let i = 0; i < nu; i++) {
    const u = gl.getActiveUniform(program, i);
    if (!u) continue;
    const name = u.name.replace(/\[0\]$/, ''),
      loc = gl.getUniformLocation(program, name);
    if (loc) uniforms[name] = loc;
  }
  return { program, attribs, locations: Object.values(attribs).filter((l) => l >= 0), uniforms };
}

/** Points the program's attributes at the bound array buffer: [name, floats] in vertex order. */
export function bindAttribs(
  gl: WebGLRenderingContext,
  p: Program,
  stride: number,
  layout: readonly (readonly [string, number])[],
): void {
  let off = 0;
  for (let i = 0; i < layout.length; i++) {
    const entry = layout[i]!,
      n = entry[1],
      loc = p.attribs[entry[0]];
    if (loc !== undefined && loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride * 4, off * 4);
    }
    off += n;
  }
}

/** Disables every attribute array a program uses (before switching to another layout). */
export function unbindAttribs(gl: WebGLRenderingContext, p: Program): void {
  for (let i = 0; i < p.locations.length; i++) gl.disableVertexAttribArray(p.locations[i]!);
}

/** A texture with nearest filtering and clamped edges from RGBA pixels. */
export function createTexture(gl: WebGLRenderingContext, px: Pixels | null): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (px) {
    const d = px.data,
      data = d instanceof Uint8Array ? d : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      px.width,
      px.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function createBuffer(
  gl: WebGLRenderingContext,
  target: number,
  data: ArrayBufferView | number,
  usage: number,
): WebGLBuffer {
  const b = gl.createBuffer();
  if (!b) throw new Error('createBuffer failed');
  gl.bindBuffer(target, b);
  if (typeof data === 'number') gl.bufferData(target, data, usage);
  else gl.bufferData(target, data as BufferSource, usage);
  return b;
}

/** Indices of `quads` quads, two triangles each: (0 1 2) (0 2 3). */
export function quadIndices(quads: number): Uint16Array {
  const idx = new Uint16Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const v = q * 4,
      i = q * 6;
    idx[i] = v;
    idx[i + 1] = v + 1;
    idx[i + 2] = v + 2;
    idx[i + 3] = v;
    idx[i + 4] = v + 2;
    idx[i + 5] = v + 3;
  }
  return idx;
}
