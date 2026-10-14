/**
 * Seeded point buffers for the galaxy. Pure: no three.js objects, so it runs
 * in vitest and could run in a Worker. Colours are linear-light floats.
 *
 * The lab's four populations (disc, bulge, companion, dust) are drawn from
 * the SAME rng stream in the SAME order as the original lab galaxy, so for a
 * given seed every lab star is still here at the same orbit. The polish
 * decisions (young / old split, stellar class, halo, globulars, bridge, spurs,
 * clusters) come from a second stream. Two star buffers: `stars` (old light,
 * drawn under the dust) and `young` (arm population, beads, clusters, drawn
 * over it). Product module (moved from `components/lab/cosmos/galaxy/
 * galaxy-points.ts`).
 */
import { Color } from "three";
import { gaussian, mulberry32, range } from "@/lib/stage/rng";
import { armAngle, armRidgeAngle, spurOffset, type GalaxySpec } from "./spec";
import { STELLAR_CLASS } from "./palettes";

export const KIND = {
  disc: 0,
  dust: 1,
  bead: 2,
  bulge: 3,
  companion: 4,
  young: 5,
  halo: 6,
  globular: 7,
  bridge: 8,
  cluster: 9,
  spur: 10,
} as const;

export interface PointBuffers {
  count: number;
  /** a, eScale, psi0, dTheta per point. */
  orbit: Float32Array;
  /** x, z: rigid offset added after the orbit (clumps); y = thickness offset. */
  position: Float32Array;
  kind: Float32Array;
  color: Float32Array;
  phase: Float32Array;
  /** OBAFGKM class index into the theme's stellar list. */
  cls: Float32Array;
}

export interface GalaxyBuffers {
  stars: PointBuffers;
  young: PointBuffers;
  dust: PointBuffers;
}

export const GALAXY_COUNTS = { disc: 3400, dust: 420, bulge: 480, companion: 90 } as const;
export const POLISH_COUNTS = { halo: 360, globular: 36, bridge: 100, clusters: 12, spurStars: 20, complexBeads: 8 } as const;
/** Hard ceiling for everything the galaxy draws as points (the star shell is separate). */
export const POINT_BUDGET = 9000;

function alloc(count: number): PointBuffers {
  return {
    count,
    orbit: new Float32Array(count * 4),
    position: new Float32Array(count * 3),
    kind: new Float32Array(count),
    color: new Float32Array(count * 3),
    phase: new Float32Array(count),
    cls: new Float32Array(count),
  };
}

function put(b: PointBuffers, i: number, a: number, eScale: number, psi0: number, dTheta: number, kind: number, y: number, c: Color, phase: number, cls: number, ox = 0, oz = 0) {
  b.orbit[i * 4] = a;
  b.orbit[i * 4 + 1] = eScale;
  b.orbit[i * 4 + 2] = psi0;
  b.orbit[i * 4 + 3] = dTheta;
  b.position[i * 3] = ox;
  b.position[i * 3 + 1] = y;
  b.position[i * 3 + 2] = oz;
  b.kind[i] = kind;
  b.color[i * 3] = c.r;
  b.color[i * 3 + 1] = c.g;
  b.color[i * 3 + 2] = c.b;
  b.phase[i] = phase;
  b.cls[i] = cls;
}

const scratch = new Color();
const { OB, A, F, G, K, M, HII, HII_ALT } = STELLAR_CLASS;

/** Weighted class pick: pairs of [class, weight]. */
function pickClass(rng: () => number, table: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (const [, w] of table) total += w;
  let roll = rng() * total;
  for (const [cls, w] of table) {
    roll -= w;
    if (roll < 0) return cls;
  }
  return table[table.length - 1][0];
}

// Old disc: cream-white with gold, a little orange, a sprinkle of red giants (warmer inward, M31).
const CLASS_INNER = [[F, 0.45], [G, 0.35], [K, 0.15], [M, 0.05]] as const;
const CLASS_MID = [[A, 0.2], [F, 0.55], [G, 0.18], [K, 0.04], [M, 0.03]] as const;
const CLASS_OUTER = [[OB, 0.08], [A, 0.4], [F, 0.45], [G, 0.05], [M, 0.02]] as const;
const CLASS_YOUNG = [[OB, 0.55], [A, 0.35], [F, 0.1]] as const;
const CLASS_BULGE = [[F, 0.25], [G, 0.45], [K, 0.25], [M, 0.05]] as const;
const CLASS_COMPANION = [[F, 0.35], [G, 0.45], [K, 0.2]] as const;
const CLASS_BRIDGE = [[A, 0.2], [F, 0.5], [G, 0.3]] as const;
const CLASS_HALO = [[F, 0.35], [G, 0.4], [K, 0.2], [M, 0.05]] as const;
const CLASS_GLOBULAR = [[F, 0.35], [G, 0.45], [K, 0.2]] as const;

export function buildGalaxyBuffers(spec: GalaxySpec): GalaxyBuffers {
  const rng = mulberry32(spec.seed ^ 0x9e3779b9);
  const rng2 = mulberry32(spec.seed ^ 0x2545f491);
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
  const bridgeCount = spec.bridge && spec.companion ? POLISH_COUNTS.bridge : 0;
  const globularCount = spec.globulars.length * POLISH_COUNTS.globular;
  const spurCount = spec.spurs.length * POLISH_COUNTS.spurStars;
  const complexBeadCount = spec.hiiComplexes.length * POLISH_COUNTS.complexBeads;

  const armStart = spec.bar ? spec.barLength * 1.1 : 0.28;
  // The young / old split is decided per disc star from a dedicated stream, so the disc loop
  // below keeps the lab's rng order untouched. Buffers are allocated for the upper bound and
  // trimmed to the exact count afterwards.
  const rngYoung = mulberry32(spec.seed ^ 0x7f4a7c15);

  let stars = alloc(discCount + bulgeCount + compCount + spec.haloCount + globularCount + bridgeCount);
  let young = alloc(discCount + spurCount + POLISH_COUNTS.clusters + complexBeadCount);
  const dustB = alloc(GALAXY_COUNTS.dust);

  let i = 0;
  let j = 0;
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
    const phase = rng();
    // Polish: population and class from the second stream.
    const isYoung = rngYoung() < spec.youngFraction && hug && a > armStart && !isBead;
    const cls = isBead ? (scratch.equals(bead) ? HII : HII_ALT) : isYoung ? pickClass(rng2, CLASS_YOUNG) : pickClass(rng2, a < 0.4 ? CLASS_INNER : a < 0.75 ? CLASS_MID : CLASS_OUTER);
    if (isBead || isYoung) put(young, j++, a, eScale, psi0, dTheta, isBead ? KIND.bead : KIND.young, y, scratch, phase, cls);
    else put(stars, i++, a, eScale, psi0, dTheta, KIND.disc, y, scratch, phase, cls);
  }
  // Bulge: Gaussian ball, circular orbits, warm to white.
  for (let n = 0; n < bulgeCount; n++) {
    const a = Math.min(0.5, Math.abs(gaussian(rng)) * spec.coreSize + 0.01);
    const psi0 = rng() * Math.PI * 2;
    const heat = Math.exp(-(a * a) / (2 * spec.coreSize * spec.coreSize * 0.3));
    scratch.copy(core).lerp(white, heat);
    const y = gaussian(rng) * spec.coreSize * 0.45;
    put(stars, i++, a, 0, psi0, 0, KIND.bulge, y, scratch, rng(), pickClass(rng2, CLASS_BULGE));
  }
  // Companion (M51's buddy): a warm clump hanging off one arm tip, co-rotating with the pattern.
  const ac = spec.companionRadius;
  const compPsi = armAngle(spec, Math.min(ac, 1), spec.companionArm);
  if (spec.companion) {
    for (let n = 0; n < compCount; n++) {
      const da = gaussian(rng) * 0.035;
      const dpsi = gaussian(rng) * 0.045;
      scratch.copy(companion).lerp(white, Math.max(0, 1 - Math.hypot(da / 0.035, dpsi / 0.045)) * 0.6);
      put(stars, i++, ac + da, 0, compPsi + dpsi, 0, KIND.companion, gaussian(rng) * 0.02, scratch, rng(), pickClass(rng2, CLASS_COMPANION));
    }
  }
  // Dust lanes: same orbits, crowding shifted to the inner / trailing edge of each arm.
  for (let n = 0; n < GALAXY_COUNTS.dust; n++) {
    const a = 0.16 + 0.8 * Math.pow(rng(), 0.8);
    const psi0 = rng() * Math.PI * 2;
    scratch.copy(dust).lerp(new Color("#000000"), range(rng, 0, 0.3));
    put(dustB, n, a, 1.08, psi0, -spec.spinDir * 0.32, KIND.dust, gaussian(rng) * spec.thickness * 0.5, scratch, rng(), K);
  }

  // ---- polish populations (second stream only from here) ----
  // Halo: sparse flattened spheroid of old stars, slow orbits.
  for (let n = 0; n < spec.haloCount; n++) {
    const a = 0.2 + 1.0 * Math.pow(rng2(), 0.6);
    const y = gaussian(rng2) * 0.22 * (1.15 - a * 0.5);
    scratch.copy(core).multiplyScalar(0.8);
    put(stars, i++, a, 0.15, rng2() * Math.PI * 2, 0, KIND.halo, y, scratch, rng2(), pickClass(rng2, CLASS_HALO));
  }
  // Globular clusters: rigid clumps (shared a, offsets in position.xz), well out of the plane.
  for (const g of spec.globulars) {
    for (let n = 0; n < POLISH_COUNTS.globular; n++) {
      const ox = gaussian(rng2) * g.size * 0.55;
      const oz = gaussian(rng2) * g.size * 0.55;
      const oy = gaussian(rng2) * g.size * 0.55;
      scratch.copy(core).lerp(white, Math.max(0, 1 - Math.hypot(ox, oz, oy) / g.size) * 0.5);
      put(stars, i++, g.a, 0, g.psi, 0, KIND.globular, g.y + oy, scratch, rng2(), pickClass(rng2, CLASS_GLOBULAR), ox, oz);
    }
  }
  // Tidal bridge: from the arm's crowding ridge near the rim to the companion, plus a short tail beyond it.
  if (bridgeCount > 0) {
    const tipPsi = armRidgeAngle(spec, 0.9, spec.companionArm);
    // Shortest way round from the ridge tip to the companion.
    let span = compPsi - tipPsi;
    span = Math.atan2(Math.sin(span), Math.cos(span));
    for (let n = 0; n < bridgeCount; n++) {
      const t = n < bridgeCount * 0.75 ? rng2() : 1 + rng2() * 0.5;
      const a = 0.9 + (ac - 0.9) * t + gaussian(rng2) * (0.02 + 0.03 * Math.max(0, t - 1));
      const psi = tipPsi + span * t + gaussian(rng2) * 0.035;
      scratch.copy(arm).lerp(companion, Math.min(1, t));
      put(stars, i++, a, 0, psi, 0, KIND.bridge, gaussian(rng2) * 0.02, scratch, rng2(), pickClass(rng2, CLASS_BRIDGE));
    }
  }
  // Spur stars: young stars whose perturbation is rotated along the spur, so their crowding ridge IS the spur.
  for (const s of spec.spurs) {
    for (let n = 0; n < POLISH_COUNTS.spurStars; n++) {
      const a = s.a0 * Math.exp(rng2() * s.len);
      const dTheta = spurOffset(s, a) + (Math.PI * 2 * s.arm) / spec.arms + spec.spinDir * 0.06;
      scratch.copy(tip);
      put(young, j++, a, 1, rng2() * Math.PI * 2, dTheta, KIND.spur, gaussian(rng2) * spec.thickness, scratch, rng2(), pickClass(rng2, CLASS_YOUNG));
    }
  }
  // Open clusters: a dozen bright blue plus-shaped points that light up in compression.
  for (let n = 0; n < POLISH_COUNTS.clusters; n++) {
    const a = range(rng2, 0.3, 0.9);
    scratch.copy(tip).lerp(white, 0.4);
    put(young, j++, a, 1, rng2() * Math.PI * 2, spec.spinDir * 0.08, KIND.cluster, gaussian(rng2) * spec.thickness, scratch, rng2(), OB);
  }
  // Giant HII complexes: a knot of beads around the complex glow, on the outer edge of the ridge.
  for (const h of spec.hiiComplexes) {
    const psi = armRidgeAngle(spec, h.a, h.arm) + spec.spinDir * 0.12;
    for (let n = 0; n < POLISH_COUNTS.complexBeads; n++) {
      const a = h.a + gaussian(rng2) * h.size * 0.4;
      const alt = rng2() < 0.3;
      scratch.copy(alt ? beadAlt : bead);
      put(young, j++, a, 1, psi + (gaussian(rng2) * h.size * 0.5) / Math.max(0.3, h.a), spec.spinDir * 0.14, KIND.bead, gaussian(rng2) * spec.thickness, scratch, rng2(), alt ? HII_ALT : HII);
    }
  }
  if (i > stars.count || j > young.count) throw new Error(`galaxy buffers: wrote ${i}/${stars.count} old, ${j}/${young.count} young`);
  stars = trim(stars, i);
  young = trim(young, j);
  return { stars, young, dust: dustB };
}

/** Exact-length views over the filled prefix of each attribute. */
function trim(b: PointBuffers, count: number): PointBuffers {
  return {
    count,
    orbit: b.orbit.subarray(0, count * 4),
    position: b.position.subarray(0, count * 3),
    kind: b.kind.subarray(0, count),
    color: b.color.subarray(0, count * 3),
    phase: b.phase.subarray(0, count),
    cls: b.cls.subarray(0, count),
  };
}

export function totalGalaxyPoints(b: GalaxyBuffers): number {
  return b.stars.count + b.young.count + b.dust.count;
}

export interface GalaxyFeatures {
  core: boolean;
  arms: boolean;
  dust: boolean;
  hii: boolean;
  colour: boolean;
  halo: boolean;
  depth: boolean;
  life: boolean;
}

export const FEATURE_KEYS = ["core", "arms", "dust", "hii", "colour", "halo", "depth", "life"] as const satisfies readonly (keyof GalaxyFeatures)[];

export const ALL_FEATURES: GalaxyFeatures = { core: true, arms: true, dust: true, hii: true, colour: true, halo: true, depth: true, life: true };
export const NO_FEATURES: GalaxyFeatures = { core: false, arms: false, dust: false, hii: false, colour: false, halo: false, depth: false, life: false };

/** Parse `on=all|none|core,arms,...` (URL param) into a feature set. */
export function featuresFromParam(on: string | undefined): GalaxyFeatures {
  if (on === undefined || on === "all") return ALL_FEATURES;
  if (on === "none" || on === "") return NO_FEATURES;
  const f = { ...NO_FEATURES };
  for (const key of on.split(",")) if (key in f) f[key as keyof GalaxyFeatures] = true;
  return f;
}

/**
 * Draw calls the galaxy issues for a feature set. Always: old stars, young
 * stars, dust grain, near glow sprites. Added: arm field (arms or core bar),
 * bulge billboard (core), dust field (dust), far layer (halo or life).
 */
export function galaxyDrawCalls(f: GalaxyFeatures): number {
  let n = 4;
  if (f.arms || f.core || f.depth) n++;
  if (f.core) n++;
  if (f.dust) n++;
  if (f.halo || f.life) n++;
  return n;
}

/** Galaxy draws (8 with every feature) + the course anchors' instanced draw + the course blobs' point draw (S3-3 C, 2026-10-13). */
export const DRAW_CALL_BUDGET = 10;
