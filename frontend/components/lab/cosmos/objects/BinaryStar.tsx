"use client";

import { useEffect, useMemo } from "react";
import { mulberry32, range } from "./lib/rng";
import { PointWriter, POINT_PRELUDE, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import * as THREE from "three";
import { QUAD_PRELUDE, num, unitPlaneGeometry, useQuadMaterial } from "./lib/quad";
import { DITHER_MODE, GLSL_CELL, GLSL_LIGHT, namedGlowUniforms, setNamedGlowRamp } from "./lib/light";
import type { Exhibit, ObjectBase } from "./lib/types";

/**
 * Binary star with mass transfer: a puffy orange donor and a small hot
 * blue-white accretor with a thin disc, both circling the barycentre on a
 * tilted ellipse; a thin stream of dots leaves the donor's near side, lags
 * behind and lands on the disc's trailing edge. Refs: Algol / cataclysmic
 * variable artist impressions (teardrop donor, stream, disc hot spot).
 * Stylised: Outer Wilds' Ash Twin / Ember Twin sand column, cute.
 *
 * Light: donor = Sérsic giant with a dithered limb, accretor = Sérsic glare + exponential inner disc
 * (blue-white -> amber outward, hot spot on the leading edge), stream = ONE Gaussian ribbon ~1.4 cells
 * wide from the L1 side bending prograde onto the disc (shared/light dithering). Guides only in explain mode.
 * Budget: 1 quad (everything). Before: 1 banded quad + 1 points draw (<= 96 stream dots).
 */
export interface BinaryParams extends Record<string, number | string> {
  period: number;
  sep: number;
  /** How much of its Roche lobe the donor fills (1 = overflowing, which is what drives the stream). */
  fill: number;
}

export const BINARY_PALETTES = {
  dark: { donor: "#f0a060", donorEdge: "#c0401a", donorCore: "#fff0c2", accretor: "#dff6ff", accretorEdge: "#8ad7ea", disc: "#9fe8c8", hot: "#ffffff", stream: "#ffd36a" },
  light: { donor: "#c06030", donorEdge: "#7a2a10", donorCore: "#4a2a10", accretor: "#2f5fa6", accretorEdge: "#4f6ea8", disc: "#2f7f6a", hot: "#17151d", stream: "#8a6a2a" },
} as const;

/** Stream ribbon half-width in cells (Gaussian sigma); the ribbon is one quad, no points. */
export const STREAM_SIGMA_CELLS = 1.4;

export interface BinarySpec {
  phase: number;
  dir: 1 | -1;
  tiltY: number;
  /** Donor (puffy giant) mass in solar masses: the lighter star, so it rides the larger orbit. */
  mA: number;
  /** Accretor (hot compact star) mass: heavier, brighter, smaller. */
  mB: number;
}

/** Eggleton (1983) Roche-lobe radius over the separation for mass ratio q = M_donor / M_accretor. */
export function rocheLobe(q: number): number {
  const q23 = Math.pow(q, 2 / 3);
  return (0.49 * q23) / (0.6 * q23 + Math.log(1 + Math.pow(q, 1 / 3)));
}

/**
 * Sizes and orbit radii in box units (box = 10 su; 1 su = 0.1 box = one star glow).
 * The donor is as big as the Roche lobe it fills; the accretor glow is ~1 su, slightly growing with mass.
 * Both circle the barycentre with ONE period: r_A / r_B = m_B / m_A, the lighter one farther out.
 */
export function binaryLayout(spec: Pick<BinarySpec, "mA" | "mB">, sep: number, fill: number): { rA: number; rB: number; orbitA: number; orbitB: number; q: number } {
  const q = spec.mB / spec.mA;
  return {
    rA: fill * rocheLobe(spec.mA / spec.mB) * sep,
    rB: 0.05 * Math.pow(spec.mB / 1.4, 0.3),
    orbitA: (sep * spec.mB) / (spec.mA + spec.mB),
    orbitB: (sep * spec.mA) / (spec.mA + spec.mB),
    q,
  };
}

export function generateBinary(seed: number, size: number, cute: number): BinarySpec {
  const rng = mulberry32(seed ^ 0xb1a2);
  // Size and cute only shape the glows (see the shader); kept in the signature so the seed stream is stable.
  void size;
  void cute;
  // Algol paradox: the evolved donor is the LESS massive star; the accretor is heavier, hotter and smaller.
  const mA = range(rng, 0.5, 1.2);
  const mB = mA * range(rng, 1.3, 2.4);
  return { phase: range(rng, 0, Math.PI * 2), dir: rng() < 0.5 ? 1 : -1, tiltY: range(rng, 0.5, 0.85), mA, mB };
}

const BINARY_GLSL = /* glsl */ `
uniform float uPeriod, uPhase, uDir, uSep, uQ, uTiltY, uRa, uRb;
// Both bodies on circles about the barycentre; y flattened by the tilt. z = sin(angle) (positive = nearer).
void bodies(float t, out vec2 A, out vec2 B, out float zA, out vec2 vA) {
  float ang = uDir * t * 6.2832 / uPeriod + uPhase;
  float rA = uSep * uQ / (1.0 + uQ);
  float rB = uSep / (1.0 + uQ);
  vec2 dirv = vec2(cos(ang), -sin(ang) * uTiltY);
  A = dirv * rA;
  B = -dirv * rB;
  zA = sin(ang);
  vA = normalize(vec2(-sin(ang), -cos(ang) * uTiltY)) * uDir;
}
// Mass-transfer stream as a quadratic Bezier (mirrors streamPoint in TS). Gas leaves the donor's L1 side
// and is deflected PROGRADE (Coriolis / angular-momentum excess: it has L1's angular momentum, so it runs
// ahead of the co-rotating line of centres) and lands on the leading edge of the disc.
vec2 streamPoint(vec2 A, vec2 B, vec2 vA, float s) {
  vec2 ab = normalize(B - A);
  vec2 perp = vec2(-ab.y, ab.x);
  float side = dot(perp, vA) > 0.0 ? 1.0 : -1.0;
  float sep = length(B - A);
  vec2 P0 = A + ab * uRa * 0.78;
  vec2 P1 = A + ab * sep * 0.55 + perp * side * sep * 0.22;
  vec2 P2 = B + perp * side * uRb * 2.6 - ab * uRb * 0.4;
  float ms = 1.0 - s;
  return ms * ms * P0 + 2.0 * ms * s * P1 + s * s * P2;
}
`;

const BINARY_FRAG = /* glsl */ `
${QUAD_PRELUDE}
${GLSL_LIGHT}
${GLSL_CELL}
${BINARY_GLSL}
uniform float uExplain;
uniform vec3 uPalDonor[8], uPalAcc[8], uPalDisc[8], uPalStream[8];
uniform float uStepsDonor, uStepsAcc, uStepsDisc, uStepsStream;
uniform float uAlphaMaxDonor, uAlphaMaxAcc, uAlphaMaxDisc, uAlphaMaxStream, uDither;
// "over" compositing of one dithered layer onto the running colour.
void over(inout vec3 c, inout float a, vec4 src) { c = mix(c, src.rgb, src.a); a = max(a, src.a); }
const int NS = 20;
void main() {
  vec2 A, B, vA;
  float zA;
  bodies(uTime, A, B, zA, vA);
  vec2 p = vUv;
  vec2 ab = normalize(B - A);
  vec2 perp = vec2(-ab.y, ab.x);
  float cell = cellBox();
  vec2 fc = gl_FragCoord.xy;

  // Donor: a soft Sérsic giant (n = 0.8), round; the Roche teardrop only in explain mode.
  vec2 d = p - A;
  float u = dot(d, ab);
  float v = dot(d, perp);
  float stretch = (uExplain > 0.5 && u > 0.0) ? 0.74 : 1.0;
  float rd = length(vec2(u * stretch, v)) / uRa;
  vec4 donor = glowSprite(sersic(rd, 0.66, 0.8) * (1.0 - smoothstep(1.05, 1.3, rd)), uStepsDonor, uPalDonor, uAlphaMaxDonor, fc, uDither);

  // Accretor: a small blue-white glare (n = 1) ...
  vec2 e = p - B;
  float ra = length(e) / uRb;
  vec4 acc = glowSprite(sersic(ra, 0.5, 1.0) * (1.0 - smoothstep(1.6, 2.4, ra)), uStepsAcc, uPalAcc, uAlphaMaxAcc, fc, uDither);
  // ... with a hot inner disc: a tilted exponential disc, blue-white at the inner edge shading to amber outward,
  // brighter at the hot spot where the stream lands (leading edge).
  float ratio = max(0.25, uTiltY * 0.45);
  float re = length(e / vec2(1.0, ratio)) / uRb;
  float side = dot(perp, vA) > 0.0 ? 1.0 : -1.0;
  vec2 landing = normalize(-ab * 0.4 + perp * side);
  float hot = smoothstep(0.2, 1.0, dot(normalize(e), landing)) * smoothstep(2.0, 2.8, re) * (1.0 - smoothstep(3.2, 3.8, re));
  float discP = re < 1.0 ? 0.0 : expDisc(re - 1.0, 1.1) * (1.0 - smoothstep(3.2, 4.0, re));
  discP = clamp(discP * (1.0 + 0.9 * hot), 0.0, 1.0);
  vec4 disc = glowSprite(discP, uStepsDisc, uPalDisc, uAlphaMaxDisc, fc, uDither);

  // Stream: ONE thin Gaussian ribbon along the Bezier (sampled, no dots), brightening toward the disc.
  float best = 1e3;
  float bestS = 0.0;
  vec2 prev = streamPoint(A, B, vA, 0.0);
  for (int i = 1; i <= NS; i++) {
    float s1 = float(i) / float(NS);
    vec2 cur = streamPoint(A, B, vA, s1);
    vec2 seg = cur - prev;
    float len2 = max(dot(seg, seg), 1e-9);
    float t = clamp(dot(p - prev, seg) / len2, 0.0, 1.0);
    float dist = length(p - (prev + seg * t));
    if (dist < best) { best = dist; bestS = (float(i - 1) + t) / float(NS); }
    prev = cur;
  }
  float sigma = 1.4 * cell;
  float sp = gaussianBand(best, sigma) * smoothstep(0.0, 0.04, bestS) * (1.0 - smoothstep(0.93, 1.0, bestS)) * (0.6 + 0.4 * bestS);
  sp *= 0.88 + 0.12 * step(0.5, fract(uTime * 1.3 - bestS * 4.0));   // slow two-step flow
  vec4 stream = glowSprite(sp, uStepsStream, uPalStream, uAlphaMaxStream, fc, uDither);

  // Composite far -> near. The disc's upper half sits behind the glare, the lower half in front.
  vec3 c = vec3(0.0);
  float a = 0.0;
  bool donorNear = zA > 0.0;
  bool discNear = e.y < 0.0;
  if (!donorNear) over(c, a, donor);
  if (!discNear) over(c, a, disc);
  over(c, a, acc);
  if (discNear) over(c, a, disc);
  over(c, a, stream);
  if (donorNear) over(c, a, donor);
  if (a <= 0.01) discard;
  gl_FragColor = vec4(themeTone(c, uLight), a * min(uFade, 1.0));
  #include <colorspace_fragment>
}
`;

/** Distance of the inner Lagrange point from the donor's centre (Plavec & Kratochvil 1964), box units. */
export function l1FromDonor(spec: Pick<BinarySpec, "mA" | "mB">, sep: number): number {
  return sep * (0.5 + 0.227 * Math.log10(spec.mA / spec.mB));
}

export interface BinaryBodies {
  A: [number, number];
  B: [number, number];
  /** Unit velocities (B moves opposite to A; |vB| / |vA| = orbitB / orbitA). */
  vA: [number, number];
  vB: [number, number];
  ab: [number, number];
  perp: [number, number];
  zA: number;
}

/** Positions and unit velocities on the cosmos clock (mirrors GLSL `bodies`). */
export function binaryBodies(spec: BinarySpec, sep: number, period: number, t: number): BinaryBodies {
  const q = spec.mB / spec.mA;
  const ang = spec.dir * ((t * Math.PI * 2) / period) + spec.phase;
  const rA = (sep * q) / (1 + q);
  const rB = sep / (1 + q);
  const dir: [number, number] = [Math.cos(ang), -Math.sin(ang) * spec.tiltY];
  const A: [number, number] = [dir[0] * rA, dir[1] * rA];
  const B: [number, number] = [-dir[0] * rB, -dir[1] * rB];
  const tx = -Math.sin(ang);
  const ty = -Math.cos(ang) * spec.tiltY;
  const tl = Math.hypot(tx, ty) || 1;
  const vA: [number, number] = [(tx / tl) * spec.dir, (ty / tl) * spec.dir];
  const abx = B[0] - A[0];
  const aby = B[1] - A[1];
  const al = Math.hypot(abx, aby) || 1;
  const ab: [number, number] = [abx / al, aby / al];
  return { A, B, vA, vB: [-vA[0], -vA[1]], ab, perp: [-ab[1], ab[0]], zA: Math.sin(ang) };
}

/** Stream Bezier point, s in [0, 1] (mirrors GLSL `streamPoint`): leaves the donor's L1 side, bends prograde, lands on the disc's leading edge. */
export function streamPoint(b: BinaryBodies, rA: number, rB: number, s: number): [number, number] {
  const side = b.perp[0] * b.vA[0] + b.perp[1] * b.vA[1] > 0 ? 1 : -1;
  const sep = Math.hypot(b.B[0] - b.A[0], b.B[1] - b.A[1]);
  const P0 = [b.A[0] + b.ab[0] * rA * 0.78, b.A[1] + b.ab[1] * rA * 0.78];
  const P1 = [b.A[0] + b.ab[0] * sep * 0.55 + b.perp[0] * side * sep * 0.22, b.A[1] + b.ab[1] * sep * 0.55 + b.perp[1] * side * sep * 0.22];
  const P2 = [b.B[0] + b.perp[0] * side * rB * 2.6 - b.ab[0] * rB * 0.4, b.B[1] + b.perp[1] * side * rB * 2.6 - b.ab[1] * rB * 0.4];
  const ms = 1 - s;
  return [ms * ms * P0[0] + 2 * ms * s * P1[0] + s * s * P2[0], ms * ms * P0[1] + 2 * ms * s * P1[1] + s * s * P2[1]];
}

/** Illustrative Roche-lobe outline around the donor: an egg that reaches exactly the L1 point (theta measured from the donor -> accretor line). */
export function lobeRadius(rA: number, l1: number, theta: number): number {
  const c = Math.max(0, Math.cos(theta));
  return rA * (1 + (l1 / rA - 1) * Math.pow(c, 2.2));
}

export const BINARY_GUIDE_MAX = 160;

/** Teaching guides (explain mode): barycentre, both orbits, lobe outline, L1, velocity arrows. aux.x = kind. */
export function generateBinaryGuides(): PointBuffers {
  const w = new PointWriter(BINARY_GUIDE_MAX);
  w.push(0, 0, 0, "#ffffff", 5, 0, SHAPE.sparkle, [1, 0, 0, 0]);
  for (let i = 0; i < 32; i++) w.push(0, 0, 0, "#9b94b8", 1, 0, SHAPE.cell, [2, (i / 32) * Math.PI * 2, 0, 0]);
  for (let i = 0; i < 32; i++) w.push(0, 0, 0, "#8ad7ea", 1, 0, SHAPE.cell, [3, (i / 32) * Math.PI * 2, 0, 0]);
  for (let i = 0; i < 48; i++) w.push(0, 0, 0, "#f0a060", 1, 0, SHAPE.cell, [4, (i / 48) * Math.PI * 2, 0, 0]);
  w.push(0, 0, 0, "#ffd36a", 5, 0, SHAPE.sparkle, [5, 0, 0, 0]);
  for (let i = 0; i < 10; i++) w.push(0, 0, 0, "#8ad7ea", 1, 0, SHAPE.cell, [6, i / 9, 0, 0]);
  w.push(0, 0, 0, "#8ad7ea", 1, 0, SHAPE.cell, [6, 0.85, 1, 0]);
  w.push(0, 0, 0, "#8ad7ea", 1, 0, SHAPE.cell, [6, 0.85, -1, 0]);
  for (let i = 0; i < 10; i++) w.push(0, 0, 0, "#8ad7ea", 1, 0, SHAPE.cell, [7, i / 9, 0, 0]);
  w.push(0, 0, 0, "#8ad7ea", 1, 0, SHAPE.cell, [7, 0.85, 1, 0]);
  w.push(0, 0, 0, "#8ad7ea", 1, 0, SHAPE.cell, [7, 0.85, -1, 0]);
  return w.finish();
}

const GUIDE_VERT = /* glsl */ `
${POINT_PRELUDE}
${BINARY_GLSL}
uniform float uL1;
void main() {
  vec2 A, B, vA;
  float zA;
  bodies(uTime, A, B, zA, vA);
  vec2 ab = normalize(B - A);
  vec2 perp = vec2(-ab.y, ab.x);
  float kind = aux.x;
  float th = aux.y;
  float rOrbA = uSep * uQ / (1.0 + uQ);
  float rOrbB = uSep / (1.0 + uQ);
  vec2 pos = vec2(0.0);
  float a = 0.6;
  float s = size;
  float sh = shape;
  if (kind < 1.5) { pos = vec2(0.0); a = 0.9; }
  else if (kind < 2.5) { pos = vec2(cos(th) * rOrbA, -sin(th) * rOrbA * uTiltY); a = 0.45; }
  else if (kind < 3.5) { pos = vec2(-cos(th) * rOrbB, sin(th) * rOrbB * uTiltY); a = 0.45; }
  else if (kind < 4.5) {
    float c = max(0.0, cos(th));
    float r = uRa * (1.0 + (uL1 / uRa - 1.0) * pow(c, 2.2));
    pos = A + (ab * cos(th) + perp * sin(th)) * r;
    a = 0.7;
  }
  else if (kind < 5.5) { pos = A + ab * uL1; a = 1.0; }
  else {
    // Velocity arrows: A along vA, B along -vA scaled by its smaller orbit; aux.z = arrow-head side.
    bool isA = kind < 6.5;
    vec2 v = isA ? vA : -vA;
    float len = 0.17 * (isA ? 1.0 : rOrbB / rOrbA);
    vec2 base = isA ? A : B;
    vec2 vp = vec2(-v.y, v.x);
    pos = aux.z == 0.0 ? base + v * th * len : base + v * 0.82 * len + vp * aux.z * 0.035;
    a = 0.95;
  }
  emitPoint(vec3(pos, 0.0), color, a, s, sh);
}
`;

const BINARY_GLOW = {
  donor: { dark: ["#5a1a0a", "#c0401a", "#f0a060", "#ffd9a0", "#fff0c2"], light: ["#d8b89a", "#b07050", "#8a4a2a", "#5a2a10", "#17151d"], steps: 6, alphaMax: 0.95 },
  acc: { dark: ["#3b6fe0", "#8ad7ea", "#dff6ff", "#ffffff"], light: ["#9ab0d8", "#4f6ea8", "#2f4f8a", "#17151d"], steps: 4, alphaMax: 1.0 },
  disc: { dark: ["#6a2a10", "#c98a3a", "#ffd36a", "#dff6ff"], light: ["#c9a070", "#9a7a5a", "#5a6fa6", "#2f4f8a"], steps: 5, alphaMax: 0.9 },
  stream: { dark: ["#a8702a", "#ffd36a", "#fff4e0"], light: ["#a8702a", "#6a4a1a", "#17151d"], steps: 3, alphaMax: 0.95 },
} as const;

export function BinaryStar({ seed, size, theme, intensity, cute, params, explain = false }: ObjectBase & { params: BinaryParams }) {
  const spec = useMemo(() => generateBinary(seed, size, cute), [seed, size, cute]);
  const shared = useMemo(
    () => ({ uPeriod: num(10), uPhase: num(spec.phase), uDir: num(spec.dir), uSep: num(0.8), uQ: num(2), uTiltY: num(spec.tiltY), uRa: num(0.3), uRb: num(0.09), uSizePx: num(size) }),
    [spec, size],
  );
  const guideU = useMemo(() => ({ ...shared, uL1: num(0.35) }), [shared]);
  const guideBuffers = useMemo(() => generateBinaryGuides(), []);
  const guideG = usePointsGeometry(guideBuffers);
  const guideM = usePointsMaterial({ vertexShader: GUIDE_VERT, uniforms: guideU, theme, fade: 1, additive: false });
  const glows = useMemo(
    () => ({
      ...namedGlowUniforms("Donor", BINARY_GLOW.donor.dark, BINARY_GLOW.donor.steps, BINARY_GLOW.donor.alphaMax),
      ...namedGlowUniforms("Acc", BINARY_GLOW.acc.dark, BINARY_GLOW.acc.steps, BINARY_GLOW.acc.alphaMax),
      ...namedGlowUniforms("Disc", BINARY_GLOW.disc.dark, BINARY_GLOW.disc.steps, BINARY_GLOW.disc.alphaMax),
      ...namedGlowUniforms("Stream", BINARY_GLOW.stream.dark, BINARY_GLOW.stream.steps, BINARY_GLOW.stream.alphaMax),
      uDither: { value: DITHER_MODE.bayer8 },
      uExplain: { value: 0 },
    }),
    [],
  );
  useEffect(() => {
    const t = theme;
    setNamedGlowRamp(glows, "Donor", BINARY_GLOW.donor[t], BINARY_GLOW.donor.steps);
    setNamedGlowRamp(glows, "Acc", BINARY_GLOW.acc[t], BINARY_GLOW.acc.steps);
    setNamedGlowRamp(glows, "Disc", BINARY_GLOW.disc[t], BINARY_GLOW.disc.steps);
    setNamedGlowRamp(glows, "Stream", BINARY_GLOW.stream[t], BINARY_GLOW.stream.steps);
  }, [glows, theme]);
  useEffect(() => {
    (glows.uExplain as { value: number }).value = explain ? 1 : 0;
  }, [glows, explain]);
  const bodyU = useMemo(() => ({ ...shared, ...glows }) as Record<string, { value: unknown }>, [shared, glows]);
  useEffect(() => {
    const sep = Number(params.sep);
    const lay = binaryLayout(spec, sep, Number(params.fill));
    shared.uPeriod.value = Number(params.period);
    shared.uSep.value = sep;
    shared.uQ.value = lay.q;
    // Cute rounds both glows up a little; the accretor stays the smaller one.
    shared.uRa.value = lay.rA * (1 + 0.15 * cute);
    shared.uRb.value = lay.rB * (1 + 0.3 * cute);
    guideU.uL1.value = l1FromDonor(spec, sep);
  }, [shared, guideU, spec, params.period, params.sep, params.fill, cute]);
  const body = useQuadMaterial({ fragmentShader: BINARY_FRAG, uniforms: bodyU as Record<string, THREE.IUniform>, theme, fade: intensity, cute });
  return (
    <group>
      <mesh geometry={unitPlaneGeometry()} material={body} scale={2} renderOrder={1} frustumCulled={false} />
      {explain ? <points geometry={guideG} material={guideM} renderOrder={3} frustumCulled={false} /> : null}
    </group>
  );
}

export const BINARY_EXHIBIT: Exhibit<BinaryParams> = {
  id: "binary",
  title: "Binary star",
  ref: "Algol / cataclysmic-variable artist impressions; Outer Wilds twins",
  budget: "1 quad (donor, glare, disc, stream ribbon); guides only in explain",
  meaning: "Two linked concepts: the stronger one feeds the weaker until they balance",
  su: 10,
  knobs: [
    { key: "period", label: "period s", min: 4, max: 24, step: 0.5 },
    { key: "sep", label: "separation (box)", min: 0.5, max: 1.0, step: 0.05 },
    { key: "fill", label: "donor Roche fill", min: 0.7, max: 1.05, step: 0.01 },
  ],
  defaults: { period: 10, sep: 0.8, fill: 0.98 },
  readout: (seed, params) => {
    const s = generateBinary(seed, 320, 0.5);
    const lay = binaryLayout(s, Number(params.sep), Number(params.fill));
    return [
      ["donor mass", `${s.mA.toFixed(2)} M☉ (giant, orbit ${(lay.orbitA * 10).toFixed(1)} su)`],
      ["accretor mass", `${s.mB.toFixed(2)} M☉ (compact, orbit ${(lay.orbitB * 10).toFixed(1)} su)`],
      ["radii", `${(lay.rA * 10).toFixed(1)} su / ${(lay.rB * 10).toFixed(2)} su`],
      ["barycentre", `${(lay.orbitB / (lay.orbitA + lay.orbitB) * 100).toFixed(0)} % of the way from accretor to donor`],
    ];
  },
  Component: BinaryStar,
};
