import { describe, expect, it } from "vitest";
import { seedFromText } from "@/lib/stage/rng";
import { ALL_FEATURES, buildGalaxyBuffers, DRAW_CALL_BUDGET, NO_FEATURES, POINT_BUDGET } from "@/lib/galaxy/points";
import { generateGalaxySpec } from "@/lib/galaxy/spec";
import { armsFromSpec, generateGalaxyLayout, type GalaxyCourse } from "@/lib/galaxy/layout";
import { COURSE_PALETTES } from "@/lib/galaxy/palettes";
import { GLSL_LIGHT } from "@/lib/light";
import { BEAD_FRAG, BEAD_VERT } from "./bead-shaders";
import { FAR_FRAG, GALAXY_VERT, GLOW_FRAG, GLOW_VERT, POINT_FRAG } from "./galaxy-shaders";
import { BEAD_MODE, beadInstanceCount, beadInstances, GALAXY_HERO_SIZE, galaxyDistance, galaxyLayerBudget, galaxyLayerVisible, galaxySizeAt, HERO_CAMERA_DISTANCE } from "./galaxy-layer-model";

const SIX: readonly GalaxyCourse[] = [
  { id: "8.223", code: "8.223", title: "Classical Mechanics II", conceptCount: 64, mastery: 0.62, hasWorld: true, archived: false, lastOpenedAt: "2026-10-11T00:00:00Z" },
  { id: "18.06", code: "18.06", title: "Linear Algebra", conceptCount: 52, mastery: 0.78, hasWorld: true, archived: false, lastOpenedAt: "2026-10-09T00:00:00Z" },
  { id: "21G.401", code: "21G.401", title: "Korean I", conceptCount: 90, mastery: 0.41, hasWorld: false, archived: false, lastOpenedAt: "2026-10-10T00:00:00Z" },
  { id: "6.1010", code: "6.1010", title: "Fundamentals of Programming", conceptCount: 48, mastery: 0.86, hasWorld: true, archived: false, lastOpenedAt: "2026-10-08T00:00:00Z" },
  { id: "8.044", code: "8.044", title: "Statistical Physics I", conceptCount: 40, mastery: 0.33, hasWorld: false, archived: false, lastOpenedAt: "2026-10-07T00:00:00Z" },
  { id: "7.012", code: "7.012", title: "Introductory Biology", conceptCount: 58, mastery: 0.9, hasWorld: false, archived: true, lastOpenedAt: "2026-10-02T00:00:00Z" },
];

describe("GalaxyLayer framing", () => {
  it("defaults to the lab hero framing: 0.83 of the viewport height is the camera 3.3 disc radii away", () => {
    expect(GALAXY_HERO_SIZE).toBeCloseTo(0.832, 2);
    expect(galaxyDistance(GALAXY_HERO_SIZE)).toBeCloseTo(HERO_CAMERA_DISTANCE, 9);
    expect(galaxySizeAt(galaxyDistance(0.4))).toBeCloseTo(0.4, 9);
    // Smaller on screen = farther away; a wider fov needs a nearer camera for the same size.
    expect(galaxyDistance(0.2)).toBeGreaterThan(galaxyDistance(0.8));
    expect(galaxyDistance(0.5, 60)).toBeLessThan(galaxyDistance(0.5, 40));
  });

  it("renders nothing at fade 0 and below, something above", () => {
    expect(galaxyLayerVisible(0)).toBe(false);
    expect(galaxyLayerVisible(-1)).toBe(false);
    expect(galaxyLayerVisible(Number.NaN)).toBe(false);
    expect(galaxyLayerVisible(0.001)).toBe(false);
    expect(galaxyLayerVisible(0.5)).toBe(true);
    expect(galaxyLayerVisible(1)).toBe(true);
  });
});

describe("GalaxyLayer budget", () => {
  it("stays within 10 draws (8 galaxy + anchors + blobs) and 9000 points for every seed with six courses, all features on", () => {
    for (let i = 0; i < 48; i++) {
      const seed = seedFromText(`galaxy-${i}`);
      const spec = generateGalaxySpec(seed);
      const layout = generateGalaxyLayout({ courses: SIX, currentCourseId: "8.223", seed, geometry: armsFromSpec(spec) });
      const budget = galaxyLayerBudget(ALL_FEATURES, buildGalaxyBuffers(spec), layout);
      expect(budget.drawCalls).toBeLessThanOrEqual(10);
      expect(budget.blobDraws).toBe(1);
      expect(budget.drawCalls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
      expect(budget.points).toBeLessThanOrEqual(9000);
      expect(budget.pointBudget).toBe(POINT_BUDGET);
      expect(budget.beadInstances).toBe(beadInstanceCount(layout));
      expect(budget.beadInstances).toBe(5 * 2 + 1 + 1 * 2);
    }
    const spec = generateGalaxySpec(seedFromText("whirlpool"));
    const layout = generateGalaxyLayout({ courses: SIX, currentCourseId: "8.223", seed: spec.seed, geometry: armsFromSpec(spec) });
    expect(galaxyLayerBudget(NO_FEATURES, buildGalaxyBuffers(spec), layout).drawCalls).toBe(6);
    expect(galaxyLayerBudget(ALL_FEATURES, buildGalaxyBuffers(spec), { ...layout, beads: [], current: null, globulars: [] }).drawCalls).toBe(8);
  });
});

describe("course bead instances", () => {
  const spec = generateGalaxySpec(seedFromText("whirlpool"));
  const layout = generateGalaxyLayout({ courses: SIX, currentCourseId: "18.06", seed: spec.seed, geometry: armsFromSpec(spec) });

  it("builds a glow and a core per active course, the ring on the current one and a globular per archived course", () => {
    for (const theme of ["dark", "light"] as const) {
      const list = beadInstances(layout, COURSE_PALETTES[theme]);
      expect(list).toHaveLength(beadInstanceCount(layout));
      const glows = list.filter((q) => q.mode === BEAD_MODE.glow);
      expect(glows.map((q) => q.courseId)).toEqual(layout.beads.map((b) => b.courseId));
      // Glows come first so a click on the biggest quad reads the course.
      expect(list.slice(0, glows.length).every((q) => q.mode === BEAD_MODE.glow)).toBe(true);
      const rings = list.filter((q) => q.mode === BEAD_MODE.ring);
      expect(rings).toHaveLength(1);
      expect(rings[0].courseId).toBe("18.06");
      expect(rings[0].color).toBe(COURSE_PALETTES[theme].youAreHere);
      expect(rings[0].size).toBeGreaterThan(layout.current!.radius);
      const planets = list.filter((q) => q.mode === BEAD_MODE.planet).map((q) => q.courseId).sort();
      expect(planets).toEqual(layout.beads.filter((b) => b.hasWorld).map((b) => b.courseId).sort());
      const globs = list.filter((q) => q.mode === BEAD_MODE.globular);
      expect(globs.map((q) => q.courseId)).toEqual(["7.012"]);
      for (const q of list) {
        expect(q.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(q.alpha).toBeGreaterThan(0);
        expect(q.alpha).toBeLessThanOrEqual(1);
        expect(q.size).toBeGreaterThan(0);
      }
      // Warmer mastery, warmer glow (the red channel of the mix rises with mastery).
      const warm = glows.find((q) => q.courseId === "6.1010")!;
      const cool = glows.find((q) => q.courseId === "8.044")!;
      expect(parseInt(warm.color.slice(1, 3), 16)).toBeGreaterThan(parseInt(cool.color.slice(1, 3), 16));
    }
  });

  it("sits every bead on the galaxy's own arms, in the pattern frame", () => {
    for (const b of layout.beads) expect(b.arm).toBeLessThan(spec.arms);
    expect(layout.arms).toHaveLength(spec.arms);
    expect(layout.shape.spinDir).toBe(spec.spinDir);
  });
});

describe("shader contracts", () => {
  it("fades through uniforms (never a rebuild) and takes the light chunk from lib/light", () => {
    for (const frag of [GLOW_FRAG, FAR_FRAG, BEAD_FRAG]) expect(frag).toContain("uniform float uFade;");
    for (const frag of [GLOW_FRAG, FAR_FRAG, BEAD_FRAG, POINT_FRAG]) expect(frag).toContain("ditherQuantize(");
    // Points carry the fade from the vertex stage (vAlpha = uFade * ...).
    expect(GALAXY_VERT).toContain("uniform float uFade;");
    expect(GLOW_VERT).toContain("uniform float uMotion;");
    expect(GLOW_FRAG).toContain("g.a * uFade");
    expect(FAR_FRAG).toContain("g.a * uFade");
    // The four-argument quantiser from lib/light, included once per shader.
    for (const src of [GLOW_FRAG, FAR_FRAG, BEAD_FRAG, POINT_FRAG]) {
      expect(src.split("float ditherQuantize(float v, float steps, vec2 cell, float mode)").length).toBe(2);
      expect(src).toContain(GLSL_LIGHT);
    }
    // Beads snap their size to cells through uRes and never use a bloom pass.
    expect(BEAD_VERT).toContain("uniform vec2 uRes;");
    expect(BEAD_FRAG).not.toMatch(/bloom/i);
  });
});
