import { describe, expect, it } from "vitest";
import { courseGraphsFor, fitZoom, nodeCountFor, realCourseGraph, syntheticCourseGraph } from "./course-graphs";
import { cellsPerUnitAt } from "@/lib/galaxy/blobs";
import { mulberry32 } from "@/lib/stage/rng";

describe("realCourseGraph (8.223 parity capture)", () => {
  it("carries the captured sky: 205 nodes, 343 links, 8 clusters, the capture's zoom", () => {
    const g = realCourseGraph();
    expect(g.origin).toBe("real");
    expect(g.nodes).toHaveLength(205);
    expect(g.links).toHaveLength(343);
    expect(g.clusters).toHaveLength(8);
    expect(g.referenceZoom).toBeCloseTo(0.3117, 3);
    expect(g.bounds.halfExtent).toBeGreaterThan(1500);
    // Every link resolves to two nodes.
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const l of g.links) {
      expect(ids.has(l.source)).toBe(true);
      expect(ids.has(l.target)).toBe(true);
    }
    // The fit formula lands within 15 % of the capture's own camera.
    expect(Math.abs(fitZoom(g.bounds) - g.referenceZoom) / g.referenceZoom).toBeLessThan(0.15);
  });
});

describe("syntheticCourseGraph (product d3 layout, headless)", () => {
  it("is deterministic per seed and settles to finite, spread positions", () => {
    const a = syntheticCourseGraph("x", 1234, { nodeCount: 120 });
    const b = syntheticCourseGraph("x", 1234, { nodeCount: 120 });
    expect(a.nodes.length).toBe(120);
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]));
    for (const n of a.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
    expect(a.bounds.halfExtent).toBeGreaterThan(300);
    expect(a.clusters.length).toBeGreaterThanOrEqual(4);
    expect(a.clusters.length).toBeLessThanOrEqual(9);
    // Clusters are cohesive: a member is closer to its own centroid than to the graph centre on average.
    const centroid = new Map(a.clusters.map((c) => [c.id, c]));
    let own = 0;
    let global = 0;
    for (const n of a.nodes) {
      if (n.kind !== "concept" || !n.clusterId) continue;
      const c = centroid.get(n.clusterId)!;
      own += Math.hypot(n.x - c.x, n.y - c.y);
      global += Math.hypot(n.x - a.bounds.cx, n.y - a.bounds.cy);
    }
    expect(own).toBeLessThan(global);
  });

  it("changes with the seed and keeps edges inside the graph", () => {
    const a = syntheticCourseGraph("x", 1, { nodeCount: 80 });
    const b = syntheticCourseGraph("x", 2, { nodeCount: 80 });
    expect(a.nodes.map((n) => n.x)).not.toEqual(b.nodes.map((n) => n.x));
    const ids = new Set(a.nodes.map((n) => n.id));
    for (const l of a.links) expect(ids.has(l.source) && ids.has(l.target)).toBe(true);
    expect(a.links.length).toBeGreaterThan(a.nodes.length * 0.9);
  });

  it("nodeCountFor stays in the 60 .. 220 band", () => {
    const rng = mulberry32(7);
    for (const c of [5, 18, 40, 64, 90, 400]) {
      const n = nodeCountFor(c, rng);
      expect(n).toBeGreaterThanOrEqual(60);
      expect(n).toBeLessThanOrEqual(220);
    }
  });

  it("courseGraphsFor: the real capture for 8.223, synthetic settled graphs for the rest", () => {
    const t0 = performance.now();
    const graphs = courseGraphsFor(
      [
        { id: "8.223", concepts: 64 },
        { id: "18.06", concepts: 52 },
        { id: "21G.401", concepts: 90 },
      ],
      42,
    );
    const ms = performance.now() - t0;
    expect(graphs.get("8.223")!.origin).toBe("real");
    expect(graphs.get("18.06")!.origin).toBe("synthetic");
    expect(graphs.get("21G.401")!.nodes.length).toBeGreaterThanOrEqual(60);
    // Two settled synthetic courses in a few hundred ms at most (the lab settles 7 .. 11 at mount).
    expect(ms).toBeLessThan(4000);
  });
});

describe("cellsPerUnitAt (the stage's cells per disc unit)", () => {
  it("the hero framing puts a 0.085 R bead at ~14 cells radius on a 450-cell-high target", () => {
    const C = cellsPerUnitAt(3.3, 40, 450);
    expect(0.085 * C).toBeGreaterThan(12);
    expect(0.085 * C).toBeLessThan(18);
  });
});
