"use client";

import { useEffect, useMemo } from "react";
import { clamp, mulberry32, pick, range } from "./lib/rng";
import { PointWriter, POINT_PRELUDE, SHAPE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import type { Exhibit, ObjectBase } from "./lib/types";

/**
 * Asteroid ring: a tilted annulus of grey-brown rubble on Kepler-speed
 * orbits (inner ones lap the outer ones), a few 3-cell boulders that tumble
 * (two-step flicker). Refs: Saturn's ring grain, the Kuiper belt plots.
 * Stylised: Mario Galaxy's asteroid fields, Astroneer debris rings.
 *
 * Budget: 1 points draw (<= 320 pts).
 */
export interface AsteroidRingParams extends Record<string, number | string> {
  tilt: number;
  density: number;
}

export const ASTEROID_PALETTE = ["#8a8ea0", "#6b6a86", "#b8a890", "#9a7a60", "#cfcac0"] as const;
export const ASTEROID_MAX = 320;

export function asteroidCount(size: number, density: number): number {
  return clamp(Math.round(size * 1.1 * density), 24, ASTEROID_MAX);
}

/** aux = (rho, phase0, speed, 0): the vertex shader orbits every rock. */
export function generateAsteroids(seed: number, size: number, density: number, cute: number): PointBuffers {
  const rng = mulberry32(seed ^ 0xa57e);
  const n = asteroidCount(size, density);
  const w = new PointWriter(ASTEROID_MAX);
  for (let i = 0; i < n; i++) {
    // Denser toward the middle of the belt, with a Kirkwood-like gap.
    let rho = 0.5 + 0.45 * Math.pow(rng(), 0.8);
    if (Math.abs(rho - 0.74) < 0.025 * (1 - cute)) rho += 0.06;
    const speed = 0.12 / Math.pow(rho, 1.5);
    const big = rng() < 0.05 && size >= 96;
    w.push(rho, 0, 0, pick(rng, ASTEROID_PALETTE), big ? 3 : 1, rng(), big ? SHAPE.blob : SHAPE.cell, [rho, range(rng, 0, Math.PI * 2), speed, rng() < 0.5 ? 1 : -1]);
  }
  return w.finish();
}

const RING_VERT = /* glsl */ `
${POINT_PRELUDE}
uniform float uTilt, uDir;
void main() {
  float rho = aux.x;
  float ang = aux.y + uDir * uTime * aux.z;
  vec2 pos = vec2(cos(ang) * rho, sin(ang) * rho * uTilt);
  // Near half (bottom) slightly brighter; boulders tumble in two steps.
  float near = sin(ang) < 0.0 ? 1.0 : 0.75;
  float tumble = size > 1.5 ? mix(0.7, 1.0, step(0.5, fract(uTime * 0.8 + phase * 3.0))) : 1.0;
  emitPoint(vec3(pos, 0.0), color * tumble, near, size, shape);
}
`;

export function AsteroidRing({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: AsteroidRingParams }) {
  const density = Number(params.density);
  const buffers = useMemo(() => generateAsteroids(seed, size, density, cute), [seed, size, density, cute]);
  const uniforms = useMemo(() => ({ uTilt: { value: 0.4 }, uDir: { value: (seed & 1) === 0 ? 1 : -1 } }), [seed]);
  useEffect(() => {
    uniforms.uTilt.value = Number(params.tilt);
  }, [uniforms, params.tilt]);
  const geometry = usePointsGeometry(buffers);
  const material = usePointsMaterial({ vertexShader: RING_VERT, uniforms, theme, fade: Math.min(1, intensity), additive: false });
  return <points geometry={geometry} material={material} renderOrder={1} frustumCulled={false} />;
}

export const ASTEROID_RING_EXHIBIT: Exhibit<AsteroidRingParams> = {
  id: "asteroids",
  title: "Asteroid ring",
  ref: "Saturn ring grain, Kuiper belt plots; Mario Galaxy asteroid fields",
  budget: "1 points draw (<= 320 pts)",
  meaning: "Loose notes and flashcards that have not been sorted into a course yet",
  su: 3,
  knobs: [
    { key: "tilt", label: "tilt", min: 0.15, max: 1, step: 0.05 },
    { key: "density", label: "density", min: 0.4, max: 1.5, step: 0.05 },
  ],
  defaults: { tilt: 0.4, density: 1 },
  Component: AsteroidRing,
};
