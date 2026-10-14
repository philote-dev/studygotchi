/**
 * Outermost zone layout: courses -> places in a barred spiral galaxy.
 *
 * Pure and seeded (mulberry32): the same courses and seed give the same map on
 * every machine. No three.js objects here so it runs in vitest; the renderer
 * turns the result into points, quads and labels.
 *
 * Mapping rules (see outer-zone-layout.canvas.tsx for the reasoning):
 *   - subject area      -> arm (two major arms first, then the two minor ones; extra subjects share arms)
 *   - active course     -> bead on its arm, size from concept count, warmth from mastery
 *   - course with world -> bright cluster with a planet core (Westerlund 2 silhouette)
 *   - current course    -> the "you are here" bead: gold ring, label always on, the warm focal region
 *   - archived course   -> faint globular in the halo (Omega Centauri), off the disc plane
 *   - friend            -> satellite dwarf (LMC): bar + knot + haze, 1.5 to 2.0 R out
 *   - far background    -> deep-field smudges on a far shell, one cluster huddle and one quintet as landmarks
 *   - object slots      -> where sibling objects go, one per sector, never inside a bead
 *
 * Disc frame: the disc lies in the XZ plane, Y is up (same as the lab Galaxy), radius 1.
 */
import { gaussian, mulberry32, range } from "../../space/lib/rng";

export type Vec3 = readonly [number, number, number];

export interface LayoutCourse {
  id: string;
  name: string;
  /** Subject area key; every distinct key gets an arm (or a share of one). */
  subject: string;
  /** Concept count: drives bead radius. */
  concepts: number;
  /** 0..1, drives bead warmth; the lowest active mastery anchors the black hole. */
  mastery: number;
  hasWorld: boolean;
  archived: boolean;
  current: boolean;
}

export interface LayoutFriend {
  id: string;
  name: string;
}

export interface GalaxyLayoutInput {
  courses: readonly LayoutCourse[];
  friends?: readonly LayoutFriend[];
  seed: number;
}

export type ArmKind = "major" | "minor" | "spur";

export interface ArmSpine {
  index: number;
  kind: ArmKind;
  /** Pattern-frame angle of the arm at `aStart`. */
  theta0: number;
  aStart: number;
  aEnd: number;
  /** Subjects routed to this arm, in order of course count. */
  subjects: string[];
}

export type BeadKind = "cluster" | "world-cluster" | "current";

export interface CourseBead {
  courseId: string;
  name: string;
  subject: string;
  kind: BeadKind;
  arm: number;
  /** Semi-major radius along the arm, 0..1. */
  a: number;
  /** Disc-plane angle (pattern frame). */
  theta: number;
  position: Vec3;
  /** Glow radius in disc units. */
  radius: number;
  /** 0..1 from mastery: cool lilac at 0, warm cream at 1. */
  warmth: number;
  hasWorld: boolean;
  /** Unit vector in the disc plane pointing to the convex (outer) side of the arm: labels go here. */
  labelDir: readonly [number, number];
}

export interface HaloGlobular {
  courseId: string;
  name: string;
  position: Vec3;
  radius: number;
}

export interface Satellite {
  friendId: string;
  name: string;
  position: Vec3;
  /** Bar half-length in disc units. */
  radius: number;
  /** Rotation about Y, then tilt about the bar axis. */
  yaw: number;
  tilt: number;
  /** Which end of the bar carries the bright knot (30 Doradus). */
  knotSide: 1 | -1;
}

export type SlotType = "blackhole" | "nebula" | "pulsar" | "comet" | "binary" | "ringed-giant" | "white-hole" | "supernova-remnant";

export interface ObjectSlot {
  type: SlotType;
  position: Vec3;
  /** 0..5, 60 degree sectors of the disc, counted from +X toward +Z. */
  sector: number;
  radius: number;
  /** Course that justifies this slot (black hole: weakest; nebula: biggest). */
  anchorCourseId: string | null;
  /** Unit direction for things that move (comet). */
  heading: Vec3 | null;
  note: string;
}

export type SmudgeKind = "elliptical" | "spiral" | "edge-on";

export interface DeepFieldSmudge {
  /** Unit direction; the renderer puts it on the far shell. */
  dir: Vec3;
  kind: SmudgeKind;
  /** Size in pixel-pass cells, 1..3. */
  cells: 1 | 2 | 3;
  /** Which far landmark it belongs to, if any. */
  group: "field" | "cluster" | "quintet";
}

export interface ParallaxDepth {
  name: "near-sparkle" | "disc" | "halo" | "deep-field";
  /** Radius in disc units (shell radius for stars, disc radius for the subject). */
  radius: number;
  /** Full turns per second about Y (signed); 0 = camera parallax only. */
  spin: number;
}

export interface GalaxyShape {
  /** Log-spiral coefficient: theta(a) = theta0 + b * ln(a / aStart). Sign = -spinDir so arms trail. */
  b: number;
  pitchDeg: number;
  spinDir: 1 | -1;
  barHalfLength: number;
  barAngle: number;
  /** Warp amplitude: y = warp * max(0, a - 0.6)^2 * sin(theta - warpPhase). */
  warp: number;
  warpPhase: number;
  bulgeSigma: number;
}

export interface LayoutBudget {
  courses: number;
  beads: number;
  globulars: number;
  satellites: number;
  slots: number;
  slotCap: number;
  deepField: number;
}

export interface GalaxyLayout {
  seed: number;
  shape: GalaxyShape;
  arms: ArmSpine[];
  beads: CourseBead[];
  globulars: HaloGlobular[];
  satellites: Satellite[];
  slots: ObjectSlot[];
  deepField: DeepFieldSmudge[];
  depths: ParallaxDepth[];
  /** The warm focal region: the current bead if any, else the bulge. */
  focal: { position: Vec3; radius: number; courseId: string | null };
  budget: LayoutBudget;
}

// ---------------------------------------------------------------------------
// Constants (the spec numbers; the canvas quotes these)
// ---------------------------------------------------------------------------

export const LAYOUT = {
  /** Beads live between these radii along an arm. */
  beadAMin: 0.34,
  beadAMax: 0.94,
  beadRadiusMin: 0.04,
  beadRadiusMax: 0.085,
  /** Clearance between bead glows (disc units). */
  beadMargin: 0.035,
  /** Halo globulars: shell radii and the minimum |y| / r so they stay off the disc plane. */
  globularRMin: 1.1,
  globularRMax: 1.45,
  globularMinElevation: 0.3,
  globularRadius: 0.045,
  globularSpacing: 0.14,
  satelliteRMin: 1.5,
  satelliteRMax: 2.0,
  satelliteMinElevation: 0.3,
  satelliteSpacing: 0.55,
  maxSatellites: 3,
  /** Slot cap: 4 + floor(courses / 3). */
  slotBase: 4,
  slotPerCourses: 3,
  slotClearance: 0.045,
  sectors: 6,
  /** Deep field: 90 field smudges + one cluster huddle + one quintet. */
  deepFieldCount: 90,
  deepClusterCount: 7,
  deepQuintetCount: 5,
  /** Spins in turns per second: disc 1/240, halo counter 1/600. */
  discSpin: 1 / 240,
  haloSpin: -1 / 600,
} as const;

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Geometry helpers (shared with the renderer)
// ---------------------------------------------------------------------------

/** Pattern-frame angle of an arm at radius a (log spiral from the arm start). */
export function armTheta(shape: GalaxyShape, arm: ArmSpine, a: number): number {
  return arm.theta0 + shape.b * Math.log(Math.max(a, arm.aStart) / arm.aStart);
}

/** Vertical warp of the outer disc (ESO 510-G13): zero inside 0.6 R. */
export function warpY(shape: GalaxyShape, a: number, theta: number): number {
  const t = Math.max(0, a - 0.6);
  return shape.warp * t * t * Math.sin(theta - shape.warpPhase);
}

export function discPoint(shape: GalaxyShape, a: number, theta: number, y = 0): Vec3 {
  return [a * Math.cos(theta), y + warpY(shape, a, theta), a * Math.sin(theta)];
}

export function armPoint(shape: GalaxyShape, arm: ArmSpine, a: number): Vec3 {
  return discPoint(shape, a, armTheta(shape, arm, a));
}

/** Unit vector in the disc plane normal to the arm at a, pointing to the convex (outer) side. */
export function armOutwardNormal(shape: GalaxyShape, arm: ArmSpine, a: number): readonly [number, number] {
  const p0 = armPoint(shape, arm, a);
  const p1 = armPoint(shape, arm, Math.min(arm.aEnd, a + 0.01));
  const tx = p1[0] - p0[0];
  const tz = p1[2] - p0[2];
  const len = Math.hypot(tx, tz) || 1;
  // Two candidate normals; the outer one points away from the centre.
  let nx = -tz / len;
  let nz = tx / len;
  if (nx * p0[0] + nz * p0[2] < 0) {
    nx = -nx;
    nz = -nz;
  }
  return [nx, nz];
}

export function sectorOf(x: number, z: number): number {
  const t = ((Math.atan2(z, x) % TAU) + TAU) % TAU;
  return Math.min(LAYOUT.sectors - 1, Math.floor((t / TAU) * LAYOUT.sectors));
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function unitFromAngles(theta: number, elevation: number): Vec3 {
  const c = Math.cos(elevation);
  return [c * Math.cos(theta), Math.sin(elevation), c * Math.sin(theta)];
}

export function beadRadiusFor(concepts: number): number {
  const t = Math.sqrt(Math.min(1, Math.max(0, concepts) / 80));
  return LAYOUT.beadRadiusMin + (LAYOUT.beadRadiusMax - LAYOUT.beadRadiusMin) * t;
}

export function slotCapFor(courseCount: number): number {
  return LAYOUT.slotBase + Math.floor(courseCount / LAYOUT.slotPerCourses);
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function generateGalaxyLayout(input: GalaxyLayoutInput): GalaxyLayout {
  const seed = input.seed >>> 0;
  const rng = mulberry32(seed);
  const courses = input.courses;
  const friends = (input.friends ?? []).slice(0, LAYOUT.maxSatellites);

  // Shape: Hurt map proportions. Pitch 12 to 18 degrees, bar 0.22 to 0.3 R.
  const pitchDeg = range(rng, 12, 18);
  const spinDir: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const b = -spinDir / Math.tan((pitchDeg * Math.PI) / 180);
  const barHalfLength = range(rng, 0.22, 0.3);
  const barAngle = rng() * TAU;
  const shape: GalaxyShape = {
    b,
    pitchDeg,
    spinDir,
    barHalfLength,
    barAngle,
    warp: range(rng, 0.04, 0.09),
    warpPhase: rng() * TAU,
    bulgeSigma: range(rng, 0.1, 0.14),
  };

  // Arms: two major from the bar ends, two minor a quarter turn on, one spur.
  const arms: ArmSpine[] = [
    { index: 0, kind: "major", theta0: barAngle, aStart: barHalfLength, aEnd: 1, subjects: [] },
    { index: 1, kind: "major", theta0: barAngle + Math.PI, aStart: barHalfLength, aEnd: 1, subjects: [] },
    { index: 2, kind: "minor", theta0: barAngle + Math.PI / 2 + range(rng, -0.15, 0.15), aStart: barHalfLength + 0.08, aEnd: 0.9, subjects: [] },
    { index: 3, kind: "minor", theta0: barAngle + (3 * Math.PI) / 2 + range(rng, -0.15, 0.15), aStart: barHalfLength + 0.08, aEnd: 0.9, subjects: [] },
  ];
  const spurArm = Math.floor(rng() * 2);
  const spurA = range(rng, 0.5, 0.62);
  arms.push({
    index: 4,
    kind: "spur",
    theta0: armTheta(shape, arms[spurArm], spurA) + spinDir * 0.22,
    aStart: spurA,
    aEnd: Math.min(1, spurA + 0.26),
    subjects: [],
  });

  // Subjects -> arms. Count active courses per subject; biggest subject takes a major arm.
  const active = courses.filter((c) => !c.archived);
  const archived = courses.filter((c) => c.archived);
  const subjectCounts = new Map<string, number>();
  for (const c of active) subjectCounts.set(c.subject, (subjectCounts.get(c.subject) ?? 0) + 1);
  const subjects = [...subjectCounts.entries()].sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1)).map(([s]) => s);
  const armOrder = [0, 1, 2, 3];
  const subjectArm = new Map<string, number>();
  subjects.forEach((s, i) => {
    const arm = armOrder[i % armOrder.length];
    subjectArm.set(s, arm);
    arms[arm].subjects.push(s);
  });

  // Beads: biggest first so the small ones fill the gaps. Candidates are arm samples; a bead takes
  // the valid sample nearest its preferred radius. Preferred radii spread each arm's courses evenly.
  const beads: CourseBead[] = [];
  const sorted = [...active].sort((p, q) => beadRadiusFor(q.concepts) - beadRadiusFor(p.concepts) || (p.id < q.id ? -1 : 1));
  const perArmIndex = new Map<number, number>();
  const perArmTotal = new Map<number, number>();
  for (const c of sorted) perArmTotal.set(subjectArm.get(c.subject)!, (perArmTotal.get(subjectArm.get(c.subject)!) ?? 0) + 1);
  const samples = 48;
  const placeOnArm = (c: LayoutCourse, armIndex: number, radius: number, preferred: number): CourseBead | null => {
    const arm = arms[armIndex];
    const lo = Math.max(LAYOUT.beadAMin, arm.aStart + 0.06);
    const hi = Math.min(LAYOUT.beadAMax, arm.aEnd - 0.03);
    let best: { a: number; score: number } | null = null;
    for (let s = 0; s <= samples; s++) {
      const a = lo + ((hi - lo) * s) / samples;
      const p = armPoint(shape, arm, a);
      let ok = true;
      for (const other of beads) {
        if (dist(p, other.position) < radius + other.radius + LAYOUT.beadMargin) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const score = Math.abs(a - preferred);
      if (!best || score < best.score) best = { a, score };
    }
    if (!best) return null;
    const theta = armTheta(shape, arm, best.a);
    return {
      courseId: c.id,
      name: c.name,
      subject: c.subject,
      kind: c.current ? "current" : c.hasWorld ? "world-cluster" : "cluster",
      arm: armIndex,
      a: best.a,
      theta,
      position: armPoint(shape, arm, best.a),
      radius,
      warmth: Math.min(1, Math.max(0, c.mastery)),
      hasWorld: c.hasWorld,
      labelDir: armOutwardNormal(shape, arm, best.a),
    };
  };
  for (const c of sorted) {
    const home = subjectArm.get(c.subject)!;
    const idx = perArmIndex.get(home) ?? 0;
    perArmIndex.set(home, idx + 1);
    const total = perArmTotal.get(home) ?? 1;
    const preferred = LAYOUT.beadAMin + ((LAYOUT.beadAMax - LAYOUT.beadAMin) * (idx + 0.5)) / total + range(rng, -0.04, 0.04);
    let radius = beadRadiusFor(c.concepts);
    let bead: CourseBead | null = null;
    // Home arm first, then the others, then shrink. Bounded: 3 shrink steps x 5 arms.
    for (let shrink = 0; shrink < 3 && !bead; shrink++) {
      const order = [home, ...[0, 1, 2, 3, 4].filter((k) => k !== home)];
      for (const armIndex of order) {
        bead = placeOnArm(c, armIndex, radius, preferred);
        if (bead) break;
      }
      if (!bead) radius *= 0.8;
    }
    if (bead) beads.push(bead);
  }

  // Halo globulars for archived courses: off the plane, spaced.
  const globulars: HaloGlobular[] = [];
  for (const c of archived) {
    let best: Vec3 | null = null;
    let bestScore = -1;
    for (let attempt = 0; attempt < 16; attempt++) {
      const r = range(rng, LAYOUT.globularRMin, LAYOUT.globularRMax);
      const sign = rng() < 0.5 ? 1 : -1;
      const elevation = sign * range(rng, Math.asin(LAYOUT.globularMinElevation), 1.25);
      const u = unitFromAngles(rng() * TAU, elevation);
      const p: Vec3 = [u[0] * r, u[1] * r, u[2] * r];
      let minD = Infinity;
      for (const g of globulars) minD = Math.min(minD, dist(p, g.position));
      if (minD >= LAYOUT.globularSpacing) {
        best = p;
        break;
      }
      if (minD > bestScore) {
        bestScore = minD;
        best = p;
      }
    }
    globulars.push({ courseId: c.id, name: c.name, position: best!, radius: LAYOUT.globularRadius });
  }

  // Satellites for friends: LMC-style dwarfs 1.5 to 2.0 R out, never in the disc plane, spread apart.
  const satellites: Satellite[] = [];
  for (const f of friends) {
    let best: Vec3 | null = null;
    let bestScore = -1;
    for (let attempt = 0; attempt < 16; attempt++) {
      const r = range(rng, LAYOUT.satelliteRMin, LAYOUT.satelliteRMax);
      const sign = satellites.length % 2 === 0 ? -1 : 1;
      const elevation = sign * range(rng, Math.asin(LAYOUT.satelliteMinElevation), 0.9);
      const u = unitFromAngles(rng() * TAU, elevation);
      const p: Vec3 = [u[0] * r, u[1] * r, u[2] * r];
      let minD = Infinity;
      for (const s of satellites) minD = Math.min(minD, dist(p, s.position));
      if (minD >= LAYOUT.satelliteSpacing) {
        best = p;
        break;
      }
      if (minD > bestScore) {
        bestScore = minD;
        best = p;
      }
    }
    satellites.push({
      friendId: f.id,
      name: f.name,
      position: best!,
      radius: range(rng, 0.09, 0.13),
      yaw: rng() * TAU,
      tilt: range(rng, -0.6, 0.6),
      knotSide: rng() < 0.5 ? 1 : -1,
    });
  }

  // Object slots.
  const slots: ObjectSlot[] = [];
  const slotCap = slotCapFor(courses.length);
  const occupancy = new Array<number>(LAYOUT.sectors).fill(0);
  for (const bd of beads) occupancy[sectorOf(bd.position[0], bd.position[2])] += 1;
  const clearOf = (p: Vec3, r: number): boolean => {
    for (const bd of beads) if (dist(p, bd.position) < bd.radius + r + LAYOUT.slotClearance) return false;
    for (const s of slots) if (dist(p, s.position) < s.radius + r + LAYOUT.slotClearance) return false;
    return true;
  };
  const push = (slot: ObjectSlot) => {
    if (slots.length >= slotCap) return;
    slots.push(slot);
    occupancy[slot.sector] += 1;
  };
  /** Least-occupied sector, ties broken by the seed; a free position in it, pushed clear of beads. */
  const freeSlot = (type: SlotType, radius: number, aLo: number, aHi: number, y: number, note: string): ObjectSlot | null => {
    const minOcc = Math.min(...occupancy);
    const candidates = occupancy.map((o, i) => (o === minOcc ? i : -1)).filter((i) => i >= 0);
    const sector = candidates[Math.floor(rng() * candidates.length)];
    let best: Vec3 | null = null;
    let bestD = -1;
    for (let attempt = 0; attempt < 14; attempt++) {
      const theta = ((sector + 0.5) / LAYOUT.sectors) * TAU + range(rng, -0.4, 0.4);
      const a = range(rng, aLo, aHi);
      const p = discPoint(shape, a, theta, y);
      if (clearOf(p, radius)) {
        best = p;
        break;
      }
      let minD = Infinity;
      for (const bd of beads) minD = Math.min(minD, dist(p, bd.position) - bd.radius);
      if (minD > bestD) {
        bestD = minD;
        best = p;
      }
    }
    if (!best) return null;
    return { type, position: best, sector: sectorOf(best[0], best[2]), radius, anchorCourseId: null, heading: null, note };
  };

  // 1. Black hole: inward of the weakest active bead, in the inter-arm gap on the concave side.
  const weakest = beads.length ? beads.reduce((w, bd) => (bd.warmth < w.warmth ? bd : w), beads[0]) : null;
  if (weakest) {
    const nx = -weakest.labelDir[0];
    const nz = -weakest.labelDir[1];
    const r = 0.055;
    const step = weakest.radius + r + LAYOUT.slotClearance + 0.02;
    let p: Vec3 = [weakest.position[0] + nx * step, weakest.position[1], weakest.position[2] + nz * step];
    // Keep it outside the bar and clear of other beads; otherwise try the convex side.
    if (Math.hypot(p[0], p[2]) < shape.barHalfLength + 0.08 || !clearOf(p, r)) {
      p = [weakest.position[0] - nx * step, weakest.position[1], weakest.position[2] - nz * step];
    }
    push({
      type: "blackhole",
      position: p,
      sector: sectorOf(p[0], p[2]),
      radius: r,
      anchorCourseId: weakest.courseId,
      heading: null,
      note: `weak-area attractor beside ${weakest.name} (mastery ${(weakest.warmth * 100).toFixed(0)} %)`,
    });
  }
  // 2. Nebula: HII pocket on the outer edge of the biggest bead (two for 6+ courses, second biggest).
  const bySize = [...beads].sort((p, q) => q.radius - p.radius || (p.courseId < q.courseId ? -1 : 1));
  const nebulaCount = Math.min(bySize.length, courses.length >= 6 ? 2 : 1);
  const nebulaFor = (bd: CourseBead): ObjectSlot => {
    const r = 0.075;
    const step = bd.radius + r * 0.55;
    const p: Vec3 = [bd.position[0] + bd.labelDir[0] * step, bd.position[1], bd.position[2] + bd.labelDir[1] * step];
    return { type: "nebula", position: p, sector: sectorOf(p[0], p[2]), radius: r, anchorCourseId: bd.courseId, heading: null, note: `HII pocket behind ${bd.name}` };
  };
  if (nebulaCount >= 1) push(nebulaFor(bySize[0]));
  // 3. Pulsar: inter-arm, mid disc.
  const pulsar = freeSlot("pulsar", 0.03, 0.45, 0.8, 0.01, "lighthouse beat in an empty sector");
  if (pulsar) push(pulsar);
  // 4. Comet: perihelion just outside the current bead, heading across the disc.
  const current = beads.find((bd) => bd.kind === "current") ?? null;
  if (current) {
    const r = 0.03;
    const p: Vec3 = [current.position[0] + current.labelDir[0] * (current.radius + 0.1), current.position[1] + 0.03, current.position[2] + current.labelDir[1] * (current.radius + 0.1)];
    const ang = rng() * TAU;
    push({
      type: "comet",
      position: p,
      sector: sectorOf(p[0], p[2]),
      radius: r,
      anchorCourseId: current.courseId,
      heading: [Math.cos(ang), 0.15, Math.sin(ang)],
      note: `perihelion past ${current.name}, falls in from the halo`,
    });
  }
  // 5. Binary: a pair in a free sector.
  const binary = freeSlot("binary", 0.035, 0.5, 0.9, -0.01, "two beads waltzing in a quiet sector");
  if (binary) push(binary);
  // 6. Ringed giant: the outskirts.
  const giant = freeSlot("ringed-giant", 0.04, 0.86, 0.98, 0.02, "Saturn on the rim");
  if (giant) push(giant);
  // 7. Supernova remnant: on an arm, away from beads (needs an archived course: something ended).
  if (archived.length > 0) {
    const arm = arms[(seed >>> 3) % 4];
    let placed = false;
    for (let s = 0; s <= 20 && !placed; s++) {
      const a = 0.4 + 0.5 * (s / 20);
      const p = armPoint(shape, arm, a);
      if (clearOf(p, 0.06)) {
        push({ type: "supernova-remnant", position: p, sector: sectorOf(p[0], p[2]), radius: 0.06, anchorCourseId: archived[0].id, heading: null, note: `where ${archived[0].name} used to shine` });
        placed = true;
      }
    }
  }
  // 8. White hole: opposite the black hole, above the disc in the halo (6+ courses).
  const bh = slots.find((s) => s.type === "blackhole");
  if (bh && courses.length >= 6) {
    const t = Math.atan2(bh.position[2], bh.position[0]) + Math.PI;
    const p: Vec3 = [1.15 * Math.cos(t), 0.22, 1.15 * Math.sin(t)];
    push({ type: "white-hole", position: p, sector: sectorOf(p[0], p[2]), radius: 0.05, anchorCourseId: null, heading: null, note: "mirror of the black hole, above the rim" });
  }
  // 9. Second HII pocket, only when the cap still has room (never with 12 courses: one of each type wins).
  if (nebulaCount >= 2) push(nebulaFor(bySize[1]));

  // Deep field: smudges on the far shell, biased slightly off the disc plane so they do not fight the rim.
  const deepField: DeepFieldSmudge[] = [];
  const smudgeKind = (): SmudgeKind => {
    const r = rng();
    return r < 0.55 ? "elliptical" : r < 0.8 ? "spiral" : "edge-on";
  };
  const smudgeCells = (): 1 | 2 | 3 => {
    const r = rng();
    return r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
  };
  for (let i = 0; i < LAYOUT.deepFieldCount; i++) {
    const z = rng() * 2 - 1;
    const t = rng() * TAU;
    const rr = Math.sqrt(1 - z * z);
    deepField.push({ dir: [rr * Math.cos(t), z, rr * Math.sin(t)], kind: smudgeKind(), cells: smudgeCells(), group: "field" });
  }
  const clusterDir = unitFromAngles(rng() * TAU, range(rng, 0.25, 0.7) * (rng() < 0.5 ? 1 : -1));
  for (let i = 0; i < LAYOUT.deepClusterCount; i++) {
    const d: Vec3 = [clusterDir[0] + gaussian(rng) * 0.07, clusterDir[1] + gaussian(rng) * 0.05, clusterDir[2] + gaussian(rng) * 0.07];
    const len = Math.hypot(d[0], d[1], d[2]);
    deepField.push({ dir: [d[0] / len, d[1] / len, d[2] / len], kind: "elliptical", cells: i < 3 ? 3 : 2, group: "cluster" });
  }
  const quintetDir = unitFromAngles(Math.atan2(clusterDir[2], clusterDir[0]) + Math.PI + range(rng, -0.6, 0.6), range(rng, -0.5, 0.5));
  for (let i = 0; i < LAYOUT.deepQuintetCount; i++) {
    const d: Vec3 = [quintetDir[0] + gaussian(rng) * 0.025, quintetDir[1] + gaussian(rng) * 0.02, quintetDir[2] + gaussian(rng) * 0.025];
    const len = Math.hypot(d[0], d[1], d[2]);
    deepField.push({ dir: [d[0] / len, d[1] / len, d[2] / len], kind: i % 2 === 0 ? "elliptical" : "spiral", cells: 2, group: "quintet" });
  }

  const depths: ParallaxDepth[] = [
    { name: "near-sparkle", radius: 2.8, spin: 0 },
    { name: "disc", radius: 1, spin: LAYOUT.discSpin * spinDir },
    { name: "halo", radius: 2, spin: LAYOUT.haloSpin * spinDir },
    { name: "deep-field", radius: 8, spin: 0 },
  ];

  const focal = current
    ? { position: current.position, radius: Math.max(0.26, current.radius * 3.2), courseId: current.courseId }
    : { position: [0, 0, 0] as Vec3, radius: barHalfLength + 0.1, courseId: null };

  return {
    seed,
    shape,
    arms,
    beads,
    globulars,
    satellites,
    slots,
    deepField,
    depths,
    focal,
    budget: {
      courses: courses.length,
      beads: beads.length,
      globulars: globulars.length,
      satellites: satellites.length,
      slots: slots.length,
      slotCap,
      deepField: deepField.length,
    },
  };
}
