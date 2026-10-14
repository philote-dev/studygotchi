import { GLSL_COMMON } from "../../lib/uniforms";

/**
 * Grain points: the star field (three parallax depths, slow NDC drift with
 * wrap, two-step twinkle on 3x3 plus stars) and the far objects' crisp bits
 * (cluster stars, dwarfs, sparkles) in ONE draw. `drift` is 0 for anything
 * that must stay put. Ported from the space lab's STAR_VERT / STAR_FRAG.
 */
export const POINTS_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
uniform float uCellPx;
uniform float uLight;
uniform float uDrift;
attribute float size;
attribute float alpha;
attribute float phase;
attribute float shape;
attribute float drift;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
${GLSL_COMMON}
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  if (drift > 0.0) {
    // Stars were laid over ndc x in [-1.1, 1.1]; drift along x and wrap in that range, near layers faster.
    vec2 ndc = clip.xy / clip.w;
    ndc.x = mod(ndc.x + uDrift * uTime * drift + 1.1, 2.2) - 1.1;
    clip.xy = ndc * clip.w;
  }
  gl_Position = snapClip(clip, uRes);
  gl_PointSize = size * uCellPx;
  // Two-step twinkle (1.0 / 0.6) with a 3 to 7 s period per star; never continuous.
  float tw = step(0.5, fract(uTime / (3.0 + 4.0 * phase) + phase * 3.0));
  float twinkle = size > 1.5 ? mix(0.6, 1.0, tw) : 1.0;
  vColor = color * twinkle;
  vAlpha = alpha;
  vShape = shape;
}
`;

export const POINTS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  if (vAlpha <= 0.002) discard;
  float a = vAlpha;
  if (vShape > 0.5) {
    // 3x3 plus: centre bright, arms soft, corners empty.
    vec2 q = floor(gl_PointCoord * 3.0);
    bool centre = q.x == 1.0 && q.y == 1.0;
    if (q.x != 1.0 && q.y != 1.0) discard;
    if (!centre) a *= 0.45;
  }
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

/**
 * Far galaxy hint: polar orbit attributes in, pixel-snapped clip position out.
 * The spiral PATTERN turns rigidly at the pattern speed (a density wave); each
 * star rides an m-fold perturbed orbit with a flat rotation curve, so stars
 * stream through the arms and the arms trail the spin without winding up.
 * Trimmed from the space lab's GALAXY_VERT (no bar, no dust lane).
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
uniform float uThetaBar;
uniform float uEcc;
uniform float uFade;
uniform vec3 uArmTint;
attribute vec4 orbit;
attribute float kind;
attribute float phase;
varying vec3 vColor;
varying float vAlpha;
${GLSL_COMMON}
float thetaAt(float a) { return uThetaBar + uB * log(max(a, 0.18) / 0.18); }
void main() {
  float a = orbit.x;
  float omega = sign(uPattern) * uV0 / max(a, uACore);
  float psi = orbit.z + omega * uTime;
  float theta = thetaAt(a) + orbit.w + uPattern * uTime;
  float e = orbit.y * uEcc;
  float X = uArms * (psi - theta);
  float r = a * (1.0 + e * cos(X));
  // Orbit crowding 1 / (dr/da): where neighbouring orbits bunch, young bright stars form.
  float dens = 1.0 / max(0.06, 1.0 + e * cos(X) + e * uArms * uB * sin(X));
  float armness = clamp((dens - 0.75) / 2.6, 0.0, 1.0);
  vec3 p = vec3(r * cos(psi), position.y, r * sin(psi));
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_Position = snapClip(clip, uRes);
  gl_PointSize = 1.0;
  float tw = step(0.5, fract(uTime / (3.0 + 4.0 * phase) + phase));
  bool bead = kind > 1.5 && kind < 2.5;
  bool disc = kind < 0.5;
  vec3 c = color;
  float alpha = uFade;
  if (disc) {
    // Inter-arm stars dim and sparse, arm stars bright and tinted toward the tips: the arms read.
    c = mix(c * 0.28, mix(c, uArmTint, 0.4) * 1.15, armness);
    alpha *= mix(0.42, 1.0, armness);
  } else if (bead) {
    // HII beads light up only while inside the arm compression.
    alpha *= step(0.35, armness);
    c *= mix(0.55, 1.0, tw);
  }
  vColor = themeTone(c, uLight);
  vAlpha = alpha;
}
`;

export const GALAXY_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.002) discard;
  gl_FragColor = vec4(vColor, vAlpha);
  #include <colorspace_fragment>
}
`;

/** Instanced quad kinds (`iKind`). */
export const QUAD_KIND = { ellipse: 0, arc: 1, nebula: 2, planetary: 3, clusterHaze: 4, bulge: 5 } as const;

/**
 * The soft part of every far object in ONE instanced draw: the `vUv` box is
 * -1..1, `iKind` picks the recipe, `iParams` = (alpha, p0, p1, seed),
 * `iParams2` recipe-specific, `iC0..iC3` the palette. Every glow is banded or
 * dithered in cell space, never a smooth gradient, so it survives the pixel
 * pass as grain instead of mush. Recipes ported from the cosmos objects lab
 * (LensedSmudges, EmissionNebula cloud layer, PlanetaryNebula ring, StarCluster
 * haze) and the galaxy bulge glow.
 */
export const QUAD_VERT = /* glsl */ `
attribute float iKind;
attribute vec4 iParams;
attribute vec4 iParams2;
attribute vec3 iC0;
attribute vec3 iC1;
attribute vec3 iC2;
attribute vec3 iC3;
varying vec2 vUv;
varying float vKind;
varying vec4 vParams;
varying vec4 vParams2;
varying vec3 vC0, vC1, vC2, vC3;
void main() {
  vUv = uv * 2.0 - 1.0;
  vKind = iKind;
  vParams = iParams;
  vParams2 = iParams2;
  vC0 = iC0; vC1 = iC1; vC2 = iC2; vC3 = iC3;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

export const QUAD_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec2 uRes;
uniform float uLight;
uniform float uFade;
// 1 = live, 0 = prefers-reduced-motion: clouds stop drifting, shells stop breathing.
uniform float uMotion;
varying vec2 vUv;
varying float vKind;
varying vec4 vParams;
varying vec4 vParams2;
varying vec3 vC0, vC1, vC2, vC3;
${GLSL_COMMON}

vec3 ramp4(float k, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
  return k < 0.34 ? mix(c0, c1, k / 0.34) : (k < 0.67 ? mix(c1, c2, (k - 0.34) / 0.33) : mix(c2, c3, (k - 0.67) / 0.33));
}
vec3 ramp3(float k, vec3 c0, vec3 c1, vec3 c2) {
  return k < 0.5 ? mix(c0, c1, k * 2.0) : mix(c1, c2, (k - 0.5) * 2.0);
}

void main() {
  vec2 p = vUv;
  float alphaMax = vParams.x;
  float seed = vParams.w;
  vec3 c = vC0;
  float a = 0.0;

  if (vKind < 0.5) {
    // Tilted ellipse smudge: two bands, a one-cell warm core.
    float r = length(p / vec2(1.0, vParams.y));
    float lvl = band((1.0 - smoothstep(0.1, 1.0, r)) * 1.1, 3.0);
    if (lvl <= 0.0) discard;
    a = (0.3 + 0.4 * lvl) * alphaMax;
    if (r < 0.2) c = vC3;
  } else if (vKind < 1.5) {
    // Lensed arc: a thin partial ring, span vParams.y radians, bent around an unseen mass.
    float r = length(p);
    float th = atan(p.y, p.x);
    float inRing = step(abs(r - 0.78), 0.14);
    float inSpan = step(abs(th), vParams.y * 0.5);
    float soft = 1.0 - smoothstep(vParams.y * 0.3, vParams.y * 0.5, abs(th));
    float lvl = band(inRing * inSpan * (0.5 + 0.6 * soft) * (1.0 - smoothstep(0.08, 0.14, abs(r - 0.78))), 2.0);
    if (lvl <= 0.0) discard;
    a = (0.35 + 0.35 * lvl) * alphaMax;
  } else if (vKind < 2.5) {
    // Emission nebula cloud (one painted layer): warped fbm with a ridged octave, a lumpy
    // silhouette leaning toward the heart, a dust lane, dithered into 4 palette steps.
    float t = uTime * vParams2.z * uMotion;
    float freq = vParams.y;
    float warp = vParams.z;
    vec2 heart = vParams2.xy;
    vec2 q = p * freq + seed;
    q += vec2(0.011, -0.007) * t;
    vec2 w = vec2(fbm3(q * 0.7 + vec2(0.0, t * 0.03)), fbm3(q * 0.7 + vec2(5.2, 1.3) - t * 0.02)) - 0.5;
    float n0 = fbm4(q + warp * w);
    float ridge = 1.0 - abs(2.0 * fbm3(q * 1.3 + 11.0 + warp * w.yx) - 1.0);
    float n = mix(n0, ridge, 0.3);
    float nb = 4.0;
    float lump = (fbm3(p * 1.8 + seed * 3.1 + w * 0.5) - 0.5) * 0.3;
    vec2 pe = p - heart * 0.35 + w * 0.25;
    float rr = length(pe * vec2(1.0, vParams2.w)) + lump;
    float mask = 1.0 - smoothstep(0.2, 1.05, rr);
    float h = 1.0 - smoothstep(0.0, 0.3, length(p - heart));
    float d = clamp(smoothstep(0.22, 0.85, n) * 1.2 * mask + h * h * 0.3, 0.0, 1.0);
    float lane = smoothstep(0.57, 0.63, fbm3(q * 1.6 + vec2(31.0, 17.0) + w * 0.8)) * smoothstep(0.15, 0.4, d) * (1.0 - h);
    float lvl = ditherQuantize(d, nb, gl_FragCoord.xy);
    if (lvl <= 0.0) discard;
    float k = (lvl * nb - 1.0) / (nb - 1.0);
    // The heart stays a warm tint of the bright step, not a white plate: this is a far backdrop.
    c = ramp4(k, vC0, vC1, vC2, mix(vC2, vC3, 0.55));
    c = mix(c, vC0 * 0.35, lane * 0.7);
    // One painted layer (no stacking), so the alpha ramp is gentler than the lab's three-layer cloud.
    a = (0.3 + 0.7 * k * k) * alphaMax * (1.0 - lane * 0.45);
  } else if (vKind < 3.5) {
    // Planetary nebula shell (ring form): faint inner fill, a yellow-green / orange / red ring with
    // radial streaks and coarse grain quantised to three levels, breathing a cell or two.
    float breath = 1.0 + 0.035 * uMotion * sin(uTime * 6.2832 / 8.0 + vParams.z);
    vec2 pp = p / breath;
    float mottle = (fbm3(pp * 3.5 + seed) - 0.5) * 0.06;
    float s = length(pp / vec2(1.0, vParams.y)) * 1.7 + mottle * 2.0;
    float th = atan(pp.y, pp.x);
    float streak = fbm3(vec2(th * 2.5, s * 2.0) + seed);
    float grain = fbm3(pp * 5.0 + seed * 2.0);
    float g = band(0.3 + 0.4 * streak + 0.5 * grain, 3.0) + 0.34;
    if (s < 0.62) { c = vC0; a = 0.26 * (0.5 + 0.5 * band(1.0 - s / 0.62, 2.0)) * (0.5 + 0.5 * band(grain * 1.2, 2.0)); }
    else if (s < 0.72) { c = vC1; a = 0.55 * g; }
    else if (s < 0.84) { c = vC2; a = 0.6 * g; }
    else if (s < 0.92) { c = vC3; a = 0.5 * g; }
    else if (s < 1.05) { c = vC3; a = 0.14 * g; }
    a *= alphaMax;
  } else if (vKind < 4.5) {
    // Open-cluster reflection haze: streaky fbm wisps wrapped around the three brightest stars.
    vec2 s0 = vParams2.xy;
    vec2 s1 = vParams2.zw;
    vec2 s2 = vParams.yz;
    float h = max(gaussianBand(length(p - s0), 0.2), max(gaussianBand(length(p - s1), 0.17), gaussianBand(length(p - s2), 0.17)));
    vec2 sp = vec2(p.x * 1.4 + p.y * 1.1, p.y * 1.2 - p.x * 0.5);
    float streak = fbm3(sp * 3.2 + seed) * 0.6 + 0.4 * fbm3(sp * 7.0 + 3.0 + seed);
    float prof = smoothstep(0.38, 0.75, streak) * h;
    float q = ditherQuantize(prof, 4.0, gl_FragCoord.xy);
    if (q <= 0.0) discard;
    c = ramp3((q * 4.0 - 1.0) / 3.0, vC0, vC1, vC2);
    a = alphaMax * q;
  } else {
    // Galaxy bulge: a Sérsic (n = 2) glow dithered into 5 steps, feathered at the rim.
    float r = length(p);
    float prof = sersic(r, 0.32, 2.0) * (1.0 - smoothstep(0.7, 1.0, r));
    float q = ditherQuantize(prof, 5.0, gl_FragCoord.xy);
    if (q <= 0.0) discard;
    c = ramp3((q * 5.0 - 1.0) / 4.0, vC0, vC1, vC2);
    a = alphaMax * q;
  }
  if (a <= 0.01) discard;
  gl_FragColor = vec4(themeTone(c, uLight), a * uFade);
  #include <colorspace_fragment>
}
`;
