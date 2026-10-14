"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { clamp, int, mulberry32, range } from "./lib/rng";
import { PointWriter, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import { QUAD_PRELUDE, color, num, unitPlaneGeometry, useQuadMaterial, vec2, vec3 } from "./lib/quad";
import type { Exhibit, ObjectBase } from "./lib/types";
import { GLSL_LIGHT } from "./lib/light";

/**
 * Emission nebula billboards. Refs: 09-orion (pink-mauve fbm around one cream
 * heart, teal shadows), 08-carina cosmic cliffs (warm horizon under a cobalt
 * star field), 07-pillars (ochre columns on deep blue, red protostars).
 * Stylised: Mario Galaxy painted skies (2-3 hue zones), Kirby pastel.
 *
 * Budget: 2-3 quads (fbm4 + 2x fbm3 per texel) + 1 points draw, <= 48 points.
 */
export type NebulaVariant = "orion" | "carina" | "pillars";
export interface NebulaParams extends Record<string, number | string> {
  variant: NebulaVariant;
  /** Internal drift speed multiplier. */
  drift: number;
  layers: number;
}

interface Ramp {
  deep: string;
  mid: string;
  bright: string;
  heart: string;
  dust: string;
}

export const NEBULA_PALETTES: Record<NebulaVariant, { warm: Ramp; cool: Ramp; stars: readonly string[]; proto: string }> = {
  orion: {
    warm: { deep: "#2a1a33", mid: "#8a5a7a", bright: "#d87a8a", heart: "#fff4e0", dust: "#140a14" },
    cool: { deep: "#1a2a33", mid: "#3a5a5a", bright: "#6a8a8a", heart: "#c9d6e6", dust: "#140a14" },
    stars: ["#ffffff", "#b8dcff", "#f2a7c6", "#dfe8ff"],
    proto: "#f2a7c6",
  },
  carina: {
    warm: { deep: "#5a2a18", mid: "#d9823b", bright: "#f0b07a", heart: "#fff0d0", dust: "#2a1408" },
    cool: { deep: "#0f1f4d", mid: "#2e4f9c", bright: "#6f8fc0", heart: "#dfe8ff", dust: "#0a1230" },
    stars: ["#ffffff", "#f2a7c6", "#dfe8ff", "#b8dcff"],
    proto: "#f2a7c6",
  },
  pillars: {
    warm: { deep: "#5a3018", mid: "#8c4a2a", bright: "#c98a3a", heart: "#f0d0a0", dust: "#3a1c10" },
    cool: { deep: "#1b2a5e", mid: "#3f5fa6", bright: "#7f9fd6", heart: "#dfe8ff", dust: "#101a40" },
    stars: ["#dfe8ff", "#ffffff", "#b8dcff", "#ffe6a8"],
    proto: "#d04a3a",
  },
};

export interface NebulaLayerSpec {
  /** 0 cloud, 1 cliffs (horizon), 2 pillars. */
  mode: 0 | 1 | 2;
  scale: number;
  offset: [number, number];
  freq: number;
  drift: [number, number];
  warp: number;
  alpha: number;
  seed: number;
  aspect: number;
  heart: [number, number];
  /** Only the front layer carries the bright heart, so stacking never blows out. */
  heartOn: boolean;
  horizonY: number;
  /** Opaque layer (cliffs / pillars) uses normal blending so it occludes the haze. */
  opaque: boolean;
}

export interface NebulaSpec {
  variant: NebulaVariant;
  roll: number;
  layers: NebulaLayerSpec[];
  /** x, height, half-width per pillar (up to 3). */
  pillars: [number, number, number][];
  stars: PointBuffers;
}

const NEBULA_MAX_POINTS = 48;

export function generateNebula(seed: number, size: number, variant: NebulaVariant, cute: number, layerCount = 3): NebulaSpec {
  const rng = mulberry32(seed ^ 0x4eb0);
  const pal = NEBULA_PALETTES[variant];
  const roll = variant === "orion" ? range(rng, -0.4, 0.4) : 0;
  const heart: [number, number] = [range(rng, -0.25, 0.25), range(rng, -0.2, 0.2)];
  const pillars: [number, number, number][] = [];
  if (variant === "pillars") {
    const n = int(rng, 2, 3);
    for (let i = 0; i < n; i++) {
      const x = -0.55 + (i + 0.5) * (1.1 / n) + range(rng, -0.08, 0.08);
      pillars.push([x, range(rng, -0.1, 0.75) * (i === 0 ? 0.6 : 1), range(rng, 0.09, 0.16) * (1 + 0.4 * cute)]);
    }
  }
  const horizonY = variant === "carina" ? range(rng, -0.35, -0.05) : -2;
  const layers: NebulaLayerSpec[] = [];
  const count = clamp(Math.round(layerCount), 1, 3);
  for (let i = 0; i < count; i++) {
    const back = i === 0;
    const base: NebulaLayerSpec = {
      mode: 0,
      scale: back ? 2 : i === 1 ? 1.5 : 0.95,
      offset: back ? [0, 0] : [heart[0] * (i === 1 ? 0.4 : 0.8) + range(rng, -0.08, 0.08), heart[1] * (i === 1 ? 0.4 : 0.8) + range(rng, -0.08, 0.08)],
      freq: back ? range(rng, 1.3, 1.8) : i === 1 ? range(rng, 2.0, 2.8) : range(rng, 2.8, 3.6),
      drift: [range(rng, -1, 1) * 0.012 * (i + 1), range(rng, -1, 1) * 0.008 * (i + 1)],
      warp: range(rng, 0.35, 0.7) * (1 - 0.4 * cute),
      alpha: back ? 0.75 : i === 1 ? 0.8 : 0.9,
      seed: range(rng, 0, 100),
      aspect: range(rng, 0.7, 1.35),
      heart: [heart[0] * (back ? 0 : 0.6), heart[1] * (back ? 0 : 0.6)],
      heartOn: i === count - 1,
      horizonY,
      opaque: false,
    };
    layers.push(base);
  }
  if (variant === "carina") {
    // Back haze is cool and faint; the front layer is the warm cliff with the horizon.
    layers[layers.length - 1] = { ...layers[layers.length - 1], mode: 1, scale: 2, offset: [0, 0], alpha: 0.95, opaque: true, freq: range(rng, 2.2, 3.0) };
  }
  if (variant === "pillars") {
    layers.length = Math.min(layers.length, 2);
    layers[0] = { ...layers[0], alpha: 0.6, scale: 2, heartOn: false };
    layers[layers.length - 1] = { mode: 2, scale: 2, offset: [0, 0], freq: range(rng, 3, 4), drift: [0, 0], warp: 0.3, alpha: 0.98, seed: range(rng, 0, 100), aspect: 1, heart: [0, 0], heartOn: false, horizonY, opaque: true };
    if (layers.length === 1) layers.unshift({ mode: 0, scale: 2, offset: [0, 0], freq: 1.5, drift: [0.006, -0.004], warp: 0.4, alpha: 0.6, seed: range(rng, 0, 100), aspect: 1, heart: [0, 0], heartOn: false, horizonY, opaque: false });
  }

  // Stars: many tiny, a few plus stars; Trapezium-like knot near the heart for Orion; protostars on pillar tips.
  const n = clamp(Math.round(size / 6), 10, NEBULA_MAX_POINTS);
  const w = new PointWriter(NEBULA_MAX_POINTS);
  const insidePillar = (x: number, y: number) => pillars.some(([px, h, hw]) => Math.abs(x - px) < hw * 1.3 && y < h + hw);
  if (variant === "pillars") for (const [px, h, hw] of pillars) w.push(px + range(rng, -0.3, 0.3) * hw, h + hw * 0.2, 0, pal.proto, 1, rng(), SHAPE.cell);
  if (variant === "orion") for (let i = 0; i < 4; i++) w.push(heart[0] + range(rng, -0.1, 0.1), heart[1] + range(rng, -0.08, 0.08), 0, "#b8dcff", 3, rng(), SHAPE.plus);
  for (let i = w.count; i < n; i++) {
    let x = range(rng, -0.95, 0.95);
    let y = range(rng, -0.95, 0.95);
    if (variant === "carina" && y < horizonY + 0.1) y = range(rng, horizonY + 0.1, 0.95);
    if (insidePillar(x, y)) x = x > 0 ? x - 0.5 : x + 0.5;
    const big = rng() < 0.16;
    const c = pal.stars[Math.floor(rng() * pal.stars.length)];
    w.push(x, y, 0, c, big ? 3 : 1, rng(), big ? SHAPE.plus : SHAPE.cell);
  }
  return { variant, roll, layers, pillars, stars: w.finish() };
}

const NEBULA_FRAG = /* glsl */ `
${QUAD_PRELUDE}
${GLSL_LIGHT}
uniform float uMode;
uniform float uSeed;
uniform float uFreq;
uniform vec2 uDrift;
uniform float uDriftSpeed;
uniform float uWarp;
uniform float uAlpha;
uniform float uAspect;
uniform vec2 uHeart;
uniform float uHeartOn;
uniform float uHorizonY;
uniform vec3 uDeep, uMid, uBright, uHeartC, uDust;
uniform vec3 uCDeep, uCMid, uCBright, uCHeart;
uniform vec3 uP0, uP1, uP2;
uniform float uPillarCount;

vec3 ramp(float k, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
  return k < 0.34 ? mix(c0, c1, k / 0.34) : (k < 0.67 ? mix(c1, c2, (k - 0.34) / 0.33) : mix(c2, c3, (k - 0.67) / 0.33));
}

float pillarSdf(vec2 p, vec3 P, float t) {
  float y01 = clamp((p.y + 1.1) / (P.y + 1.1), 0.0, 1.0);
  float wob = (fbm3(vec2(P.x * 7.0 + uSeed, p.y * 1.6 + t * 0.01)) - 0.5) * 0.28 * (1.0 - 0.5 * uCute);
  float hw = P.z * (1.0 - 0.45 * y01);
  float cx = P.x + wob;
  float capY = P.y - hw;
  float d = p.y <= capY ? abs(p.x - cx) - hw : length(vec2(p.x - cx, p.y - capY)) - hw;
  d += (fbm3(p * 5.0 + uSeed * 2.0) - 0.5) * 0.09 * (1.0 - 0.5 * uCute);
  return d;
}

void main() {
  vec2 p = vUv;
  float t = uTime * uDriftSpeed;
  vec2 q = p * uFreq + uSeed;
  q += uDrift * t;
  vec2 w = vec2(fbm3(q * 0.7 + vec2(0.0, t * 0.03)), fbm3(q * 0.7 + vec2(5.2, 1.3) - t * 0.02)) - 0.5;
  float n0 = fbm4(q + uWarp * w);
  // Ridged octave: nebulae are filaments and fronts, not only puffs.
  float ridge = 1.0 - abs(2.0 * fbm3(q * 1.3 + 11.0 + uWarp * w.yx) - 1.0);
  float n = mix(n0, ridge, mix(0.4, 0.15, uCute));
  float nb = floor(mix(5.0, 3.0, uCute) + 0.5);

  if (uMode > 1.5) {
    // Pillars: opaque ochre columns, rim-lit toward the tips, on nothing (the haze layer sits behind).
    float d = 1e3;
    float tip = 0.0;
    for (int i = 0; i < 3; i++) {
      if (float(i) >= uPillarCount) break;
      vec3 P = i == 0 ? uP0 : (i == 1 ? uP1 : uP2);
      float di = pillarSdf(p, P, t);
      if (di < d) { d = di; tip = smoothstep(P.y - 0.7, P.y + 0.05, p.y); }
    }
    if (d > 0.0) discard;
    float depthIn = 1.0 - smoothstep(-0.14, 0.0, d);
    float tex = band(n * 1.2, 3.0);
    vec3 c = ramp(tex, uDust, uMid, uBright, uBright);
    float rim = (1.0 - depthIn) * (0.45 + 0.55 * tip);
    c = mix(c, uHeartC, band(rim, 3.0));
    gl_FragColor = vec4(themeTone(c, uLight), uAlpha * uFade);
    #include <colorspace_fragment>
    return;
  }

  // Cloud silhouette: a lumpy disc leaning toward the heart; cute rounds it off.
  float lump = (fbm3(p * 1.8 + uSeed * 3.1 + w * 0.5) - 0.5) * mix(0.42, 0.14, uCute);
  vec2 pe = p - uHeart * 0.35 + w * mix(0.35, 0.12, uCute);
  float rr = length(pe * vec2(1.0, uAspect)) + lump;
  float mask = 1.0 - smoothstep(0.2, 1.05, rr);
  float heart = uHeartOn * (1.0 - smoothstep(0.0, 0.3, length(p - uHeart)));
  float d = clamp(smoothstep(0.3, 0.9, n) * 1.15 * mask + heart * heart * 0.45, 0.0, 1.0);
  float lane = smoothstep(0.55, 0.61, fbm3(q * 1.6 + vec2(31.0, 17.0) + w * 0.8)) * smoothstep(0.15, 0.4, d) * (1.0 - heart);
  lane *= 1.0 - 0.5 * uCute;

  vec3 c;
  float a;
  if (uMode > 0.5) {
    // Cliffs: a wavy horizon; warm below (dense, opaque), cool and thin above.
    float hz = p.y - (uHorizonY + 0.22 * (fbm3(vec2(p.x * 1.4 + uSeed, 3.0 + t * 0.01)) - 0.5) + 0.1 * (fbm3(vec2(p.x * 4.0 + uSeed, 9.0)) - 0.5));
    float below = 1.0 - smoothstep(-0.02, 0.02, hz);
    float dWarm = clamp(0.55 + 0.45 * n - hz * 0.4, 0.0, 1.0);
    float lvl = band(dWarm, nb);
    float k = lvl * nb / (nb - 1.0);
    vec3 warm = ramp(k, uDeep, uMid, uBright, uHeartC);
    // Edge glow right at the horizon (the lit rim of the cliff).
    float rimg = 1.0 - smoothstep(0.0, 0.14, abs(hz));
    warm = mix(warm, uHeartC, band(rimg * 0.9, 3.0) * 0.8);
    warm = mix(warm, uDust, lane * 0.6);
    if (below < 0.5) discard;
    c = warm;
    a = uAlpha * uFade;
  } else {
    // Dithered quantisation (shared/light): the cloud keeps its few palette steps but the band edges
    // dissolve into a pixel-cell dither instead of hard contour lines.
    float lvl = ditherQuantize(d, nb, gl_FragCoord.xy, 2.0);
    if (lvl <= 0.0) discard;
    float k = (lvl * nb - 1.0) / (nb - 1.0);
    c = ramp(k, uDeep, uMid, uBright, uHeartC);
    c = mix(c, uDust, lane * 0.85);
    a = (0.1 + 0.9 * k * k * k) * uAlpha * (1.0 - lane * 0.55) * uFade;
  }
  gl_FragColor = vec4(themeTone(c, uLight), a);
  #include <colorspace_fragment>
}
`;

function NebulaLayer({ layer, spec, theme, intensity, cute, drift, order }: { layer: NebulaLayerSpec; spec: NebulaSpec; theme: ObjectBase["theme"]; intensity: number; cute: number; drift: number; order: number }) {
  const pal = NEBULA_PALETTES[spec.variant];
  const warmRamp = layer.mode === 0 && spec.variant !== "orion" ? pal.cool : pal.warm;
  const uniforms = useMemo(() => {
    const [p0, p1, p2] = [spec.pillars[0] ?? [0, -2, 0.1], spec.pillars[1] ?? [0, -2, 0.1], spec.pillars[2] ?? [0, -2, 0.1]];
    return {
      uMode: num(layer.mode),
      uSeed: num(layer.seed),
      uFreq: num(layer.freq),
      uDrift: vec2(layer.drift[0], layer.drift[1]),
      uDriftSpeed: num(1),
      uWarp: num(layer.warp),
      uAlpha: num(layer.alpha),
      uAspect: num(layer.aspect),
      uHeart: vec2(layer.heart[0], layer.heart[1]),
      uHeartOn: num(layer.heartOn ? 1 : 0),
      uHorizonY: num(layer.horizonY),
      uDeep: color(warmRamp.deep),
      uMid: color(warmRamp.mid),
      uBright: color(warmRamp.bright),
      uHeartC: color(warmRamp.heart),
      uDust: color(warmRamp.dust),
      uCDeep: color(pal.cool.deep),
      uCMid: color(pal.cool.mid),
      uCBright: color(pal.cool.bright),
      uCHeart: color(pal.cool.heart),
      uP0: vec3(p0[0], p0[1], p0[2]),
      uP1: vec3(p1[0], p1[1], p1[2]),
      uP2: vec3(p2[0], p2[1], p2[2]),
      uPillarCount: num(spec.pillars.length),
    };
  }, [layer, spec, warmRamp, pal]);
  useEffect(() => {
    uniforms.uDriftSpeed.value = drift;
    // Cute: warmer highlights. Nudge the heart toward cream-peach.
    uniforms.uHeartC.value.set(warmRamp.heart).lerp(new THREE.Color("#ffe6a8"), cute * 0.5);
  }, [uniforms, drift, cute, warmRamp.heart]);
  // Painted layers (normal blend) rather than additive: three stacked clouds must not fuse into white.
  const material = useQuadMaterial({ fragmentShader: NEBULA_FRAG, uniforms, theme, fade: intensity, cute, additive: false });
  return <mesh geometry={unitPlaneGeometry()} material={material} scale={layer.scale} position={[layer.offset[0], layer.offset[1], 0]} renderOrder={order} frustumCulled={false} />;
}

export function EmissionNebula({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: NebulaParams }) {
  const spec = useMemo(() => generateNebula(seed, size, params.variant, cute, Number(params.layers)), [seed, size, params.variant, params.layers, cute]);
  const geometry = usePointsGeometry(spec.stars);
  const material = usePointsMaterial({ theme, fade: Math.min(1, intensity) });
  return (
    <group rotation-z={spec.roll}>
      {spec.layers.map((l, i) => (
        <NebulaLayer key={`${i}-${l.mode}`} layer={l} spec={spec} theme={theme} intensity={intensity} cute={cute} drift={Number(params.drift)} order={i} />
      ))}
      <points geometry={geometry} material={material} renderOrder={5} frustumCulled={false} />
    </group>
  );
}

export const EMISSION_NEBULA_EXHIBIT: Exhibit<NebulaParams> = {
  id: "nebula",
  title: "Emission nebula",
  ref: "09-orion, 08-carina cliffs, 07-pillars; Mario Galaxy painted skies",
  budget: "2-3 fbm quads + 1 points draw (<= 48 pts)",
  meaning: "A course's home cloud; the heart brightens as the course fills in",
  su: 40,
  knobs: [
    { key: "variant", label: "variant", options: ["orion", "carina", "pillars"] },
    { key: "drift", label: "drift", min: 0, max: 3, step: 0.25 },
    { key: "layers", label: "layers", min: 1, max: 3, step: 1 },
  ],
  defaults: { variant: "orion", drift: 1, layers: 3 },
  Component: EmissionNebula,
};
