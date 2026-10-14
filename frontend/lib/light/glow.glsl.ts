/**
 * lib/light: the shared light + gradient module (moved from the cosmos lab's
 * `shared/light`; shared by the galaxy, the space objects and gravity).
 *
 * One light language for every soft object: a physically shaped brightness
 * profile (Sérsic bulge, exponential disc, Gaussian band) mapped through 3–8
 * palette steps with ORDERED DITHERING in pixel-cell space, instead of hard
 * concentric bands. The dither threshold is read from `gl_FragCoord.xy` of the
 * pixel-pass target, so one dither dot is one cell of the 2 px grid and the
 * pattern is stable under the pass (Obra Dinn's rule: dots 1:1 with output
 * pixels).
 *
 * Profiles (all normalised to 1 at the centre):
 *   sersic(r, re, n)       I = exp(-b_n (r/re)^(1/n)), b_n = 2n - 1/3 + 4/(405n)
 *                          (Ciotti & Bertin 1999); n = 4 is de Vaucouleurs,
 *                          n = 1 the exponential, n = 0.5 a Gaussian.
 *   expDisc(r, h)          I = exp(-r/h), the spiral disc law (scale length h).
 *   gaussianBand(d, s)     exp(-d^2 / 2 s^2): a spiral arm's cross-section in
 *                          the arm-normal coordinate d.
 * Dither:
 *   bayer(cell, n)         n x n Bayer threshold in [0,1), n = 2, 4, 8.
 *   ign(cell)              interleaved gradient noise (Jimenez 2014): a texture-
 *                          free blue-noise-like threshold.
 *   ditherQuantize(v, steps, cell, mode)
 *                          floor(v * steps + threshold) / steps. mode 0 = plain
 *                          rounding (hard bands), 1 = Bayer 4, 2 = Bayer 8,
 *                          3 = IGN. The spatial mean of the result equals v.
 *   glowSprite(p, steps, pal[8], alphaMax, cell, mode)
 *                          profile -> dithered palette step + alpha ramp.
 *   glowRamp(p, steps, dim, bright, alphaMax, cell, mode)
 *                          same with a two-colour ramp (for instanced sprites).
 *
 * To adopt it in a material:
 *   1. include `${GLSL_LIGHT}` in the fragment shader and spread
 *      `glowUniforms({ anchors, steps, alphaMax, mode })` into `uniforms`;
 *   2. compute a profile `p` in [0, 1] from your geometry (`sersic(r, re, n)`,
 *      `expDisc(r, h)`, `gaussianBand(d, sigma)`);
 *   3. output `glowSprite(p, uSteps, uPal, uAlphaMax, gl_FragCoord.xy, uDither)`
 *      (or `glowRamp(p, steps, dim, bright, ...)` for instanced sprites with a
 *      per-instance colour).
 * Always pass `gl_FragCoord.xy` of the pixel-pass target so one dither dot is
 * one cell and the pattern is stable under the 2 px pass; pick `mode` `bayer8`
 * by default (Philote accepted the Bayer grid), `ign` for a blue-noise-like
 * grain, `bands` to see the old look. On the light theme call
 * `setGlowRamp(uniforms, inkAnchors, steps)` and switch to `NormalBlending`.
 *
 * Rules: profiles are normalised to 1 at the centre; never add a bloom pass;
 * keep steps <= 8; feather any edge with the profile, not a `step()`, so the
 * dither fades it.
 *
 * The TS mirrors below exist for tests and CPU-side use (e.g. placing beads
 * where a profile crosses a threshold). `light.test.ts` checks monotonic
 * profiles, the Bayer matrices and that dithering preserves the mean.
 *
 * Note: `components/stage/lib/uniforms.ts` carries a reduced `GLSL_LIGHT`
 * (Bayer 8 only, three-argument `ditherQuantize`) inside its `GLSL_COMMON`.
 * Never include both in one shader; galaxy materials take `GLSL_SNAP`,
 * `GLSL_THEME_TONE` and `GLSL_NOISE` from there and the light chunk from here.
 */
import { Color } from "three";

export const DITHER_MODE = { bands: 0, bayer4: 1, bayer8: 2, ign: 3 } as const;
export type DitherMode = keyof typeof DITHER_MODE;
export const DITHER_MODES = Object.keys(DITHER_MODE) as DitherMode[];
/** The accepted default everywhere: the 8x8 Bayer grid. `ign` stays selectable. */
export const DEFAULT_DITHER_MODE: DitherMode = "bayer8";
/** Palette steps are passed as a fixed-size uniform array. */
export const MAX_GLOW_STEPS = 8;

export const GLSL_LIGHT = /* glsl */ `
float bSersic(float n) { return 2.0 * n - 1.0 / 3.0 + 4.0 / (405.0 * n); }
float sersic(float r, float re, float n) { return exp(-bSersic(n) * pow(max(r, 0.0) / re, 1.0 / n)); }
float expDisc(float r, float h) { return exp(-max(r, 0.0) / h); }
float gaussianBand(float d, float sigma) { return exp(-0.5 * d * d / (sigma * sigma)); }

// n x n Bayer threshold (n a power of two, up to 8) by bit interleaving of (x xor y, y),
// most significant digit from the least significant position bit. Returns (index + 0.5) / n^2.
float bayer(vec2 cell, float n) {
  vec2 p = mod(floor(cell), n);
  float v = 0.0;
  float mul = n * n / 4.0;
  float bit = 1.0;
  for (int i = 0; i < 3; i++) {
    if (bit >= n) break;
    float bx = mod(floor(p.x / bit), 2.0);
    float by = mod(floor(p.y / bit), 2.0);
    float bxy = mod(bx + by, 2.0);
    v += (bxy * 2.0 + by) * mul;
    mul /= 4.0;
    bit *= 2.0;
  }
  return (v + 0.5) / (n * n);
}
// Interleaved gradient noise (Jimenez 2014): blue-noise-like without a texture.
float ign(vec2 cell) { return fract(52.9829189 * fract(0.06711056 * floor(cell.x) + 0.00583715 * floor(cell.y))); }
float ditherThreshold(vec2 cell, float mode) {
  if (mode < 0.5) return 0.5;
  if (mode < 1.5) return bayer(cell, 4.0);
  if (mode < 2.5) return bayer(cell, 8.0);
  return ign(cell);
}
// v in [0,1] -> k / steps, k in 0..steps. Spatial mean over a dither tile equals v.
float ditherQuantize(float v, float steps, vec2 cell, float mode) {
  return floor(clamp(v, 0.0, 1.0) * steps + ditherThreshold(cell, mode)) / steps;
}
// Profile -> palette step (pal[0] dimmest .. pal[steps-1] brightest) with an alpha ramp.
vec4 glowSprite(float p, float steps, vec3 pal[8], float alphaMax, vec2 cell, float mode) {
  float q = ditherQuantize(p, steps, cell, mode);
  if (q <= 0.0) return vec4(0.0);
  int k = int(q * steps + 0.5) - 1;
  vec3 c = pal[0];
  for (int i = 0; i < 8; i++) { if (i == k) c = pal[i]; }
  return vec4(c, alphaMax * q);
}
// Two-colour ramp variant for instanced sprites (per-instance colour, no palette array).
vec4 glowRamp(float p, float steps, vec3 dim, vec3 bright, float alphaMax, vec2 cell, float mode) {
  float q = ditherQuantize(p, steps, cell, mode);
  if (q <= 0.0) return vec4(0.0);
  float k = (q * steps - 1.0) / max(1.0, steps - 1.0);
  return vec4(mix(dim, bright, k), alphaMax * q);
}
`;

// ---- TS mirrors -----------------------------------------------------------

export function bSersic(n: number): number {
  return 2 * n - 1 / 3 + 4 / (405 * n);
}
export function sersic(r: number, re: number, n: number): number {
  return Math.exp(-bSersic(n) * Math.pow(Math.max(r, 0) / re, 1 / n));
}
export function expDisc(r: number, h: number): number {
  return Math.exp(-Math.max(r, 0) / h);
}
export function gaussianBand(d: number, sigma: number): number {
  return Math.exp((-0.5 * d * d) / (sigma * sigma));
}

/** n x n Bayer threshold in [0,1) for integer cell (x, y); n = 2, 4 or 8. */
export function bayer(x: number, y: number, n: 2 | 4 | 8): number {
  const px = ((Math.floor(x) % n) + n) % n;
  const py = ((Math.floor(y) % n) + n) % n;
  let v = 0;
  let mul = (n * n) / 4;
  for (let bit = 1; bit < n; bit *= 2) {
    const bx = Math.floor(px / bit) % 2;
    const by = Math.floor(py / bit) % 2;
    const bxy = (bx + by) % 2;
    v += (bxy * 2 + by) * mul;
    mul /= 4;
  }
  return (v + 0.5) / (n * n);
}
export function ign(x: number, y: number): number {
  const f = (v: number) => v - Math.floor(v);
  return f(52.9829189 * f(0.06711056 * Math.floor(x) + 0.00583715 * Math.floor(y)));
}
export function ditherThreshold(x: number, y: number, mode: DitherMode): number {
  if (mode === "bands") return 0.5;
  if (mode === "bayer4") return bayer(x, y, 4);
  if (mode === "bayer8") return bayer(x, y, 8);
  return ign(x, y);
}
export function ditherQuantize(v: number, steps: number, x: number, y: number, mode: DitherMode): number {
  return Math.floor(Math.min(1, Math.max(0, v)) * steps + ditherThreshold(x, y, mode)) / steps;
}

/**
 * Build `steps` palette colours from a few anchors (dim -> bright), evenly
 * interpolated, padded to MAX_GLOW_STEPS for the uniform array.
 */
export function glowRamp(anchors: readonly string[], steps: number): Color[] {
  const n = Math.min(MAX_GLOW_STEPS, Math.max(1, Math.round(steps)));
  const out: Color[] = [];
  const a = anchors.map((h) => new Color(h));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1);
    const f = t * (a.length - 1);
    const lo = Math.min(a.length - 1, Math.floor(f));
    const hi = Math.min(a.length - 1, lo + 1);
    out.push(a[lo].clone().lerp(a[hi], f - lo));
  }
  while (out.length < MAX_GLOW_STEPS) out.push(out[out.length - 1].clone());
  return out;
}

export interface GlowParams {
  /** Palette anchors from dim to bright; interpolated into `steps`. */
  anchors: readonly string[];
  /** 2..8 palette steps. */
  steps: number;
  /** Alpha at the brightest step. */
  alphaMax: number;
  mode: DitherMode;
}

/** Uniforms a material needs to call `glowSprite(p, uSteps, uPal, uAlphaMax, gl_FragCoord.xy, uDither)`. */
export function glowUniforms(params: GlowParams) {
  return {
    uPal: { value: glowRamp(params.anchors, params.steps) },
    uSteps: { value: Math.min(MAX_GLOW_STEPS, Math.max(1, Math.round(params.steps))) },
    uAlphaMax: { value: params.alphaMax },
    uDither: { value: DITHER_MODE[params.mode] },
  };
}

/** Write a new ramp into existing uniforms (theme switch) without reallocating. */
export function setGlowRamp(uniforms: { uPal: { value: Color[] }; uSteps: { value: number } }, anchors: readonly string[], steps: number): void {
  const ramp = glowRamp(anchors, steps);
  for (let i = 0; i < MAX_GLOW_STEPS; i++) uniforms.uPal.value[i].copy(ramp[i]);
  uniforms.uSteps.value = Math.min(MAX_GLOW_STEPS, Math.max(1, Math.round(steps)));
}
