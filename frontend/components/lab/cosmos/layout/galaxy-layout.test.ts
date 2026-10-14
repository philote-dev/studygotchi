import { describe, expect, it } from "vitest";
import { courseSet, FAKE_COURSES, FAKE_FRIENDS } from "./fake-courses";
import { armPoint, armTheta, generateGalaxyLayout, LAYOUT, sectorOf, slotCapFor, type GalaxyLayout, type Vec3 } from "./galaxy-layout";

const SEEDS = [1, 7, 42, 1234, 0x9e3779b9, 20261011];
const SIZES = [3, 6, 12] as const;

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function every(fn: (layout: GalaxyLayout, size: (typeof SIZES)[number], seed: number) => void) {
  for (const size of SIZES) {
    const { courses, friends } = courseSet(size);
    for (const seed of SEEDS) fn(generateGalaxyLayout({ courses, friends, seed }), size, seed);
  }
}

describe("generateGalaxyLayout", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const { courses, friends } = courseSet(12);
    const a = generateGalaxyLayout({ courses, friends, seed: 42 });
    const b = generateGalaxyLayout({ courses, friends, seed: 42 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const c = generateGalaxyLayout({ courses, friends, seed: 43 });
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
    const layout = generateGalaxyLayout({ courses: FAKE_COURSES, friends: FAKE_FRIENDS, seed: 99 });
    expect(layout.beads).toHaveLength(9);
    expect(layout.globulars).toHaveLength(3);
    expect(layout.satellites).toHaveLength(3);
    expect(layout.slots.length).toBeLessThanOrEqual(8);
  });
});
