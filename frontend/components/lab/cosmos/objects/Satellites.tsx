"use client";

import { useEffect, useMemo } from "react";
import { clamp, mulberry32, pick, range } from "./lib/rng";
import { PointWriter, POINT_PRELUDE, usePointsGeometry, usePointsMaterial, type PointBuffers } from "./lib/points";
import { QUAD_PRELUDE, color, num, unitPlaneGeometry, useQuadMaterial, vec3 } from "./lib/quad";
import type { Exhibit, ObjectBase } from "./lib/types";

/**
 * A tiny space-station / satellite set orbiting a small pastel planet. Each
 * craft is one 7x7 (or 5x5) pixel sprite drawn in the point fragment shader:
 * station (cross + core + blinking red light), satellite (body + blue
 * panels + antenna), capsule (round, one lit window). They hide behind the
 * planet on the far half of their orbit. Refs: ISS silhouettes, Astroneer
 * pastel planets. Stylised: Kirby's Halberd / Mario Galaxy's starship bits.
 *
 * Budget: 1 planet quad + 1 points draw (<= 5 sprites).
 */
export interface SatellitesParams extends Record<string, number | string> {
  craft: number;
  planet: "mint" | "peach" | "sky";
}

export const SAT_PLANETS = {
  mint: { light: "#cfe8d8", mid: "#7fc0a0", dark: "#3f7f6a", rim: "#ffffff" },
  peach: { light: "#ffe6d0", mid: "#f0b07a", dark: "#b85a3a", rim: "#fff4e0" },
  sky: { light: "#dff0ff", mid: "#8fb0d8", dark: "#4f6ea8", rim: "#ffffff" },
} as const;

export const SAT_SHAPE = { station: 10, satellite: 11, capsule: 12 } as const;

export function generateCraft(seed: number, size: number, count: number): PointBuffers {
  const rng = mulberry32(seed ^ 0x5a7e);
  const n = clamp(Math.round(count), 1, 5);
  const w = new PointWriter(5);
  const kinds = [SAT_SHAPE.station, SAT_SHAPE.satellite, SAT_SHAPE.satellite, SAT_SHAPE.capsule, SAT_SHAPE.satellite];
  for (let i = 0; i < n; i++) {
    const kind = i === 0 ? SAT_SHAPE.station : pick(rng, kinds);
    const radius = 0.5 + i * 0.11 + range(rng, 0, 0.05);
    const period = range(rng, 7, 12) * (1 + i * 0.35);
    // Sprite cells: 7x7 (5x5 capsule); at >= 320 px each sprite pixel is 2 cells wide (the fragment halves the grid).
    const px = kind === SAT_SHAPE.capsule ? 5 : 7;
    w.push(radius, period, 0, "#dfe4ea", size >= 320 ? px * 2 : size >= 64 ? px : 3, rng(), kind, [radius, period, range(rng, 0, Math.PI * 2), rng() < 0.5 ? 1 : -1]);
  }
  return w.finish();
}

const CRAFT_VERT = /* glsl */ `
${POINT_PRELUDE}
uniform float uTilt, uPR;
void main() {
  float radius = aux.x;
  float ph = aux.z + aux.w * uTime * 6.2832 / aux.y;
  vec2 pos = vec2(cos(ph) * radius, -sin(ph) * radius * uTilt);
  float z = sin(ph);
  float behind = step(z, 0.0) * step(length(pos), uPR);
  emitPoint(vec3(pos, 0.0), color, 1.0 - behind, size, shape);
  // Blink flag rides on vSide: once a second, two-step.
  vSide = step(0.7, fract(uTime + phase));
}
`;

const CRAFT_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vSize;
varying float vSide;
void main() {
  if (vAlpha <= 0.002) discard;
  vec3 c = vColor;
  float n = floor(vSize + 0.5);
  if (n < 4.0) { gl_FragColor = vec4(c, vAlpha); return; }
  float cells = n > 8.0 ? n * 0.5 : n;      // 2 cells per sprite pixel at the large size
  vec2 q = floor(gl_PointCoord * cells);
  float h = floor(cells * 0.5);
  float dx = q.x - h;
  float dy = q.y - h;
  vec3 panel = vec3(0.19, 0.31, 0.52);
  vec3 light = vec3(0.95, 0.3, 0.2);
  bool on = false;
  if (vShape < 10.5) {
    // station: cross with a 3x3 core; blinking light on top.
    on = (dy == 0.0) || (dx == 0.0 && abs(dy) <= 2.0) || (abs(dx) <= 1.0 && abs(dy) <= 1.0);
    if (dy == 0.0 && abs(dx) >= 2.0) c = panel;
    if (dx == 0.0 && dy == -h) { on = vSide > 0.5; c = light; }
  } else if (vShape < 11.5) {
    // satellite: 3x3 body, panels left and right, antenna above.
    on = (abs(dx) <= 1.0 && abs(dy) <= 1.0) || (dy == 0.0 && abs(dx) >= 2.0) || (dx == 0.0 && dy == -2.0);
    if (dy == 0.0 && abs(dx) >= 2.0) c = panel;
    if (dx == 0.0 && dy == -2.0) c = vColor * 0.7;
  } else {
    // capsule: round 5x5 with one lit window.
    on = abs(dx) + abs(dy) <= h + 1.0 && !(abs(dx) == h && abs(dy) == h);
    if (dx == -1.0 && dy == -1.0) c = vec3(1.0, 0.9, 0.6);
  }
  if (!on) discard;
  gl_FragColor = vec4(c, vAlpha);
  #include <colorspace_fragment>
}
`;

const SMALL_PLANET_FRAG = /* glsl */ `
${QUAD_PRELUDE}
uniform vec3 uLightC, uMidC, uDarkC, uRim, uSun;
void main() {
  vec2 p = vUv / 0.4;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  vec3 N = vec3(p, sqrt(1.0 - r2));
  float lam = dot(N, uSun);
  vec3 c = lam > 0.35 ? uLightC : (lam > -0.05 ? uMidC : uDarkC);
  // One soft continent band so it is not a plain ball.
  float land = step(0.55, fbm3(N.xy * 3.0 + 2.0));
  c = mix(c, c * 0.85, land * step(-0.05, lam));
  if (r2 > 0.82 && lam > 0.1) c = mix(c, uRim, 0.5);
  gl_FragColor = vec4(bodyTone(c, uLight), 1.0);
  #include <colorspace_fragment>
}
`;

export function Satellites({ seed, size, theme, intensity, cute, params }: ObjectBase & { params: SatellitesParams }) {
  const craftCount = Number(params.craft);
  const buffers = useMemo(() => generateCraft(seed, size, craftCount), [seed, size, craftCount]);
  const pal = SAT_PLANETS[params.planet] ?? SAT_PLANETS.mint;
  const rng = useMemo(() => mulberry32(seed ^ 0x51), [seed]);
  const sun = useMemo(() => {
    const x = range(rng, -0.7, 0.7);
    const y = range(rng, 0.2, 0.7);
    const l = Math.hypot(x, y, 0.6);
    return [x / l, y / l, 0.6 / l] as const;
  }, [rng]);
  const planetU = useMemo(
    () => ({ uLightC: color(pal.light), uMidC: color(pal.mid), uDarkC: color(pal.dark), uRim: color(pal.rim), uSun: vec3(sun[0], sun[1], sun[2]) }),
    [pal, sun],
  );
  const craftU = useMemo(() => ({ uTilt: num(0.35), uPR: num(0.4) }), []);
  useEffect(() => {
    craftU.uTilt.value = 0.3 + 0.2 * cute;
  }, [craftU, cute]);
  const planet = useQuadMaterial({ fragmentShader: SMALL_PLANET_FRAG, uniforms: planetU, theme, fade: intensity, cute, additive: false });
  const geometry = usePointsGeometry(buffers);
  const craft = usePointsMaterial({ vertexShader: CRAFT_VERT, fragmentShader: CRAFT_FRAG, uniforms: craftU, theme, fade: 1, additive: false });
  return (
    <group>
      <mesh geometry={unitPlaneGeometry()} material={planet} scale={2} renderOrder={1} frustumCulled={false} />
      <points geometry={geometry} material={craft} renderOrder={2} frustumCulled={false} />
    </group>
  );
}

export const SATELLITES_EXHIBIT: Exhibit<SatellitesParams> = {
  id: "satellites",
  title: "Station + satellites",
  ref: "ISS silhouette, Astroneer pastel planet; Kirby Halberd bits",
  budget: "1 planet quad + 1 points draw (<= 5 sprites)",
  meaning: "Study sessions in orbit around today's course; the station blinks when one is live",
  su: 1.3,
  knobs: [
    { key: "craft", label: "craft", min: 1, max: 5, step: 1 },
    { key: "planet", label: "planet", options: ["mint", "peach", "sky"] },
  ],
  defaults: { craft: 3, planet: "mint" },
  Component: Satellites,
};
