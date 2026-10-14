import * as THREE from "three";

export type StageTheme = "dark" | "light";

/**
 * Uniforms every stage material shares by reference; the composer writes them
 * once per frame and materials never allocate. `uRes` is the pixel pass's
 * low-resolution target in cells, so vertex shaders can snap to the grid the
 * pass samples (one point = one cell). Ported from the labs' LAB_UNIFORMS /
 * COSMOS_UNIFORMS so the product no longer depends on lab files.
 */
export const STAGE_UNIFORMS = {
  uTime: { value: 0 },
  uRes: { value: new THREE.Vector2(720, 450) },
  /** 0 = dark sky (additive light), 1 = light sky (ink on paper, normal blend). */
  uLight: { value: 0 },
  /**
   * Device px per cell of the target the native path draws into: the galaxy's
   * point sizes are authored in cells, and at device resolution one cell is
   * this many pixels (the pixel path's targets are in cells, so they never
   * read it). The composer writes it with `uRes` every frame.
   */
  uCellPx: { value: 2 },
};

/**
 * One clock for the whole stage. Starts on wall time (like `skyClockMs`) so a
 * reload lands mid-motion instead of at a fresh phase; the composer advances it.
 */
export const stageClock = {
  seconds: (Date.now() / 1000) % 86400,
  advance(dt: number): void {
    this.seconds += Math.min(dt, 0.1);
  },
};

/** Snap a clip-space position to the centre of its low-res cell. */
export const GLSL_SNAP = /* glsl */ `
vec4 snapClip(vec4 clip, vec2 res) {
  vec2 ndc = clip.xy / clip.w;
  vec2 cell = (floor((ndc * 0.5 + 0.5) * res) + 0.5) / res * 2.0 - 1.0;
  return vec4(cell * clip.w, clip.z, clip.w);
}
`;

/** Light sky: the product's spiral filter (brightness .56, saturate 1.45), pushed a little darker for ink on paper. */
export const GLSL_THEME_TONE = /* glsl */ `
vec3 themeTone(vec3 c, float light) {
  vec3 lum = vec3(dot(c, vec3(0.299, 0.587, 0.114)));
  vec3 dark = clamp(mix(lum, c, 1.6) * 0.48, 0.0, 1.0);
  return mix(c, dark, light);
}
`;

export const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 7.3) + 0.2 * vnoise(p * 4.3 + 19.1); }
float fbm4(vec2 p) { return 0.45 * vnoise(p) + 0.27 * vnoise(p * 2.03 + 5.2) + 0.17 * vnoise(p * 4.11 + 13.7) + 0.11 * vnoise(p * 8.2 + 29.3); }
float band(float x, float n) { return floor(clamp(x, 0.0, 0.9999) * n) / n; }
mat2 rot2(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
`;

/**
 * Light module, ported from the cosmos lab's shared/light: physically shaped
 * profiles (Sérsic bulge, Gaussian band) quantised through a few palette
 * steps with an 8x8 Bayer dither read in pixel-cell space, so one dither dot
 * is one cell of the 2 px grid and nothing shows a hard contour.
 */
export const GLSL_LIGHT = /* glsl */ `
float bSersic(float n) { return 2.0 * n - 1.0 / 3.0 + 4.0 / (405.0 * n); }
float sersic(float r, float re, float n) { return exp(-bSersic(n) * pow(max(r, 0.0) / re, 1.0 / n)); }
float gaussianBand(float d, float sigma) { return exp(-0.5 * d * d / (sigma * sigma)); }
float bayer8(vec2 cell) {
  vec2 p = mod(floor(cell), 8.0);
  float v = 0.0;
  float mul = 16.0;
  float bit = 1.0;
  for (int i = 0; i < 3; i++) {
    float bx = mod(floor(p.x / bit), 2.0);
    float by = mod(floor(p.y / bit), 2.0);
    float bxy = mod(bx + by, 2.0);
    v += (bxy * 2.0 + by) * mul;
    mul /= 4.0;
    bit *= 2.0;
  }
  return (v + 0.5) / 64.0;
}
float ditherQuantize(float v, float steps, vec2 cell) {
  return floor(clamp(v, 0.0, 1.0) * steps + bayer8(cell)) / steps;
}
`;

export const GLSL_COMMON = GLSL_SNAP + GLSL_THEME_TONE + GLSL_NOISE + GLSL_LIGHT;

/**
 * Blending for the transparent stage target. Dark sky: light adds (colour
 * SrcAlpha/One, alpha One/One so coverage accumulates). Light sky: ink over
 * paper (three's NormalBlending, which leaves a premultiplied result in the
 * target). The composer unpremultiplies before encoding to sRGB.
 */
export function applySkyBlend(material: THREE.Material, theme: StageTheme): void {
  if (theme === "dark") {
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrc = THREE.SrcAlphaFactor;
    material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneFactor;
  } else {
    material.blending = THREE.NormalBlending;
  }
  material.needsUpdate = true;
}
