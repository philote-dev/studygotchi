/**
 * Course beads on the arms: one instanced draw of flat quads in the disc
 * plane, in the galaxy's pattern frame. `iParams` = (alpha, mode, p0, phase).
 * Modes:
 *   0 glow        dithered Gaussian through the shared light module (lib/light)
 *   1 core dot    one bright cell (at least ~1.2 cells), the course without a world
 *   2 planet core dark disc with a lit rim (Westerlund 2 silhouette), the course with a world
 *   3 ring        the "you are here" ring, at least ~1.4 cells thick
 *   4 globular    a dim Sérsic smudge in the halo (archived course)
 * Everything is sized in pixel-pass cells through `uRes`, so a ring never
 * thins below one cell whatever the altitude.
 *
 * Hover (S3-4): `iCourse` is the instance's course index and `uHover` the
 * hovered course (-1 none); the hovered course's glow quad gains a one-cell
 * ring just inside its edge. One uniform write per hover change, no rebuild.
 *
 * Blob anchors (S3-3 C): the glow is drawn at the blob's core-glow radius and
 * the ring at the blob's rim; `uCurrent` + `uCondense` + `uGrow` grow the
 * current course's glow and shrink its ring back to the bead as the hop
 * collapses the blob (per-frame uniform writes).
 */
import { GLSL_SNAP, GLSL_THEME_TONE } from "../../lib/uniforms";
import { GLSL_LIGHT } from "@/lib/light";

export const BEAD_VERT = /* glsl */ `
uniform vec2 uRes;
uniform float uHover;
uniform float uCurrent;
uniform float uCondense;
uniform vec2 uGrow;
attribute vec3 iColor;
attribute vec4 iParams;
attribute float iCourse;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vParams;
varying float vCells;
varying float vHover;
${GLSL_SNAP}
void main() {
  vUv = uv * 2.0 - 1.0;
  vColor = iColor;
  vParams = iParams;
  vHover = step(abs(iCourse - uHover), 0.5);
  // The current course's anchors grow with the hop's condense (the blob collapsing into its core): the glow back
  // to the whole bead (the twin's landing disc), the ring back to the bead ring. One uniform, no rebuild.
  float cur = step(abs(iCourse - uCurrent), 0.5);
  float mode = iParams.y;
  float grow = 1.0;
  if (cur > 0.5) {
    if (mode < 0.5) grow = mix(1.0, uGrow.x, uCondense);
    else if (mode > 2.5 && mode < 3.5) grow = mix(1.0, uGrow.y, uCondense);
  }
  // Half-size of this instance in pixel-pass cells (same trick as the galaxy's halo sizing).
  mat4 mvp = projectionMatrix * modelViewMatrix * instanceMatrix;
  vec4 c0 = mvp * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 c1 = mvp * vec4(grow, 0.0, 0.0, 1.0);
  vCells = length((c1.xy / c1.w - c0.xy / c0.w) * 0.5 * uRes);
  gl_Position = mvp * vec4(position * vec3(grow, grow, 1.0), 1.0);
}
`;

export const BEAD_FRAG = /* glsl */ `
uniform float uLight;
uniform float uTime;
uniform float uFade;
uniform float uDither;
uniform vec3 uPaper;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vParams;
varying float vCells;
varying float vHover;
${GLSL_THEME_TONE}
${GLSL_LIGHT}
float ringMask(float r, float radius, float thick) { return step(radius - thick, r) * step(r, radius + thick); }
void main() {
  float mode = vParams.y;
  float r = length(vUv);
  float cells = max(vCells, 1.0);
  vec3 c = themeTone(vColor, uLight);
  float a = 0.0;
  if (mode < 0.5 && vHover > 0.5 && ringMask(r, 0.74, 0.5 / cells) > 0.5) {
    // Hover: a one-cell ring just inside the glow's edge, brighter than the glow (darker ink on the light sky).
    vec3 hot = mix(mix(c, vec3(1.0), 0.55), c * 0.45, uLight);
    gl_FragColor = vec4(hot, 0.9 * uFade);
    #include <colorspace_fragment>
    return;
  }
  if (mode < 0.5 || mode > 3.5) {
    // Glow (0) and globular (4): a profile through a two-colour dithered ramp, feathered at the quad edge.
    float p = mode > 3.5 ? sersic(r, 0.4, 1.5) : gaussianBand(r, 0.36);
    p *= 1.0 - smoothstep(0.8, 1.0, r);
    vec3 dim = mix(c * 0.35, mix(c, uPaper, 0.6), uLight);
    vec3 bright = mix(mix(c, vec3(1.0), 0.2), c, uLight);
    vec4 g = glowRamp(clamp(p, 0.0, 1.0), mode > 3.5 ? 3.0 : 4.0, dim, bright, vParams.x, gl_FragCoord.xy, uDither);
    if (g.a <= 0.0) discard;
    gl_FragColor = vec4(g.rgb, g.a * uFade);
    #include <colorspace_fragment>
    return;
  } else if (mode < 1.5) {
    // Core dot: never under ~1.2 cells of radius.
    float dotR = max(vParams.z, 1.2 / cells);
    a = step(r, dotR) * vParams.x;
  } else if (mode < 2.5) {
    // Planet core: dark disc, lit rim on the upper-right (the galaxy's light comes from the bulge side in spirit).
    float disc = step(r, 1.0);
    float rim = ringMask(r, 0.86, max(0.14, 1.0 / cells));
    float lit = step(0.0, vUv.x + vUv.y);
    c = mix(c * 0.22, c, rim * lit);
    a = disc * vParams.x;
  } else {
    // You-are-here ring: at least ~1.4 cells thick; two-step breath every 2.4 s (an opacity change only).
    float thick = max(vParams.z, 0.7 / cells);
    float breath = mix(0.78, 1.0, step(0.5, fract(uTime / 2.4)));
    a = ringMask(r, 0.82, thick) * vParams.x * breath;
  }
  if (a <= 0.002) discard;
  gl_FragColor = vec4(c, a * uFade);
  #include <colorspace_fragment>
}
`;
