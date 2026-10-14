/**
 * Seeded point buffers for the map: the disc cloud that the beads sit on, the
 * halo stars of globulars and satellites, and the three-depth star shell.
 * Pure (no three.js objects) so counts can be asserted in tests.
 */
import { Color } from "three";
import { gaussian, mulberry32 } from "../../space/lib/rng";
import { armTheta, discPoint, warpY, type GalaxyLayout } from "./galaxy-layout";
import { MAP_PALETTES, type MapPalette } from "./palettes";

export interface GrainBuffers {
  count: number;
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  phase: Float32Array;
  dim: Float32Array;
}

export const MAP_COUNTS = {
  discArm: 3400,
  discSmooth: 900,
  bulge: 420,
  bar: 300,
  dust: 380,
  hii: 80,
  globularStars: 110,
  satelliteStars: 120,
  shell: 1100,
} as const;

function alloc(count: number): GrainBuffers {
  return {
    count,
    position: new Float32Array(count * 3),
    color: new Float32Array(count * 3),
    size: new Float32Array(count),
    phase: new Float32Array(count),
    dim: new Float32Array(count),
  };
}

const scratch = new Color();

function put(b: GrainBuffers, i: number, x: number, y: number, z: number, c: Color, size: number, phase: number, dim: number) {
  b.position[i * 3] = x;
  b.position[i * 3 + 1] = y;
  b.position[i * 3 + 2] = z;
  b.color[i * 3] = c.r;
  b.color[i * 3 + 1] = c.g;
  b.color[i * 3 + 2] = c.b;
  b.size[i] = size;
  b.phase[i] = phase;
  b.dim[i] = dim;
}

export interface DiscBuffers {
  stars: GrainBuffers;
  dust: GrainBuffers;
}

/** Arm weights: major arms carry most of the light, the spur the least. */
const ARM_WEIGHTS = [0.3, 0.3, 0.15, 0.15, 0.1];

export function buildDiscBuffers(layout: GalaxyLayout, palette: MapPalette = MAP_PALETTES.dark): DiscBuffers {
  const rng = mulberry32(layout.seed ^ 0x5eed1);
  const { shape, arms } = layout;
  const core = new Color(palette.core);
  const bar = new Color(palette.bar);
  const arm = new Color(palette.arm);
  const disc = new Color(palette.disc);
  const tip = new Color(palette.tip);
  const hii = new Color(palette.hii);
  const dust = new Color(palette.dust);
  const white = new Color("#fffaf0");

  const stars = alloc(MAP_COUNTS.discArm + MAP_COUNTS.discSmooth + MAP_COUNTS.bulge + MAP_COUNTS.bar + MAP_COUNTS.hii);
  const dustB = alloc(MAP_COUNTS.dust);
  let i = 0;

  const pickArm = () => {
    let r = rng();
    for (let k = 0; k < ARM_WEIGHTS.length; k++) {
      r -= ARM_WEIGHTS[k];
      if (r <= 0) return arms[k];
    }
    return arms[0];
  };
  const thickness = (a: number) => gaussian(rng) * 0.018 * (1 + 0.8 * (1 - a));

  // Arm stars: along each spine, Gaussian spread that widens outward; colour cream -> arm -> tip.
  for (let n = 0; n < MAP_COUNTS.discArm; n++) {
    const sp = pickArm();
    const a = sp.aStart + (sp.aEnd - sp.aStart) * Math.pow(rng(), 0.85);
    const spread = (sp.kind === "spur" ? 0.045 : 0.06) + 0.075 * a;
    const theta = armTheta(shape, sp, a) + gaussian(rng) * spread;
    const ar = a + gaussian(rng) * 0.012;
    const p = discPoint(shape, ar, theta, thickness(a));
    scratch.copy(core).lerp(arm, Math.min(1, a * 1.3));
    if (a > 0.65 && rng() < 0.4) scratch.lerp(tip, 0.6);
    const dim = sp.kind === "spur" ? 0.75 : 1;
    put(stars, i++, p[0], p[1], p[2], scratch, 1, rng(), dim);
  }
  // Smooth disc: dim lilac fill so the arms read against something.
  for (let n = 0; n < MAP_COUNTS.discSmooth; n++) {
    const a = 0.15 + 0.85 * Math.pow(rng(), 0.6);
    const theta = rng() * Math.PI * 2;
    const p = discPoint(shape, a, theta, thickness(a) * 1.4);
    scratch.copy(disc).lerp(arm, rng() * 0.3);
    put(stars, i++, p[0], p[1], p[2], scratch, 1, rng(), 0.45);
  }
  // Bulge: Gaussian ball, warm to white in the middle.
  for (let n = 0; n < MAP_COUNTS.bulge; n++) {
    const a = Math.min(0.45, Math.abs(gaussian(rng)) * shape.bulgeSigma + 0.005);
    const theta = rng() * Math.PI * 2;
    const heat = Math.exp(-(a * a) / (2 * shape.bulgeSigma * shape.bulgeSigma * 0.35));
    scratch.copy(core).lerp(white, heat * 0.8);
    const y = gaussian(rng) * shape.bulgeSigma * 0.55;
    put(stars, i++, a * Math.cos(theta), y, a * Math.sin(theta), scratch, 1, rng(), 1);
  }
  // Bar: cream points along the bar axis.
  for (let n = 0; n < MAP_COUNTS.bar; n++) {
    const along = (rng() * 2 - 1) * shape.barHalfLength * (0.7 + 0.3 * rng());
    const across = gaussian(rng) * 0.045;
    const x = along * Math.cos(shape.barAngle) - across * Math.sin(shape.barAngle);
    const z = along * Math.sin(shape.barAngle) + across * Math.cos(shape.barAngle);
    scratch.copy(bar).lerp(core, rng() * 0.5);
    put(stars, i++, x, gaussian(rng) * 0.02, z, scratch, 1, rng(), 1);
  }
  // HII sprinkle: pink 2-cell knots on the convex edge of the major and minor arms, never on the spur.
  for (let n = 0; n < MAP_COUNTS.hii; n++) {
    const sp = arms[Math.floor(rng() * 4)];
    const a = 0.3 + 0.62 * rng();
    const edge = -Math.sign(shape.b) * (0.045 + 0.03 * a);
    const theta = armTheta(shape, sp, a) + edge + gaussian(rng) * 0.02;
    const p = discPoint(shape, a, theta, thickness(a) * 0.5);
    scratch.copy(hii).lerp(white, rng() * 0.25);
    put(stars, i++, p[0], p[1], p[2], scratch, 2, rng(), 0.9);
  }
  // Dust: on the concave (inner, trailing) edge of the two major arms, dark brown, normal blend.
  for (let n = 0; n < MAP_COUNTS.dust; n++) {
    const sp = arms[n % 2];
    const a = sp.aStart + 0.04 + (sp.aEnd - sp.aStart - 0.1) * Math.pow(rng(), 0.9);
    const edge = Math.sign(shape.b) * (0.05 + 0.04 * a);
    const theta = armTheta(shape, sp, a) + edge + gaussian(rng) * 0.025;
    const p = discPoint(shape, a + gaussian(rng) * 0.008, theta, thickness(a) * 0.4);
    scratch.copy(dust).lerp(new Color("#000000"), rng() * 0.3);
    put(dustB, n, p[0], p[1], p[2], scratch, 1, rng(), 1);
  }
  return { stars, dust: dustB };
}

/** Halo grain: each globular a 3-band ball (Omega Centauri), each satellite a tilted bar with a knot (LMC). */
export function buildHaloBuffers(layout: GalaxyLayout, palette: MapPalette = MAP_PALETTES.dark): GrainBuffers {
  const rng = mulberry32(layout.seed ^ 0x4a10);
  const count = layout.globulars.length * MAP_COUNTS.globularStars + layout.satellites.length * MAP_COUNTS.satelliteStars;
  const b = alloc(count);
  const cream = new Color(palette.globularCore);
  const orange = new Color(palette.globularWarm);
  const blue = new Color(palette.globularCool);
  const satBar = new Color(palette.satelliteBar);
  const satKnot = new Color(palette.satelliteKnot);
  const satHaze = new Color(palette.satelliteHaze);
  let i = 0;
  for (const g of layout.globulars) {
    for (let n = 0; n < MAP_COUNTS.globularStars; n++) {
      const rr = Math.abs(gaussian(rng)) * g.radius * 0.5;
      const z = rng() * 2 - 1;
      const t = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      const roll = rng();
      scratch.copy(rr < g.radius * 0.35 ? cream : roll < 0.3 ? orange : roll < 0.55 ? blue : cream);
      put(b, i++, g.position[0] + s * Math.cos(t) * rr, g.position[1] + z * rr, g.position[2] + s * Math.sin(t) * rr, scratch, 1, rng(), rr < g.radius * 0.35 ? 1 : 0.7);
    }
  }
  for (const s of layout.satellites) {
    const cy = Math.cos(s.yaw);
    const sy = Math.sin(s.yaw);
    for (let n = 0; n < MAP_COUNTS.satelliteStars; n++) {
      const inKnot = n < 14;
      const along = inKnot ? s.knotSide * s.radius * 0.8 + gaussian(rng) * s.radius * 0.12 : (rng() * 2 - 1) * s.radius * (rng() < 0.7 ? 1 : 1.7);
      const across = gaussian(rng) * (inKnot ? s.radius * 0.12 : s.radius * (rng() < 0.7 ? 0.3 : 0.7));
      const x = along * cy - across * sy;
      const z = along * sy + across * cy;
      const y = gaussian(rng) * s.radius * 0.15 + across * Math.tan(s.tilt) * 0.5;
      scratch.copy(inKnot ? satKnot : Math.abs(across) > s.radius * 0.35 ? satHaze : satBar);
      put(b, i++, s.position[0] + x, s.position[1] + y, s.position[2] + z, scratch, inKnot && n < 3 ? 2 : 1, rng(), inKnot ? 1 : 0.7);
    }
  }
  return b;
}

export const SHELL_LAYERS = [
  { share: 0.62, depth: 1.0, size: 1, bright: 0.45 },
  { share: 0.32, depth: 0.62, size: 1, bright: 1.0 },
  { share: 0.06, depth: 0.36, size: 3, bright: 1.0 },
] as const;

/** Three parallax shells of grain stars in one draw (the near one is the 3x3 sparkle layer). */
export function buildShellBuffers(seed: number, radius: number, palette: MapPalette = MAP_PALETTES.dark): GrainBuffers {
  const rng = mulberry32(seed ^ 0x51a7);
  const b = alloc(MAP_COUNTS.shell);
  const star = new Color(palette.star);
  const soft = new Color(palette.starSoft);
  const warm = new Color("#ffe6a8");
  const blue = new Color("#b8dcff");
  let i = 0;
  for (const layer of SHELL_LAYERS) {
    const n = Math.round(MAP_COUNTS.shell * layer.share);
    for (let k = 0; k < n && i < MAP_COUNTS.shell; k++, i++) {
      const z = rng() * 2 - 1;
      const t = rng() * Math.PI * 2;
      const rr = Math.sqrt(1 - z * z);
      const d = radius * layer.depth * (0.92 + 0.16 * rng());
      scratch.copy(layer.bright < 1 ? soft : star);
      const roll = rng();
      if (layer.size > 1) scratch.copy(roll < 0.3 ? warm : roll < 0.55 ? blue : star);
      put(b, i, rr * Math.cos(t) * d, z * d, rr * Math.sin(t) * d, scratch, layer.size, rng(), 1);
    }
  }
  b.count = i;
  return b;
}

export function totalPoints(...buffers: GrainBuffers[]): number {
  return buffers.reduce((n, b) => n + b.count, 0);
}

export { warpY };
