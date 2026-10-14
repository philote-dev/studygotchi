"use client";

import { useEffect, useMemo } from "react";
import { clamp, mulberry32, range } from "./lib/rng";
import { PointWriter, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import { QUAD_PRELUDE, color, num, unitPlaneGeometry, useQuadMaterial } from "./lib/quad";
import type { Exhibit, ObjectBase } from "./lib/types";

/**
 * Dark nebula: a Horsehead-like silhouette (a column with a head and a snout,
 * eroded by noise) in front of a pink-red glowing haze, with a thin lit rim
 * on the side facing the bright star. Ref: 23-horsehead. Stylised: Mario
 * Galaxy's flat painted sky cut-outs.
 *
 * Budget: 1 quad (haze + silhouette) + 1 points draw (<= 24 stars, none inside the silhouette).
 */
export interface DarkNebulaParams extends Record<string, number | string> {
  horse: number;
}

export const DARK_PALETTE = { hazeDeep: "#3a1020", hazeMid: "#a0304a", hazeBright: "#e06a7c", hazeHot: "#f2a7c6", dust: "#0a0a18", rim: "#f0b07a" } as const;

export interface DarkNebulaSpec {
  flip: 1 | -1;
  headX: number;
  headY: number;
  stars: PointBuffers;
}

export function generateDarkNebula(seed: number, size: number): DarkNebulaSpec {
  const rng = mulberry32(seed ^ 0xda4c);
  const flip: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const headX = range(rng, 0.05, 0.2) * flip;
  const headY = range(rng, 0.15, 0.35);
  const n = clamp(Math.round(size / 10), 6, 24);
  const w = new PointWriter(24);
  for (let i = 0; i < n; i++) {
    // Stars only in the upper haze, away from the column.
    const x = range(rng, -0.95, 0.95);
    const y = range(rng, -0.2, 0.95);
    if (Math.abs(x) < 0.45 && y < headY + 0.4) continue;
    const big = rng() < 0.2;
    w.push(x, y, 0, big ? "#dfe8ff" : "#ffffff", big ? 3 : 1, rng(), big ? SHAPE.plus : SHAPE.cell);
  }
  return { flip, headX, headY, stars: w.finish() };
}

const DARK_FRAG = /* glsl */ `
${QUAD_PRELUDE}
uniform float uFlip, uHeadX, uHeadY, uHorse, uSeed;
uniform vec3 uDeep, uMid, uBright, uHot, uDust, uRim;
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
void main() {
  vec2 p = vUv;
  // Haze: fbm banded, brighter toward the top-left where the illuminating star sits.
  vec2 q = p * 2.2 + uSeed;
  float n = fbm4(q + 0.5 * (fbm3(q * 0.6 + uTime * 0.004) - 0.5));
  float lightDir = 0.5 + 0.5 * dot(normalize(vec2(-uFlip, 1.0)), p);
  // Soft, lumpy vignette so the haze never shows the quad's square edge.
  float vign = 1.0 - smoothstep(0.45, 1.0, length(p * vec2(1.0, 0.9)) + (fbm3(p * 2.0 + uSeed) - 0.5) * 0.3);
  float d = clamp((n * 0.9 + lightDir * 0.35 - 0.2) * vign * 1.3, 0.0, 1.0);
  float nb = floor(mix(5.0, 3.0, uCute) + 0.5);
  float lvl = band(d, nb);
  if (lvl <= 0.0) discard;
  float k = lvl * nb / (nb - 1.0);
  vec3 c = k < 0.34 ? mix(uDeep, uMid, k / 0.34) : (k < 0.67 ? mix(uMid, uBright, (k - 0.34) / 0.33) : mix(uBright, uHot, (k - 0.67) / 0.33));
  float a = (0.15 + 0.85 * k * k) * 0.9;

  // Silhouette: column from the bottom + round head + snout, eroded by noise. uHorse 0 = blob.
  float col = sdBox(p - vec2(0.0, -0.75), vec2(0.26 - 0.05 * uHorse, 0.75));
  float neck = sdBox(p - vec2(uHeadX * 0.4, 0.0), vec2(0.17, 0.25));
  float head = length(p - vec2(uHeadX, uHeadY)) - (0.28 + 0.06 * uCute);
  float snout = sdBox(p - vec2(uHeadX + uFlip * 0.3 * uHorse, uHeadY - 0.05), vec2(0.2 * uHorse, 0.12));
  float ear = length(p - vec2(uHeadX - uFlip * 0.12, uHeadY + 0.3)) - 0.09 * uHorse;
  float sd = min(min(col, neck), min(head, min(snout, ear)));
  sd += (fbm3(p * 5.0 + uSeed * 3.0) - 0.5) * mix(0.14, 0.05, uCute);
  if (sd < 0.0) {
    // Rim light: a thin band just inside the edge, only on the side facing the star.
    float rim = smoothstep(-0.06, -0.015, sd);
    float lit = smoothstep(0.0, 0.7, dot(normalize(vec2(-uFlip, 1.0)), normalize(p - vec2(uHeadX, uHeadY - 0.3))));
    c = mix(uDust, uRim, step(0.5, rim) * step(0.4, lit) * 0.85);
    a = 0.98;
  }
  gl_FragColor = vec4(themeTone(c, uLight), a * min(uFade, 1.0));
  #include <colorspace_fragment>
}
`;

export function DarkNebula({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: DarkNebulaParams }) {
  const spec = useMemo(() => generateDarkNebula(seed, size), [seed, size]);
  const uniforms = useMemo(
    () => ({
      uFlip: num(spec.flip),
      uHeadX: num(spec.headX),
      uHeadY: num(spec.headY),
      uHorse: num(1),
      uSeed: num((seed % 100) / 13),
      uDeep: color(DARK_PALETTE.hazeDeep),
      uMid: color(DARK_PALETTE.hazeMid),
      uBright: color(DARK_PALETTE.hazeBright),
      uHot: color(DARK_PALETTE.hazeHot),
      uDust: color(DARK_PALETTE.dust),
      uRim: color(DARK_PALETTE.rim),
    }),
    [spec, seed],
  );
  useEffect(() => {
    uniforms.uHorse.value = Number(params.horse);
  }, [uniforms, params.horse]);
  const material = useQuadMaterial({ fragmentShader: DARK_FRAG, uniforms, theme, fade: intensity, cute, additive: false });
  const geometry = usePointsGeometry(spec.stars);
  const stars = usePointsMaterial({ theme, fade: Math.min(1, intensity) });
  return (
    <group>
      <points geometry={geometry} material={stars} renderOrder={0} frustumCulled={false} />
      <mesh geometry={unitPlaneGeometry()} material={material} scale={2} renderOrder={1} frustumCulled={false} />
    </group>
  );
}

export const DARK_NEBULA_EXHIBIT: Exhibit<DarkNebulaParams> = {
  id: "darknebula",
  title: "Dark nebula",
  ref: "23-horsehead silhouette on pink haze; Mario Galaxy cut-outs",
  budget: "1 quad + 1 points draw (<= 24 pts)",
  meaning: "A gap in knowledge: the silhouette shrinks as prerequisites are learned",
  su: 30,
  knobs: [{ key: "horse", label: "horse-ness", min: 0, max: 1, step: 0.05 }],
  defaults: { horse: 1 },
  Component: DarkNebula,
};
