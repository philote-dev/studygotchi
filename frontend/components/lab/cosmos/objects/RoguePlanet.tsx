"use client";

import { useEffect, useMemo } from "react";
import { mulberry32, range } from "./lib/rng";
import { QUAD_PRELUDE, color, num, unitPlaneGeometry, useQuadMaterial } from "./lib/quad";
import type { Exhibit, ObjectBase } from "./lib/types";

/**
 * Rogue planet: a starlit navy disc with no sun, a thin rim, and curtains of
 * aurora rippling over one pole (green, teal, violet in three bands). Refs:
 * 15-earth-at-night (navy with a thin limb), Jupiter's aurora ovals.
 * Stylised: Astroneer's night side, Outer Wilds' Dark Bramble glow.
 *
 * Budget: 1 quad.
 */
export interface RogueParams extends Record<string, number | string> {
  aurora: number;
}

export const ROGUE_PALETTE = { body: "#1b2244", bodyDark: "#121a3a", rim: "#6f6fa0", green: "#7fe0a0", teal: "#3fb8a8", violet: "#a07ac8", cute: "#e9a6c9" } as const;

export interface RogueSpec {
  poleTilt: number;
  seed: number;
}

export function generateRogue(seed: number): RogueSpec {
  const rng = mulberry32(seed ^ 0x2096);
  return { poleTilt: range(rng, -0.5, 0.5), seed: range(rng, 0, 100) };
}

const ROGUE_FRAG = /* glsl */ `
${QUAD_PRELUDE}
uniform float uPoleTilt, uSeed, uAurora;
uniform vec3 uBody, uBodyDark, uRim, uGreen, uTeal, uViolet, uCuteC;
void main() {
  vec2 p = rot2(uPoleTilt) * vUv / 0.56;
  float r2 = dot(p, p);
  vec3 c = vec3(0.0);
  float a = 0.0;
  if (r2 <= 1.0) {
    vec3 N = vec3(p, sqrt(1.0 - r2));
    float lat = asin(clamp(N.y, -1.0, 1.0));
    float lon = atan(N.x, N.z);
    // Starlit night side: two navy tones in broad latitude bands, a faint cloud mottle, rim one band lighter.
    c = mix(uBodyDark, uBody, step(0.0, sin(lat * 4.0 + uSeed)));
    c = mix(c, uBody * 1.25, step(0.62, fbm3(vec2(lon * 2.0 + uTime * 0.01, lat * 3.0) + uSeed)) * 0.6);
    if (r2 > 0.88) c = mix(c, uRim, 0.55);
    // Aurora oval around the north pole: a thin ring of curtains, broken by noise, three colour steps.
    float oval = smoothstep(0.7, 0.82, lat) * (1.0 - smoothstep(1.05, 1.2, lat));
    float curtain = fbm3(vec2(lon * 4.0 + uTime * 0.3, lat * 9.0 - uTime * 0.15) + uSeed);
    float lvl = band(oval * (0.2 + 1.1 * curtain) * uAurora, 3.0);
    vec3 ac = lvl > 0.6 ? mix(uGreen, uCuteC, uCute * 0.5) : (lvl > 0.3 ? uTeal : uViolet);
    c = mix(c, ac, step(0.3, lvl) * (0.6 + 0.4 * lvl));
    a = 1.0;
  } else {
    // Faint aurora glow past the limb above the pole, two steps.
    float r = sqrt(r2);
    float above = smoothstep(0.55, 1.0, p.y / max(r, 1e-3));
    float glow = (1.0 - smoothstep(1.0, 1.18, r)) * above * uAurora;
    float lvl = band(glow * (0.5 + 0.7 * fbm3(vec2(atan(p.x, p.y) * 5.0 + uTime * 0.3, r * 6.0) + uSeed)), 3.0);
    if (lvl <= 0.0) discard;
    c = lvl > 0.5 ? uGreen : uTeal;
    a = 0.2 + 0.3 * lvl;
  }
  gl_FragColor = vec4(bodyTone(c, uLight), a * min(uFade, 1.0));
  #include <colorspace_fragment>
}
`;

export function RoguePlanet({ seed, theme, intensity, cute, params }: ObjectBase & { params: RogueParams }) {
  const spec = useMemo(() => generateRogue(seed), [seed]);
  const uniforms = useMemo(
    () => ({
      uPoleTilt: num(spec.poleTilt),
      uSeed: num(spec.seed),
      uAurora: num(1),
      uBody: color(ROGUE_PALETTE.body),
      uBodyDark: color(ROGUE_PALETTE.bodyDark),
      uRim: color(ROGUE_PALETTE.rim),
      uGreen: color(ROGUE_PALETTE.green),
      uTeal: color(ROGUE_PALETTE.teal),
      uViolet: color(ROGUE_PALETTE.violet),
      uCuteC: color(ROGUE_PALETTE.cute),
    }),
    [spec],
  );
  useEffect(() => {
    uniforms.uAurora.value = Number(params.aurora);
  }, [uniforms, params.aurora]);
  const material = useQuadMaterial({ fragmentShader: ROGUE_FRAG, uniforms, theme, fade: intensity, cute, additive: false });
  return <mesh geometry={unitPlaneGeometry()} material={material} scale={2} renderOrder={1} frustumCulled={false} />;
}

export const ROGUE_PLANET_EXHIBIT: Exhibit<RogueParams> = {
  id: "rogue",
  title: "Rogue planet",
  ref: "15-earth-at-night limb, Jupiter aurora ovals; Astroneer night side",
  budget: "1 quad",
  meaning: "A course with no schedule attached: it drifts, the aurora is its last activity",
  su: 1.1,
  knobs: [{ key: "aurora", label: "aurora", min: 0, max: 1.5, step: 0.05 }],
  defaults: { aurora: 1 },
  Component: RoguePlanet,
};
