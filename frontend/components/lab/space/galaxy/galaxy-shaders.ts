import { GLSL_NOISE, GLSL_SNAP, GLSL_THEME_TONE } from "../lib/lab-uniforms";

/**
 * Galaxy points. Polar orbit attributes in, pixel-snapped clip position out.
 * Mirrors `starPosition()` in galaxy-spec.ts exactly; tests cover the CPU side.
 */
export const GALAXY_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uPattern;
uniform float uV0;
uniform float uACore;
uniform float uB;
uniform float uArms;
uniform float uBarLen;
uniform float uThetaBar;
uniform float uEcc;
uniform float uBarEcc;
uniform float uCells;
uniform float uFade;
uniform vec3 uArmTint;
attribute vec4 orbit;
attribute float kind;
attribute float phase;
varying vec3 vColor;
varying float vAlpha;
${GLSL_SNAP}
${GLSL_THEME_TONE}

float sstep(float lo, float hi, float x) { float t = clamp((x - lo) / (hi - lo), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float thetaAt(float a) {
  if (uBarLen > 0.0) return a < uBarLen ? uThetaBar : uThetaBar + uB * log(a / uBarLen);
  return uThetaBar + uB * log(max(a, 0.18) / 0.18);
}
float eccAt(float a) {
  if (uBarLen <= 0.0) return uEcc;
  return mix(uBarEcc, uEcc, sstep(uBarLen * 0.8, uBarLen * 1.2, a));
}

void main() {
  float a = orbit.x;
  // Companion co-rotates with the pattern; everything else has a flat rotation curve.
  float omega = kind > 3.5 ? uPattern : sign(uPattern) * uV0 / max(a, uACore);
  float psi = orbit.z + omega * uTime;
  float theta = thetaAt(a) + orbit.w + uPattern * uTime;
  float m = (uBarLen > 0.0 && a < uBarLen) ? 2.0 : uArms;
  float e = orbit.y * eccAt(a);
  float X = m * (psi - theta);
  float r = a * (1.0 + e * cos(X));
  // Local orbit crowding, 1 / (dr/da): where neighbouring orbits bunch, the density wave
  // compresses gas and young bright stars form. Brightness follows it, so arms read as arms
  // while every star keeps drifting through them. A function of orbit phase only: no winding.
  float dens = 1.0 / max(0.06, 1.0 + e * cos(X) + e * m * uB * sin(X));
  float armness = clamp((dens - 0.75) / 2.6, 0.0, 1.0);
  vec3 p = vec3(r * cos(psi), position.y, r * sin(psi));
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_Position = snapClip(clip, uRes);
  gl_PointSize = uCells;
  // Two-step twinkle (1.0 / 0.55) with a 3 to 7 s period per bead; never continuous.
  float tw = step(0.5, fract(uTime / (3.0 + 4.0 * phase) + phase));
  bool bead = kind > 1.5 && kind < 2.5;
  bool disc = kind < 0.5;
  bool dust = kind > 0.5 && kind < 1.5;
  float twinkle = bead ? mix(0.55, 1.0, tw) : 1.0;
  vec3 c = color;
  float alpha = uFade;
  if (disc) {
    c = mix(c * 0.45, mix(c, uArmTint, 0.35), armness);
  } else if (bead) {
    // HII beads light up only while inside the arm compression.
    alpha *= step(0.35, armness);
  } else if (dust) {
    alpha *= armness;
  }
  vColor = themeTone(c, uLight) * twinkle;
  vAlpha = alpha;
}
`;

export const POINT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.002) discard;
  gl_FragColor = vec4(vColor, vAlpha);
  #include <colorspace_fragment>
}
`;

/** Star shells: three depths in one draw, 1-cell or 2-cell points, optional plus shape. */
export const STAR_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uFade;
attribute float size;
attribute float phase;
attribute float shape;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
${GLSL_SNAP}
${GLSL_THEME_TONE}
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = snapClip(clip, uRes);
  gl_PointSize = size;
  float tw = step(0.5, fract(uTime / (3.0 + 4.0 * phase) + phase * 3.0));
  float twinkle = size > 1.5 ? mix(0.6, 1.0, tw) : 1.0;
  vColor = themeTone(color, uLight) * twinkle;
  vAlpha = uFade;
  vShape = shape;
}
`;

export const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vec3 c = vColor;
  float a = vAlpha;
  if (vShape > 0.5) {
    // 3x3 plus: centre bright, arms soft, corners empty.
    vec2 q = floor(gl_PointCoord * 3.0);
    bool centre = q.x == 1.0 && q.y == 1.0;
    if (q.x != 1.0 && q.y != 1.0) discard;
    if (!centre) a *= 0.45;
  }
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}
`;

/** Instanced glow quads lying in the disc plane: 4-step banded radial falloff, optional fbm mottle. */
export const GLOW_VERT = /* glsl */ `
attribute vec3 iColor;
attribute vec4 iParams; // alpha, mottle (0/1), seed, unused
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vParams;
void main() {
  vUv = uv * 2.0 - 1.0;
  vColor = iColor;
  vParams = iParams;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

export const GLOW_FRAG = /* glsl */ `
uniform float uLight;
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vParams;
${GLSL_NOISE}
${GLSL_THEME_TONE}
void main() {
  float r = length(vUv);
  float fall = 1.0 - smoothstep(0.0, 1.0, r);
  if (vParams.y > 0.5) {
    float n = fbm3(vUv * 2.6 + vParams.z * 13.7 + uTime * 0.004);
    fall *= 0.35 + 1.1 * n;
  }
  float band = floor(clamp(fall, 0.0, 0.999) * 4.0) / 4.0;
  if (band <= 0.0) discard;
  gl_FragColor = vec4(themeTone(vColor, uLight), band * vParams.x);
  #include <colorspace_fragment>
}
`;

/** Far Milky Way band: low-contrast cream strip with brown dust bites, drifting 260 s. */
export const BAND_FRAG = /* glsl */ `
uniform float uLight;
uniform float uTime;
uniform float uFade;
uniform vec3 uCream;
uniform vec3 uDust;
varying vec2 vUv;
${GLSL_NOISE}
${GLSL_THEME_TONE}
void main() {
  vec2 p = vUv * vec2(6.0, 1.0) + vec2(uTime / 260.0, 0.0);
  float band = exp(-pow((vUv.y - 0.5) / 0.16, 2.0));
  float n = fbm3(p * 2.0);
  float dust = smoothstep(0.55, 0.75, fbm3(p * 3.0 + 31.0));
  float alpha = band * (0.5 + 0.5 * n) * uFade;
  alpha = floor(alpha * 5.0) / 5.0;
  if (alpha <= 0.0) discard;
  vec3 c = mix(uCream, uDust, dust * 0.8);
  gl_FragColor = vec4(themeTone(c, uLight), alpha);
  #include <colorspace_fragment>
}
`;

export const BAND_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
