"use client";

import { useEffect, useMemo } from "react";
import { clamp, mulberry32, range } from "./lib/rng";
import { PointWriter, POINT_PRELUDE, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import { QUAD_PRELUDE, color, num, unitPlaneGeometry, useQuadMaterial } from "./lib/quad";
import type { Exhibit, ObjectBase, ObjectTheme } from "./lib/types";
import { GLSL_LIGHT, useGlowUniforms } from "./lib/light";

/**
 * Pulsar as an oblique rotator (the lighthouse model; NASA Imagine the
 * Universe "Pulsars", ATNF "Introduction to pulsars", Chandra Crab 2002/2008).
 *  - The star spins about a ROTATION AXIS (omega) inclined by zeta to the
 *    line of sight; the MAGNETIC AXIS (m) is inclined to omega by alpha
 *    (25-70 degrees here, never perpendicular by default), so the two
 *    radiation beams along +-m are swept in CONES around omega: their tips
 *    trace circles, which is the wobble you see.
 *  - A PULSE is seen when a beam cone (half-angle rho ~ 12 degrees) crosses
 *    the line of sight; zeta is seeded within 8 degrees of alpha so one beam
 *    grazes the viewer once per turn.
 *  - Crab-style wind nebula (remnant version): a faint equatorial torus
 *    (plane perpendicular to omega), an inner ring, and thin polar jets along
 *    +-omega (Chandra 27-crab-pulsar-chandra.jpg).
 *  - Periods 0.5-2 s so slow-mo reads; optional very slow precession of omega.
 * The 3D geometry is solved per frame in the shaders and mirrored in TS below
 * (tested: angle(m, omega) = alpha at all phases, pulse at the sweep).
 *
 * Scale: box = 2.5 su (star glow ~1 su, beams ~1.75 su). Budget: 1 quad + 1 points draw (1 star + <= 6 wisps).
 */
export interface PulsarParams extends Record<string, number | string> {
  period: number;
  alphaDeg: number;
  beam: number;
  torus: "on" | "off";
  precess: number;
}

export const PULSAR_PALETTES = {
  dark: { core: "#ffffff", beam: "#8ad7ea", beamFar: "#3b6fe0", halo: "#b8dcff", cuteBeam: "#f2a7c6", torus: "#6fb8ff" },
  light: { core: "#17151d", beam: "#2f5fa6", beamFar: "#4a4760", halo: "#4f6ea8", cuteBeam: "#b8508a", torus: "#4f6ea8" },
} as const;

/** Beam cone half-opening angle (radians). */
export const PULSAR_RHO = (12 * Math.PI) / 180;

export interface PulsarSpec {
  /** Magnetic inclination alpha (radians), seeded 25-70 degrees. */
  alpha: number;
  /** zeta - alpha: how closely the beam grazes the line of sight (radians, |delta| <= 8 degrees). */
  delta: number;
  /** Position angle of the projected rotation axis on screen. */
  psi: number;
  spin: 1 | -1;
  phase: number;
  points: PointBuffers;
}

export type Vec3 = readonly [number, number, number];

export function generatePulsar(seed: number, size: number): PulsarSpec {
  const rng = mulberry32(seed ^ 0x9015);
  const w = new PointWriter(8);
  // The star itself: aux.x = 1 marks it so the vertex shader pulses it.
  w.push(0, 0, 0, "#ffffff", 3, rng(), SHAPE.plus, [1, 0, 0, 0]);
  // A few faint wisps (synchrotron knots) that flicker, only when there is room.
  const n = size >= 96 ? 6 : size >= 48 ? 3 : 0;
  for (let i = 0; i < n; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const r = range(rng, 0.18, 0.4);
    w.push(Math.cos(a) * r, Math.sin(a) * r * 0.7, 0, "#8ad7ea", 1, rng(), SHAPE.cell, [0, 0, 0, 0]);
  }
  return {
    alpha: (range(rng, 25, 70) * Math.PI) / 180,
    delta: (range(rng, -8, 8) * Math.PI) / 180,
    psi: range(rng, 0, Math.PI * 2),
    spin: rng() < 0.5 ? 1 : -1,
    phase: range(rng, 0, Math.PI * 2),
    points: w.finish(),
  };
}

export interface PulsarGeometry {
  alpha: number;
  zeta: number;
  psi: number;
  spin: 1 | -1;
  phase: number;
  period: number;
  precess: number;
}

export function pulsarGeometry(spec: PulsarSpec, period: number, alphaDeg?: number, precess = 0): PulsarGeometry {
  const alpha = alphaDeg === undefined ? spec.alpha : (clamp(alphaDeg, 5, 89) * Math.PI) / 180;
  return { alpha, zeta: clamp(alpha + spec.delta, 0.02, Math.PI - 0.02), psi: spec.psi, spin: spec.spin, phase: spec.phase, period, precess };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Rotation axis and the two perpendicular unit vectors; e1 points toward the viewer's projection (mirrors GLSL `frame`). */
export function pulsarFrame(g: PulsarGeometry, t: number): { omega: Vec3; e1: Vec3; e2: Vec3 } {
  const psi = g.psi + g.precess * Math.sin(t * 0.7);
  const omega: Vec3 = [Math.sin(g.zeta) * Math.cos(psi), Math.sin(g.zeta) * Math.sin(psi), Math.cos(g.zeta)];
  const z: Vec3 = [0, 0, 1];
  const d = dot3(z, omega);
  const p: Vec3 = [z[0] - d * omega[0], z[1] - d * omega[1], z[2] - d * omega[2]];
  const e1: Vec3 = Math.hypot(...p) < 1e-4 ? [1, 0, 0] : norm(p);
  return { omega, e1, e2: cross(omega, e1) };
}

/** Magnetic axis at time t: alpha from omega, swept around it once per period (mirrors GLSL). */
export function magneticAxis(g: PulsarGeometry, t: number): Vec3 {
  const { omega, e1, e2 } = pulsarFrame(g, t);
  const phi = g.spin * ((t * Math.PI * 2) / g.period) + g.phase;
  const ca = Math.cos(g.alpha);
  const sa = Math.sin(g.alpha);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  return [ca * omega[0] + sa * (cp * e1[0] + sp * e2[0]), ca * omega[1] + sa * (cp * e1[1] + sp * e2[1]), ca * omega[2] + sa * (cp * e1[2] + sp * e2[2])];
}

/** Smallest angle between either beam and the line of sight (+z). */
export function beamAngleToViewer(m: Vec3): number {
  const c = clamp(Math.abs(m[2]), 0, 1);
  return Math.acos(c);
}

/** 0 when no beam is within rho of the viewer, rising to 1 when a beam axis is within 0.35 rho (mirrors GLSL, before quantising). */
export function pulseStrength(g: PulsarGeometry, t: number, rho = PULSAR_RHO): number {
  return clamp((rho - beamAngleToViewer(magneticAxis(g, t))) / (rho * 0.65), 0, 1);
}

/** Shared GLSL: rotation frame, magnetic axis, quantised pulse (3 steps). */
const PULSAR_GLSL = /* glsl */ `
uniform float uPeriod, uPhase, uSpin, uAlpha, uZeta, uPsi, uPrecess, uRho;
void frame(float t, out vec3 om, out vec3 e1, out vec3 e2) {
  float psi = uPsi + uPrecess * sin(t * 0.7);
  om = vec3(sin(uZeta) * cos(psi), sin(uZeta) * sin(psi), cos(uZeta));
  vec3 z = vec3(0.0, 0.0, 1.0);
  vec3 p = z - dot(z, om) * om;
  e1 = length(p) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(p);
  e2 = cross(om, e1);
}
vec3 magneticAxis(float t, vec3 om, vec3 e1, vec3 e2) {
  float phi = uSpin * t * 6.2832 / uPeriod + uPhase;
  return cos(uAlpha) * om + sin(uAlpha) * (cos(phi) * e1 + sin(phi) * e2);
}
float pulseOf(vec3 m) {
  float ang = acos(clamp(abs(m.z), 0.0, 1.0));
  float s = clamp((uRho - ang) / (uRho * 0.65), 0.0, 1.0);
  return band(s * 0.999, 3.0) * 1.5;   // 0, 0.5, 1
}
`;

const BEAM_FRAG = /* glsl */ `
${QUAD_PRELUDE}
${GLSL_LIGHT}
${PULSAR_GLSL}
uniform float uLen, uWidth, uAppearAt, uHaloR, uTorus;
uniform vec3 uPal[8];
uniform float uSteps, uAlphaMax, uDither;
uniform vec3 uHalo, uCore, uTorusC;
// Projected cone of one beam along the unit 3D axis m: a Gaussian across, exponential along.
// Foreshortens as m leaves the screen plane and opens up as it tilts toward the viewer.
float beam(vec2 p, vec3 m, float len, float width) {
  vec2 d = m.xy;
  float fore = length(d);
  vec2 dir = fore < 1e-4 ? vec2(1.0, 0.0) : d / fore;
  float Lp = len * (0.15 + 0.85 * fore);
  float al = dot(p, dir);
  if (al < 0.0 || al > Lp) return 0.0;
  float ac = dot(p, vec2(-dir.y, dir.x));
  float halfw = width * (0.1 + al * 0.42) * (1.0 + 0.9 * abs(m.z));
  float across = gaussianBand(ac, halfw * 0.8);
  float along = expDisc(al / Lp, 0.75) * (1.0 - smoothstep(0.78, 1.0, al / Lp));
  return across * along;
}
void main() {
  if (uTime < uAppearAt) discard;
  vec3 om, e1, e2;
  frame(uTime, om, e1, e2);
  vec3 m = magneticAxis(uTime, om, e1, e2);
  float pulse = pulseOf(m);
  vec2 p = vUv;
  float width = uWidth * mix(1.0, 1.6, uCute);
  float len = uLen * mix(1.0, 0.85, uCute);
  float prof = max(beam(p, m, len, width), beam(p, -m, len, width)) * (0.75 + 0.25 * pulse);
  // Halo around the star: a Sérsic glare a fixed few cells wide, swelling on the pulse.
  float r = length(vUv);
  float hr = uHaloR * (1.0 + 0.6 * pulse);
  prof = max(prof, sersic(r, hr * 0.45, 1.0) * (0.75 + 0.25 * pulse));
  vec4 g = glowSprite(prof, uSteps, uPal, uAlphaMax, gl_FragCoord.xy, uDither);
  vec3 c = g.rgb;
  float a = g.a;
  if (pulse > 0.9 && r < hr * 0.4) { c = uCore; a = 1.0; }

  if (uTorus > 0.5) {
    // Crab-style wind nebula: torus in the plane perpendicular to omega (an ellipse with ratio |om.z|),
    // an inner ring, and thin jets along +-omega. Gaussian bands, faint, two-step shimmer.
    vec2 axis = length(om.xy) < 1e-3 ? vec2(1.0, 0.0) : normalize(om.xy);
    vec2 tdir = vec2(-axis.y, axis.x);
    float u = dot(p, tdir);
    float v = dot(p, axis);
    float ratio = max(abs(om.z), 0.12);
    float R = 0.46;
    float el = length(vec2(u / R, v / (R * ratio)));
    float ring = gaussianBand(el - 1.0, 0.06);
    float inner = gaussianBand(el - 0.42, 0.06);
    float jet = gaussianBand(u, 0.012 + 0.012 * abs(v)) * step(abs(v), 0.8) * smoothstep(0.03, 0.1, abs(v));
    float tor = max(max(ring * 0.28, inner * 0.38), jet * 0.5);
    tor *= 0.8 + 0.2 * step(0.5, fract(uTime * 0.3 + u * 3.0 + v * 2.0));
    float tq = ditherQuantize(tor, 3.0, gl_FragCoord.xy, uDither);
    if (tq * 0.45 > a) { c = uTorusC; a = tq * 0.45; }
  }
  if (a <= 0.01) discard;
  gl_FragColor = vec4(themeTone(c, uLight), a * uFade);
  #include <colorspace_fragment>
}
`;

const PULSAR_POINT_VERT = /* glsl */ `
${POINT_PRELUDE}
${PULSAR_GLSL}
uniform float uAppearAt;
void main() {
  vec3 om, e1, e2;
  frame(uTime, om, e1, e2);
  float pulse = pulseOf(magneticAxis(uTime, om, e1, e2));
  float isStar = aux.x;
  float s = isStar > 0.5 ? (pulse > 0.9 ? 5.0 : 3.0) : 1.0;
  float sh = isStar > 0.5 ? (pulse > 0.9 ? 3.0 : 1.0) : 0.0;
  float flick = isStar > 0.5 ? 1.0 : step(0.5, fract(uTime * 0.7 + phase * 5.0));
  float a = uTime < uAppearAt ? 0.0 : (isStar > 0.5 ? mix(0.85, 1.0, pulse) : 0.6 * flick);
  emitPoint(position, color, a, s, sh);
}
`;

const PULSAR_GLOW = {
  beam: { dark: ["#1b2a5e", "#3b6fe0", "#8ad7ea", "#dff6ff", "#ffffff"], light: ["#9aa8c8", "#5a6fa6", "#2f4f8a", "#1f2f5a", "#17151d"], steps: 5, alphaMax: 0.95 },
  cute: { dark: ["#4a2040", "#b8508a", "#f2a7c6", "#ffe6f0", "#ffffff"], light: ["#c8a0b8", "#a05080", "#7a3060", "#4a2040", "#17151d"], steps: 5, alphaMax: 0.95 },
} as const;

export interface PulsarCoreProps {
  seed: number;
  size: number;
  theme: ObjectTheme;
  intensity: number;
  cute: number;
  period: number;
  beamLen: number;
  /** Magnetic inclination override in degrees; seeded when omitted. */
  alphaDeg?: number;
  torus?: boolean;
  precess?: number;
  /** Cosmos-clock seconds before which the pulsar is hidden (the remnant reveals it). */
  appearAt?: number;
}

export function PulsarCore({ seed, size, theme, intensity, cute, period, beamLen, alphaDeg, torus = false, precess = 0, appearAt = -1e9 }: PulsarCoreProps) {
  const spec = useMemo(() => generatePulsar(seed, size), [seed, size]);
  const pal = PULSAR_PALETTES[theme];
  const glow = useGlowUniforms(cute > 0.5 ? PULSAR_GLOW.cute : PULSAR_GLOW.beam, theme);
  const shared = useMemo(
    () => ({ uPeriod: num(1), uPhase: num(spec.phase), uSpin: num(spec.spin), uAlpha: num(spec.alpha), uZeta: num(spec.alpha + spec.delta), uPsi: num(spec.psi), uPrecess: num(0), uRho: num(PULSAR_RHO) }),
    [spec],
  );
  const uniforms = useMemo(
    () => ({
      ...shared,
      uLen: num(1),
      uWidth: num(0.12),
      uAppearAt: num(-1e9),
      uTorus: num(0),
      // 7 cells of halo radius in quad units (the quad spans `size` px).
      uHaloR: num(Math.min(0.3, 14 / Math.max(16, size))),
      uCore: color(pal.core),
      uHalo: color(pal.halo),
      uTorusC: color(pal.torus),
      ...glow,
    }),
    [shared, pal, size, glow],
  );
  const pointUniforms = useMemo(() => ({ ...shared, uAppearAt: num(-1e9) }), [shared]);
  useEffect(() => {
    const g = pulsarGeometry(spec, period, alphaDeg, precess);
    shared.uPeriod.value = g.period;
    shared.uAlpha.value = g.alpha;
    shared.uZeta.value = g.zeta;
    shared.uPrecess.value = g.precess;
    uniforms.uLen.value = beamLen;
    uniforms.uAppearAt.value = appearAt;
    uniforms.uTorus.value = torus ? 1 : 0;
    pointUniforms.uAppearAt.value = appearAt;
  }, [shared, uniforms, pointUniforms, spec, period, alphaDeg, precess, beamLen, appearAt, torus]);
  const beam = useQuadMaterial({ fragmentShader: BEAM_FRAG, uniforms, theme, fade: intensity, cute });
  const geometry = usePointsGeometry(spec.points);
  const star = usePointsMaterial({ vertexShader: PULSAR_POINT_VERT, uniforms: pointUniforms, theme, fade: Math.min(1, intensity) });
  return (
    <group>
      <mesh geometry={unitPlaneGeometry()} material={beam} scale={2} renderOrder={1} frustumCulled={false} />
      <points geometry={geometry} material={star} renderOrder={2} frustumCulled={false} />
    </group>
  );
}

export function Pulsar({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: PulsarParams }) {
  return (
    <PulsarCore
      seed={seed}
      size={size}
      theme={theme}
      intensity={intensity}
      cute={cute}
      period={Number(params.period)}
      beamLen={Number(params.beam)}
      alphaDeg={Number(params.alphaDeg)}
      torus={params.torus === "on"}
      precess={Number(params.precess)}
    />
  );
}

export const PULSAR_EXHIBIT: Exhibit<PulsarParams> = {
  id: "pulsar",
  title: "Pulsar",
  ref: "Lighthouse model (NASA Imagine, ATNF), 27-crab-pulsar-chandra torus + jets",
  budget: "1 cone quad + 1 points draw (<= 7 pts)",
  meaning: "A spaced-repetition reminder: it pulses until you review",
  su: 2.5,
  knobs: [
    { key: "period", label: "period s", min: 0.5, max: 2, step: 0.05 },
    { key: "alphaDeg", label: "alpha (magnetic tilt) deg", min: 10, max: 89, step: 1 },
    { key: "beam", label: "beam length", min: 0.4, max: 1, step: 0.05 },
    { key: "torus", label: "wind torus + jets", options: ["off", "on"] },
    { key: "precess", label: "precession", min: 0, max: 0.12, step: 0.01 },
  ],
  defaults: { period: 1.1, alphaDeg: 45, beam: 0.7, torus: "off", precess: 0.02 },
  readout: (seed, params) => {
    const g = pulsarGeometry(generatePulsar(seed, 320), Number(params.period), Number(params.alphaDeg), Number(params.precess));
    const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(0)}°`;
    return [
      ["alpha (m to omega)", deg(g.alpha)],
      ["zeta (omega to viewer)", deg(g.zeta)],
      ["beam grazes viewer by", deg(Math.abs(g.zeta - g.alpha))],
      ["spin", g.spin > 0 ? "counter-clockwise" : "clockwise"],
    ];
  },
  Component: Pulsar,
};
