import { Vector2 } from "three";

/**
 * Uniforms every lab material shares by reference. The composer writes them
 * once per frame; materials never allocate. `uRes` is the pixel pass's
 * low-resolution target size, so "one cell" is one texel of that target and
 * vertex shaders can snap to the grid the pass will sample.
 */
export const LAB_UNIFORMS = {
  uTime: { value: 0 },
  uRes: { value: new Vector2(640, 360) },
  /** 0 = dark sky (additive), 1 = light sky (normal blend, darkened palette). */
  uLight: { value: 0 },
};

export type LabTheme = "dark" | "light";

/** Snap-to-grid helper shared by every point shader (GLSL). */
export const GLSL_SNAP = /* glsl */ `
vec4 snapClip(vec4 clip, vec2 res) {
  vec2 ndc = clip.xy / clip.w;
  vec2 cell = (floor((ndc * 0.5 + 0.5) * res) + 0.5) / res * 2.0 - 1.0;
  return vec4(cell * clip.w, clip.z, clip.w);
}
`;

/** Light-theme tone: the product's CSS filter (brightness .56, saturate 1.45), pushed a little darker for ink on paper. */
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
`;
