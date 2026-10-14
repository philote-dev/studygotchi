import { Vector2 } from "three";

/**
 * Shared uniforms for every exhibit material (by reference, written once per
 * frame by `CosmosComposer`). `uRes` is the pixel pass's low-resolution
 * target in cells, so vertex shaders can snap to the grid the pass samples.
 * Own copy of the space-lab helpers so the other lab can change freely.
 */
export const COSMOS_UNIFORMS = {
  uTime: { value: 0 },
  uRes: { value: new Vector2(640, 400) },
  /** 0 = dark sky (additive glows), 1 = light sky (normal blend, ink tones). */
  uLight: { value: 0 },
};

/** One clock for every exhibit; the composer advances it, `?t=` freezes it. */
export const cosmosClock = {
  seconds: 0,
  speed: 1,
  frozenAt: null as number | null,
  advance(dt: number): void {
    if (this.frozenAt !== null) {
      this.seconds = this.frozenAt;
      return;
    }
    this.seconds += Math.min(dt, 0.1) * this.speed;
  },
};

export const GLSL_COMMON = /* glsl */ `
vec4 snapClip(vec4 clip, vec2 res) {
  vec2 ndc = clip.xy / clip.w;
  vec2 cell = (floor((ndc * 0.5 + 0.5) * res) + 0.5) / res * 2.0 - 1.0;
  return vec4(cell * clip.w, clip.z, clip.w);
}
// Light sky: ink on paper (the product's brightness .56 / saturate 1.45 filter, a touch darker).
vec3 themeTone(vec3 c, float light) {
  vec3 lum = vec3(dot(c, vec3(0.299, 0.587, 0.114)));
  vec3 dark = clamp(mix(lum, c, 1.6) * 0.48, 0.0, 1.0);
  return mix(c, dark, light);
}
// Opaque bodies (planets) keep their pastel on paper, only a little dimmer.
vec3 bodyTone(vec3 c, float light) { return mix(c, c * 0.82, light); }
float band(float x, float n) { return floor(clamp(x, 0.0, 0.9999) * n) / n; }
float twinkle2(float t, float phase) { return step(0.5, fract(t / (3.0 + 4.0 * phase) + phase * 3.0)); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 7.3) + 0.2 * vnoise(p * 4.3 + 19.1); }
float fbm4(vec2 p) { return 0.45 * vnoise(p) + 0.27 * vnoise(p * 2.03 + 5.2) + 0.17 * vnoise(p * 4.11 + 13.7) + 0.11 * vnoise(p * 8.2 + 29.3); }
// Counter-clockwise by a (GLSL mat2 is column-major): matches the JS rotation in the generators.
mat2 rot2(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
float easeOutBack(float t) { float c1 = 1.70158; float c3 = c1 + 1.0; float u = t - 1.0; return 1.0 + c3 * u * u * u + c1 * u * u; }
float easeOutCubic(float t) { float u = 1.0 - t; return 1.0 - u * u * u; }
float easeInCubic(float t) { return t * t * t; }
`;
