"use client";

import { useEffect, useMemo } from "react";
import { clamp, gaussian, mulberry32, range } from "./lib/rng";
import { GLSL_KEPLER, orbitPoint } from "./lib/orbit";
import { PointWriter, POINT_PRELUDE, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import { QUAD_PRELUDE, color, num, unitPlaneGeometry, useQuadMaterial, vec2 } from "./lib/quad";
import { GLSL_CELL, GLSL_LIGHT, useGlowUniforms } from "./lib/light";
import type { Exhibit, ObjectBase, Params } from "./lib/types";
import { GLSL_COMMON } from "./lib/uniforms";

/**
 * Comet on a seeded Kepler ellipse around a sun at the focus.
 *
 * Physics followed (NASA comet facts, ESA Rosetta / 67P, NEOWISE, Hale-Bopp):
 *  - the ION tail is straight and points exactly anti-sunward (radial line
 *    from the sun through the nucleus), kinked by the solar wind, flickering;
 *  - the DUST tail is broad and curved: grains released earlier keep moving
 *    on their own slightly different Keplerian orbits while radiation pressure
 *    pushes them outward, so the tail bends back toward the path the comet
 *    came from, between the anti-sun direction and the reverse velocity.
 *    Here every dust grain is placed at the nucleus position at its emission
 *    time (the past trajectory, solved with Kepler in the shader) plus an
 *    anti-sunward push growing with age squared (syndyne shape);
 *  - both tails and the coma grow near perihelion (length ~ 1 / r, clamped);
 *  - the nucleus is one cell: tiny next to the coma, the tails and any planet.
 * Stylised: Kirby Warp Star trail, Mario Galaxy prankster comet. All motion
 * is in the shaders, zero JS per frame; the CPU mirror below is tested.
 *
 * Scale: box = 6 su (sun glow ~1 su, orbit semi-major 3.3 su, coma 0.3-0.6 su, nucleus 1 cell).
 * Light: both tails are dithered gradient RIBBONS (shared/light): the ion tail a Gaussian band
 * ~1.5 cells wide fading exponentially along the anti-sun line; the dust tail a Gaussian band around
 * the past-trajectory + push centreline, widening and dimming with grain age (cream -> amber -> dim
 * red); the coma and the sun are Sérsic glows. Only <= 40 sprinkle grains remain as texture.
 * Budget: 4 quads (sun, dust ribbon, ion ribbon, coma) + 1 points draw (<= 40 grains + nucleus, sun, <= 64 guide dots).
 * (Before: 2 tail points draws <= 300 pts + 2 quads + 1 points draw.)
 */
export interface CometParams extends Record<string, number | string> {
  ecc: number;
  period: number;
  tail: number;
  guides: "on" | "off";
}

export const COMET_PALETTES = {
  dark: { coma: "#9fe8c8", comaCore: "#fff4e0", dustNear: "#fff0c2", dustFar: "#e8963a", ion: "#6fb8ff", ionFar: "#3b6fe0", sun: "#ffd36a", sunGlow: "#f6ac3d", orbit: "#5b5884", nucleus: "#ffffff" },
  light: { coma: "#2f7f6a", comaCore: "#17151d", dustNear: "#8a6a2a", dustFar: "#b85a3a", ion: "#2f5fa6", ionFar: "#4a4760", sun: "#d9a92e", sunGlow: "#c98a3a", orbit: "#8a88a8", nucleus: "#17151d" },
} as const;

export const COMET_BUDGET = { dust: 40, ion: 0, misc: 110 } as const;
/**
 * Dust grains live this fraction of the orbital period before they fade. Short enough that, even
 * around perihelion where the orbit bends fastest, the oldest grains stay between -v and anti-sun
 * (tested); longer lives would park old grains sunward of the -v line, i.e. "behind the bend".
 */
export const DUST_AGE_FRACTION = 0.045;
/** Radiation-pressure push at the end of a grain's life, in tail lengths. */
export const DUST_PUSH = 1.0;

export interface CometSpec {
  a: number;
  e: number;
  rot: number;
  dir: 1 | -1;
  phase: number;
  sun: [number, number];
  dust: PointBuffers;
  ion: PointBuffers;
  misc: PointBuffers;
}

export interface CometState {
  pos: [number, number];
  /** Unit velocity. */
  vel: [number, number];
  /** Unit anti-sun direction. */
  away: [number, number];
  /** Distance from the sun in box units. */
  r: number;
}

/** Sprinkle grains on top of the dust ribbon (texture only); the ion tail is a pure ribbon. */
export function cometCounts(size: number): { dust: number; ion: number } {
  return { dust: clamp(Math.round(size * 0.07), 6, COMET_BUDGET.dust), ion: 0 };
}

/** Nucleus position, unit velocity and anti-sun direction on the cosmos clock (mirrors `cometState` in GLSL). */
export function cometState(spec: Pick<CometSpec, "a" | "e" | "rot" | "dir" | "phase" | "sun">, period: number, t: number): CometState {
  const M = spec.dir * Math.PI * 2 * (t / period + spec.phase);
  const q = orbitPoint(spec.a, spec.e, M);
  const tx = -spec.a * Math.sin(q.E);
  const ty = spec.a * Math.sqrt(1 - spec.e * spec.e) * Math.cos(q.E);
  const tl = Math.hypot(tx, ty) || 1;
  const c = Math.cos(spec.rot);
  const s = Math.sin(spec.rot);
  const pos: [number, number] = [spec.sun[0] + c * q.x - s * q.y, spec.sun[1] + s * q.x + c * q.y];
  const vel: [number, number] = [((c * tx - s * ty) / tl) * spec.dir, ((s * tx + c * ty) / tl) * spec.dir];
  const dx = pos[0] - spec.sun[0];
  const dy = pos[1] - spec.sun[1];
  const r = Math.hypot(dx, dy) || 1e-6;
  return { pos, vel, away: [dx / r, dy / r], r };
}

/**
 * Radiation-pressure displacement of a grain of relative age age01, in tail lengths (mirrors GLSL).
 * Mostly ~ age^2 (constant acceleration) with a small linear part: the push must outrun the
 * curvature of the past orbit near perihelion, or old grains would sit sunward of the -v line.
 */
export function dustPush(age01: number): number {
  return DUST_PUSH * (0.3 * age01 + 0.7 * age01 * age01);
}

/** Tail length in box units: grows toward perihelion as 1 / r, clamped (mirrors GLSL). */
export function tailLength(tailLen: number, r: number): number {
  return tailLen * clamp(0.5 / Math.max(r, 0.15), 0.3, 1.15);
}

/** Ion tail sample: straight anti-sunward from the nucleus, s in [0, 1), lateral in grain widths (mirrors GLSL, kinks omitted). */
export function ionSample(spec: CometSpec, period: number, tailLen: number, t: number, s: number, lateral = 0): [number, number] {
  const st = cometState(spec, period, t);
  const L = tailLength(tailLen, st.r) * 1.4;
  const perp = [-st.away[1], st.away[0]];
  return [st.pos[0] + st.away[0] * s * L + perp[0] * lateral * (0.006 + 0.025 * s) * L, st.pos[1] + st.away[1] * s * L + perp[1] * lateral * (0.006 + 0.025 * s) * L];
}

/**
 * Dust grain sample: the nucleus position at emission time (t - age) plus a
 * radiation-pressure push along the MEAN anti-sun direction of the grain's
 * life (average of the radial at emission and the radial now), which is what
 * a constant outward acceleration integrates to as the comet swings round the
 * sun (mirrors GLSL). The grain's position angle about the sun therefore stays
 * between where it was emitted and where the nucleus is now: behind, along
 * the orbit it came from, never ahead.
 */
export function dustSample(spec: CometSpec, period: number, tailLen: number, t: number, age01: number, lateral = 0): { pos: [number, number]; emitted: CometState; age: number } {
  const age = age01 * period * DUST_AGE_FRACTION;
  const emitted = cometState(spec, period, t - age);
  const now = cometState(spec, period, t);
  const L = tailLength(tailLen, emitted.r);
  const push = L * dustPush(age01);
  const mx = emitted.away[0] + now.away[0];
  const my = emitted.away[1] + now.away[1];
  const ml = Math.hypot(mx, my) || 1;
  const dir = [mx / ml, my / ml];
  const perp = [-dir[1], dir[0]];
  const spread = lateral * (0.01 + 0.08 * age01) * L;
  return { pos: [emitted.pos[0] + dir[0] * push + perp[0] * spread, emitted.pos[1] + dir[1] * push + perp[1] * spread], emitted, age };
}

/** Optional overrides so captures can start at a known phase (`p.phase0=`, `p.dir=`). */
export interface CometOverrides {
  phase0?: number;
  dir?: 1 | -1;
}

export function generateComet(seed: number, size: number, ecc: number, cute: number, guides: boolean, over: CometOverrides = {}): CometSpec {
  const rng = mulberry32(seed ^ 0xc03e);
  const e = clamp(ecc, 0.05, 0.9);
  const a = 0.55;
  const rot = range(rng, 0, Math.PI * 2);
  const seededDir: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const dir = over.dir ?? seededDir;
  // Sun at the focus; the ellipse centre sits at the box centre.
  const cx = -a * e;
  const sun: [number, number] = [-(Math.cos(rot) * cx), -(Math.sin(rot) * cx)];
  const { dust: nd } = cometCounts(size);
  const dust = new PointWriter(COMET_BUDGET.dust);
  for (let i = 0; i < nd; i++) dust.push(rng(), gaussian(rng) * (1 - 0.3 * cute), rng(), rng() < 0.5 ? "#fff0c2" : "#ffe6a8", 1, rng(), SHAPE.cell, [9, 0, 0, 0]);
  const ion = new PointWriter(1);
  const misc = new PointWriter(COMET_BUDGET.misc);
  // aux.x: 0 orbit dot, 1 nucleus, 2 sun core, 3 sun halo, 4 sun-direction guide dot (aux.y = fraction sun -> nucleus).
  misc.push(0, 0, 0, "#ffffff", 1, 0, SHAPE.cell, [1, 0, 0, 0]);
  const sunPhase = rng();
  misc.push(sun[0], sun[1], 0, "#ffd36a", size >= 96 ? 7 : 5, sunPhase, SHAPE.blob, [3, 0, 0, 0]);
  misc.push(sun[0], sun[1], 0, "#fff0c2", size >= 96 ? 5 : 3, sunPhase, SHAPE.sparkle, [2, 0, 0, 0]);
  if (guides) {
    const n = size >= 160 ? 48 : size >= 64 ? 24 : 0;
    for (let i = 0; i < n; i++) {
      const M = (i / n) * Math.PI * 2;
      const p = orbitPoint(a, e, M);
      misc.push(sun[0] + Math.cos(rot) * p.x - Math.sin(rot) * p.y, sun[1] + Math.sin(rot) * p.x + Math.cos(rot) * p.y, 0, "#5b5884", 1, rng(), SHAPE.cell, [0, 0, 0, 0]);
    }
    const g = size >= 160 ? 16 : 0;
    for (let i = 1; i < g; i++) misc.push(0, 0, 0, "#ffd36a", 1, rng(), SHAPE.cell, [4, i / g, 0, 0]);
  }
  // Sprinkle grains ride in the same draw as the markers (aux.x = 9), after them so the marker order is stable.
  for (let i = 0; i < dust.count; i++) misc.push(dust.position[i * 3], dust.position[i * 3 + 1], dust.position[i * 3 + 2], "#fff0c2", 1, dust.phase[i], SHAPE.cell, [9, 0, 0, 0]);
  const seededPhase = rng();
  return { a, e, rot, dir, phase: over.phase0 ?? seededPhase, sun, dust: dust.finish(), ion: ion.finish(), misc: misc.finish() };
}

export const COMET_GUIDE_MAX = 48;

/**
 * Teaching guides (explain mode), positioned in the shader so they ride with the nucleus.
 * aux.x: 5 ghost (aux.y = age fraction of a grain's life), 6 velocity arrow (aux.y = s, aux.z = head side),
 * 7 anti-sun axis dots (aux.y = s), 8 reverse-velocity dots (aux.y = s).
 */
export function generateCometGuides(): PointBuffers {
  const w = new PointWriter(COMET_GUIDE_MAX);
  for (let k = 1; k <= 4; k++) w.push(0, 0, 0, "#c9d6e6", 3, 0, SHAPE.blob, [5, k / 4, 0, 0]);
  for (let i = 0; i < 10; i++) w.push(0, 0, 0, "#8ad7ea", 1, 0, SHAPE.cell, [6, i / 9, 0, 0]);
  w.push(0, 0, 0, "#8ad7ea", 1, 0, SHAPE.cell, [6, 0.82, 1, 0]);
  w.push(0, 0, 0, "#8ad7ea", 1, 0, SHAPE.cell, [6, 0.82, -1, 0]);
  for (let i = 1; i <= 14; i++) w.push(0, 0, 0, "#ffffff", 1, 0, SHAPE.cell, [7, i / 14, 0, 0]);
  for (let i = 1; i <= 8; i++) w.push(0, 0, 0, "#e9a6c9", 1, 0, SHAPE.cell, [8, i / 8, 0, 0]);
  return w.finish();
}

const ORBIT_GLSL = /* glsl */ `
uniform float uA, uE, uRot, uDir, uPeriod, uPhase, uTailLen;
uniform vec2 uSun;
${GLSL_KEPLER}
// Nucleus position, unit velocity, anti-sun direction and sun distance at time t (mirrors cometState in TS).
vec2 cometState(float t, out vec2 vel, out vec2 away, out float r) {
  float M = uDir * 6.2832 * (t / uPeriod + uPhase);
  vec2 q = orbitPoint(uA, uE, M);
  mat2 R = rot2(uRot);
  vel = R * (orbitTangent(uA, uE, M) * uDir);
  vec2 c = uSun + R * q;
  vec2 d = c - uSun;
  r = max(length(d), 1e-6);
  away = d / r;
  return c;
}
float tailLength(float r) { return uTailLen * clamp(0.5 / max(r, 0.15), 0.3, 1.15); }
const float AGE_FRACTION = ${DUST_AGE_FRACTION.toFixed(3)};
const float PUSH = ${DUST_PUSH.toFixed(3)};
// Dust-tail centreline: where a grain of relative age age01 is now (mirrors dustSample with lateral 0).
vec2 dustCentre(float t, float age01, vec2 awayNow, out float L) {
  float age = age01 * uPeriod * AGE_FRACTION;
  vec2 vel, away;
  float r;
  vec2 emitted = cometState(t - age, vel, away, r);
  L = tailLength(r);
  float push = L * PUSH * (0.3 * age01 + 0.7 * age01 * age01);
  vec2 dir = normalize(away + awayNow);
  return emitted + dir * push;
}
`;

const GUIDE_VERT = /* glsl */ `
${POINT_PRELUDE}
${ORBIT_GLSL}
const float AGE_FRACTION = ${DUST_AGE_FRACTION.toFixed(3)};
void main() {
  vec2 vel, away;
  float r;
  vec2 c = cometState(uTime, vel, away, r);
  float L = tailLength(r);
  float kind = aux.x;
  float s = aux.y;
  vec2 pos = c;
  float a = 0.8;
  if (kind < 5.5) {
    // Ghost: where the nucleus was when the grains now at this age left it.
    vec2 v2, aw2;
    float r2;
    pos = cometState(uTime - s * uPeriod * AGE_FRACTION, v2, aw2, r2);
    a = 0.95 - 0.18 * s * 4.0;
  } else if (kind < 6.5) {
    // Velocity arrow from the nucleus, with a two-cell head.
    float len = 0.26;
    vec2 vp = vec2(-vel.y, vel.x);
    pos = aux.z == 0.0 ? c + vel * s * len : c + vel * 0.82 * len + vp * aux.z * 0.035;
    a = 1.0;
  } else if (kind < 7.5) {
    // Anti-sun axis: dotted, past the ion tail's end.
    pos = c + away * s * L * 1.6;
    a = 0.55;
  } else {
    // Reverse velocity: the other edge of the sector the dust tail must stay inside.
    pos = c - vel * s * 0.26 * 0.8;
    a = 0.7;
  }
  emitPoint(vec3(pos, 0.0), color, a, size, shape);
}
`;

/** Quad vertex for the ribbons: the nucleus state rides along as varyings (constant over the quad). */
const RIBBON_VERT = /* glsl */ `
varying vec2 vUv;
varying vec2 vC, vAway, vVel;
varying float vL;
uniform float uTime;
${GLSL_COMMON}
${ORBIT_GLSL}
void main() {
  vUv = uv * 2.0 - 1.0;
  float r;
  vC = cometState(uTime, vVel, vAway, r);
  vL = tailLength(r);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Ion tail: a thin Gaussian band (sigma ~1.5 cells) on the anti-sun line, fading exponentially, kinked by the wind. */
const ION_FRAG = /* glsl */ `
${QUAD_PRELUDE}
${GLSL_LIGHT}
${GLSL_CELL}
uniform vec3 uPal[8];
uniform float uSteps, uAlphaMax, uDither;
varying vec2 vC, vAway, vVel;
varying float vL;
void main() {
  vec2 d = vUv - vC;
  vec2 perp = vec2(-vAway.y, vAway.x);
  float Lion = vL * 1.4;
  float s = dot(d, vAway) / Lion;
  if (s < 0.0 || s > 1.0) discard;
  float x = dot(d, perp);
  float cell = cellBox();
  float kink = 0.7 * cell * sin(s * 12.0 - uTime * 3.5);
  float sigma = 1.5 * cell * (1.0 + 1.2 * s);
  float prof = gaussianBand(x - kink, sigma) * expDisc(s, 0.5) * (1.0 - smoothstep(0.8, 1.0, s));
  prof *= 0.85 + 0.15 * step(0.5, fract(uTime * 1.5 + s * 2.0));
  vec4 g = glowSprite(prof, uSteps, uPal, uAlphaMax, gl_FragCoord.xy, uDither);
  if (g.a <= 0.0) discard;
  gl_FragColor = vec4(themeTone(g.rgb, uLight), g.a * uFade);
  #include <colorspace_fragment>
}
`;

/**
 * Dust tail: a curved ribbon whose centreline is the past-trajectory + radiation-push curve
 * (sampled in the fragment, N Kepler solves), Gaussian cross-section widening with grain age,
 * brightness fading with age so the palette runs cream -> amber -> dim red outward.
 */
const DUST_SAMPLES = 14;
const DUST_FRAG = /* glsl */ `
${QUAD_PRELUDE}
${GLSL_LIGHT}
${GLSL_CELL}
${ORBIT_GLSL}
uniform vec3 uPal[8];
uniform float uSteps, uAlphaMax, uDither;
varying vec2 vC, vAway, vVel;
varying float vL;
const int N = ${DUST_SAMPLES};
void main() {
  vec2 p = vUv;
  // Cheap reject: the ribbon never leaves a disc of ~1.3 tail lengths around the nucleus.
  if (length(p - vC) > vL * 1.6 + 0.1) discard;
  float best = 1e3;
  float bestAge = 0.0;
  float Lprev;
  vec2 prev = dustCentre(uTime, 0.0, vAway, Lprev);
  for (int i = 1; i < N; i++) {
    float a1 = float(i) / float(N - 1);
    float L1;
    vec2 cur = dustCentre(uTime, a1, vAway, L1);
    vec2 seg = cur - prev;
    float len2 = max(dot(seg, seg), 1e-9);
    float u = clamp(dot(p - prev, seg) / len2, 0.0, 1.0);
    float dist = length(p - (prev + seg * u));
    if (dist < best) { best = dist; bestAge = (float(i - 1) + u) / float(N - 1); }
    prev = cur;
  }
  float cell = cellBox();
  float sigma = max(1.5 * cell, (0.012 + 0.1 * bestAge) * vL);
  float prof = gaussianBand(best, sigma) * exp(-bestAge * 1.7) * (1.0 - smoothstep(0.9, 1.0, bestAge));
  vec4 g = glowSprite(prof, uSteps, uPal, uAlphaMax, gl_FragCoord.xy, uDither);
  if (g.a <= 0.0) discard;
  gl_FragColor = vec4(themeTone(g.rgb, uLight), g.a * uFade);
  #include <colorspace_fragment>
}
`;

/** Coma: Sérsic glow, round toward the sun and stretched away from it, swelling toward perihelion. */
const COMA_VERT = /* glsl */ `
varying vec2 vUv;
varying vec2 vAway;
uniform float uTime;
uniform float uComaBase;
${GLSL_COMMON}
${ORBIT_GLSL}
void main() {
  vUv = uv * 2.0 - 1.0;
  vec2 vel, away;
  float r;
  vec2 c = cometState(uTime, vel, away, r);
  vAway = away;
  float coma = uComaBase * (0.5 + 0.5 * clamp(0.5 / max(r, 0.15), 0.3, 1.15) / 1.15);
  vec3 p = vec3(position.xy * coma + c, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const COMA_FRAG = /* glsl */ `
${QUAD_PRELUDE}
${GLSL_LIGHT}
uniform vec3 uPal[8];
uniform float uSteps, uAlphaMax, uDither;
varying vec2 vAway;
void main() {
  vec2 p = vUv;
  float along = dot(p, vAway);
  float q = along > 0.0 ? along * 0.55 : along;
  vec2 pp = p - vAway * along + vAway * q;
  float prof = sersic(length(pp), 0.42, 1.0);
  vec4 g = glowSprite(prof, uSteps, uPal, uAlphaMax, gl_FragCoord.xy, uDither);
  if (g.a <= 0.0) discard;
  gl_FragColor = vec4(themeTone(g.rgb, uLight), g.a * uFade);
  #include <colorspace_fragment>
}
`;

const SUN_FRAG = /* glsl */ `
${QUAD_PRELUDE}
${GLSL_LIGHT}
uniform vec3 uPal[8];
uniform float uSteps, uAlphaMax, uDither;
void main() {
  vec4 g = glowSprite(sersic(length(vUv), 0.4, 1.0), uSteps, uPal, uAlphaMax, gl_FragCoord.xy, uDither);
  if (g.a <= 0.0) discard;
  gl_FragColor = vec4(themeTone(g.rgb, uLight), g.a * uFade);
  #include <colorspace_fragment>
}
`;

/** One points draw: nucleus, sun sparkle, orbit + sun-direction guides, and a sparse sprinkle of dust grains (aux.x = 9). */
const MISC_VERT = /* glsl */ `
${POINT_PRELUDE}
${ORBIT_GLSL}
uniform vec3 uGrainNear, uGrainFar;
void main() {
  vec2 vel, away;
  float r;
  vec3 pos = position;
  vec3 col = color;
  float a = 1.0;
  if (aux.x > 8.5) {
    // Sprinkle grain riding the dust ribbon: same centreline, a Gaussian lateral offset, re-emitted when old.
    vec2 c = cometState(uTime, vel, away, r);
    float maxAge = uPeriod * AGE_FRACTION;
    float age01 = fract(position.x + uTime / maxAge);
    float L;
    vec2 centre = dustCentre(uTime, age01, away, L);
    vec2 velE, awayE; float rE;
    cometState(uTime - age01 * maxAge, velE, awayE, rE);
    vec2 dir = normalize(awayE + away);
    vec2 perp = vec2(-dir.y, dir.x);
    pos = vec3(centre + perp * position.y * (0.012 + 0.1 * age01) * L, 0.0);
    col = mix(uGrainNear, uGrainFar, age01);
    a = 0.35 + 0.45 * step(0.5, fract(uTime * 0.8 + phase * 7.0));
  }
  else if (aux.x > 0.5 && aux.x < 1.5) { pos = vec3(cometState(uTime, vel, away, r), 0.0); }
  else if (aux.x < 0.5) { a = 0.45 * mix(0.6, 1.0, step(0.5, fract(uTime * 0.2 + phase))); }
  else if (aux.x < 2.5) { float tw = twinkle2(uTime, phase); a = mix(0.85, 1.0, tw); }
  else if (aux.x < 3.5) { a = 0.0; }
  else {
    vec2 c = cometState(uTime, vel, away, r);
    pos = vec3(mix(uSun, c, aux.y), 0.0);
    a = 0.3 * mix(0.5, 1.0, step(0.5, fract(uTime * 0.5 - aux.y * 2.0)));
  }
  emitPoint(pos, col, a, size, shape);
}
`;

/** Reads the optional capture overrides out of the params bag. */
export function cometOverrides(params: Params): CometOverrides {
  const o: CometOverrides = {};
  if (typeof params.phase0 === "number" && Number.isFinite(params.phase0)) o.phase0 = params.phase0;
  if (params.dir === 1 || params.dir === -1) o.dir = params.dir;
  return o;
}

const COMET_GLOW = {
  coma: { dark: ["#1f4f44", "#3f9f88", "#9fe8c8", "#fff4e0"], light: ["#8aa89a", "#4a7f6a", "#2f5f50", "#17151d"], steps: 5, alphaMax: 0.9 },
  ion: { dark: ["#1b2a5e", "#3b6fe0", "#6fb8ff", "#dff6ff"], light: ["#9aa8c8", "#5a6fa6", "#2f4f8a", "#17151d"], steps: 5, alphaMax: 0.9 },
  dust: { dark: ["#4a1208", "#a8401a", "#e8963a", "#ffd36a", "#fff0c2"], light: ["#c9b48a", "#9a7a5a", "#7a5a3a", "#4a3020", "#17151d"], steps: 6, alphaMax: 0.85 },
  sun: { dark: ["#5a3010", "#c98a3a", "#ffd36a", "#fff4e0"], light: ["#c9a070", "#a8702a", "#7a5020", "#4a3010"], steps: 4, alphaMax: 0.7 },
} as const;

export function Comet({ seed, size, theme, intensity, cute, params, explain = false }: ObjectBase & { params: CometParams }) {
  const ecc = Number(params.ecc);
  const guides = params.guides !== "off";
  const over = cometOverrides(params);
  const spec = useMemo(() => generateComet(seed, size, ecc, cute, guides, over), [seed, size, ecc, cute, guides, over.phase0, over.dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const pal = COMET_PALETTES[theme];
  const orbit = useMemo(
    () => ({ uA: num(spec.a), uE: num(spec.e), uRot: num(spec.rot), uDir: num(spec.dir), uPeriod: num(30), uPhase: num(spec.phase), uTailLen: num(0.7), uSun: vec2(spec.sun[0], spec.sun[1]), uSizePx: num(size) }),
    [spec, size],
  );
  const comaGlow = useGlowUniforms(COMET_GLOW.coma, theme);
  const ionGlow = useGlowUniforms(COMET_GLOW.ion, theme);
  const dustGlow = useGlowUniforms(COMET_GLOW.dust, theme);
  const sunGlow = useGlowUniforms(COMET_GLOW.sun, theme);
  const ionU = useMemo(() => ({ ...orbit, ...ionGlow }), [orbit, ionGlow]);
  const dustU = useMemo(() => ({ ...orbit, ...dustGlow }), [orbit, dustGlow]);
  const comaU = useMemo(() => ({ ...orbit, ...comaGlow, uComaBase: num(0.1) }), [orbit, comaGlow]);
  const sunU = useMemo(() => ({ ...sunGlow }), [sunGlow]);
  const miscU = useMemo(() => ({ ...orbit, uGrainNear: color(pal.dustNear), uGrainFar: color(pal.dustFar) }), [orbit, pal]);
  const guideU = useMemo(() => ({ ...orbit }), [orbit]);
  const guideBuffers = useMemo(() => generateCometGuides(), []);
  const guideG = usePointsGeometry(guideBuffers);
  const guideM = usePointsMaterial({ vertexShader: GUIDE_VERT, uniforms: guideU, theme, fade: 1, additive: false });
  useEffect(() => {
    orbit.uPeriod.value = Number(params.period);
    orbit.uTailLen.value = Number(params.tail) * (1 - 0.2 * cute);
    // Coma diameter: ~0.3 su at aphelion to ~0.6 su at perihelion; never below 3 cells.
    comaU.uComaBase.value = Math.max(0.05 + 0.05 * cute, 6 / size);
  }, [orbit, comaU, params.period, params.tail, cute, size]);
  const ionM = useQuadMaterial({ fragmentShader: ION_FRAG, vertexShader: RIBBON_VERT, uniforms: ionU, theme, fade: intensity, cute });
  const dustM = useQuadMaterial({ fragmentShader: DUST_FRAG, vertexShader: RIBBON_VERT, uniforms: dustU, theme, fade: intensity, cute });
  const comaM = useQuadMaterial({ fragmentShader: COMA_FRAG, vertexShader: COMA_VERT, uniforms: comaU, theme, fade: intensity, cute });
  const sunM = useQuadMaterial({ fragmentShader: SUN_FRAG, uniforms: sunU, theme, fade: intensity, cute });
  const miscM = usePointsMaterial({ vertexShader: MISC_VERT, uniforms: miscU, theme, fade: 1 });
  const miscG = usePointsGeometry(spec.misc);
  return (
    <group>
      <mesh geometry={unitPlaneGeometry()} material={sunM} position={[spec.sun[0], spec.sun[1], 0]} scale={0.24} renderOrder={0} frustumCulled={false} />
      <mesh geometry={unitPlaneGeometry()} material={dustM} scale={2.4} renderOrder={1} frustumCulled={false} />
      <mesh geometry={unitPlaneGeometry()} material={ionM} scale={2.4} renderOrder={2} frustumCulled={false} />
      <mesh geometry={unitPlaneGeometry()} material={comaM} renderOrder={3} frustumCulled={false} />
      <points geometry={miscG} material={miscM} renderOrder={4} frustumCulled={false} />
      {explain ? <points geometry={guideG} material={guideM} renderOrder={5} frustumCulled={false} /> : null}
    </group>
  );
}

export const COMET_EXHIBIT: Exhibit<CometParams> = {
  id: "comet",
  title: "Comet",
  ref: "26-neowise two tails, Rosetta / 67P, Hale-Bopp; Kirby warp star trail",
  budget: "4 quads (sun, dust ribbon, ion ribbon, coma) + 1 points draw (<= 40 grains + <= 70 guides)",
  meaning: "An upcoming deadline: it swings closer to the sun as the date nears",
  su: 6,
  knobs: [
    { key: "ecc", label: "eccentricity", min: 0.2, max: 0.85, step: 0.05 },
    { key: "period", label: "period s", min: 8, max: 60, step: 1 },
    { key: "tail", label: "tail length", min: 0.3, max: 1.2, step: 0.05 },
    { key: "guides", label: "orbit + sun guides", options: ["on", "off"] },
  ],
  defaults: { ecc: 0.65, period: 30, tail: 0.7, guides: "on" },
  readout: (seed, params) => {
    const s = generateComet(seed, 320, Number(params.ecc), 0.5, false);
    return [
      ["semi-major", `${(s.a * 6).toFixed(1)} su`],
      ["perihelion", `${(s.a * (1 - s.e) * 6).toFixed(2)} su`],
      ["aphelion", `${(s.a * (1 + s.e) * 6).toFixed(2)} su`],
    ];
  },
  Component: Comet,
};
