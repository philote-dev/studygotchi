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
 *
 * The base fields are drawn from the same rng stream in the same order as the
 * original lab spec (same seed = same base galaxy as every lab capture), and
 * the polish fields come from a SECOND stream so adding one never reshuffles
 * the others. Product module (moved from `components/lab/cosmos/galaxy/
 * galaxy-spec.ts`, the polished fork); the kinematics are untouched.
 */
import { gaussian, mulberry32, pick, range } from "@/lib/stage/rng";
import { GALAXY_PALETTES, type GalaxyPalette } from "./palettes";

export type ArmCount = 2 | 3 | 4;

/** A spur / feather: a short ridge that branches off arm `arm` at radius `a0` and opens outward. */
export interface Spur {
  a0: number;
  arm: number;
  /** Signed d(theta)/d(ln a) added to the arm's: opposite sign to `b`, so the spur is more radial than the arm. */
  slope: number;
  /** Length in ln(a) units. */
  len: number;
  strength: number;
}

export interface Globular {
  a: number;
  psi: number;
  y: number;
  size: number;
}

export interface BackgroundGalaxy {
  /** View-plane position in units of the far layer (disc radii). */
  x: number;
  y: number;
  /** Depth behind the galaxy, disc radii. */
  depth: number;
  size: number;
  /** Minor / major axis ratio. */
  ratio: number;
  tilt: number;
  warm: boolean;
}

export interface HiiComplex {
  a: number;
  arm: number;
  size: number;
}

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

  // ---- polish fields (second rng stream) ----
  /** Share of disc stars in the young blue-white arm population. */
  youngFraction: number;
  /** 0..0.35: one arm stronger than the others (M51 / NGC 1300 are not symmetric). */
  armAsymmetry: number;
  spurs: Spur[];
  /** Dust feathers crossing the arms: start radius + arm, steep slope. */
  dustSpurs: Spur[];
  globulars: Globular[];
  haloCount: number;
  bridge: boolean;
  backgroundGalaxies: BackgroundGalaxy[];
  hiiComplexes: HiiComplex[];
  openClusterCount: number;
  /** Nucleus radius as a fraction of coreSize. */
  nucleus: number;
  flashPeriodS: number;
  cometPeriodS: number;
  /** Comet path in view-plane disc radii: x0, y0, x1, y1. */
  cometPath: [number, number, number, number];

  // ---- light model (shared/light) ----
  /** Sérsic index of the bulge billboard, 1.5 (soft) .. 3 (cuspy). */
  bulgeSersic: number;
  /** Bulge effective radius as a fraction of the billboard half-size. */
  bulgeRe: number;
  /** Arm cross-section sigma (disc radii) at the inner end and at the rim: wider inward, narrower outward. */
  armSigmaIn: number;
  armSigmaOut: number;
}

export const PATTERN_PERIOD_S = 48;
/** Outer-disc orbital period at a = 1 (seconds). Inner stars are faster. */
export const OUTER_ORBIT_PERIOD_S = 96;
export const CROWDING = 0.94;
export const MAX_SPURS = 6;

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
  const base = {
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

  // Second stream: nothing below disturbs the base galaxy.
  const rng2 = mulberry32(seed ^ 0x51ed270b);
  const b = base.b;
  const pitch = Math.atan(1 / twist);
  // Spurs branch 20 to 40 degrees away from the arm, on the outer side, more radial than the arm.
  const spurs: Spur[] = [];
  const spurTotal = Math.min(MAX_SPURS, arms * 2);
  const armStart = bar ? barLength * 1.25 : 0.3;
  for (let i = 0; i < spurTotal; i++) {
    const arm = i % arms;
    const branch = (range(rng2, 20, 40) * Math.PI) / 180;
    const slopeMag = twist - 1 / Math.tan(pitch + branch);
    spurs.push({
      a0: range(rng2, armStart, 0.72),
      arm,
      slope: -Math.sign(b) * slopeMag,
      len: range(rng2, 0.16, 0.3),
      strength: range(rng2, 0.55, 1),
    });
  }
  const dustSpurs: Spur[] = [];
  const dustSpurTotal = Math.min(MAX_SPURS, arms + 1);
  for (let i = 0; i < dustSpurTotal; i++) {
    dustSpurs.push({
      a0: range(rng2, armStart + 0.05, 0.75),
      arm: i % arms,
      slope: -Math.sign(b) * range(rng2, 2.6, 3.8),
      len: range(rng2, 0.1, 0.18),
      strength: range(rng2, 0.5, 1),
    });
  }
  const globulars: Globular[] = [];
  const globularCount = 2 + (rng2() < 0.5 ? 1 : 0);
  for (let i = 0; i < globularCount; i++) {
    globulars.push({ a: range(rng2, 0.55, 1.15), psi: rng2() * Math.PI * 2, y: (rng2() < 0.5 ? 1 : -1) * range(rng2, 0.12, 0.34), size: range(rng2, 0.04, 0.06) });
  }
  const backgroundGalaxies: BackgroundGalaxy[] = [];
  const bgCount = 2 + (rng2() < 0.5 ? 1 : 0);
  for (let i = 0; i < bgCount; i++) {
    const angle = rng2() * Math.PI * 2;
    const dist = range(rng2, 1.25, 1.75);
    backgroundGalaxies.push({
      x: Math.cos(angle) * dist * 1.3,
      y: Math.sin(angle) * dist * 0.8,
      depth: range(rng2, 4, 9),
      size: range(rng2, 0.035, 0.065),
      ratio: range(rng2, 0.3, 0.7),
      tilt: rng2() * Math.PI,
      warm: rng2() < 0.5,
    });
  }
  const hiiComplexes: HiiComplex[] = [];
  const hiiCount = 1 + (rng2() < 0.4 ? 1 : 0);
  for (let i = 0; i < hiiCount; i++) {
    hiiComplexes.push({ a: range(rng2, 0.5, 0.86), arm: Math.floor(rng2() * arms), size: range(rng2, 0.05, 0.075) });
  }
  // Comet: a chord across the field that passes beside the disc, never through the core.
  const cometAngle = rng2() * Math.PI * 2;
  const cometCross = cometAngle + Math.PI + range(rng2, -0.5, 0.5);
  const cometSide = (rng2() < 0.5 ? 1 : -1) * range(rng2, 1.4, 1.7);
  const mid = cometAngle + (cometCross - cometAngle) / 2;
  const nx = -Math.sin(mid) * cometSide;
  const ny = Math.cos(mid) * cometSide * 0.7;
  const cometPath: [number, number, number, number] = [
    Math.cos(cometAngle) * 1.9 + nx,
    Math.sin(cometAngle) * 1.1 + ny,
    Math.cos(cometCross) * 1.9 + nx,
    Math.sin(cometCross) * 1.1 + ny,
  ];
  return {
    ...base,
    youngFraction: range(rng2, 0.3, 0.38),
    armAsymmetry: range(rng2, 0, 0.35),
    spurs,
    dustSpurs,
    globulars,
    haloCount: 220,
    bridge: companion,
    backgroundGalaxies,
    hiiComplexes,
    openClusterCount: 12,
    nucleus: range(rng2, 0.1, 0.16),
    flashPeriodS: range(rng2, 6, 12),
    cometPeriodS: range(rng2, 30, 60),
    cometPath,
    // Light model fields are drawn last so adding them never reshuffles the fields above.
    bulgeSersic: range(rng2, 1.5, 3),
    bulgeRe: range(rng2, 0.28, 0.36),
    armSigmaIn: range(rng2, 0.09, 0.12),
    armSigmaOut: range(rng2, 0.05, 0.07),
  };
}

/**
 * Stellar surface density of the disc population as sampled in galaxy-points.ts
 * (a = 0.06 + 0.96 u^0.7): dN/da / (2 pi a), unnormalised, zero outside the
 * sampled range. The arm field's amplitude follows it so the ridge dies out
 * where the stars thin out.
 */
export function discDensity(a: number): number {
  if (a < 0.07 || a > 1.02) return 0;
  return Math.pow((a - 0.06) / 0.96, 1 / 0.7 - 1) / a;
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

/**
 * Where the orbits actually crowd, relative to theta(a): the density
 * 1 / (dr/da) = 1 / (1 + e cos X + e m b sin X) peaks at X = pi + atan(m b),
 * so the visible ridge of arm k sits at theta(a) + ridgeOffset + 2 pi k / m.
 * (`armAngle` keeps the lab meaning, the perturbation orientation.)
 */
export function ridgeOffset(spec: GalaxySpec): number {
  return (Math.PI + Math.atan2(spec.arms * spec.b, 1)) / spec.arms;
}

/**
 * Barred galaxies: the perturbation outside the bar is rotated by -ridgeOffset
 * (blended over 0.9..1.3 bar lengths) so the crowding ridge leaves from the bar
 * ends (NGC 1300) instead of 50 degrees around. The bar itself stays straight.
 */
export function barTwistAmount(spec: GalaxySpec): number {
  if (spec.barLength <= 0) return 0;
  const off = ridgeOffset(spec);
  // Wrap into (-pi/m, pi/m]: the two bar ends are pi apart, the ridges 2 pi / m apart.
  const period = (Math.PI * 2) / spec.arms;
  const wrapped = off - period * Math.round(off / period);
  return -wrapped;
}

export function barTwistOffset(spec: GalaxySpec, a: number): number {
  if (spec.barLength <= 0) return 0;
  return barTwistAmount(spec) * smoothstep(spec.barLength * 0.9, spec.barLength * 1.3, a);
}

/** Orientation of the m-fold perturbation at radius a, in the pattern frame (t = 0). */
export function thetaAt(spec: GalaxySpec, a: number): number {
  if (spec.barLength > 0) {
    const base = a < spec.barLength ? spec.thetaBar : spec.thetaBar + spec.b * Math.log(a / spec.barLength);
    return base + barTwistOffset(spec, a);
  }
  return spec.thetaBar + spec.b * Math.log(Math.max(a, ARM_START) / ARM_START);
}

/** Angle of arm k at radius a in the pattern frame: where orbits crowd. */
export function armAngle(spec: GalaxySpec, a: number, k = 0): number {
  return thetaAt(spec, a) + (Math.PI * 2 * k) / spec.arms;
}

/** Angle of the visible crowding ridge of arm k at radius a (pattern frame). */
export function armRidgeAngle(spec: GalaxySpec, a: number, k = 0): number {
  return armAngle(spec, a, k) + ridgeOffset(spec);
}

/** Pattern-frame perturbation offset of a star on a spur at radius a (0 off the spur). */
export function spurOffset(spur: Spur, a: number): number {
  const l = Math.log(a / spur.a0);
  if (l < 0 || l > spur.len) return 0;
  return spur.slope * l;
}

/** Branch angle (radians) between a spur and its arm: pitch(arm + spur) - pitch(arm). */
export function spurBranchAngle(spec: GalaxySpec, spur: Spur): number {
  const armPitch = Math.atan(1 / Math.abs(spec.b));
  const spurPitch = Math.atan(1 / Math.abs(spec.b + spur.slope));
  return spurPitch - armPitch;
}

export interface OrbitSample {
  a: number;
  eScale: number;
  psi0: number;
  dTheta: number;
  /** 4 = companion, 8 = bridge (co-rotate with the pattern); 6 halo / 7 globular orbit slowly; anything else orbits at omega(a). */
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

/** Orbital speed factor per kind: halo and globulars drift slowly, companion and bridge ride the pattern. */
export function omegaForKind(spec: GalaxySpec, kind: number, a: number): number {
  if (kind === 4 || kind === 8) return patternSpeed(spec);
  if (kind === 6) return omegaAt(spec, a) * 0.5;
  if (kind === 7) return omegaAt(spec, a) * 0.35;
  return omegaAt(spec, a);
}

/** CPU mirror of the vertex shader: disc-plane position of one orbit sample at time t. */
export function starPosition(spec: GalaxySpec, o: OrbitSample, tSeconds: number): { x: number; z: number; r: number; psi: number } {
  const omega = omegaForKind(spec, o.kind, o.a);
  const psi = o.psi0 + omega * tSeconds;
  const theta = thetaAt(spec, o.a) + o.dTheta + patternAngle(spec, tSeconds);
  const m = spec.barLength > 0 && o.a < spec.barLength ? 2 : spec.arms;
  const e = o.eScale * eccentricityAt(spec, o.a);
  const r = o.a * (1 + e * Math.cos(m * (psi - theta)));
  return { x: r * Math.cos(psi), z: r * Math.sin(psi), r, psi };
}

export { gaussian, mulberry32 };
