"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { clamp, gaussian, mulberry32, pick, range } from "./lib/rng";
import { PointWriter, POINT_PRELUDE, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import { QUAD_PRELUDE, num, unitPlaneGeometry, useQuadMaterial } from "./lib/quad";
import { GLSL_LIGHT, useGlowUniforms } from "./lib/light";
import type { Exhibit, ObjectBase } from "./lib/types";

/**
 * Star clusters. Open (Pleiades): a few dozen blue-white stars, 6-9 bright
 * plus stars wrapped in wisps of blue reflection haze. Globular (Omega Cen /
 * 47 Tuc): hundreds of cream-yellow points on a King-like profile with a
 * solid core, a few red giants and blue stragglers. Refs: 22-pleiades,
 * 25-omega-centauri. Stylised: Spore's galaxy-map dot clumps.
 *
 * Budget: 1 points draw (open <= 90, globular <= 800) + 1 haze / core quad.
 */
export type ClusterKind = "open" | "globular";
export interface ClusterParams extends Record<string, number | string> {
  kind: ClusterKind;
  richness: number;
}

export const CLUSTER_PALETTES = {
  open: { stars: ["#ffffff", "#dfe8ff", "#b8dcff", "#cfe4ff"], bright: "#dff0ff", hazeA: "#1b2a5e", hazeB: "#3f5fa6", hazeC: "#8fb0d8" },
  globular: { stars: ["#ffe6b0", "#fff0c2", "#f5e8c8", "#ffd9a0"], giants: "#f0a060", stragglers: "#b8dcff", coreA: "#5a4a2a", coreB: "#c9a070" },
} as const;

export const CLUSTER_BUDGET = { open: 90, globular: 800 } as const;

export interface ClusterSpec {
  kind: ClusterKind;
  /** Bright-star centres the haze wraps (open only), up to 6. */
  bright: [number, number][];
  points: PointBuffers;
}

export function clusterCount(kind: ClusterKind, size: number, richness: number): number {
  const base = kind === "open" ? size * 0.3 : size * 2.7;
  return clamp(Math.round(base * richness), kind === "open" ? 12 : 60, CLUSTER_BUDGET[kind]);
}

export function generateCluster(seed: number, size: number, kind: ClusterKind, richness: number, cute: number): ClusterSpec {
  const rng = mulberry32(seed ^ 0xc1a5);
  const n = clusterCount(kind, size, richness);
  const w = new PointWriter(CLUSTER_BUDGET[kind]);
  const bright: [number, number][] = [];
  if (kind === "open") {
    const pal = CLUSTER_PALETTES.open;
    const nBright = clamp(Math.round(6 + 3 * rng()), 4, 9);
    const squash = range(rng, 0.7, 1);
    const roll = range(rng, 0, Math.PI);
    const place = (sigma: number): [number, number] => {
      const x = gaussian(rng) * sigma;
      const y = gaussian(rng) * sigma * squash;
      return [Math.cos(roll) * x - Math.sin(roll) * y, Math.sin(roll) * x + Math.cos(roll) * y];
    };
    for (let i = 0; i < nBright; i++) {
      const [x, y] = place(0.28);
      if (bright.length < 6) bright.push([x, y]);
      w.push(x, y, 0, pal.bright, size >= 96 ? (i < 2 ? 5 : 3) : size >= 48 ? 3 : 1, rng(), size >= 96 && i < 2 ? SHAPE.sparkle : SHAPE.plus);
    }
    for (let i = nBright; i < n; i++) {
      const [x, y] = place(0.36);
      w.push(x, y, 0, pick(rng, pal.stars), 1, rng(), SHAPE.cell);
    }
  } else {
    const pal = CLUSTER_PALETTES.globular;
    const rc = 0.12 + 0.06 * cute;
    const rt = 0.95;
    for (let i = 0; i < n; i++) {
      // King-ish: r = rc * sqrt(u^-1 - 1), clipped at the tidal radius.
      const u = Math.max(0.012, rng());
      const r = Math.min(rt, rc * Math.sqrt(1 / u - 1));
      const a = range(rng, 0, Math.PI * 2);
      const roll = rng();
      const c = roll < 0.05 ? pal.giants : roll < 0.08 ? pal.stragglers : pick(rng, pal.stars);
      w.push(Math.cos(a) * r, Math.sin(a) * r * 0.94, 0, c, roll < 0.05 && size >= 160 ? 3 : 1, rng(), roll < 0.05 && size >= 160 ? SHAPE.blob : SHAPE.cell);
    }
  }
  return { kind, bright, points: w.finish() };
}

const CLUSTER_VERT = /* glsl */ `
${POINT_PRELUDE}
void main() {
  // Big stars twinkle in two steps; cells flicker rarely so the clump feels alive without breathing.
  float tw = size > 1.5 ? mix(0.65, 1.0, twinkle2(uTime, phase)) : mix(0.8, 1.0, step(0.93, fract(uTime / (5.0 + 6.0 * phase) + phase)));
  emitPoint(position, color * tw, 1.0, size, shape);
}
`;

const HAZE_FRAG = /* glsl */ `
${QUAD_PRELUDE}
${GLSL_LIGHT}
uniform float uKind, uCount, uSeed;
uniform vec2 uStars[6];
uniform vec3 uPal[8];
uniform float uSteps, uAlphaMax, uDither;
void main() {
  vec2 p = vUv;
  float prof = 0.0;
  if (uKind < 0.5) {
    // Open: wisps of reflection nebula around the brightest stars, streaky fbm, Gaussian falloff per star.
    float h = 0.0;
    for (int i = 0; i < 6; i++) {
      if (float(i) >= uCount) break;
      h = max(h, gaussianBand(length(p - uStars[i]), 0.16));
    }
    vec2 sp = vec2(p.x * 1.4 + p.y * 1.1, p.y * 1.2 - p.x * 0.5);
    float streak = fbm3(sp * 3.2 + uSeed) * 0.6 + 0.4 * fbm3(sp * 7.0 + 3.0 + uSeed);
    prof = smoothstep(0.38, 0.75, streak) * h * mix(1.0, 1.3, uCute);
  } else {
    // Globular: a de Vaucouleurs-ish core (n = 2) so the ball reads as one warm glow even at 32 px.
    prof = sersic(length(p), 0.3, 2.0) * (1.0 - smoothstep(0.7, 1.0, length(p)));
  }
  vec4 g = glowSprite(prof, uSteps, uPal, uAlphaMax, gl_FragCoord.xy, uDither);
  if (g.a <= 0.0) discard;
  gl_FragColor = vec4(themeTone(g.rgb, uLight), g.a * uFade);
  #include <colorspace_fragment>
}
`;

const CLUSTER_GLOW = {
  open: { dark: ["#1b2a5e", "#3f5fa6", "#8fb0d8"], light: ["#a8b8d8", "#6a7fb0", "#3f5f9a"], steps: 4, alphaMax: 0.55 },
  globular: { dark: ["#3a2a14", "#8a6a3a", "#c9a070", "#ffe6b0"], light: ["#c9b48a", "#9a7a4a", "#6a4a2a", "#3a2a14"], steps: 4, alphaMax: 0.6 },
} as const;

export function StarCluster({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: ClusterParams }) {
  const kind = params.kind;
  const richness = Number(params.richness);
  const spec = useMemo(() => generateCluster(seed, size, kind, richness, cute), [seed, size, kind, richness, cute]);
  const glow = useGlowUniforms(kind === "open" ? CLUSTER_GLOW.open : CLUSTER_GLOW.globular, theme);
  const uniforms = useMemo(() => {
    const stars = Array.from({ length: 6 }, (_, i) => new THREE.Vector2(spec.bright[i]?.[0] ?? 0, spec.bright[i]?.[1] ?? 0));
    return { uKind: num(kind === "open" ? 0 : 1), uCount: num(spec.bright.length), uSeed: num((seed % 100) / 9), uStars: { value: stars }, ...glow };
  }, [spec, kind, seed, glow]);
  useEffect(() => {
    uniforms.uCount.value = spec.bright.length;
  }, [uniforms, spec]);
  const haze = useQuadMaterial({ fragmentShader: HAZE_FRAG, uniforms, theme, fade: intensity, cute });
  const geometry = usePointsGeometry(spec.points);
  const stars = usePointsMaterial({ vertexShader: CLUSTER_VERT, theme, fade: Math.min(1, intensity) });
  return (
    <group>
      <mesh geometry={unitPlaneGeometry()} material={haze} scale={2} renderOrder={0} frustumCulled={false} />
      <points geometry={geometry} material={stars} renderOrder={1} frustumCulled={false} />
    </group>
  );
}

export const CLUSTER_EXHIBIT: Exhibit<ClusterParams> = {
  id: "cluster",
  title: "Star cluster",
  ref: "22-pleiades (open, blue haze), 25-omega-centauri (globular); Spore clumps",
  budget: "1 points draw (open <= 90, globular <= 800) + 1 quad",
  meaning: "Open cluster = a live course; globular = an archived course, dense and gold",
  su: 10,
  knobs: [
    { key: "kind", label: "kind", options: ["open", "globular"] },
    { key: "richness", label: "richness", min: 0.5, max: 1.5, step: 0.05 },
  ],
  defaults: { kind: "open", richness: 1 },
  Component: StarCluster,
};
