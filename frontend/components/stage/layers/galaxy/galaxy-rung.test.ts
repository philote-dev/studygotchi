import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { armsFromSpec, generateGalaxyLayout, type GalaxyCourse } from "@/lib/galaxy/layout";
import { generateGalaxySpec } from "@/lib/galaxy/spec";
import { COURSE_PALETTES } from "@/lib/galaxy/palettes";
import { RUNG_L } from "@/lib/stage/rungs";
import { placeGalaxyScenery } from "@/lib/stage/galaxy-scenery";
import { seedFromText } from "@/lib/stage/rng";
import { BEAD_FRAG, BEAD_VERT } from "./bead-shaders";
import { GalaxyFader } from "./galaxy-fade";
import { beadInstances, courseIndexOf } from "./galaxy-layer-model";
import { BEAD_ANCHOR, beadGrowAt, galaxyLayerBudget, ringScaleFor } from "./galaxy-layer-model";
import { GALAXY_HIDE_BELOW, GALAXY_INTERACTIVE_ABOVE, galaxyBeadsFade, galaxyRungFade, galaxyRungInteractive, planetPassFadeAt, shownFlags, stageRungFromSearch, stickyFlagNext } from "./galaxy-rung-model";
import { createGalaxyRungController } from "./galaxy-rung-controller";
import { ALL_FEATURES, buildGalaxyBuffers } from "@/lib/galaxy/points";
import { BLOB_BLOOM, galaxyHandoffAt } from "@/lib/stage/hop";
import { buildGalaxyScenery, GALAXY_SCENERY_DRAW_CALLS, SCENERY_BUILD_BAND, SCENERY_BUILD_DISTANCE, sceneryGroupTransform, sceneryToPlacedObjects } from "./galaxy-scenery-build";

const COURSES: readonly GalaxyCourse[] = [
  { id: "a", code: "8.223", title: "Classical Mechanics II", conceptCount: 64, mastery: 0.3, hasWorld: true, archived: false, lastOpenedAt: 3 },
  { id: "b", code: "6.1400", title: "Computability", conceptCount: 50, mastery: 0.8, hasWorld: true, archived: false, lastOpenedAt: 2 },
  { id: "c", code: "18.06", title: "Linear Algebra", conceptCount: 70, mastery: 1, hasWorld: false, archived: false, lastOpenedAt: 1 },
  { id: "d", code: "7.012", title: "Biology", conceptCount: 20, mastery: 0.5, hasWorld: false, archived: true, lastOpenedAt: null },
];

describe("galaxy rung fade bands", () => {
  it("is invisible on the planet and the constellation, rises past L ~2.4, full at the galaxy stop", () => {
    expect(galaxyRungFade(RUNG_L.world)).toBe(0);
    expect(galaxyRungFade(RUNG_L.planet)).toBe(0);
    expect(galaxyRungFade(RUNG_L.constellation)).toBe(0);
    expect(galaxyRungFade(2.3)).toBe(0);
    expect(galaxyRungFade(2.4)).toBeGreaterThan(0);
    expect(galaxyRungFade(2.4)).toBeLessThan(0.2);
    expect(galaxyRungFade(2.6)).toBeGreaterThan(galaxyRungFade(2.4));
    expect(galaxyRungFade(2.8)).toBe(1);
    expect(galaxyRungFade(RUNG_L.galaxy)).toBe(1);
    expect(galaxyRungFade(3.1)).toBe(1);
    expect(galaxyBeadsFade(2.7)).toBe(1);
    expect(galaxyBeadsFade(2.2)).toBe(0);
    // Monotone.
    let prev = 0;
    for (let L = 2; L <= 3; L += 0.01) {
      const f = galaxyRungFade(L);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it("takes input only at the galaxy stop once faded in", () => {
    expect(galaxyRungInteractive({ L: 3, rung: "galaxy" })).toBe(true);
    expect(galaxyRungInteractive({ L: 2.9, rung: "galaxy" })).toBe(true);
    expect(galaxyRungInteractive({ L: 2.45, rung: "constellation" })).toBe(false);
    expect(galaxyRungInteractive({ L: 1, rung: "planet" })).toBe(false);
    expect(GALAXY_HIDE_BELOW).toBeLessThan(GALAXY_INTERACTIVE_ABOVE);
    expect(galaxyRungFade(2.5)).toBeLessThan(GALAXY_INTERACTIVE_ABOVE);
  });

  it("leaves the planet pass alone up to the constellation and removes it where the galaxy is full", () => {
    expect(planetPassFadeAt(0)).toBe(1);
    expect(planetPassFadeAt(1)).toBe(1);
    expect(planetPassFadeAt(2)).toBe(1);
    expect(planetPassFadeAt(2.3)).toBe(1);
    expect(planetPassFadeAt(2.55)).toBeGreaterThan(0);
    expect(planetPassFadeAt(2.55)).toBeLessThan(1);
    expect(planetPassFadeAt(2.8)).toBe(0);
    expect(planetPassFadeAt(3)).toBe(0);
    for (let L = 0; L <= 3; L += 0.05) expect(planetPassFadeAt(L) + galaxyRungFade(L)).toBeCloseTo(1, 9);
  });

  it("reads ?rung= for the dev teleport", () => {
    expect(stageRungFromSearch("?stage=galaxy,planet&rung=galaxy")).toBe("galaxy");
    expect(stageRungFromSearch("rung=Planet")).toBe("planet");
    expect(stageRungFromSearch("?rung=moon")).toBeNull();
    expect(stageRungFromSearch("?stage=galaxy")).toBeNull();
    expect(stageRungFromSearch(null)).toBeNull();
  });
});

describe("the sticky flag at the rung (gate 3, 2026-10-13)", () => {
  it("rests on the current course until a blob is hovered, then stays on the blob most recently hovered", () => {
    // Nothing hovered yet: the current course's flag (none with `currentFlag` off, or when the rung is inert).
    expect(shownFlags({ active: true, currentFlag: true, currentCourseId: "a", sticky: null, pinned: null })).toEqual(["a"]);
    expect(shownFlags({ active: true, currentFlag: false, currentCourseId: "a", sticky: null, pinned: null })).toEqual([]);
    expect(shownFlags({ active: false, currentFlag: true, currentCourseId: "a", sticky: "b", pinned: null })).toEqual([]);
    // Hover b: the sticky memory moves to b and the flag follows; the pointer leaving keeps it on b.
    let sticky: string | null = null;
    sticky = stickyFlagNext({ active: true, sticky, hoveredId: "b" });
    expect(sticky).toBe("b");
    sticky = stickyFlagNext({ active: true, sticky, hoveredId: null });
    expect(sticky).toBe("b");
    expect(shownFlags({ active: true, currentFlag: true, currentCourseId: "a", sticky, pinned: null })).toEqual(["b"]);
    // Hover c: it moves again; hovering the current course puts it back on the current one.
    sticky = stickyFlagNext({ active: true, sticky, hoveredId: "c" });
    expect(sticky).toBe("c");
    sticky = stickyFlagNext({ active: true, sticky, hoveredId: "a" });
    expect(shownFlags({ active: true, currentFlag: true, currentCourseId: "a", sticky, pinned: null })).toEqual(["a"]);
    // Leaving the rung resets the memory: a return shows the current course again.
    sticky = stickyFlagNext({ active: false, sticky: "c", hoveredId: null });
    expect(sticky).toBeNull();
    expect(shownFlags({ active: true, currentFlag: true, currentCourseId: "a", sticky, pinned: null })).toEqual(["a"]);
    // One flag at a time; a pinned card (the pointer on it) only adds its course for the instant it differs.
    expect(shownFlags({ active: true, currentFlag: true, currentCourseId: "a", sticky: "b", pinned: "b" })).toEqual(["b"]);
    expect(shownFlags({ active: true, currentFlag: true, currentCourseId: "a", sticky: "b", pinned: "c" })).toEqual(["b", "c"]);
  });

  it("the controller remembers the sticky course and drops it with hover and pin when the rung goes inert", () => {
    const c = createGalaxyRungController();
    c.setActive(true);
    c.setSticky("b");
    expect(c.sticky).toBe("b");
    c.setActive(false);
    expect(c.sticky).toBeNull();
  });

  it("the controller notifies on hover, rest, pin and course changes, and drops hover + pin when the rung goes inert", () => {
    const c = createGalaxyRungController();
    let n = 0;
    c.subscribe(() => n++);
    c.setActive(true);
    c.setResting(true);
    c.setHover({ courseId: "a", code: "8.223", title: "Mechanics" });
    c.setHover({ courseId: "a", code: "8.223", title: "Mechanics" });
    c.setPinned("a");
    c.setCourses([{ id: "a", code: "8.223", title: "Mechanics", concepts: 64, mastery: 0.5 }], "a", true);
    expect(n).toBe(5);
    expect(c.version()).toBe(5);
    expect(c.flags.last).toBeNull();
    c.flags.publish({ anchors: [], centre: { x: 0, y: 0 }, bulgeR: 0, width: 10, height: 10 });
    expect(c.flags.last?.width).toBe(10);
    c.setActive(false);
    expect(c.hover).toBeNull();
    expect(c.pinned).toBeNull();
  });
});

describe("blob anchors (the bead draw)", () => {
  it("the shaders carry the course attribute, the hover uniform and the condense growth; the course index is dense in order of appearance", () => {
    expect(BEAD_VERT).toContain("attribute float iCourse");
    expect(BEAD_VERT).toContain("uniform float uHover");
    expect(BEAD_VERT).toContain("uniform float uCondense");
    expect(BEAD_VERT).toContain("uniform vec2 uGrow");
    expect(BEAD_FRAG).toContain("vHover");
    const spec = generateGalaxySpec(seedFromText("hover"));
    const layout = generateGalaxyLayout({ courses: COURSES, currentCourseId: "a", seed: spec.seed, geometry: armsFromSpec(spec) });
    const instances = beadInstances(layout, COURSE_PALETTES.dark);
    const index = courseIndexOf(instances);
    expect(index.size).toBe(4);
    expect([...index.values()].sort()).toEqual([0, 1, 2, 3]);
    // Every instance of a course shares its index (glow, core, ring).
    for (const q of instances) expect(index.get(q.courseId)).toBeDefined();
    expect(instances.filter((q) => q.courseId === "a").length).toBe(3);
  });

  it("the glow is the blob's core glow (0.6 of the bead) and the ring hugs the blob rim; condense grows them back to the bead", () => {
    const spec = generateGalaxySpec(seedFromText("anchor"));
    const layout = generateGalaxyLayout({ courses: COURSES, currentCourseId: "a", seed: spec.seed, geometry: armsFromSpec(spec) });
    const instances = beadInstances(layout, COURSE_PALETTES.dark);
    const cur = layout.current!;
    const glow = instances.find((q) => q.courseId === "a" && q.mode === 0)!;
    const ring = instances.find((q) => q.mode === 3)!;
    expect(glow.size).toBeCloseTo(cur.radius * BEAD_ANCHOR.coreGlow, 9);
    expect(ring.size).toBeCloseTo(cur.radius * ringScaleFor(BEAD_ANCHOR), 9);
    expect(ring.size).toBeGreaterThan(cur.radius * 1.3);
    const grow = beadGrowAt(BEAD_ANCHOR);
    // At condense 1 the glow is the whole bead (the twin's landing disc) and the ring the bead ring (1.3 r).
    expect(glow.size * grow.glow).toBeCloseTo(cur.radius, 9);
    expect(ring.size * grow.ring).toBeCloseTo(cur.radius * 1.3, 9);
    // The budget counts the blob draw beside the anchors' instanced draw.
    const budget = galaxyLayerBudget(ALL_FEATURES, buildGalaxyBuffers(spec), layout, { draws: 1, points: 400 });
    expect(budget.blobDraws).toBe(1);
    expect(budget.blobPoints).toBe(400);
    expect(budget.drawCalls).toBe(galaxyLayerBudget(ALL_FEATURES, buildGalaxyBuffers(spec), layout, { draws: 0, points: 0 }).drawCalls + 1);
  });

  it("the hand-off folds the current blob into its core while the twin lands and blooms it with the ring", () => {
    expect(galaxyHandoffAt(2.3).blob).toBe(1);
    expect(galaxyHandoffAt(2.6).blob).toBe(1);
    expect(galaxyHandoffAt(BLOB_BLOOM.from).blob).toBe(1);
    const mid = galaxyHandoffAt((BLOB_BLOOM.from + BLOB_BLOOM.to) / 2);
    expect(mid.blob).toBeCloseTo(0.5, 9);
    expect(mid.ring).toBeGreaterThan(0);
    expect(mid.ring).toBeLessThan(1);
    expect(galaxyHandoffAt(BLOB_BLOOM.to).blob).toBe(0);
    expect(galaxyHandoffAt(3).blob).toBe(0);
    // The twin's stars are on the core (condense 1 at 2.7) before the blob is more than a sixth out.
    expect(galaxyHandoffAt(2.7).condense).toBe(1);
    expect(galaxyHandoffAt(2.7).blob).toBeGreaterThan(0.8);
  });
});

describe("GalaxyFader", () => {
  function mat(uFade: number, field = false): THREE.ShaderMaterial {
    const uniforms: Record<string, { value: unknown }> = { uFade: { value: uFade } };
    if (field) uniforms.uSpur = { value: [] };
    return new THREE.ShaderMaterial({ uniforms });
  }
  it("scales every uFade from its recorded base, plates in the second half, and skips repeats", () => {
    const root = new THREE.Group();
    const a = mat(1);
    const dust = mat(0.72);
    const plate = mat(1, true);
    const plain = new THREE.MeshBasicMaterial();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), a), new THREE.Mesh(new THREE.BufferGeometry(), dust), new THREE.Mesh(new THREE.BufferGeometry(), plate), new THREE.Mesh(new THREE.BufferGeometry(), plain));
    const fader = new GalaxyFader();
    fader.apply(root, 0.5);
    expect(a.uniforms.uFade.value).toBeCloseTo(0.5);
    expect(dust.uniforms.uFade.value).toBeCloseTo(0.36);
    expect(plate.uniforms.uFade.value).toBe(0);
    fader.apply(root, 0.75);
    expect(plate.uniforms.uFade.value).toBeCloseTo(0.5);
    fader.apply(root, 1);
    expect(a.uniforms.uFade.value).toBe(1);
    expect(dust.uniforms.uFade.value).toBeCloseTo(0.72);
    expect(plate.uniforms.uFade.value).toBe(1);
    // Same opacity again: no rewrite (an external write survives until it changes).
    a.uniforms.uFade.value = 0.123;
    fader.apply(root, 1);
    expect(a.uniforms.uFade.value).toBe(0.123);
    fader.invalidate();
    fader.apply(root, 1);
    expect(a.uniforms.uFade.value).toBe(1);
    fader.apply(root, 0);
    expect(a.uniforms.uFade.value).toBe(0);
  });
});

describe("galaxy scenery build", () => {
  it("inverts the sky builder's view-plane frame onto the disc plane and stays within two draws", () => {
    const seed = seedFromText("scenery-build");
    const spec = generateGalaxySpec(seed);
    const layout = generateGalaxyLayout({ courses: COURSES, currentCourseId: "a", seed, geometry: armsFromSpec(spec) });
    const scenery = placeGalaxyScenery({ seed, layout, view: { aspect: 1.6, fovDeg: 40, size: 0.832, roll: spec.roll, inclination: spec.inclination } });
    expect(scenery.objects.length).toBeGreaterThanOrEqual(3);
    const placed = sceneryToPlacedObjects(scenery);
    expect(placed).toHaveLength(scenery.objects.length);
    expect(SCENERY_BUILD_DISTANCE).toBeGreaterThanOrEqual(SCENERY_BUILD_BAND.near);
    expect(SCENERY_BUILD_DISTANCE).toBeLessThanOrEqual(SCENERY_BUILD_BAND.far);
    const t = sceneryGroupTransform();
    expect(t.rotationX).toBe(-Math.PI / 2);
    expect(t.position[1]).toBe(SCENERY_BUILD_DISTANCE);

    const built = buildGalaxyScenery(scenery, "dark");
    expect(built.stats.draws).toBe(GALAXY_SCENERY_DRAW_CALLS);
    expect(built.quads.count).toBeGreaterThan(0);
    expect(built.quads.count).toBeLessThanOrEqual(24);
    // Round trip: each quad's instance matrix translation, seated under the group, lands on its object's disc position.
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const group = new THREE.Matrix4().compose(new THREE.Vector3(...t.position), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), t.rotationX), new THREE.Vector3(1, 1, 1));
    let matched = 0;
    for (let i = 0; i < built.quads.count; i++) {
      m.fromArray(built.quads.matrices, i * 16);
      p.setFromMatrixPosition(m).applyMatrix4(group);
      // Smudge rings scatter sub-quads around their centre, so only exact object centres are counted.
      if (scenery.objects.some((o) => Math.hypot(p.x - o.position[0], p.z - o.position[2]) < 1e-6 && Math.abs(p.y) < 1e-6)) matched++;
    }
    expect(matched).toBeGreaterThanOrEqual(scenery.objects.filter((o) => o.kind !== "smudges").length);
    // Points (cluster stars, nebula sprinkles) live in the same frame and fade with the rung via their alpha copy.
    expect(built.points.count).toBeGreaterThanOrEqual(0);
    const light = buildGalaxyScenery(scenery, "light");
    expect(light.quads.count).toBe(built.quads.count);
  });
});
