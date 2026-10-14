import { describe, expect, it } from "vitest";
import { armPoint, armsFromSpec, armTheta, generateGalaxyLayout, LAYOUT, normaliseCourses, sectorOf, slotCapFor, subjectFromCode, type GalaxyCourse, type GalaxyLayout, type LayoutFriend, type Vec3 } from "./layout";
import { armRidgeAngle, generateGalaxySpec } from "./spec";
import { seedFromText } from "@/lib/stage/rng";

/**
 * A plausible term in the product course shape: MIT-style codes, seven
 * subject areas, three courses with worlds (the three biomes), three archived.
 * Order matters: the 3 / 6 / 12 sets take prefixes, so the first three already
 * cover the current course, a world course and a second subject.
 */
const day = (d: number) => new Date(Date.UTC(2026, 9, d)).toISOString();
export const TERM: readonly GalaxyCourse[] = [
  { id: "8.223", code: "8.223", title: "Classical Mechanics II", subject: "physics", conceptCount: 64, mastery: 0.62, hasWorld: true, archived: false, lastOpenedAt: day(11) },
  { id: "18.06", code: "18.06", title: "Linear Algebra", subject: "math", conceptCount: 52, mastery: 0.78, hasWorld: true, archived: false, lastOpenedAt: day(9) },
  { id: "21G.401", code: "21G.401", title: "Korean I", subject: "language", conceptCount: 90, mastery: 0.41, hasWorld: false, archived: false, lastOpenedAt: day(10) },
  { id: "6.1010", code: "6.1010", title: "Fundamentals of Programming", subject: "cs", conceptCount: 48, mastery: 0.86, hasWorld: true, archived: false, lastOpenedAt: day(8) },
  { id: "8.044", code: "8.044", title: "Statistical Physics I", subject: "physics", conceptCount: 40, mastery: 0.33, hasWorld: false, archived: false, lastOpenedAt: day(7) },
  { id: "18.100A", code: "18.100A", title: "Real Analysis", subject: "math", conceptCount: 36, mastery: 0.55, hasWorld: false, archived: false, lastOpenedAt: day(6) },
  { id: "6.1210", code: "6.1210", title: "Algorithms", subject: "cs", conceptCount: 44, mastery: 0.22, hasWorld: false, archived: false, lastOpenedAt: day(5) },
  { id: "21W.021", code: "21W.021", title: "Writing and Experience", subject: "humanities", conceptCount: 18, mastery: 0.7, hasWorld: false, archived: false, lastOpenedAt: day(4) },
  { id: "14.01", code: "14.01", title: "Microeconomics", subject: "economics", conceptCount: 30, mastery: 0.48, hasWorld: false, archived: false, lastOpenedAt: day(3) },
  { id: "7.012", code: "7.012", title: "Introductory Biology", subject: "science", conceptCount: 58, mastery: 0.9, hasWorld: false, archived: true, lastOpenedAt: day(2) },
  { id: "5.111", code: "5.111", title: "Principles of Chemical Science", subject: "science", conceptCount: 50, mastery: 0.83, hasWorld: false, archived: true, lastOpenedAt: day(1) },
  { id: "24.00", code: "24.00", title: "Problems of Philosophy", subject: "humanities", conceptCount: 22, mastery: 0.95, hasWorld: false, archived: true, lastOpenedAt: null },
];
const CURRENT = "8.223";
const FRIENDS: readonly LayoutFriend[] = [
  { id: "mina", name: "Mina's galaxy" },
  { id: "theo", name: "Theo's galaxy" },
  { id: "yuki", name: "Yuki's galaxy" },
];

type SetSize = 3 | 6 | 12;
/** Prefix of the term plus a friend count that grows with it (1 / 2 / 3). */
function courseSet(size: SetSize): { courses: GalaxyCourse[]; friends: LayoutFriend[] } {
  const courses = TERM.slice(0, size).map((c) => ({ ...c }));
  // The 6-course set still needs a halo: archive the last one so globulars appear at every size above 3.
  if (size === 6) courses[5] = { ...courses[5], archived: true };
  const friends = FRIENDS.slice(0, size === 3 ? 1 : size === 6 ? 2 : 3).map((f) => ({ ...f }));
  return { courses, friends };
}

const SEEDS = [1, 7, 42, 1234, 0x9e3779b9, 20261011];
const SIZES: SetSize[] = [3, 6, 12];

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function every(fn: (layout: GalaxyLayout, size: SetSize, seed: number) => void) {
  for (const size of SIZES) {
    const { courses, friends } = courseSet(size);
    for (const seed of SEEDS) fn(generateGalaxyLayout({ courses, currentCourseId: CURRENT, friends, seed }), size, seed);
  }
}

describe("generateGalaxyLayout", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const { courses, friends } = courseSet(12);
    const a = generateGalaxyLayout({ courses, currentCourseId: CURRENT, friends, seed: 42 });
    const b = generateGalaxyLayout({ courses, currentCourseId: CURRENT, friends, seed: 42 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const c = generateGalaxyLayout({ courses, currentCourseId: CURRENT, friends, seed: 43 });
    expect(c.shape.barAngle).not.toBe(a.shape.barAngle);
    expect(c.beads.map((bd) => bd.a)).not.toEqual(a.beads.map((bd) => bd.a));
  });

  it("places every active course on an arm, exactly once, within the bead radius band", () => {
    every((layout, size) => {
      const { courses } = courseSet(size);
      const active = courses.filter((c) => !c.archived);
      expect(layout.beads).toHaveLength(active.length);
      expect(new Set(layout.beads.map((b) => b.courseId)).size).toBe(active.length);
      for (const bead of layout.beads) {
        const arm = layout.arms[bead.arm];
        expect(arm).toBeDefined();
        expect(bead.a).toBeGreaterThanOrEqual(LAYOUT.beadAMin - 1e-9);
        expect(bead.a).toBeLessThanOrEqual(LAYOUT.beadAMax + 1e-9);
        // The bead sits on the arm spine: same point as armPoint at its radius.
        const onArm = armPoint(layout.shape, arm, bead.a);
        expect(dist(onArm, bead.position)).toBeLessThan(1e-9);
        expect(Math.abs(armTheta(layout.shape, arm, bead.a) - bead.theta)).toBeLessThan(1e-9);
      }
    });
  });

  it("routes every subject to the arm its beads sit on and uses major arms first", () => {
    every((layout) => {
      for (const bead of layout.beads) expect(layout.arms[bead.arm].subjects).toContain(bead.subject);
      const used = new Set(layout.beads.map((b) => b.arm));
      if (used.size >= 2) {
        expect(used.has(0)).toBe(true);
        expect(used.has(1)).toBe(true);
      }
    });
  });

  it("never overlaps two beads (glow radii plus margin)", () => {
    every((layout) => {
      for (let i = 0; i < layout.beads.length; i++) {
        for (let j = i + 1; j < layout.beads.length; j++) {
          const a = layout.beads[i];
          const b = layout.beads[j];
          expect(dist(a.position, b.position)).toBeGreaterThanOrEqual(a.radius + b.radius + LAYOUT.beadMargin - 1e-9);
        }
      }
    });
  });

  it("marks exactly one current bead and makes it the focal region", () => {
    every((layout) => {
      const current = layout.beads.filter((b) => b.kind === "current");
      expect(current).toHaveLength(1);
      expect(current[0].courseId).toBe(CURRENT);
      expect(layout.current).toBe(current[0]);
      expect(layout.focal.courseId).toBe(current[0].courseId);
      expect(layout.focal.radius).toBeGreaterThan(current[0].radius * 2);
    });
  });

  it("gives archived courses a halo globular off the disc plane and friends a satellite beyond the rim", () => {
    every((layout, size) => {
      const { courses, friends } = courseSet(size);
      const archived = courses.filter((c) => c.archived);
      expect(layout.globulars).toHaveLength(archived.length);
      for (const g of layout.globulars) {
        const r = Math.hypot(...g.position);
        expect(r).toBeGreaterThanOrEqual(LAYOUT.globularRMin - 1e-9);
        expect(r).toBeLessThanOrEqual(LAYOUT.globularRMax + 1e-9);
        expect(Math.abs(g.position[1]) / r).toBeGreaterThanOrEqual(LAYOUT.globularMinElevation - 1e-9);
      }
      expect(layout.satellites).toHaveLength(Math.min(friends.length, LAYOUT.maxSatellites));
      for (const s of layout.satellites) {
        const r = Math.hypot(...s.position);
        expect(r).toBeGreaterThanOrEqual(LAYOUT.satelliteRMin - 1e-9);
        expect(r).toBeLessThanOrEqual(LAYOUT.satelliteRMax + 1e-9);
        expect(Math.abs(s.position[1]) / r).toBeGreaterThanOrEqual(LAYOUT.satelliteMinElevation - 1e-9);
      }
    });
  });

  it("keeps object slots within the budget, one black hole beside the weakest course, none inside a bead", () => {
    every((layout, size) => {
      expect(layout.slots.length).toBeLessThanOrEqual(slotCapFor(size));
      expect(layout.slots.length).toBe(layout.budget.slots);
      expect(layout.budget.slotCap).toBe(slotCapFor(size));
      const holes = layout.slots.filter((s) => s.type === "blackhole");
      expect(holes).toHaveLength(1);
      const weakest = layout.beads.reduce((w, b) => (b.warmth < w.warmth ? b : w), layout.beads[0]);
      expect(holes[0].anchorCourseId).toBe(weakest.courseId);
      for (const slot of layout.slots) {
        if (slot.type === "nebula") continue; // nebulae are HII pockets hugging their bead by design
        for (const bead of layout.beads) expect(dist(slot.position, bead.position)).toBeGreaterThan(bead.radius);
        expect(slot.sector).toBe(sectorOf(slot.position[0], slot.position[2]));
      }
      const types = new Set(layout.slots.map((s) => s.type));
      expect(types.has("nebula")).toBe(true);
      expect(types.has("comet")).toBe(true);
      // The full term shows one of every sibling object type (8 slots, 8 types).
      if (size === 12) expect(types.size).toBe(8);
    });
  });

  it("spreads slots: no sector holds more than half of them", () => {
    every((layout) => {
      const per = new Array<number>(LAYOUT.sectors).fill(0);
      for (const s of layout.slots) per[s.sector] += 1;
      expect(Math.max(...per)).toBeLessThanOrEqual(Math.max(2, Math.ceil(layout.slots.length / 2)));
    });
  });

  it("builds the deep field with unit directions and the two landmarks", () => {
    every((layout) => {
      expect(layout.deepField).toHaveLength(LAYOUT.deepFieldCount + LAYOUT.deepClusterCount + LAYOUT.deepQuintetCount);
      for (const s of layout.deepField) expect(Math.abs(Math.hypot(...s.dir) - 1)).toBeLessThan(1e-6);
      expect(layout.deepField.filter((s) => s.group === "cluster")).toHaveLength(LAYOUT.deepClusterCount);
      expect(layout.deepField.filter((s) => s.group === "quintet")).toHaveLength(LAYOUT.deepQuintetCount);
    });
  });

  it("keeps the shape in the Hurt-map band and arms trailing", () => {
    every((layout) => {
      expect(layout.shape.pitchDeg).toBeGreaterThanOrEqual(12);
      expect(layout.shape.pitchDeg).toBeLessThanOrEqual(18);
      expect(Math.sign(layout.shape.b)).toBe(-layout.shape.spinDir);
      expect(layout.arms).toHaveLength(5);
      expect(layout.arms.filter((a) => a.kind === "major")).toHaveLength(2);
      expect(layout.depths.map((d) => d.name)).toEqual(["near-sparkle", "disc", "halo", "deep-field"]);
    });
  });

  it("handles the full term with every friend", () => {
    const layout = generateGalaxyLayout({ courses: TERM, currentCourseId: CURRENT, friends: FRIENDS, seed: 99 });
    expect(layout.beads).toHaveLength(9);
    expect(layout.globulars).toHaveLength(3);
    expect(layout.satellites).toHaveLength(3);
    expect(layout.slots.length).toBeLessThanOrEqual(8);
  });

  it("takes the product course shape: names from code + title, subject from the code prefix, current by id or recency", () => {
    expect(subjectFromCode("8.223")).toBe("8");
    expect(subjectFromCode("21G.401")).toBe("21G");
    expect(subjectFromCode("CS101")).toBe("CS");
    expect(subjectFromCode("MATH 51")).toBe("MATH");
    expect(subjectFromCode("")).toBe("general");
    const real: GalaxyCourse[] = [
      { id: "u1", code: "8.223", title: "Classical Mechanics II", conceptCount: 64, mastery: 0.62, hasWorld: true, archived: false, lastOpenedAt: "2026-10-09T10:00:00Z" },
      { id: "u2", code: "8.044", title: "8.044 Statistical Physics I", conceptCount: 40, mastery: 1.4, hasWorld: false, archived: false, lastOpenedAt: Date.UTC(2026, 9, 11) },
      { id: "u3", code: "18.06", title: "Linear Algebra", subject: "math", conceptCount: Number.NaN, mastery: -0.2, hasWorld: false, archived: false, lastOpenedAt: null },
      { id: "u4", code: "7.012", title: "Introductory Biology", conceptCount: 58, mastery: 0.9, hasWorld: false, archived: true, lastOpenedAt: "2026-10-12T10:00:00Z" },
    ];
    const norm = normaliseCourses(real, "u3");
    expect(norm.map((c) => c.name)).toEqual(["8.223 Classical Mechanics II", "8.044 Statistical Physics I", "18.06 Linear Algebra", "7.012 Introductory Biology"]);
    expect(norm.map((c) => c.subject)).toEqual(["8", "8", "math", "7"]);
    expect(norm[1].mastery).toBe(1);
    expect(norm[2].mastery).toBe(0);
    expect(norm[2].concepts).toBe(0);
    expect(norm.map((c) => c.current)).toEqual([false, false, true, false]);
    // No id (or an archived / unknown one): the most recently opened ACTIVE course is current (u2, epoch ms beats u1's ISO; u4 is archived).
    for (const id of [null, undefined, "u4", "nope"]) expect(normaliseCourses(real, id).find((c) => c.current)?.id).toBe("u2");
    // The two physics courses share one arm; the layout carries the ids through.
    const layout = generateGalaxyLayout({ courses: real, currentCourseId: "u3", seed: 5 });
    expect(layout.beads.map((b) => b.courseId).sort()).toEqual(["u1", "u2", "u3"]);
    expect(layout.current?.courseId).toBe("u3");
    const physics = layout.beads.filter((b) => b.subject === "8");
    expect(new Set(physics.map((b) => b.arm)).size).toBe(1);
    expect(layout.globulars.map((g) => g.courseId)).toEqual(["u4"]);
    expect(layout.budget).toMatchObject({ courses: 4, beads: 3, globulars: 1, satellites: 0 });
  });

  it("places beads on the polished galaxy's crowding ridges with armsFromSpec (barred and unbarred, every arm count)", () => {
    const specs = Array.from({ length: 24 }, (_, i) => generateGalaxySpec(seedFromText(`galaxy-${i}`)));
    expect(specs.some((s) => s.bar)).toBe(true);
    expect(new Set(specs.map((s) => s.arms)).size).toBe(3);
    const { courses, friends } = courseSet(12);
    for (const spec of specs) {
      const geometry = armsFromSpec(spec);
      expect(geometry.arms).toHaveLength(spec.arms);
      expect(geometry.shape.spinDir).toBe(spec.spinDir);
      expect(Math.sign(geometry.shape.b)).toBe(-spec.spinDir);
      // armTheta reproduces armRidgeAngle for every arm along its whole length (bar twist included).
      for (const arm of geometry.arms) {
        for (let a = arm.aStart; a <= 1.0001; a += 0.02) {
          expect(Math.abs(armTheta(geometry.shape, arm, a) - armRidgeAngle(spec, a, arm.index))).toBeLessThan(1e-9);
        }
      }
      const layout = generateGalaxyLayout({ courses, currentCourseId: CURRENT, friends, seed: spec.seed, geometry });
      expect(layout.beads).toHaveLength(9);
      expect(layout.arms).toHaveLength(spec.arms);
      for (const bead of layout.beads) {
        expect(bead.arm).toBeLessThan(spec.arms);
        // On the ridge, in the disc plane (no warp), inside the bead band.
        const ridge = armRidgeAngle(spec, bead.a, bead.arm);
        const psi = Math.atan2(bead.position[2], bead.position[0]);
        expect(Math.abs(Math.atan2(Math.sin(psi - ridge), Math.cos(psi - ridge)))).toBeLessThan(1e-9);
        expect(bead.position[1]).toBe(0);
        expect(Math.hypot(bead.position[0], bead.position[2])).toBeCloseTo(bead.a, 9);
        if (spec.bar) expect(bead.a).toBeGreaterThan(spec.barLength);
      }
      for (let i = 0; i < layout.beads.length; i++) {
        for (let j = i + 1; j < layout.beads.length; j++) {
          const p = layout.beads[i];
          const q = layout.beads[j];
          expect(dist(p.position, q.position)).toBeGreaterThanOrEqual(p.radius + q.radius + LAYOUT.beadMargin - 1e-9);
        }
      }
      expect(layout.slots.filter((s) => s.type === "blackhole")).toHaveLength(1);
    }
  });
});
