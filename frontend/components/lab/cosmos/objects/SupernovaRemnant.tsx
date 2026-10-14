"use client";

import { useEffect, useMemo } from "react";
import { clamp, gaussian, int, mulberry32, pick, range } from "./lib/rng";
import { PointWriter, POINT_PRELUDE, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import { QUAD_PRELUDE, color, num, unitPlaneGeometry, useQuadMaterial } from "./lib/quad";
import type { Exhibit, ObjectBase } from "./lib/types";
import { PulsarCore } from "./Pulsar";
import { GLSL_LIGHT, useGlowUniforms } from "./lib/light";

/**
 * Supernova remnant: a cage of filament arcs (Crab) or neon ribbons (Veil)
 * around a pulsar, with a "go supernova" beat for the mastered-concept
 * celebration. Refs: 21-crab (orange/red cage, blue synchrotron heart),
 * 10-veil (cyan + magenta ribbons). Stylised: Kirby star pop, Mario Galaxy
 * star-bit burst. Beat (game-feel tiers, large): 80 ms hit-stop while the
 * star goes white, flash disc 60-500 ms, shell ease-out-back 80-1400 ms with
 * per-filament stagger, brightness 2x -> 1x, pulsar appears at 1.2 s.
 *
 * Budget: 1 points draw (<= 520 pts) + 2 quads (heart glow, flash) + pulsar (2 draws).
 */
export type RemnantVariant = "crab" | "veil";
export interface RemnantParams extends Record<string, number | string> {
  variant: RemnantVariant;
  stage: "star" | "remnant";
  /** Cosmos-clock seconds when "go" was pressed; -1e9 = never (idle remnant). */
  beatAt: number;
}

export const REMNANT_PALETTES: Record<RemnantVariant, { filaments: readonly string[]; hot: string; heart: string; heartEdge: string; star: string; flash: string }> = {
  crab: { filaments: ["#e8963a", "#f0b07a", "#d04a3a", "#b8d070", "#ffe6a8"], hot: "#ffffff", heart: "#8ad7ea", heartEdge: "#3b6fe0", star: "#f0a060", flash: "#fff4e0" },
  veil: { filaments: ["#6fd3f0", "#3b6fe0", "#e04ab0", "#e8963a", "#b8d070"], hot: "#ffffff", heart: "#3a3a6a", heartEdge: "#2a1a3a", star: "#f0a060", flash: "#dfe8ff" },
};

export const REMNANT_MAX_POINTS = 520;

const REMNANT_GLOW = {
  crab: { dark: ["#1b2a5e", "#3b6fe0", "#6fb8ff", "#b8dcff", "#dff6ff"], light: ["#9aa8c8", "#5a6fa6", "#3f5f9a", "#2f4f8a", "#17151d"], steps: 5, alphaMax: 0.5 },
  veil: { dark: ["#1a1a3a", "#3a3a6a", "#5a5a8a"], light: ["#a8a8c8", "#6a6a9a", "#4a4a70"], steps: 3, alphaMax: 0.35 },
} as const;

export function remnantPointCount(size: number): number {
  return clamp(Math.round(size * 2.4), 60, REMNANT_MAX_POINTS);
}

/**
 * Filaments: K arcs on a lumpy sphere, each a great-circle segment with
 * wobble; projected to the view plane, z kept for brightness. aux = (z, delay, knot, arcId).
 */
export function generateRemnant(seed: number, size: number, variant: RemnantVariant, cute: number): PointBuffers {
  const rng = mulberry32(seed ^ 0x5e7a);
  const pal = REMNANT_PALETTES[variant];
  const total = remnantPointCount(size);
  const arcs = Math.max(4, int(rng, 10, 16) - Math.round(cute * 4));
  const perArc = Math.max(4, Math.floor(total / arcs));
  const w = new PointWriter(REMNANT_MAX_POINTS);
  for (let k = 0; k < arcs; k++) {
    // Random axis; the arc lives on the great circle perpendicular to it.
    const z = rng() * 2 - 1;
    const t = rng() * Math.PI * 2;
    const rr = Math.sqrt(1 - z * z);
    const ax = [rr * Math.cos(t), rr * Math.sin(t), z];
    // Orthonormal basis (u, v) of the plane perpendicular to the axis.
    const ref = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = cross(ax, ref);
    normalize(u);
    const v = cross(ax, u);
    const start = range(rng, 0, Math.PI * 2);
    const span = range(rng, 0.7, 2.2) * (1 - 0.3 * cute);
    const colour = pick(rng, pal.filaments);
    const colour2 = pick(rng, pal.filaments);
    const delay = rng() * 0.3;
    const wobbleF = range(rng, 2, 5);
    const wobbleA = range(rng, 0.04, 0.12) * (1 - 0.5 * cute);
    for (let i = 0; i < perArc && w.count < total; i++) {
      const s = i / (perArc - 1);
      const a = start + s * span;
      const radial = 1 + wobbleA * Math.sin(a * wobbleF + k) + gaussian(rng) * 0.025;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const px = (u[0] * ca + v[0] * sa) * radial;
      const py = (u[1] * ca + v[1] * sa) * radial;
      const pz = (u[2] * ca + v[2] * sa) * radial;
      const knot = rng() < 0.08 ? 1 : 0;
      const c = rng() < 0.7 ? colour : colour2;
      // Squash y a touch so the remnant is an oval, like the Crab.
      const bigKnot = knot === 1 && size >= 160;
      w.push(px * 0.74, py * 0.64, pz * 0.74, c, bigKnot ? 3 : 1, rng(), bigKnot ? SHAPE.blob : SHAPE.cell, [pz, delay, knot, k]);
    }
  }
  return w.finish();
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a: number[]): void {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  a[0] /= l;
  a[1] /= l;
  a[2] /= l;
}

const REMNANT_VERT = /* glsl */ `
${POINT_PRELUDE}
uniform float uBeatAt, uStage;
uniform vec3 uHot;
void main() {
  float tb = uTime - uBeatAt;
  float R = 1.0;
  float bright = 1.0;
  float a = uStage > 0.5 ? 1.0 : 0.0;
  if (uStage > 0.5 && tb >= 0.0 && tb < 1.6) {
    if (tb < 0.08) a = 0.0;                                   // hit-stop: nothing moves yet
    float tt = clamp((tb - 0.08 - aux.y * 0.25) / 1.1, 0.0, 1.0);
    R = mix(0.03, 1.0, easeOutBack(tt));
    bright = mix(2.2, 1.0, easeOutCubic(clamp(tb / 1.5, 0.0, 1.0)));
  }
  // Idle: filaments shimmer a cell now and then (two-step, slow), never continuous drift.
  float tw = step(0.5, fract(uTime / (4.0 + 5.0 * phase) + phase * 7.0));
  vec3 pos = position * R;
  float depth = 0.6 + 0.4 * clamp(aux.x * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(color, uHot, clamp(bright - 1.0, 0.0, 1.0) * 0.85) * bright;
  float alpha = a * depth * mix(0.75, 1.0, tw);
  emitPoint(pos, c, alpha, size, shape);
}
`;

const HEART_FRAG = /* glsl */ `
${QUAD_PRELUDE}
${GLSL_LIGHT}
uniform float uBeatAt, uStage, uOn;
uniform vec3 uPal[8];
uniform float uSteps, uAlphaMax, uDither;
void main() {
  if (uStage < 0.5 || uOn < 0.5) discard;
  float tb = uTime - uBeatAt;
  float grow = tb >= 0.0 && tb < 1.6 ? mix(0.05, 1.0, easeOutCubic(clamp((tb - 0.3) / 1.1, 0.0, 1.0))) : 1.0;
  vec2 p = vUv / grow;
  float r = length(p * vec2(1.0, 1.15));
  // Synchrotron heart: a Sérsic glow (n = 1) with a slow fbm mottle, dithered into the blue ramp.
  float n = 0.85 + 0.3 * (fbm3(p * 2.5 + uTime * 0.01) - 0.5);
  float prof = sersic(r, 0.42, 1.0) * n * (1.0 - smoothstep(0.85, 1.0, r));
  vec4 g = glowSprite(prof, uSteps, uPal, uAlphaMax, gl_FragCoord.xy, uDither);
  if (g.a <= 0.0) discard;
  gl_FragColor = vec4(themeTone(g.rgb, uLight), g.a * uFade);
  #include <colorspace_fragment>
}
`;

const FLASH_FRAG = /* glsl */ `
${QUAD_PRELUDE}
uniform float uBeatAt, uStage;
uniform vec3 uFlash, uStar;
void main() {
  float tb = uTime - uBeatAt;
  float r = length(vUv);
  if (uStage < 0.5) {
    // Progenitor: a red supergiant glow, 3 bands, slow 2-step pulse.
    float pulse = mix(0.9, 1.0, step(0.5, fract(uTime / 2.3)));
    float fall = (1.0 - smoothstep(0.0, 0.2 * pulse, r));
    float lvl = band(fall, 3.0);
    if (lvl <= 0.0) discard;
    gl_FragColor = vec4(themeTone(uStar, uLight), lvl * 0.8 * uFade);
    #include <colorspace_fragment>
    return;
  }
  if (tb < 0.0 || tb > 0.6) discard;
  if (tb < 0.08) {
    // Hit-stop: the star collapses white and swells one step.
    float fall = 1.0 - smoothstep(0.0, 0.2, r);
    if (band(fall, 2.0) <= 0.0) discard;
    gl_FragColor = vec4(vec3(1.0), 0.95 * uFade);
    #include <colorspace_fragment>
    return;
  }
  // Flash: a white disc pops to 0.45 in 100 ms and collapses to nothing by 0.3 s (shrinks, never greys),
  // while a shock ring runs out to the box edge and thins.
  float discR = tb < 0.18 ? mix(0.15, 0.45, easeOutCubic(clamp((tb - 0.08) / 0.1, 0.0, 1.0))) : mix(0.45, 0.0, easeInCubic(clamp((tb - 0.18) / 0.12, 0.0, 1.0)));
  float disc = 1.0 - smoothstep(0.0, max(discR, 1e-3), r);
  float discA = band(disc, 2.0) > 0.0 ? 1.0 : 0.0;
  // Shock ring: thin, hard-edged, white then cream, gone by 0.5 s; two alpha steps, never a soft fade.
  float k = clamp((tb - 0.1) / 0.4, 0.0, 1.0);
  float R = mix(0.2, 1.0, easeOutCubic(k));
  float w = mix(0.09, 0.035, k);
  float ring = step(abs(r - (R - w * 0.5)), w * 0.5);
  float ringA = ring * (k < 0.55 ? 1.0 : 0.5) * step(k, 0.96);
  float a = max(discA, ringA);
  if (a <= 0.02) discard;
  vec3 c = (discA >= ringA || k < 0.3) ? vec3(1.0) : uFlash;
  gl_FragColor = vec4(themeTone(c, uLight), a * uFade);
  #include <colorspace_fragment>
}
`;

export function SupernovaRemnant({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: RemnantParams }) {
  const variant = params.variant;
  const stage = params.stage === "star" ? 0 : 1;
  const beatAt = Number(params.beatAt);
  const buffers = useMemo(() => generateRemnant(seed, size, variant, cute), [seed, size, variant, cute]);
  const pal = REMNANT_PALETTES[variant];
  const pointUniforms = useMemo(() => ({ uBeatAt: num(-1e9), uStage: num(1), uHot: color(pal.hot) }), [pal]);
  const heartGlow = useGlowUniforms(variant === "crab" ? REMNANT_GLOW.crab : REMNANT_GLOW.veil, theme);
  const heartUniforms = useMemo(() => ({ uBeatAt: num(-1e9), uStage: num(1), uOn: num(variant === "crab" ? 1 : 0), ...heartGlow }), [variant, heartGlow]);
  const flashUniforms = useMemo(() => ({ uBeatAt: num(-1e9), uStage: num(1), uFlash: color(pal.flash), uStar: color(pal.star) }), [pal]);
  useEffect(() => {
    for (const u of [pointUniforms, heartUniforms, flashUniforms]) {
      u.uBeatAt.value = beatAt;
      u.uStage.value = stage;
    }
  }, [pointUniforms, heartUniforms, flashUniforms, beatAt, stage]);
  const geometry = usePointsGeometry(buffers);
  const filaments = usePointsMaterial({ vertexShader: REMNANT_VERT, uniforms: pointUniforms, theme, fade: Math.min(1.2, intensity) });
  const heart = useQuadMaterial({ fragmentShader: HEART_FRAG, uniforms: heartUniforms, theme, fade: intensity, cute });
  const flash = useQuadMaterial({ fragmentShader: FLASH_FRAG, uniforms: flashUniforms, theme, fade: 1, cute });
  const pulsarAppears = stage === 1 ? (beatAt > -1e8 ? beatAt + 1.2 : -1e9) : 1e9;
  return (
    <group>
      <mesh geometry={unitPlaneGeometry()} material={heart} scale={0.9} renderOrder={0} frustumCulled={false} />
      <points geometry={geometry} material={filaments} renderOrder={1} frustumCulled={false} />
      <group scale={0.4}>
        <PulsarCore seed={seed ^ 0x77} size={size * 0.4} theme={theme} intensity={intensity * 0.8} cute={cute} period={variant === "crab" ? 0.7 : 1.3} beamLen={0.9} torus precess={0.02} appearAt={pulsarAppears} />
      </group>
      <mesh geometry={unitPlaneGeometry()} material={flash} scale={2.2} renderOrder={3} frustumCulled={false} />
    </group>
  );
}

export const SUPERNOVA_EXHIBIT: Exhibit<RemnantParams> = {
  id: "supernova",
  title: "Supernova remnant",
  ref: "21-crab cage + pulsar, 10-veil ribbons; Kirby star pop",
  budget: "1 points draw (<= 520 pts) + 2 quads + pulsar (2)",
  meaning: "Concept mastered: the star goes supernova once, the remnant stays as the trophy",
  su: 16,
  knobs: [{ key: "variant", label: "variant", options: ["crab", "veil"] }],
  defaults: { variant: "crab", stage: "remnant", beatAt: -1e9 },
  actions: [
    { label: "Go supernova", run: (_p, now) => ({ stage: "remnant", beatAt: now }) },
    { label: "Reset to star", run: () => ({ stage: "star", beatAt: -1e9 }) },
  ],
  Component: SupernovaRemnant,
};
