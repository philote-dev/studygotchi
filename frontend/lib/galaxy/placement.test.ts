import { describe, expect, it } from "vitest";
import { armsFromSpec, generateGalaxyLayout, LAYOUT, type GalaxyCourse } from "./layout";
import { generateGalaxySpec } from "./spec";
import { blobOverlaps, DEFAULT_BLOB_PLACEMENT, HALO, haloClear, placeBlobs } from "./placement";

const course = (id: string, conceptCount: number, extra: Partial<GalaxyCourse> = {}): GalaxyCourse => ({ id, code: id, title: id, conceptCount, mastery: 0.5, hasWorld: false, archived: false, lastOpenedAt: 0, ...extra });
const COURSES: readonly GalaxyCourse[] = [
  course("8.223", 64, { hasWorld: true, lastOpenedAt: 3 }),
  course("18.06", 52, { hasWorld: true }),
  course("21G.401", 90),
  course("6.1010", 48),
  course("8.044", 40),
  course("6.1210", 70),
  course("18.100A", 30),
  course("21W.021", 18),
  course("7.012", 58),
  course("14.01", 44),
  course("5.111", 66),
  course("24.00", 22),
];

describe("placeBlobs (arms | halo | mixed)", () => {
  const seeds = [1, 42, 0x5eed, 12345];
  const layoutFor = (seed: number, n: number) => {
    const spec = generateGalaxySpec(seed);
    return generateGalaxyLayout({ courses: COURSES.slice(0, n), currentCourseId: "8.223", seed, geometry: armsFromSpec(spec) });
  };

  it("mixed is the product default; arms returns the generator's layout untouched", () => {
    expect(DEFAULT_BLOB_PLACEMENT).toBe("mixed");
    const layout = layoutFor(1, 8);
    expect(placeBlobs(layout, "arms", 1, 1.4)).toBe(layout);
  });

  it("halo: every course leaves the plane (|y| >= 0.1), none sits under the bulge, no two blobs overlap, deterministic per seed", () => {
    for (const seed of seeds) {
      for (const n of [8, 12] as const) {
        const layout = layoutFor(seed, n);
        const halo = placeBlobs(layout, "halo", seed, 1.4);
        expect(halo.beads).toHaveLength(layout.beads.length);
        for (const b of halo.beads) {
          expect(Math.abs(b.position[1])).toBeGreaterThanOrEqual(HALO.yMin - 1e-9);
          expect(Math.hypot(b.position[0], b.position[2])).toBeGreaterThanOrEqual(layout.shape.bulgeSigma * HALO.bulgeClear + b.radius * 1.4 - 1e-9);
        }
        expect(blobOverlaps(halo, 1.4)).toEqual([]);
        expect(halo.current?.courseId).toBe("8.223");
        expect(halo.focal.courseId).toBe("8.223");
        const again = placeBlobs(layout, "halo", seed, 1.4);
        expect(again.beads.map((b) => b.position)).toEqual(halo.beads.map((b) => b.position));
      }
    }
  });

  it("halo: sides alternate so the two hemispheres are balanced", () => {
    const halo = placeBlobs(layoutFor(42, 12), "halo", 42, 1.4);
    const up = halo.beads.filter((b) => b.position[1] > 0).length;
    expect(Math.abs(up - (halo.beads.length - up))).toBeLessThanOrEqual(1);
  });

  it("mixed: the current course and the courses with a world keep their arm (the hand-off anchor does not move); the others float near their home arm and overlap nothing", () => {
    for (const seed of seeds) {
      const layout = layoutFor(seed, 12);
      const mixed = placeBlobs(layout, "mixed", seed, 1.4);
      const anchored = new Set<string>();
      for (const b of mixed.beads) {
        const was = layout.beads.find((o) => o.courseId === b.courseId)!;
        if (was.kind === "current" || was.hasWorld) {
          expect(b.position).toEqual(was.position);
          anchored.add(b.courseId);
        } else {
          expect(Math.abs(b.position[1])).toBeGreaterThanOrEqual(HALO.yMin - 1e-9);
          expect(Math.abs(b.a - was.a)).toBeLessThanOrEqual(HALO.mixedAlong + 1e-9 + Math.max(0, HALO.aMin - was.a) + Math.max(0, was.a - HALO.aMax));
          expect(b.arm).toBe(was.arm);
        }
      }
      expect(mixed.current!.position).toEqual(layout.current!.position);
      expect(mixed.focal.position).toEqual(layout.focal.position);
      const floatingOverlaps = blobOverlaps(mixed, 1.4).filter(([p, q]) => !(anchored.has(p) && anchored.has(q)));
      expect(floatingOverlaps).toEqual([]);
    }
  });

  it("haloClear honours the blob radii plus the bead margin and the bulge clearance", () => {
    const placed = [{ position: [0.5, 0.2, 0] as const, radius: 0.1 }];
    expect(haloClear([0.5, 0.2, 0.2 + LAYOUT.beadMargin + 0.001], 0.1, placed, 0.1)).toBe(true);
    expect(haloClear([0.5, 0.2, 0.2 + LAYOUT.beadMargin - 0.001], 0.1, placed, 0.1)).toBe(false);
    expect(haloClear([0.1, 0.3, 0], 0.05, [], 0.12)).toBe(false);
  });
});
