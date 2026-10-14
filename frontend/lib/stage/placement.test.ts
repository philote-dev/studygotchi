import { describe, expect, it } from "vitest";
import {
  BACKDROP_FRAME,
  BACKDROP_LIMITS,
  BACKDROP_SAFE_AREAS,
  boxesOverlap,
  bucketAspect,
  EDGE_SIDES,
  edgeDistance,
  galaxyBox,
  objectBox,
  placeBackdrop,
  seedFromStudent,
  type EdgeSide,
} from "./placement";

const SEEDS = Array.from({ length: 240 }, (_, i) => seedFromStudent(`student-${i}`));
const ASPECTS = [1.33, 1.6, 1.78, 2.1];
/** The edge-bias checks run over 200 seeds at the two common desktop aspects. */
const EDGE_SEEDS = SEEDS.slice(0, 200);
const EDGE_ASPECTS = [1.6, 1.78];

describe("seedFromStudent", () => {
  it("falls back to the sandbox seed for a missing id", () => {
    const sandbox = seedFromStudent("sandbox");
    expect(seedFromStudent(null)).toBe(sandbox);
    expect(seedFromStudent(undefined)).toBe(sandbox);
    expect(seedFromStudent("")).toBe(sandbox);
    expect(seedFromStudent("   ")).toBe(sandbox);
  });

  it("is stable and distinct per student", () => {
    expect(seedFromStudent("user_2abc")).toBe(seedFromStudent("user_2abc"));
    expect(seedFromStudent("user_2abc")).not.toBe(seedFromStudent("user_2abd"));
  });
});

describe("placeBackdrop", () => {
  it("is deterministic: same seed, same sky", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      expect(placeBackdrop(seed, { aspect: 1.6 })).toEqual(placeBackdrop(seed, { aspect: 1.6 }));
    }
  });

  it("changes with the seed", () => {
    const a = placeBackdrop(SEEDS[0], { aspect: 1.6 });
    const b = placeBackdrop(SEEDS[1], { aspect: 1.6 });
    expect(a.galaxy).not.toEqual(b.galaxy);
    expect(a.objects.map((o) => [o.u, o.v])).not.toEqual(b.objects.map((o) => [o.u, o.v]));
  });

  it("keeps the object count bounded and tags the rung", () => {
    for (const aspect of ASPECTS) {
      for (const seed of SEEDS) {
        const sky = placeBackdrop(seed, { aspect });
        expect(sky.objects.length).toBeGreaterThanOrEqual(BACKDROP_LIMITS.minObjects);
        expect(sky.objects.length).toBeLessThanOrEqual(BACKDROP_LIMITS.maxObjects);
        expect(sky.rung).toBe("backdrop");
        for (const o of sky.objects) expect(o.rung).toBe("backdrop");
      }
    }
  });

  it("never puts an object or the galaxy under the header or panel safe areas", () => {
    for (const aspect of ASPECTS) {
      for (const seed of SEEDS) {
        const sky = placeBackdrop(seed, { aspect });
        const boxes = [galaxyBox(sky.galaxy, aspect), ...sky.objects.map((o) => objectBox(o, aspect))];
        for (const box of boxes) {
          for (const safe of BACKDROP_SAFE_AREAS) {
            expect(boxesOverlap(box, safe)).toBe(false);
          }
          expect(box.x0).toBeGreaterThanOrEqual(-BACKDROP_LIMITS.bleed - 1e-9);
          expect(box.y0).toBeGreaterThanOrEqual(-BACKDROP_LIMITS.bleed - 1e-9);
          expect(box.x1).toBeLessThanOrEqual(1 + BACKDROP_LIMITS.bleed + 1e-9);
          expect(box.y1).toBeLessThanOrEqual(1 + BACKDROP_LIMITS.bleed + 1e-9);
        }
      }
    }
  });

  it("keeps objects apart from each other and from the galaxy", () => {
    for (const seed of SEEDS.slice(0, 120)) {
      const sky = placeBackdrop(seed, { aspect: 1.6 });
      const all = [{ u: sky.galaxy.u, v: sky.galaxy.v, size: sky.galaxy.size }, ...sky.objects];
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const d = Math.hypot((all[i].u - all[j].u) * 1.6, all[i].v - all[j].v);
          // Centres at least a third of the bigger object apart: no two objects fuse into one blob.
          expect(d).toBeGreaterThan(Math.max(all[i].size, all[j].size) * 0.33);
        }
      }
    }
  });

  it("hugs the edges: at least 75% of objects have their centre within 0.25 of a frame edge", () => {
    let total = 0;
    let near = 0;
    for (const aspect of EDGE_ASPECTS) {
      for (const seed of EDGE_SEEDS) {
        for (const o of placeBackdrop(seed, { aspect }).objects) {
          total++;
          if (edgeDistance(o.u, o.v, aspect) <= BACKDROP_LIMITS.central) near++;
        }
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(near / total).toBeGreaterThanOrEqual(0.75);
  });

  it("leaves the middle clear: at most one object per sky in the central band", () => {
    for (const aspect of EDGE_ASPECTS) {
      for (const seed of EDGE_SEEDS) {
        const sky = placeBackdrop(seed, { aspect });
        const central = sky.objects.filter((o) => edgeDistance(o.u, o.v, aspect) > BACKDROP_LIMITS.central);
        expect(central.length).toBeLessThanOrEqual(BACKDROP_LIMITS.maxCentral);
        // The tag agrees with the geometry: only a fallback object is marked `centre`.
        for (const o of sky.objects) expect(o.edge === "centre").toBe(edgeDistance(o.u, o.v, aspect) > BACKDROP_LIMITS.central);
      }
    }
  });

  it("puts every edge object inside its side's band, measured from that side", () => {
    const f = BACKDROP_FRAME;
    for (const aspect of EDGE_ASPECTS) {
      for (const seed of EDGE_SEEDS) {
        for (const o of placeBackdrop(seed, { aspect }).objects) {
          if (o.edge === "centre") continue;
          const spec = EDGE_SIDES.find((s) => s.side === o.edge);
          expect(spec).toBeDefined();
          const inset =
            o.edge === "right" ? (f.x1 - o.u) * aspect : o.edge === "left" ? (o.u - f.x0) * aspect : o.edge === "bottom" ? f.y1 - o.v : o.v - f.y0;
          expect(inset).toBeGreaterThanOrEqual(spec!.band[0] - 1e-9);
          expect(inset).toBeLessThanOrEqual(spec!.band[1] + 1e-9);
        }
      }
    }
  });

  it("spreads objects over the sides: the right edge leads, no side is empty, no sky piles four on one edge", () => {
    const totals: Record<EdgeSide, number> = { right: 0, bottom: 0, top: 0, left: 0 };
    for (const seed of EDGE_SEEDS) {
      const sky = placeBackdrop(seed, { aspect: 1.6 });
      const perSide: Record<EdgeSide, number> = { right: 0, bottom: 0, top: 0, left: 0 };
      for (const o of sky.objects) {
        if (o.edge === "centre") continue;
        perSide[o.edge]++;
        totals[o.edge]++;
      }
      for (const side of Object.keys(perSide) as EdgeSide[]) expect(perSide[side]).toBeLessThanOrEqual(3);
    }
    expect(totals.right).toBeGreaterThan(totals.bottom);
    expect(totals.right).toBeGreaterThan(totals.top);
    expect(totals.right).toBeGreaterThan(totals.left);
    for (const side of Object.keys(totals) as EdgeSide[]) expect(totals[side]).toBeGreaterThan(0);
  });

  it("always includes the three kinds that carry the sky and sizes them within range", () => {
    for (const seed of SEEDS.slice(0, 120)) {
      const sky = placeBackdrop(seed, { aspect: 1.6 });
      const kinds = new Set(sky.objects.map((o) => o.kind));
      expect(kinds.has("nebula") || kinds.has("cluster") || kinds.has("planetary")).toBe(true);
      for (const o of sky.objects) {
        expect(o.size).toBeGreaterThan(0.05);
        expect(o.size).toBeLessThan(0.3);
        expect(o.depth).toBeGreaterThanOrEqual(0);
        expect(o.depth).toBeLessThanOrEqual(1);
        expect(Number.isFinite(o.seed)).toBe(true);
      }
      expect(sky.galaxy.size).toBeGreaterThanOrEqual(0.13);
      expect(sky.galaxy.size).toBeLessThanOrEqual(0.17);
      expect(sky.galaxy.tilt).toBeGreaterThan(0.4);
      expect(sky.galaxy.tilt).toBeLessThan(1.1);
    }
  });
});

describe("edgeDistance", () => {
  it("measures to the sky frame (header bottom, column edge, right, bottom) in viewport heights", () => {
    const f = BACKDROP_FRAME;
    expect(f).toEqual({ x0: 0.3, y0: 0.13, x1: 1, y1: 1 });
    // Horizontal gaps scale with the aspect; vertical gaps do not.
    expect(edgeDistance(0.9, 0.5, 1.6)).toBeCloseTo(0.16, 9);
    expect(edgeDistance(0.9, 0.5, 2)).toBeCloseTo(0.2, 9);
    expect(edgeDistance(0.6, 0.9, 1.6)).toBeCloseTo(0.1, 9);
    expect(edgeDistance(0.6, 0.2, 1.6)).toBeCloseTo(0.07, 9);
    expect(edgeDistance(0.35, 0.5, 1.6)).toBeCloseTo(0.08, 9);
    // The middle of the frame is far from every edge; outside the frame is negative.
    expect(edgeDistance(0.65, 0.565, 1.6)).toBeGreaterThan(BACKDROP_LIMITS.central);
    expect(edgeDistance(0.2, 0.5, 1.6)).toBeLessThan(0);
    expect(edgeDistance(0.6, 0.05, 1.6)).toBeLessThan(0);
  });

  it("agrees with the safe areas it is derived from", () => {
    const header = BACKDROP_SAFE_AREAS.find((s) => s.id === "header");
    const column = BACKDROP_SAFE_AREAS.find((s) => s.id === "left-column");
    expect(BACKDROP_FRAME.y0).toBe(header?.y1);
    expect(BACKDROP_FRAME.x0).toBe(column?.x1);
  });
});

describe("bucketAspect", () => {
  it("rounds to a tenth and survives zero sizes", () => {
    expect(bucketAspect(1440, 900)).toBe(1.6);
    expect(bucketAspect(1512, 982)).toBe(1.5);
    expect(bucketAspect(0, 900)).toBe(1.6);
    expect(bucketAspect(4000, 900)).toBe(3.2);
  });
});
