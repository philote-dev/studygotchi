/**
 * Seeded point buffers for the galaxy. Pure: no three.js objects, so it runs
 * in vitest and could run in a Worker. Colours are linear-light floats.
 */
import { Color } from "three";
import { gaussian, mulberry32, range } from "../lib/rng";
import { armAngle, type GalaxySpec } from "./galaxy-spec";

export const KIND = { disc: 0, dust: 1, bead: 2, bulge: 3, companion: 4 } as const;

export interface PointBuffers {
  count: number;
  /** a, eScale, psi0, dTheta per point. */
  orbit: Float32Array;
  /** x unused, y = thickness offset, z unused (Points needs a position). */
  position: Float32Array;
  kind: Float32Array;
  color: Float32Array;
  phase: Float32Array;
}

export interface GalaxyBuffers {
  stars: PointBuffers;
  dust: PointBuffers;
}

export const GALAXY_COUNTS = { disc: 3400, dust: 420, bulge: 480, companion: 90 } as const;

function alloc(count: number): PointBuffers {
  return {
    count,
    orbit: new Float32Array(count * 4),
    position: new Float32Array(count * 3),
    kind: new Float32Array(count),
    color: new Float32Array(count * 3),
    phase: new Float32Array(count),
  };
}

function put(b: PointBuffers, i: number, a: number, eScale: number, psi0: number, dTheta: number, kind: number, y: number, c: Color, phase: number) {
  b.orbit[i * 4] = a;
  b.orbit[i * 4 + 1] = eScale;
  b.orbit[i * 4 + 2] = psi0;
  b.orbit[i * 4 + 3] = dTheta;
  b.position[i * 3 + 1] = y;
  b.kind[i] = kind;
  b.color[i * 3] = c.r;
  b.color[i * 3 + 1] = c.g;
  b.color[i * 3 + 2] = c.b;
  b.phase[i] = phase;
}

const scratch = new Color();

export function buildGalaxyBuffers(spec: GalaxySpec): GalaxyBuffers {
  const rng = mulberry32(spec.seed ^ 0x9e3779b9);
  const P = spec.palette;
  const core = new Color(P.core);
  const arm = new Color(P.arm);
  const tip = new Color(P.tip);
  const bead = new Color(P.bead);
  const beadAlt = new Color(P.beadAlt);
  const dust = new Color(P.dust);
  const companion = new Color(P.companion);
  const white = new Color("#fffaf0");

  const discCount = GALAXY_COUNTS.disc;
  const bulgeCount = GALAXY_COUNTS.bulge;
  const compCount = spec.companion ? GALAXY_COUNTS.companion : 0;
  const stars = alloc(discCount + bulgeCount + compCount);
  const dustB = alloc(GALAXY_COUNTS.dust);

  let i = 0;
  // Disc and arm stars: more inward (pow 0.7), 80 % hug the crowding (eScale 1), 20 % soft disc.
  for (let n = 0; n < discCount; n++) {
    const a = 0.06 + 0.96 * Math.pow(rng(), 0.7);
    const hug = rng() < 0.8;
    const eScale = hug ? 1 : 0.3;
    const psi0 = rng() * Math.PI * 2;
    const isBead = hug && a > 0.3 && a < 0.92 && rng() < spec.beadDensity;
    // Beads sit on the outer (convex) edge of the arm: crowd a little ahead of the stars.
    const dTheta = isBead ? spec.spinDir * 0.14 : 0;
    scratch.copy(core).lerp(arm, Math.min(1, a * 1.15));
    if (a > 0.7 && rng() < 0.35) scratch.lerp(tip, 0.6);
    if (isBead) scratch.copy(rng() < 0.65 ? bead : beadAlt);
    const y = gaussian(rng) * spec.thickness * (1 + 0.6 * (1 - a));
    put(stars, i++, a, eScale, psi0, dTheta, isBead ? KIND.bead : KIND.disc, y, scratch, rng());
  }
  // Bulge: Gaussian ball, circular orbits, warm to white.
  for (let n = 0; n < bulgeCount; n++) {
    const a = Math.min(0.5, Math.abs(gaussian(rng)) * spec.coreSize + 0.01);
    const psi0 = rng() * Math.PI * 2;
    const heat = Math.exp(-(a * a) / (2 * spec.coreSize * spec.coreSize * 0.3));
    scratch.copy(core).lerp(white, heat);
    const y = gaussian(rng) * spec.coreSize * 0.45;
    put(stars, i++, a, 0, psi0, 0, KIND.bulge, y, scratch, rng());
  }
  // Companion (M51's buddy): a warm clump hanging off one arm tip, co-rotating with the pattern.
  if (spec.companion) {
    const ac = spec.companionRadius;
    const centre = armAngle(spec, Math.min(ac, 1), spec.companionArm);
    for (let n = 0; n < compCount; n++) {
      const da = gaussian(rng) * 0.035;
      const dpsi = gaussian(rng) * 0.045;
      scratch.copy(companion).lerp(white, Math.max(0, 1 - Math.hypot(da / 0.035, dpsi / 0.045)) * 0.6);
      put(stars, i++, ac + da, 0, centre + dpsi, 0, KIND.companion, gaussian(rng) * 0.02, scratch, rng());
    }
  }
  // Dust lanes: same orbits, crowding shifted to the inner / trailing edge of each arm.
  for (let n = 0; n < GALAXY_COUNTS.dust; n++) {
    const a = 0.16 + 0.8 * Math.pow(rng(), 0.8);
    const psi0 = rng() * Math.PI * 2;
    scratch.copy(dust).lerp(new Color("#000000"), range(rng, 0, 0.3));
    put(dustB, n, a, 1.08, psi0, -spec.spinDir * 0.32, KIND.dust, gaussian(rng) * spec.thickness * 0.5, scratch, rng());
  }
  return { stars, dust: dustB };
}

export function totalGalaxyPoints(b: GalaxyBuffers): number {
  return b.stars.count + b.dust.count;
}
