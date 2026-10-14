"use client";

import { useEffect, useMemo } from "react";
import { mulberry32, range } from "./lib/rng";
import { PointWriter, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import { QUAD_PRELUDE, color, num, unitPlaneGeometry, useQuadMaterial } from "./lib/quad";
import type { Exhibit, ObjectBase } from "./lib/types";

/**
 * Planetary nebula: concentric banded shells around a bright white dwarf,
 * breathing slowly (the shell is expanding). Refs: 18-ring (teal inside,
 * yellow-orange-red outside), 19-butterfly (two orange-pink lobes pinched by
 * a dark dust waist), 20-cats-eye (nested rotated ellipses, teal and cream).
 * Stylised: Kirby's candy rings, Katamari's flat concentric planets.
 *
 * Budget: 1 shell quad + 1 points draw (dwarf + <= 4 sparkles).
 */
export type PlanetaryShape = "ring" | "butterfly" | "cat";
export interface PlanetaryParams extends Record<string, number | string> {
  shape: PlanetaryShape;
  breath: number;
}

export const PLANETARY_PALETTES: Record<PlanetaryShape, { inner: string; a: string; b: string; c: string; halo: string; dust: string; dwarf: string }> = {
  ring: { inner: "#4fb0c0", a: "#b8d070", b: "#e8963a", c: "#c0401a", halo: "#4a2a3a", dust: "#1a1020", dwarf: "#ffffff" },
  butterfly: { inner: "#fff0c2", a: "#f0a060", b: "#e06a7c", c: "#a04ab0", halo: "#4a2a4a", dust: "#2a1408", dwarf: "#ffffff" },
  cat: { inner: "#dfe8ff", a: "#6fd3f0", b: "#f0d9a8", c: "#e8963a", halo: "#3a3a6a", dust: "#101a30", dwarf: "#ffffff" },
};

export interface PlanetarySpec {
  roll: number;
  phase: number;
  /** Shell eccentricity knobs the shader reads. */
  squash: number;
  waist: number;
  points: PointBuffers;
}

export function generatePlanetary(seed: number, size: number, shape: PlanetaryShape, cute: number): PlanetarySpec {
  const rng = mulberry32(seed ^ 0x91a6);
  const pal = PLANETARY_PALETTES[shape];
  const w = new PointWriter(6);
  // White dwarf: a plus star at >= 120 px, one bright cell below.
  w.push(0, 0, 0, pal.dwarf, size >= 120 ? 3 : 1, rng(), size >= 120 ? SHAPE.plus : SHAPE.cell);
  if (size >= 96) {
    const n = shape === "butterfly" ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const a = range(rng, 0, Math.PI * 2);
      const r = range(rng, 0.78, 0.96);
      w.push(Math.cos(a) * r, Math.sin(a) * r, 0, "#dfe8ff", 1, rng(), SHAPE.cell);
    }
  }
  return {
    roll: shape === "cat" ? range(rng, 0, Math.PI) : range(rng, -0.5, 0.5),
    phase: range(rng, 0, Math.PI * 2),
    squash: range(rng, 0.72, 0.9) + 0.1 * cute,
    waist: range(rng, 0.18, 0.28),
    points: w.finish(),
  };
}

const SHELL_FRAG = /* glsl */ `
${QUAD_PRELUDE}
uniform float uMode, uRoll, uPhase, uBreath, uSquash, uWaist, uSeed;
uniform vec3 uInner, uA, uB, uC, uHalo, uDust;
void main() {
  // Breathing: the whole shell grows and relaxes over uBreath seconds; a cell or two at 200 px.
  float breath = 1.0 + 0.035 * sin(uTime * 6.2832 / uBreath + uPhase);
  vec2 p = rot2(uRoll) * vUv / breath;
  float r = length(p);
  float th = atan(p.y, p.x);
  float mottle = (fbm3(p * 3.5 + uSeed) - 0.5) * mix(0.09, 0.03, uCute);
  float nb = floor(mix(5.0, 3.0, uCute) + 0.5);
  vec3 c = uInner;
  float a = 0.0;

  if (uMode < 0.5) {
    // Ring: faint teal fill, a yellow-green / orange / red ring (thin, feathered), dim halo.
    float s = length(p / vec2(1.0, uSquash)) * 1.7 + mottle * 2.0;
    // Radial streaks and a coarse grain, quantised to three levels, so the shells read as gas, not paint.
    float streak = fbm3(vec2(th * 2.5, s * 2.0) + uSeed);
    float grain = fbm3(p * 5.0 + uSeed * 2.0);
    float g = band(0.3 + 0.4 * streak + 0.5 * grain, 3.0) + 0.34;
    if (s < 0.62) { c = uInner; a = 0.26 * (0.5 + 0.5 * band(1.0 - s / 0.62, 2.0)) * (0.5 + 0.5 * band(grain * 1.2, 2.0)); }
    else if (s < 0.72) { c = uA; a = 0.55 * g; }
    else if (s < 0.84) { c = uB; a = 0.6 * g; }
    else if (s < 0.92) { c = uC; a = 0.5 * g; }
    else if (s < 1.05) { c = uC; a = 0.14 * g; }
    if (nb < 4.0 && s >= 0.72 && s < 0.92) { c = s < 0.84 ? uB : uC; a = 0.55 * g; }
  } else if (uMode < 1.5) {
    // Butterfly: two lobes, radius largest along +-x, pinched at the waist.
    float lobe = pow(abs(cos(th)), mix(0.6, 0.95, uCute));
    float R = mix(uWaist, 1.0, lobe);
    float s = r / R + mottle;
    float fil = 0.5 + 0.5 * sin(th * 9.0 + s * 14.0 + uSeed);   // radial streaks
    float k = 1.0 - s;
    if (s < 1.0) {
      float lvl = band(k * (0.85 + 0.3 * fil * (1.0 - uCute)), nb);
      float kk = lvl * nb / (nb - 1.0);
      c = kk > 0.75 ? uInner : (kk > 0.5 ? uA : (kk > 0.25 ? uB : uC));
      a = 0.35 + 0.6 * kk;
    }
    // dark dust torus at the waist, seen edge-on
    float torus = step(abs(p.x), uWaist * 0.6) * step(abs(p.y), 0.42) * step(0.08, abs(p.y));
    if (torus > 0.5) { c = uDust; a = 0.9; }
    // the central star shines through a small gap
    if (r < 0.07) { c = uInner; a = 0.9; }
  } else {
    // Cat's eye: nested ellipses, each rotated a little more, teal / cream / orange.
    float best = 1e3;
    float idx = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec2 e = rot2(fi * 0.55) * p;
      float len = length(e / vec2(1.0, 0.62)) + mottle;
      float Ri = 0.26 + 0.2 * fi;
      float d = abs(len - Ri);
      if (d < best) { best = d; idx = fi; }
      if (len < Ri && i == 3) a = max(a, 0.18);
    }
    float ringW = mix(0.035, 0.06, uCute);
    if (best < ringW) {
      c = idx < 0.5 ? uA : (idx < 1.5 ? uB : (idx < 2.5 ? uA : uC));
      a = 0.9 - 0.12 * idx;
    } else if (best < ringW * 2.2) {
      c = mix(uHalo, idx < 1.5 ? uA : uC, 0.5);
      a = 0.42 - 0.06 * idx;
    } else if (r < 0.2) { c = uInner; a = 0.45; }
    else if (r < 0.95) { c = uHalo; a = 0.2 * (1.0 - band(r, 3.0)); }
  }
  if (a <= 0.01) discard;
  gl_FragColor = vec4(themeTone(c, uLight), a * uFade);
  #include <colorspace_fragment>
}
`;

export function PlanetaryNebula({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: PlanetaryParams }) {
  const shape = params.shape;
  const spec = useMemo(() => generatePlanetary(seed, size, shape, cute), [seed, size, shape, cute]);
  const pal = PLANETARY_PALETTES[shape];
  const uniforms = useMemo(
    () => ({
      uMode: num(shape === "ring" ? 0 : shape === "butterfly" ? 1 : 2),
      uRoll: num(spec.roll),
      uPhase: num(spec.phase),
      uBreath: num(6),
      uSquash: num(spec.squash),
      uWaist: num(spec.waist),
      uSeed: num((seed % 1000) / 10),
      uInner: color(pal.inner),
      uA: color(pal.a),
      uB: color(pal.b),
      uC: color(pal.c),
      uHalo: color(pal.halo),
      uDust: color(pal.dust),
    }),
    [shape, spec, pal, seed],
  );
  useEffect(() => {
    uniforms.uBreath.value = Number(params.breath);
  }, [uniforms, params.breath]);
  // Additive on the dark sky: one quad, so stacking cannot blow out, and the shells glow instead of sitting like paint.
  const shell = useQuadMaterial({ fragmentShader: SHELL_FRAG, uniforms, theme, fade: intensity, cute });
  const geometry = usePointsGeometry(spec.points);
  const stars = usePointsMaterial({ theme, fade: Math.min(1, intensity) });
  return (
    <group>
      <mesh geometry={unitPlaneGeometry()} material={shell} scale={2} renderOrder={1} frustumCulled={false} />
      <points geometry={geometry} material={stars} renderOrder={2} frustumCulled={false} />
    </group>
  );
}

export const PLANETARY_NEBULA_EXHIBIT: Exhibit<PlanetaryParams> = {
  id: "planetary",
  title: "Planetary nebula",
  ref: "18-ring, 19-butterfly, 20-cat's eye; Kirby candy rings",
  budget: "1 shell quad + 1 points draw (<= 5 pts)",
  meaning: "A finished course: the dwarf is what remains, the shells are what it taught",
  su: 12,
  knobs: [
    { key: "shape", label: "shape", options: ["ring", "butterfly", "cat"] },
    { key: "breath", label: "breath s", min: 2, max: 12, step: 0.5 },
  ],
  defaults: { shape: "ring", breath: 6 },
  Component: PlanetaryNebula,
};
