import { describe, expect, it } from "vitest";
import { armsFromSpec, generateGalaxyLayout, type GalaxyCourse } from "@/lib/galaxy/layout";
import { generateGalaxySpec } from "@/lib/galaxy/spec";
import { discToScreen, GALAXY_SCENERY_LIMITS, galaxyCameraDistance, placeGalaxyScenery, sweepClearance, type GalaxyView } from "./galaxy-scenery";
import { BACKDROP_SAFE_AREAS, boxesOverlap } from "./placement";
import { discBox } from "./planet-scenery";
import { seedFromText } from "./rng";

/** The sandbox roster as the galaxy sees it (seven courses, four subjects, one current). */
const SANDBOX: readonly GalaxyCourse[] = [
  { id: "c-8223", code: "8.223", title: "Classical Mechanics II", conceptCount: 64, mastery: 0.3, hasWorld: true, archived: false, lastOpenedAt: 300 },
  { id: "c-61400", code: "6.1400", title: "Computability and Complexity Theory", conceptCount: 50, mastery: 0.8, hasWorld: true, archived: false, lastOpenedAt: 200 },
  { id: "c-61210", code: "6.1210", title: "Introduction to Algorithms", conceptCount: 120, mastery: 0.1, hasWorld: true, archived: false, lastOpenedAt: null },
  { id: "c-1806", code: "18.06", title: "Linear Algebra", conceptCount: 70, mastery: 1, hasWorld: true, archived: false, lastOpenedAt: null },
  { id: "c-1803", code: "18.03", title: "Differential Equations", conceptCount: 1, mastery: 0, hasWorld: false, archived: false, lastOpenedAt: null },
  { id: "c-8022", code: "8.022", title: "Physics II", conceptCount: 1, mastery: 0, hasWorld: false, archived: false, lastOpenedAt: null },
  { id: "c-16c20", code: "16.C20", title: "Numerical Methods", conceptCount: 1, mastery: 0, hasWorld: false, archived: false, lastOpenedAt: null },
];

/** The layer's hero framing at 1440 x 900 (fov 40, 0.83 of the height). */
function heroView(seed: number, aspect = 1.6): GalaxyView {
  const spec = generateGalaxySpec(seed);
  return { aspect, fovDeg: 40, size: 0.832, roll: spec.roll, inclination: spec.inclination };
}

function sceneryFor(seedText: string, aspect = 1.6) {
  const seed = seedFromText(seedText);
  const spec = generateGalaxySpec(seed);
  const layout = generateGalaxyLayout({ courses: SANDBOX, currentCourseId: "c-8223", seed, geometry: armsFromSpec(spec) });
  const view = heroView(seed, aspect);
  return { seed, layout, view, scenery: placeGalaxyScenery({ seed, layout, view }) };
}

describe("discToScreen", () => {
  it("puts the disc centre on the camera axis and scales a disc radius to half the hero size", () => {
    const view: GalaxyView = { aspect: 1.6, fovDeg: 40, size: 0.832, roll: 0, inclination: Math.PI / 2 };
    const c = discToScreen(view, [0, 0, 0]);
    expect(c.u).toBeCloseTo(0.5, 9);
    expect(c.v).toBeCloseTo(0.5, 9);
    expect(c.depth).toBeCloseTo(galaxyCameraDistance(view), 9);
    // Face-on (inclination pi/2 leaves the disc in XZ, seen along Z after the tilt): +x is right, half the size per radius.
    const px = discToScreen(view, [1, 0, 0]);
    expect(px.u).toBeCloseTo(0.5 + 0.416 / 1.6, 3);
    expect(px.v).toBeCloseTo(0.5, 9);
    // Tilted: the z axis foreshortens and the near half comes closer to the camera.
    const tilted: GalaxyView = { ...view, inclination: 0.6 };
    const pz = discToScreen(tilted, [0, 0, 1]);
    expect(Math.abs(pz.v - 0.5)).toBeLessThan(0.416);
    expect(Math.abs(pz.v - 0.5)).toBeGreaterThan(0.2);
    expect(pz.depth).not.toBeCloseTo(c.depth, 2);
    // A pattern turn of 2 pi is the identity.
    const turned = discToScreen(tilted, [0.5, 0, 0.3], Math.PI * 2);
    const still = discToScreen(tilted, [0.5, 0, 0.3], 0);
    expect(turned.u).toBeCloseTo(still.u, 9);
    expect(turned.v).toBeCloseTo(still.v, 9);
  });

  it("sweepClearance is negative near the rim (under the header / left column) and positive mid-disc", () => {
    const view = heroView(seedFromText("whirlpool"));
    expect(sweepClearance(view, [0.5, 0, 0], 0.04)).toBeGreaterThan(0);
    expect(sweepClearance(view, [0.95, 0, 0], 0.06)).toBeLessThan(0);
  });
});

describe("placeGalaxyScenery", () => {
  it("is deterministic for a seed, layout and view", () => {
    const a = sceneryFor("sandbox");
    const b = sceneryFor("sandbox");
    expect(a.scenery).toEqual(b.scenery);
    expect(sceneryFor("other").scenery.objects.map((o) => o.id + o.position.join(","))).not.toEqual(a.scenery.objects.map((o) => o.id + o.position.join(",")));
  });

  it("places 3 to 5 sky kinds between the beads, clear of beads, each other, the bulge and the chrome over a full turn, for many seeds", () => {
    const L = GALAXY_SCENERY_LIMITS;
    let slotFilled = 0;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const { layout, view, scenery } = sceneryFor(`student-${i}`);
      expect(scenery.rung).toBe("galaxy");
      expect(scenery.objects.length).toBeGreaterThanOrEqual(L.minObjects);
      expect(scenery.objects.length).toBeLessThanOrEqual(L.maxObjects);
      const ids = new Set(scenery.objects.map((o) => o.id));
      expect(ids.size).toBe(scenery.objects.length);
      for (const o of scenery.objects) {
        expect(["nebula", "cluster", "planetary", "smudges"]).toContain(o.kind);
        expect(o.position[1]).toBe(0);
        const a = Math.hypot(o.position[0], o.position[2]);
        expect(a + o.radius).toBeLessThanOrEqual(L.aMax + 1e-9);
        expect(a - o.radius).toBeGreaterThanOrEqual(Math.max(L.bulgeMinA, layout.shape.bulgeSigma * L.bulgeSigmas) - 1e-9);
        for (const b of layout.beads) {
          const reach = b.kind === "current" ? b.radius * 1.3 : b.radius;
          expect(Math.hypot(o.position[0] - b.position[0], o.position[2] - b.position[2])).toBeGreaterThanOrEqual(reach + o.radius + L.beadClearance - 1e-9);
        }
        for (const p of scenery.objects) {
          if (p === o) continue;
          expect(Math.hypot(o.position[0] - p.position[0], o.position[2] - p.position[2])).toBeGreaterThanOrEqual(p.radius + o.radius + L.beadClearance - 1e-9);
        }
        expect(o.clearance).toBeGreaterThanOrEqual(0);
        // Independently: at 36 pattern angles the screen disc never touches a safe area.
        for (let k = 0; k < 36; k++) {
          const s = discToScreen(view, o.position, (k / 36) * Math.PI * 2);
          const box = discBox(s.u, s.v, o.radius * s.perUnit, view.aspect);
          for (const area of BACKDROP_SAFE_AREAS) expect(boxesOverlap(box, area)).toBe(false);
        }
        if (o.slot !== "gap") slotFilled++;
        total++;
      }
    }
    // The layout's own slots do most of the work; gaps only top up.
    expect(slotFilled / total).toBeGreaterThan(0.3);
  });

  it("honours extra keep-out boxes and a different aspect", () => {
    const { layout, view } = sceneryFor("sandbox", 1.33);
    const seed = seedFromText("sandbox");
    const wide = placeGalaxyScenery({ seed, layout, view });
    expect(wide.objects.length).toBeGreaterThanOrEqual(3);
    // A keep-out covering the whole right half leaves far fewer clean sweeps.
    const blocked = placeGalaxyScenery({ seed, layout, view, keepOut: [{ x0: 0.5, y0: 0, x1: 1, y1: 1 }] });
    expect(blocked.objects.length).toBeLessThan(wide.objects.length + 1);
    expect(blocked.rejected.some((r) => r.reason === "chrome")).toBe(true);
  });
});
