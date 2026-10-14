import { describe, expect, it } from "vitest";
import { CONSTELLATION_GRAPH_BOX, CONSTELLATION_SCENERY_LIMITS, constellationSceneryAsPlaced, placeConstellationScenery } from "./constellation-scenery";
import { BACKDROP_SAFE_AREAS, boxesOverlap, objectBox } from "./placement";
import { seedFromText } from "./rng";

const seeds = ["sandbox", "philote", "student-7", "a", "b", "c", "whirlpool", "x9"].map(seedFromText);
const aspects = [1.3, 1.6, 1.78, 2.0];

describe("constellation-rung scenery", () => {
  it("places two to four objects, deterministically, for every seed and aspect", () => {
    for (const seed of seeds) {
      for (const aspect of aspects) {
        const a = placeConstellationScenery({ seed, aspect });
        const b = placeConstellationScenery({ seed, aspect });
        expect(a).toEqual(b);
        expect(a.objects.length).toBeGreaterThanOrEqual(CONSTELLATION_SCENERY_LIMITS.minObjects);
        expect(a.objects.length).toBeLessThanOrEqual(CONSTELLATION_SCENERY_LIMITS.maxObjects);
        expect(a.rung).toBe("constellation");
        expect(a.objects.every((o) => o.rung === "constellation")).toBe(true);
      }
    }
  });

  it("never puts an object under the graph box, the chrome, another object, or off the bled viewport", () => {
    for (const seed of seeds) {
      for (const aspect of aspects) {
        const s = placeConstellationScenery({ seed, aspect });
        const boxes = s.objects.map((o) => objectBox(o, aspect));
        boxes.forEach((box, i) => {
          expect(boxesOverlap(box, CONSTELLATION_GRAPH_BOX)).toBe(false);
          for (const area of BACKDROP_SAFE_AREAS) expect(boxesOverlap(box, area)).toBe(false);
          boxes.forEach((other, j) => {
            if (i !== j) expect(boxesOverlap(box, other)).toBe(false);
          });
          const bleed = CONSTELLATION_SCENERY_LIMITS.bleed;
          expect(box.x0).toBeGreaterThanOrEqual(-bleed - 1e-9);
          expect(box.y0).toBeGreaterThanOrEqual(-bleed - 1e-9);
          expect(box.x1).toBeLessThanOrEqual(1 + bleed + 1e-9);
          expect(box.y1).toBeLessThanOrEqual(1 + bleed + 1e-9);
        });
      }
    }
  });

  it("honours a caller's graph box and keep-outs", () => {
    const graphBox = { x0: 0.02, y0: 0.14, x1: 0.98, y1: 0.86 };
    const keepOut = [{ x0: 0.6, y0: 0.86, x1: 1, y1: 1 }];
    const s = placeConstellationScenery({ seed: seeds[1], aspect: 1.6, graphBox, keepOut });
    for (const o of s.objects) {
      const box = objectBox(o, 1.6);
      expect(boxesOverlap(box, graphBox)).toBe(false);
      expect(boxesOverlap(box, keepOut[0])).toBe(false);
    }
    expect(s.graphBox).toEqual(graphBox);
  });

  it("different seeds give different skies and the objects are far and small", () => {
    const a = placeConstellationScenery({ seed: seeds[0], aspect: 1.6 });
    const b = placeConstellationScenery({ seed: seeds[1], aspect: 1.6 });
    expect(a.objects.map((o) => [o.u, o.v])).not.toEqual(b.objects.map((o) => [o.u, o.v]));
    for (const o of [...a.objects, ...b.objects]) {
      expect(o.depth).toBeGreaterThanOrEqual(0.8);
      expect(o.size).toBeLessThanOrEqual(0.17);
    }
    expect(constellationSceneryAsPlaced(a).every((o) => o.rung === "backdrop")).toBe(true);
    expect(constellationSceneryAsPlaced(a)).toHaveLength(a.objects.length);
  });
});
