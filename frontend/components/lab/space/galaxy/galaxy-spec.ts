/**
 * Seeded galaxy recipe. Everything the renderer needs is decided here from one
 * seed, so the same seed is the same galaxy on every machine and every mount.
 *
 * Kinematics (the fix for the product spiral, which spins as one rigid stamp):
 *
 *   - The spiral PATTERN rotates rigidly at one slow pattern speed
 *     (`patternPeriodS`, 48 s per turn): a density wave, not material.
 *   - Stars ride m-fold perturbed orbits (Lin-Shu / beltoforion style):
 *     r(psi) = a * (1 + e * cos(m * (psi - theta(a)))), with theta(a) the
 *     orientation of the perturbation at radius a. Because theta changes with
 *     ln(a), neighbouring orbits crowd along m log-spiral ridges: the arms.
 *   - Each star moves along its orbit with a FLAT rotation curve,
 *     omega(a) = v0 / max(a, aCore): inner stars lap outer ones, and every
 *     star drifts THROUGH the arms. The arms never wind up because they are
 *     where the orbits crowd, not where the stars were placed.
 *   - Arms trail: d(theta)/da has the sign opposite to the spin, so the outer
 *     tips point against the rotation (twist is stored signed as `b`).
 */
import { gaussian, mulberry32, pick, range } from "../lib/rng";
import { GALAXY_PALETTES, type GalaxyPalette } from "./palettes";

export type ArmCount = 2 | 3 | 4;

export interface GalaxySpec {
  seed: number;
  arms: ArmCount;
  bar: boolean;
  /** Bar half-length as a fraction of the disc radius; 0 without a bar. */
  barLength: number;
  /** Signed log-spiral coefficient: theta(a) = thetaBar + b * ln(a). Sign = -spinDir. */
  b: number;
  /** Unsigned twist, 1.8..3.4 (pitch roughly 16 to 29 degrees). */
  twist: number;
  /** +1: counter-clockwise seen from +Y (above the disc). */
  spinDir: 1 | -1;
  /** Disc tilt toward the viewer, radians. */
  inclination: number;
  /** Rotation of the tilted ellipse in the view plane, radians. */
  roll: number;
  /** Bulge sigma as a fraction of the disc radius. */
  coreSize: number;
  /** Fraction of disc stars promoted to HII beads. */
  beadDensity: number;
  companion: boolean;
  companionArm: number;
  companionRadius: number;
  palette: GalaxyPalette;
  hazeCount: 1 | 2;
  patternPeriodS: number;
  /** Flat rotation curve speed: omega(a) = v0 / max(a, aCore). */
  v0: number;
  aCore: number;
  /** Orbit eccentricity for the arms, chosen so the crowding factor is ~0.9. */
  eccentricity: number;
  barEccentricity: number;
  thickness: number;
  /** Fixed orientation of the pattern at t = 0. */
  thetaBar: number;
  starCount: number;
}

export const PATTERN_PERIOD_S = 48;
/** Outer-disc orbital period at a = 1 (seconds). Inner stars are faster. */
export const OUTER_ORBIT_PERIOD_S = 96;
export const CROWDING = 0.94;

export function generateGalaxySpec(seed: number): GalaxySpec {
  const rng = mulberry32(seed);
  const arms = pick(rng, [2, 2, 2, 3, 3, 4] as const);
  const bar = arms === 2 && rng() < 0.35;
  // Pitch 16 to 29 degrees: M51 / M101 territory, opened a little so two arms stay legible at one cell per star.
  const twist = range(rng, 1.8, 3.4);
  const spinDir: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const inclination = range(rng, 0.45, 1.05);
  const roll = range(rng, -0.6, 0.6);
  const coreSize = range(rng, 0.1, 0.22);
  const beadDensity = range(rng, 0.02, 0.06);
  const companion = rng() < 0.4;
  const companionArm = Math.floor(rng() * arms);
  const companionRadius = range(rng, 1.02, 1.12);
  const palette = pick(rng, GALAXY_PALETTES);
  const hazeCount: 1 | 2 = rng() < 0.5 ? 1 : 2;
  const thetaBar = rng() * Math.PI * 2;
  const barLength = bar ? range(rng, 0.28, 0.42) : 0;
  const m = arms;
  const eccentricity = CROWDING / Math.sqrt(1 + m * m * twist * twist);
  const v0 = (Math.PI * 2) / OUTER_ORBIT_PERIOD_S;
  return {
    seed,
    arms,
    bar,
    barLength,
    b: -spinDir * twist,
    twist,
    spinDir,
    inclination,
    roll,
    coreSize,
    beadDensity,
    companion,
    companionArm,
    companionRadius,
    palette,
    hazeCount,
    patternPeriodS: PATTERN_PERIOD_S,
    v0,
    aCore: Math.max(0.08, coreSize * 0.9),
    eccentricity,
    barEccentricity: 0.5,
    thickness: range(rng, 0.02, 0.05),
    thetaBar,
    starCount: 3400,
  };
}

/** Signed pattern speed in rad/s. */
export function patternSpeed(spec: GalaxySpec): number {
  return (spec.spinDir * Math.PI * 2) / spec.patternPeriodS;
}

export function patternAngle(spec: GalaxySpec, tSeconds: number): number {
  return patternSpeed(spec) * tSeconds;
}

/** Signed orbital angular velocity: flat rotation curve outside the solid-body core. */
export function omegaAt(spec: GalaxySpec, a: number): number {
  return (spec.spinDir * spec.v0) / Math.max(a, spec.aCore);
}

/** Arms start at the bulge edge; inside it the pattern stops winding (the bulge covers it anyway). */
export const ARM_START = 0.18;

/** Orientation of the m-fold perturbation at radius a, in the pattern frame (t = 0). */
export function thetaAt(spec: GalaxySpec, a: number): number {
  if (spec.barLength > 0) {
    return a < spec.barLength ? spec.thetaBar : spec.thetaBar + spec.b * Math.log(a / spec.barLength);
  }
  return spec.thetaBar + spec.b * Math.log(Math.max(a, ARM_START) / ARM_START);
}

/** Angle of arm k at radius a in the pattern frame: where orbits crowd. */
export function armAngle(spec: GalaxySpec, a: number, k = 0): number {
  return thetaAt(spec, a) + (Math.PI * 2 * k) / spec.arms;
}

export interface OrbitSample {
  a: number;
  eScale: number;
  psi0: number;
  dTheta: number;
  /** 4 = companion (co-rotates with the pattern); anything else orbits at omega(a). */
  kind: number;
}

export function eccentricityAt(spec: GalaxySpec, a: number): number {
  if (spec.barLength <= 0) return spec.eccentricity;
  const t = smoothstep(spec.barLength * 0.8, spec.barLength * 1.2, a);
  return spec.barEccentricity + (spec.eccentricity - spec.barEccentricity) * t;
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** CPU mirror of the vertex shader: disc-plane position of one orbit sample at time t. */
export function starPosition(spec: GalaxySpec, o: OrbitSample, tSeconds: number): { x: number; z: number; r: number; psi: number } {
  const omega = o.kind === 4 ? patternSpeed(spec) : omegaAt(spec, o.a);
  const psi = o.psi0 + omega * tSeconds;
  const theta = thetaAt(spec, o.a) + o.dTheta + patternAngle(spec, tSeconds);
  const m = spec.barLength > 0 && o.a < spec.barLength ? 2 : spec.arms;
  const e = o.eScale * eccentricityAt(spec, o.a);
  const r = o.a * (1 + e * Math.cos(m * (psi - theta)));
  return { x: r * Math.cos(psi), z: r * Math.sin(psi), r, psi };
}

export { gaussian, mulberry32 };
