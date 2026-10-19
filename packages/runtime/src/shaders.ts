/**
 * GLSL ES 1.00 sources (WebGL 1). Fragment shaders use high precision where the device has it:
 * atlas texel coordinates need more than half floats to land on the right texel.
 */
import { BONE_COUNT } from './clip.ts';

const FRAG_PRECISION = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/** Tiles and depth faces into the logical framebuffer (see `world.ts` for the vertex layout). */
export const WORLD_VS = `
attribute vec3 aPos;
attribute vec2 aUV0;
attribute vec2 aUV1;
attribute vec3 aCol;
attribute vec2 aShadeMode;
uniform mat4 uMat;
uniform float uSlab;
uniform float uCap;
uniform vec2 uInvAtlas;
varying vec2 vUV0;
varying vec2 vUV1;
varying vec3 vCol;
varying float vShade;
varying float vMode;
void main() {
  gl_Position = uMat * vec4(aPos.xy, aPos.z * uSlab, 1.0);
  vUV0 = aUV0 * uInvAtlas;
  vUV1 = aUV1 * uInvAtlas;
  vCol = aCol;
  vShade = aShadeMode.x;
  float m = aShadeMode.y;
  vMode = m > 2.5 ? 3.0 : min(m, uCap);
}`;

export const WORLD_FS = `${FRAG_PRECISION}
uniform sampler2D uTex;
varying vec2 vUV0;
varying vec2 vUV1;
varying vec3 vCol;
varying float vShade;
varying float vMode;
void main() {
  if (vMode > 2.5) {
    vec4 c = texture2D(uTex, vUV0);
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb, 1.0);
    return;
  }
  vec3 c = vMode > 1.5 ? texture2D(uTex, vUV1).rgb : vMode > 0.5 ? texture2D(uTex, vUV0).rgb : vCol;
  gl_FragColor = vec4(c * vShade, 1.0);
}`;

/**
 * Textured quads in pixel space: backgrounds into the framebuffer, props and markers at device
 * resolution, the framebuffer's upscale. uXform maps px to clip space (scale xy, offset zw).
 */
export const SPRITE_VS = `
attribute vec2 aPos;
attribute vec2 aUV;
attribute float aAlpha;
uniform vec4 uXform;
uniform vec2 uInvTex;
varying vec2 vUV;
varying float vAlpha;
void main() {
  gl_Position = vec4(aPos * uXform.xy + uXform.zw, 0.0, 1.0);
  vUV = aUV * uInvTex;
  vAlpha = aAlpha;
}`;

export const SPRITE_FS = `${FRAG_PRECISION}
uniform sampler2D uTex;
uniform vec4 uTint;
varying vec2 vUV;
varying float vAlpha;
void main() {
  vec4 c = texture2D(uTex, vUV);
  float a = c.a * vAlpha * uTint.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(c.rgb * uTint.rgb, a);
}`;

/**
 * A district's backdrop (drawn on its own into a second framebuffer) laid over the backdrops
 * already in the world framebuffer, through the district mask (`backdrop.ts`): one texel per world
 * cell, a channel per district, linear filtering. The pixel's alpha is the district's weight over
 * the weights of the districts drawn so far with it (uUpTo), so the sum lands on each district's
 * share. uMaskXform maps gl_FragCoord to mask uv: (u0, du, v0, dv).
 */
export const BACKDROP_VS = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const BACKDROP_FS = `${FRAG_PRECISION}
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform vec2 uInvSize;
uniform vec4 uMaskXform;
uniform vec4 uSel;
uniform vec4 uUpTo;
void main() {
  vec2 f = gl_FragCoord.xy;
  vec4 m = texture2D(uMask, vec2(uMaskXform.x + f.x * uMaskXform.y, uMaskXform.z + f.y * uMaskXform.w));
  float s = dot(m, uUpTo);
  float a = s > 0.0 ? dot(m, uSel) / s : 0.0;
  if (a < 0.004) discard;
  gl_FragColor = vec4(texture2D(uTex, f * uInvSize).rgb, min(a, 1.0));
}`;

/**
 * The runner: rigid GPU skinning (one bone per vertex), an inflated hull for the outline, and a
 * depth slice of its own (uSlice: centre and scale in normalised depth), so runners never cut
 * into each other and the order they are submitted in decides who is in front.
 */
export const RUNNER_VS = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec2 aUV;
attribute float aBone;
attribute vec3 aHull;
uniform mat4 uBones[${BONE_COUNT}];
uniform mat4 uMat;
uniform float uHull;
uniform vec2 uSlice;
varying vec2 vUV;
varying vec3 vN;
void main() {
  mat4 B = uBones[int(aBone + 0.5)];
  vec4 q = B * vec4(aPos + aHull * uHull, 1.0);
  gl_Position = uMat * q;
  gl_Position.z = (uSlice.x - q.z * uSlice.y) * gl_Position.w;
  vUV = aUV;
  vN = (B * vec4(aNrm, 0.0)).xyz;
}`;

/** Cel shading with pixel-art shadows that saturate (the colour times itself), alpha cut-outs. */
export const RUNNER_FS = `${FRAG_PRECISION}
uniform sampler2D uTex;
uniform float uOutline;
varying vec2 vUV;
varying vec3 vN;
const vec3 LIGHT = vec3(0.3, 0.6, 0.74) / 1.0;
void main() {
  vec4 c = texture2D(uTex, vUV);
  if (c.a < 0.5) discard;
  if (uOutline > 0.5) {
    gl_FragColor = vec4(0.07, 0.055, 0.05, 1.0);
    return;
  }
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float d = max(dot(n, normalize(LIGHT)), 0.0);
  vec3 c2 = c.rgb * c.rgb;
  vec3 col = d > 0.82 ? mix(c.rgb, vec3(1.0), 0.16)
    : d > 0.5 ? c.rgb
    : d > 0.18 ? mix(c.rgb, c2, 0.3) * 0.95
    : mix(c.rgb, c2, 0.6) * 0.85;
  gl_FragColor = vec4(col, 1.0);
}`;
