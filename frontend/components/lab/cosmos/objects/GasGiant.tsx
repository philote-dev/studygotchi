"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { clamp, int, mulberry32, pick, range } from "./lib/rng";
import { PointWriter, POINT_PRELUDE, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import { QUAD_PRELUDE, color, num, unitPlaneGeometry, useQuadMaterial, vec3 } from "./lib/quad";
import type { Exhibit, ObjectBase } from "./lib/types";

/**
 * Ringed gas giant with moons. One quad draws the banded body (toon-lit in 3
 * steps with a limb light), the tilted rings with a Cassini gap, the planet's
 * shadow on the rings and the rings' shadow on the planet; moons are a points
 * draw on tilted orbits that hide behind the disc. Refs: 17-jupiter (cream /
 * tan / rust bands, white ovals, one red spot), 16-saturn (thin ice rings,
 * dark disc with a bright rim). Stylised: Astroneer two-band planets with one
 * rim light, Mario Galaxy toy planets.
 *
 * Budget: 1 body+rings quad + 1 points draw (2-4 moons).
 */
export type GiantPalette = "jupiter" | "saturn" | "ice" | "candy";
export interface GiantParams extends Record<string, number | string> {
  palette: GiantPalette;
  bands: number;
  tilt: number;
  moons: number;
}

export const GIANT_PALETTES: Record<GiantPalette, { light: string; mid: string; dark: string; storm: string; ringA: string; ringB: string; limb: string; moons: readonly string[] }> = {
  jupiter: { light: "#f0e6d2", mid: "#c9a070", dark: "#b85a3a", storm: "#d9623a", ringA: "#c9b48a", ringB: "#8a7a5a", limb: "#fff4e0", moons: ["#e8dcc8", "#c9a070", "#8a8ea0", "#f5f0e8"] },
  saturn: { light: "#f5e8c8", mid: "#d9c3a0", dark: "#b89a6a", storm: "#e8dcc8", ringA: "#a8c0e0", ringB: "#c9b48a", limb: "#ffffff", moons: ["#e8e6e0", "#cfcac0", "#c9b48a"] },
  ice: { light: "#dff0ff", mid: "#8fb0d8", dark: "#4f6ea8", storm: "#ffffff", ringA: "#c9d6e6", ringB: "#6f8fc0", limb: "#ffffff", moons: ["#e8e6e0", "#b8dcff", "#8a8ea0"] },
  candy: { light: "#ffe6f0", mid: "#f2a7c6", dark: "#c06090", storm: "#fff4e0", ringA: "#ffd36a", ringB: "#e9a6c9", limb: "#ffffff", moons: ["#fff0c2", "#8ad7ea", "#e9a6c9", "#ffffff"] },
};

export interface GiantSpec {
  tiltA: number;
  sun: [number, number, number];
  obliquity: number;
  spot: [number, number];
  spotR: number;
  ringIn: number;
  ringOut: number;
  gap: [number, number];
  spin: number;
  moons: PointBuffers;
}

export function generateGiant(seed: number, size: number, palette: GiantPalette, tilt: number, moonCount: number, cute: number): GiantSpec {
  const rng = mulberry32(seed ^ 0x6a57);
  const pal = GIANT_PALETTES[palette];
  // Sun direction: from the upper left/right, slightly toward the viewer.
  const sx = range(rng, -0.8, 0.8);
  const sy = range(rng, 0.25, 0.7);
  const sz = range(rng, 0.45, 0.8);
  const l = Math.hypot(sx, sy, sz);
  const n = clamp(Math.round(moonCount), 0, 4);
  const w = new PointWriter(4);
  for (let i = 0; i < n; i++) {
    // Orbit radius in planet radii; moons march outward so none overlap.
    const radius = 1.45 + i * 0.42 + range(rng, 0, 0.2);
    const period = range(rng, 9, 16) * (1 + i * 0.6);
    const phase = range(rng, 0, Math.PI * 2);
    const sizeCells = size >= 160 ? (i === 0 ? 3 : pick(rng, [3, 3, 5])) : size >= 64 ? 3 : 1;
    w.push(radius, period, phase, pick(rng, pal.moons), sizeCells, rng(), SHAPE.moon, [radius, period, phase, rng() < 0.5 ? 1 : -1]);
  }
  return {
    tiltA: clamp(tilt, 0.05, 1.5),
    sun: [sx / l, sy / l, sz / l],
    obliquity: range(rng, -0.35, 0.35) * (1 - 0.5 * cute),
    spot: [range(rng, -1, 1), range(rng, -0.6, -0.15) * (rng() < 0.5 ? 1 : -1)],
    spotR: range(rng, 0.17, 0.26) * (1 + 0.3 * cute),
    ringIn: range(rng, 1.25, 1.4),
    ringOut: range(rng, 2.0, 2.25),
    gap: [1.72, 1.8],
    spin: range(rng, 0.03, 0.06) * (rng() < 0.5 ? 1 : -1),
    moons: w.finish(),
  };
}

const PR = 0.42;

const GIANT_FRAG = /* glsl */ `
${QUAD_PRELUDE}
uniform vec3 uSun;
uniform float uTiltA, uBands, uObliq, uSpotR, uRingIn, uRingOut, uGapA, uGapB, uSpin, uSeed;
uniform vec2 uSpot;
uniform vec3 uLightC, uMidC, uDarkC, uStorm, uRingA, uRingB, uLimb;
const float PR = ${PR.toFixed(2)};
void main() {
  vec2 p = vUv / PR;                // planet radius = 1
  float r2 = dot(p, p);
  float st = sin(uTiltA);
  float ct = cos(uTiltA);
  float nb = max(2.0, floor(uBands - uCute * 2.0 + 0.5));

  // ---- rings in the tilted plane: screen y = -rho sin(phi) sin(tilt), depth z = rho sin(phi) cos(tilt)
  float rho = length(vec2(p.x, p.y / max(st, 1e-3)));
  float ringMask = step(uRingIn, rho) * step(rho, uRingOut) * (1.0 - step(uGapA, rho) * step(rho, uGapB));
  vec3 P = vec3(p.x, p.y, -p.y * ct / max(st, 1e-3));
  float along = dot(P, uSun);
  vec3 side = P - along * uSun;
  float inShadow = step(along, 0.0) * step(length(side), 1.0);
  float rb = band((rho - uRingIn) / (uRingOut - uRingIn), 3.0);
  vec3 ringC = rb < 0.2 ? uRingA : (rb < 0.5 ? uRingB : mix(uRingA, uRingB, 0.5));
  float ringAlpha = rb < 0.5 ? 0.92 : 0.6;
  // Backlit rim (Saturn): ring edge nearest the sun catches light.
  ringC = mix(ringC, uLimb, 0.35 * step(0.6, rb) * step(0.0, along));
  ringC *= mix(1.0, 0.35, inShadow);
  bool ringNear = p.y < 0.0;

  // ---- planet body
  vec4 body = vec4(0.0);
  if (r2 <= 1.0) {
    vec3 N = vec3(p.x, p.y, sqrt(1.0 - r2));
    vec2 ob = rot2(uObliq) * N.xy;
    float lat = asin(clamp(ob.y, -1.0, 1.0));
    float lon = atan(ob.x, N.z) + uTime * uSpin * 6.2832;
    float wave = (1.0 - uCute) * 0.06 * sin(lon * 3.0 + lat * 5.0 + uSeed);
    float idx = floor((lat / 3.14159 + 0.5) * nb + wave);
    float m = mod(idx, 3.0);
    vec3 c = m < 0.5 ? uLightC : (m < 1.5 ? uMidC : uDarkC);
    // Poles a little darker.
    c = mix(c, uDarkC, step(abs(lat), 0.0) + 0.35 * step(1.15, abs(lat)));
    // Storm oval: visible on the near face only.
    float dlon = atan(sin(lon - uSpot.x), cos(lon - uSpot.x));
    vec2 sd = vec2(dlon * cos(lat), lat - uSpot.y) / vec2(uSpotR, uSpotR * 0.62);
    float sdist = length(sd);
    if (sdist < 1.0) c = sdist < 0.5 ? mix(uStorm, uLightC, 0.3) : uStorm;
    // Ring shadow on the body: the sun ray from this point crosses the ring annulus.
    vec3 n = vec3(0.0, ct, st);
    float denom = dot(n, uSun);
    if (abs(denom) > 1e-3) {
      float t = -dot(n, N) / denom;
      vec3 H = N + t * uSun;
      float rh = length(H);
      if (t > 0.0 && rh > uRingIn && rh < uRingOut && !(rh > uGapA && rh < uGapB)) c *= 0.55;
    }
    // Toon light: three steps plus a limb light on the lit side.
    float lam = dot(N, uSun);
    float shade = lam > 0.4 ? 1.0 : (lam > 0.0 ? 0.74 : mix(0.4, 0.55, uCute));
    c *= shade;
    if (r2 > 0.84 && lam > 0.15) c = mix(c, uLimb, 0.45);
    body = vec4(c, 1.0);
  }

  vec4 col = body;
  if (ringMask > 0.5) {
    vec4 ring = vec4(ringC, ringAlpha);
    if (body.a > 0.5) { if (ringNear) col = vec4(mix(body.rgb, ring.rgb, ring.a), 1.0); }
    else col = ring;
  }
  if (col.a <= 0.01) discard;
  gl_FragColor = vec4(bodyTone(col.rgb, uLight), col.a * min(uFade, 1.0));
  #include <colorspace_fragment>
}
`;

const MOON_VERT = /* glsl */ `
${POINT_PRELUDE}
uniform float uTiltA, uSunX;
uniform float uPR;
void main() {
  float radius = aux.x;
  float period = aux.y;
  float ph = aux.z + aux.w * uTime * 6.2832 / period;
  float st = sin(uTiltA);
  float ct = cos(uTiltA);
  vec2 pos = vec2(cos(ph) * radius, -sin(ph) * radius * st) * uPR;
  float z = sin(ph) * ct;
  float behind = step(z, 0.0) * step(length(pos), uPR);
  emitPoint(vec3(pos, 0.0), color, 1.0 - behind, size, shape);
  vSide = uSunX;
}
`;

export function GasGiant({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: GiantParams }) {
  const palette = params.palette;
  const tilt = Number(params.tilt);
  const moonCount = Number(params.moons);
  const spec = useMemo(() => generateGiant(seed, size, palette, tilt, moonCount, cute), [seed, size, palette, tilt, moonCount, cute]);
  const pal = GIANT_PALETTES[palette];
  const uniforms = useMemo(
    () => ({
      uSun: vec3(spec.sun[0], spec.sun[1], spec.sun[2]),
      uTiltA: num(spec.tiltA),
      uBands: num(5),
      uObliq: num(spec.obliquity),
      uSpot: { value: new THREE.Vector2(spec.spot[0], spec.spot[1]) },
      uSpotR: num(spec.spotR),
      uRingIn: num(spec.ringIn),
      uRingOut: num(spec.ringOut),
      uGapA: num(spec.gap[0]),
      uGapB: num(spec.gap[1]),
      uSpin: num(spec.spin),
      uSeed: num((seed % 100) / 7),
      uLightC: color(pal.light),
      uMidC: color(pal.mid),
      uDarkC: color(pal.dark),
      uStorm: color(pal.storm),
      uRingA: color(pal.ringA),
      uRingB: color(pal.ringB),
      uLimb: color(pal.limb),
    }),
    [spec, pal, seed],
  );
  const moonU = useMemo(() => ({ uTiltA: num(spec.tiltA), uSunX: num(Math.sign(spec.sun[0]) || 1), uPR: num(PR) }), [spec]);
  useEffect(() => {
    uniforms.uBands.value = Number(params.bands);
  }, [uniforms, params.bands]);
  const body = useQuadMaterial({ fragmentShader: GIANT_FRAG, uniforms, theme, fade: intensity, cute, additive: false });
  const geometry = usePointsGeometry(spec.moons);
  const moons = usePointsMaterial({ vertexShader: MOON_VERT, uniforms: moonU, theme, fade: 1, additive: false });
  return (
    <group>
      <mesh geometry={unitPlaneGeometry()} material={body} scale={2} renderOrder={1} frustumCulled={false} />
      <points geometry={geometry} material={moons} renderOrder={2} frustumCulled={false} />
    </group>
  );
}

export const GAS_GIANT_EXHIBIT: Exhibit<GiantParams> = {
  id: "giant",
  title: "Ringed gas giant",
  ref: "17-jupiter bands + spot, 16-saturn rings; Astroneer rim light",
  budget: "1 body+rings quad + 1 points draw (2-4 moons)",
  meaning: "The near-planet field: a course planet, moons are its units",
  su: 1.1,
  knobs: [
    { key: "palette", label: "palette", options: ["jupiter", "saturn", "ice", "candy"] },
    { key: "bands", label: "bands", min: 3, max: 7, step: 1 },
    { key: "tilt", label: "ring tilt", min: 0.1, max: 1.2, step: 0.05 },
    { key: "moons", label: "moons", min: 0, max: 4, step: 1 },
  ],
  defaults: { palette: "jupiter", bands: 5, tilt: 0.42, moons: 3 },
  Component: GasGiant,
};
