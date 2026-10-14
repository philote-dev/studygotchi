import { Vector2 } from "three";

export type GravityTheme = "dark" | "light";

/**
 * Uniforms every gravity material shares by reference; the composer writes
 * them once per frame. `uRes` is the pixel pass's low-resolution target in
 * cells, so "one cell" is one texel and point shaders snap to that grid.
 */
export const GRAVITY_UNIFORMS = {
  uTime: { value: 0 },
  uRes: { value: new Vector2(640, 360) },
  /** 0 = dark sky (additive stars), 1 = light sky (ink stars, normal blend). */
  uLight: { value: 0 },
};

/** Snap a clip-space position to the centre of the low-res cell it falls in. */
export const GLSL_SNAP = /* glsl */ `
vec4 snapClip(vec4 clip, vec2 res) {
  vec2 ndc = clip.xy / clip.w;
  vec2 cell = (floor((ndc * 0.5 + 0.5) * res) + 0.5) / res * 2.0 - 1.0;
  return vec4(cell * clip.w, clip.z, clip.w);
}
`;

/** Light-theme tone: the product's CSS filter (brightness .56, saturate 1.45) pushed darker for ink on paper. */
export const GLSL_THEME_TONE = /* glsl */ `
vec3 themeTone(vec3 c, float light) {
  vec3 lum = vec3(dot(c, vec3(0.299, 0.587, 0.114)));
  vec3 dark = clamp(mix(lum, c, 1.6) * 0.48, 0.0, 1.0);
  return mix(c, dark, light);
}
`;

export const GLSL_HASH = /* glsl */ `
float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453123); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
`;

/** Quantise 0..1 into `steps` bands (banded glows instead of bloom). */
export const GLSL_BAND = /* glsl */ `
float band(float x, float steps) { return floor(clamp(x, 0.0, 0.9999) * steps) / (steps - 1.0); }
`;
