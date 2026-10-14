/**
 * Shaders for the outer-zone map. Everything snaps to the pixel-pass cell grid
 * (one cell = one texel of the RenderPixelatedPass target), alpha is banded,
 * twinkle is two-step, and the light theme runs through the same tone as the
 * space lab (`themeTone`). Read-only imports from the space lab.
 */
import { GLSL_NOISE, GLSL_SNAP, GLSL_THEME_TONE } from "../../space/lib/lab-uniforms";

/** Grain points: disc stars, dust, bulge, halo globular and satellite stars. */
export const POINTS_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uAlpha;
attribute float size;
attribute float phase;
attribute float dim;
varying vec3 vColor;
varying float vAlpha;
${GLSL_SNAP}
${GLSL_THEME_TONE}
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = snapClip(clip, uRes);
  gl_PointSize = size;
  // Two-step twinkle only on the big cells, 3 to 7 s periods, phase per point.
  float tw = step(0.5, fract(uTime / (3.0 + 4.0 * phase) + phase * 5.0));
  float twinkle = size > 1.5 ? mix(0.6, 1.0, tw) : 1.0;
  vColor = themeTone(color, uLight) * twinkle;
  vAlpha = uAlpha * dim;
}
`;

export const POINTS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.002) discard;
  gl_FragColor = vec4(vColor, vAlpha);
  #include <colorspace_fragment>
}
`;

/**
 * Instanced quads. `iParams` = (alpha, mode, p0, p1), `iPhase` a per-instance seed.
 * Modes:
 *   0 glow (4-band radial)          1 ring (p0 = thickness)      2 dashed ring (hover)
 *   3 planet core (dark disc, rim)  4 oval smudge (p0 aspect, p1 angle)
 *   5 dot smudge (blue, light rim)  6 streak smudge (p1 angle)   7 satellite bar (p0 aspect)
 *  10 black hole  11 nebula  12 pulsar  13 comet (p1 heading)  14 binary  15 ringed giant
 *  16 white hole  17 supernova remnant
 * `uBillboard` 1 faces the camera (halo, deep field); 0 lies in the parent's plane (disc).
 */
export const QUAD_VERT = /* glsl */ `
uniform float uBillboard;
attribute vec3 iColor;
attribute vec4 iParams;
attribute float iPhase;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vParams;
varying float vPhase;
void main() {
  vUv = uv * 2.0 - 1.0;
  vColor = iColor;
  vParams = iParams;
  vPhase = iPhase;
  if (uBillboard > 0.5) {
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float sx = length(instanceMatrix[0].xyz);
    float sy = length(instanceMatrix[1].xyz);
    mv.xy += position.xy * vec2(sx, sy);
    gl_Position = projectionMatrix * mv;
  } else {
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
}
`;

export const QUAD_FRAG = /* glsl */ `
uniform float uLight;
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vParams;
varying float vPhase;
${GLSL_NOISE}
${GLSL_THEME_TONE}

float band4(float x) { return floor(clamp(x, 0.0, 0.999) * 4.0) / 4.0; }
float ringMask(float r, float radius, float thick) { return step(radius - thick, r) * step(r, radius + thick); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  float mode = vParams.y;
  float p0 = vParams.z;
  float p1 = vParams.w;
  vec2 q = vUv;
  float r = length(q);
  vec3 c = vColor;
  float a = 0.0;
  // Two-step blink shared by the lively glyphs.
  float blink = step(0.5, fract(uTime / (2.6 + 2.0 * vPhase) + vPhase));

  if (mode < 0.5) {
    // glow
    a = band4(1.0 - smoothstep(0.0, 1.0, r)) * vParams.x;
  } else if (mode < 1.5) {
    // ring
    a = ringMask(r, 0.82, p0) * vParams.x;
  } else if (mode < 2.5) {
    // dashed ring: 12 dashes, slow crawl
    float ang = atan(q.y, q.x) + uTime * 0.6;
    float dash = step(0.5, fract(ang * 12.0 / 6.2832));
    a = ringMask(r, 0.82, p0) * dash * vParams.x;
  } else if (mode < 3.5) {
    // planet core: dark disc with a lit rim and one terminator side
    float disc = step(r, 1.0);
    float rim = ringMask(r, 0.86, 0.14);
    float lit = step(0.0, q.x + q.y);
    c = mix(c * 0.22, c, rim * lit);
    a = disc * vParams.x;
  } else if (mode < 4.5) {
    // oval smudge: warm elliptical, two bands
    vec2 e = rot(p1) * q;
    e.y /= max(p0, 0.3);
    float rr = length(e);
    a = floor(clamp(1.0 - rr, 0.0, 0.999) * 2.0) / 2.0 * vParams.x;
  } else if (mode < 5.5) {
    // dot smudge: blue dot with a lighter rim
    c = mix(c, vec3(0.93, 0.96, 1.0), ringMask(r, 0.7, 0.3));
    a = step(r, 1.0) * vParams.x;
  } else if (mode < 6.5) {
    // streak smudge: edge-on galaxy
    vec2 e = rot(p1) * q;
    a = step(abs(e.y), 0.22) * step(abs(e.x), 1.0) * vParams.x;
  } else if (mode < 7.5) {
    // satellite bar: a soft pink ellipse
    vec2 e = q;
    e.y /= max(p0, 0.25);
    a = band4(1.0 - smoothstep(0.0, 1.0, length(e))) * vParams.x;
  } else if (mode < 10.5) {
    // black hole: shadow, gold photon ring, banded disc with one bright side
    if (r < 0.38) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    float ring = ringMask(r, 0.42, 0.03);
    float inDisc = step(0.46, r) * step(r, 1.0);
    float bandI = floor((r - 0.46) / 0.18);
    vec3 disc = bandI < 0.5 ? c : bandI < 1.5 ? c * 0.72 : c * 0.4;
    float doppler = 0.55 + 0.45 * cos(atan(q.y, q.x) - 0.6 + uTime * 0.05);
    vec3 col = ring * vec3(1.0, 0.83, 0.42) + inDisc * disc * doppler;
    a = (ring + inDisc * band4(1.0 - smoothstep(0.5, 1.0, r))) * vParams.x;
    c = col;
  } else if (mode < 11.5) {
    // nebula: mottled 3-octave pocket, banded
    float n = fbm3(q * 2.4 + vPhase * 17.0 + uTime * 0.01);
    float fall = (1.0 - smoothstep(0.1, 1.0, r)) * (0.35 + 1.1 * n);
    a = band4(fall) * vParams.x;
    // one cream heart
    c = mix(c, vec3(1.0, 0.96, 0.88), step(fall, 0.3) * 0.0 + step(0.78, fall));
  } else if (mode < 12.5) {
    // pulsar: dot plus two beams that blink
    float dot = step(r, 0.22);
    vec2 e = rot(0.6) * q;
    float beam = step(abs(e.x), 0.08) * step(abs(e.y), 1.0) * blink;
    a = max(dot, beam * 0.7) * vParams.x;
  } else if (mode < 13.5) {
    // comet: head plus a tail pointing away from the heading
    vec2 e = rot(-p1) * q;
    float head = step(length(e - vec2(0.45, 0.0)), 0.22);
    float tail = step(e.x, 0.45) * step(-1.0, e.x) * step(abs(e.y), 0.12 * (e.x + 1.0) / 1.45 + 0.02);
    a = max(head, tail * 0.55) * vParams.x;
  } else if (mode < 14.5) {
    // binary: two dots waltzing
    float t = uTime / 6.0 + vPhase * 6.2832;
    vec2 o = vec2(cos(t), sin(t)) * 0.5;
    float d1 = step(length(q - o), 0.24);
    float d2 = step(length(q + o), 0.18);
    c = mix(c, vec3(1.0, 0.85, 0.6), d2);
    a = max(d1, d2) * vParams.x;
  } else if (mode < 15.5) {
    // ringed giant: disc plus a tilted ring
    float disc = step(r, 0.45);
    vec2 e = rot(0.5) * q;
    e.y /= 0.32;
    float ring = ringMask(length(e), 0.85, 0.1) * (1.0 - disc * step(e.y, 0.0));
    c = mix(c, vec3(0.78, 0.86, 0.96), ring);
    a = max(disc, ring) * vParams.x;
  } else if (mode < 16.5) {
    // white hole: cream disc, dark ring, four rays
    float disc = step(r, 0.36);
    float ring = ringMask(r, 0.46, 0.05);
    float rays = step(abs(q.x), 0.06) + step(abs(q.y), 0.06);
    rays *= step(0.5, r) * step(r, 1.0) * blink;
    c = mix(mix(c, vec3(0.1, 0.09, 0.16), ring), c, rays);
    a = max(max(disc, ring), rays * 0.6) * vParams.x;
  } else {
    // supernova remnant: dashed shell plus a few filament cells
    float ang = atan(q.y, q.x);
    float dash = step(0.5, fract(ang * 9.0 / 6.2832 + vPhase));
    float shell = ringMask(r, 0.85, 0.08) * dash;
    float fil = step(0.86, fbm3(q * 5.0 + vPhase * 9.0)) * step(r, 0.8);
    a = max(shell * 0.8, fil) * vParams.x;
  }
  // Normal blending on paper loses the soft glows; lift them so ribbons and halos still read as ink washes.
  if (mode < 0.5 || (mode > 6.5 && mode < 7.5)) a = min(1.0, a * (1.0 + 0.9 * uLight));
  if (a <= 0.002) discard;
  gl_FragColor = vec4(themeTone(c, uLight), a);
  #include <colorspace_fragment>
}
`;
