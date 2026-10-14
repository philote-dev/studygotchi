"use client";

import { useEffect, useMemo } from "react";
import { clamp, mulberry32, range } from "./lib/rng";
import { PointWriter, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import { QUAD_PRELUDE, color, num, unitPlaneGeometry, useQuadMaterial, vec3 } from "./lib/quad";
import type { Exhibit, ObjectBase } from "./lib/types";

/**
 * Protoplanetary disc: a tilted orange-cream disc with dark gaps carved by
 * unseen planets and a bright protostar. Ref: 24-hl-tau (ALMA). Stylised:
 * Katamari's flat concentric targets, Outer Wilds' Giant's Deep rings.
 *
 * Budget: 1 disc quad + 1 points draw (1 star + gap planets, <= 5 pts).
 */
export interface ProtoDiscParams extends Record<string, number | string> {
  gaps: number;
  tilt: number;
}

export const PROTO_PALETTE = { hot: "#fff4e0", bright: "#ffc24a", mid: "#ff6a1a", dim: "#a81e08", outer: "#4a0c04", planet: "#8a8ea0" } as const;

export interface ProtoDiscSpec {
  roll: number;
  /** Gap radii (0..1 of the disc) and widths, up to 4. */
  gaps: [number, number][];
  phase: number;
  points: PointBuffers;
}

export function generateProtoDisc(seed: number, size: number, gapCount: number, cute: number): ProtoDiscSpec {
  const rng = mulberry32(seed ^ 0x9d15);
  const n = clamp(Math.round(gapCount), 0, 4);
  const gaps: [number, number][] = [];
  for (let i = 0; i < n; i++) gaps.push([0.3 + (i + 0.5) * (0.62 / Math.max(1, n)) + range(rng, -0.04, 0.04), range(rng, 0.04, 0.07) * (1 + 0.5 * cute)]);
  const w = new PointWriter(5);
  w.push(0, 0, 0, PROTO_PALETTE.hot, size >= 120 ? 3 : 1, rng(), size >= 120 ? SHAPE.plus : SHAPE.cell);
  return { roll: range(rng, -0.6, 0.6), gaps, phase: range(rng, 0, Math.PI * 2), points: w.finish() };
}

const DISC_FRAG = /* glsl */ `
${QUAD_PRELUDE}
uniform float uRoll, uTilt, uSeed, uPhase, uGapCount;
uniform vec3 uG0, uG1, uG2, uG3;   // x = radius, y = half width
uniform vec3 uHot, uBright, uMid, uDim, uOuter;
void main() {
  vec2 p = rot2(uRoll) * vUv;
  float rho = length(p / vec2(1.0, uTilt));
  if (rho > 1.0) discard;
  float th = atan(p.y / uTilt, p.x);
  // Slow differential rotation of a faint grain.
  float grain = band(fbm3(vec2(th * 3.0 + uTime * 0.02 / max(rho, 0.2), rho * 9.0) + uSeed) * 1.1, 3.0);
  float k = 1.0 - rho;
  float nb = floor(mix(5.0, 3.0, uCute) + 0.5);
  float lvl = band(k * 1.05, nb);
  float kk = lvl * nb / (nb - 1.0);
  vec3 c = kk > 0.8 ? uHot : (kk > 0.55 ? uBright : (kk > 0.3 ? uMid : (kk > 0.1 ? uDim : uOuter)));
  float a = 0.35 + 0.6 * kk;
  // Gaps: dark lanes with a slightly brighter outer wall.
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uGapCount) break;
    vec3 g = i == 0 ? uG0 : (i == 1 ? uG1 : (i == 2 ? uG2 : uG3));
    float d = abs(rho - g.x);
    if (d < g.y) a *= 0.18;
    else if (d < g.y * 1.6 && rho > g.x) { c = mix(c, uBright, 0.35); }
  }
  a *= 0.8 + 0.2 * grain;
  // The far side (top) is dimmer: the disc is lit by the star from inside, the near side is thicker.
  a *= p.y > 0.0 ? 0.85 : 1.0;
  gl_FragColor = vec4(themeTone(c, uLight), a * uFade);
  #include <colorspace_fragment>
}
`;

export function ProtoDisc({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: ProtoDiscParams }) {
  const gapCount = Number(params.gaps);
  const spec = useMemo(() => generateProtoDisc(seed, size, gapCount, cute), [seed, size, gapCount, cute]);
  const uniforms = useMemo(() => {
    const g = (i: number) => vec3(spec.gaps[i]?.[0] ?? 2, spec.gaps[i]?.[1] ?? 0, 0);
    return {
      uRoll: num(spec.roll),
      uTilt: num(0.5),
      uSeed: num((seed % 100) / 11),
      uPhase: num(spec.phase),
      uGapCount: num(spec.gaps.length),
      uG0: g(0),
      uG1: g(1),
      uG2: g(2),
      uG3: g(3),
      uHot: color(PROTO_PALETTE.hot),
      uBright: color(PROTO_PALETTE.bright),
      uMid: color(PROTO_PALETTE.mid),
      uDim: color(PROTO_PALETTE.dim),
      uOuter: color(PROTO_PALETTE.outer),
    };
  }, [spec, seed]);
  useEffect(() => {
    uniforms.uTilt.value = Number(params.tilt);
  }, [uniforms, params.tilt]);
  const disc = useQuadMaterial({ fragmentShader: DISC_FRAG, uniforms, theme, fade: intensity, cute, additive: false });
  const geometry = usePointsGeometry(spec.points);
  const star = usePointsMaterial({ theme, fade: 1 });
  return (
    <group>
      <mesh geometry={unitPlaneGeometry()} material={disc} scale={1.9} renderOrder={1} frustumCulled={false} />
      <points geometry={geometry} material={star} renderOrder={2} frustumCulled={false} />
    </group>
  );
}

export const PROTO_DISC_EXHIBIT: Exhibit<ProtoDiscParams> = {
  id: "protodisc",
  title: "Protoplanetary disc",
  ref: "24-hl-tau (ALMA); Katamari targets",
  budget: "1 disc quad + 1 points draw (<= 5 pts)",
  meaning: "A course being built: gaps open where units are done",
  su: 3,
  knobs: [
    { key: "gaps", label: "gaps", min: 0, max: 4, step: 1 },
    { key: "tilt", label: "tilt", min: 0.3, max: 0.95, step: 0.05 },
  ],
  defaults: { gaps: 3, tilt: 0.5 },
  Component: ProtoDisc,
};
