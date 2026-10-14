import { describe, expect, it } from "vitest";
import { armsFromSpec, beadRadiusFor, generateGalaxyLayout, type GalaxyCourse } from "./layout";
import { generateGalaxySpec } from "./spec";
import { mulberry32 } from "@/lib/stage/rng";
import {
  BLOB_SWAP_MS,
  blobGraphFromPositions,
  buildBlobBuffers,
  cellsPerUnitAt,
  clusterDepths,
  courseRng,
  pickThreads,
  placementsFromBeads,
  plummerContrast,
  plummerRadius,
  rotateAxis,
  standInGraph,
  swapMixAt,
  tumbleFor,
  type BlobGraph,
  type BlobGraphLink,
  type BlobPlacement,
} from "./blobs";

const COURSES: readonly GalaxyCourse[] = [
  { id: "8.223", code: "8.223", title: "Classical Mechanics II", conceptCount: 64, mastery: 0.62, hasWorld: true, archived: false, lastOpenedAt: 3 },
  { id: "18.06", code: "18.06", title: "Linear Algebra", conceptCount: 52, mastery: 0.78, hasWorld: true, archived: false, lastOpenedAt: 2 },
  { id: "21G.401", code: "21G.401", title: "Korean I", conceptCount: 90, mastery: 0.41, hasWorld: false, archived: false, lastOpenedAt: 1 },
  { id: "6.1010", code: "6.1010", title: "Fundamentals of Programming", conceptCount: 48, mastery: 0.86, hasWorld: false, archived: false, lastOpenedAt: 0 },
  { id: "8.044", code: "8.044", title: "Statistical Physics I", conceptCount: 40, mastery: 0.33, hasWorld: false, archived: false, lastOpenedAt: 0 },
  { id: "6.1210", code: "6.1210", title: "Algorithms", conceptCount: 70, mastery: 0.5, hasWorld: false, archived: false, lastOpenedAt: 0 },
  { id: "18.100A", code: "18.100A", title: "Real Analysis", conceptCount: 30, mastery: 0.2, hasWorld: false, archived: false, lastOpenedAt: 0 },
  { id: "21W.021", code: "21W.021", title: "Writing", conceptCount: 18, mastery: 0.7, hasWorld: false, archived: false, lastOpenedAt: 0 },
  { id: "7.012", code: "7.012", title: "Biology", conceptCount: 58, mastery: 0.9, hasWorld: false, archived: false, lastOpenedAt: 0 },
  { id: "14.01", code: "14.01", title: "Microeconomics", conceptCount: 44, mastery: 0.4, hasWorld: false, archived: false, lastOpenedAt: 0 },
  { id: "5.111", code: "5.111", title: "Chemistry", conceptCount: 66, mastery: 0.55, hasWorld: false, archived: false, lastOpenedAt: 0 },
  { id: "24.00", code: "24.00", title: "Philosophy", conceptCount: 22, mastery: 0.6, hasWorld: false, archived: false, lastOpenedAt: 0 },
];

/** A "real" graph: a stand-in's positions re-labelled real, plus seeded links (in-family chains and a few bridges) and a few files. */
function fixtureGraph(courseId: string, nodeCount: number, seed: number): BlobGraph {
  const base = standInGraph(courseId, nodeCount, seed);
  const rng = mulberry32(seed);
  const nodes = base.nodes.map((n) => ({ ...n }));
  const files = Math.round(nodeCount * 0.1);
  // Files hang off the rim, some far out (an outlying file must not push the concepts off-centre).
  for (let i = 0; i < files; i++) nodes.push({ id: `${courseId}:r${i}`, kind: "resource", x: nodes[i].x + (i === 0 ? 20 : 0.2), y: nodes[i].y - 0.2, weight: 0.3, clusterId: null, mastery: 0.5 });
  const links: BlobGraphLink[] = [];
  const concepts = nodes.filter((n) => n.kind === "concept");
  for (let i = 1; i < concepts.length; i++) {
    const j = Math.floor(rng() * i);
    links.push({ id: `c:${concepts[j].id}->${concepts[i].id}`, source: concepts[j].id, target: concepts[i].id, kind: "concept", directed: rng() < 0.3, type: rng() < 0.3 ? "PREREQUISITE_FOR" : "RELATED" });
  }
  for (let i = 0; i < files; i++) links.push({ id: `r:${i}`, source: `${courseId}:r${i}`, target: concepts[i % concepts.length].id, kind: "resource", directed: false, type: "MENTIONS" });
  return blobGraphFromPositions(courseId, nodes, links);
}

const graphs = new Map<string, BlobGraph>([
  ["8.223", fixtureGraph("8.223", 180, 42)],
  ["18.06", fixtureGraph("18.06", 120, 7)],
]);
const params = { core: 0.35, depth: 0.6, nodeWeight: 0, seed: 0x5eed, threads: 0 };
const place = (condense = 0): BlobPlacement[] => [
  { courseId: "8.223", position: [0.5, 0, 0.2], radius: beadRadiusFor(64) * 1.4, condense, current: true },
  { courseId: "18.06", position: [-0.4, 0.2, -0.3], radius: beadRadiusFor(52) * 1.4, condense, current: false },
];

describe("plummerRadius (the density profile)", () => {
  it("is monotone, fixed at 0 and 1, and gathers the core: R(r) < r inside", () => {
    for (const a of [0.2, 0.35, 0.6]) {
      expect(plummerRadius(0, a)).toBe(0);
      expect(plummerRadius(1, a)).toBeCloseTo(1, 9);
      let prev = 0;
      for (let i = 1; i <= 100; i++) {
        const r = i / 100;
        const R = plummerRadius(r, a);
        expect(R).toBeGreaterThanOrEqual(prev);
        if (r < 1) expect(R).toBeLessThan(r);
        prev = R;
      }
    }
  });

  it("puts half of a uniform disc's stars well inside the half radius, more so for a smaller core", () => {
    const half = (a: number) => plummerRadius(Math.SQRT1_2, a);
    expect(half(0.35)).toBeLessThan(0.5);
    expect(half(0.2)).toBeLessThan(half(0.35));
    expect(half(0.6)).toBeGreaterThan(half(0.35));
    expect(plummerContrast(0.35)).toBeGreaterThan(plummerContrast(0.6));
  });
});

describe("standInGraph (the seeded placeholder)", () => {
  it("has exactly the node count, 3 .. 8 cohesive families, is deterministic per course and differs between courses", () => {
    for (const [id, n] of [
      ["a", 60],
      ["b", 120],
      ["c", 220],
      ["d", 4],
    ] as const) {
      const g = standInGraph(id, n);
      expect(g.nodes).toHaveLength(n);
      expect(g.origin).toBe("stand-in");
      expect(g.clusters.length).toBeGreaterThanOrEqual(1);
      expect(g.clusters.length).toBeLessThanOrEqual(8);
      expect(g.clusters.reduce((s, c) => s + c.count, 0)).toBe(n);
      for (const node of g.nodes) expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
      expect(standInGraph(id, n)).toEqual(g);
    }
    expect(standInGraph("a", 60).nodes.map((n) => n.x)).not.toEqual(standInGraph("b", 60).nodes.map((n) => n.x));
    // Members sit nearer their own centroid than the graph centre (families, not a uniform disc).
    const g = standInGraph("a", 120);
    const centroid = new Map<string, { x: number; y: number; n: number }>();
    for (const node of g.nodes) {
      const c = centroid.get(node.clusterId!) ?? { x: 0, y: 0, n: 0 };
      c.x += node.x;
      c.y += node.y;
      c.n += 1;
      centroid.set(node.clusterId!, c);
    }
    let own = 0;
    let global = 0;
    for (const node of g.nodes) {
      const c = centroid.get(node.clusterId!)!;
      own += Math.hypot(node.x - c.x / c.n, node.y - c.y / c.n);
      global += Math.hypot(node.x - g.bounds.cx, node.y - g.bounds.cy);
    }
    expect(own).toBeLessThan(global);
  });

  it("blobGraphFromPositions derives the clusters and bounds from the nodes", () => {
    const g = blobGraphFromPositions("x", [
      { id: "1", kind: "concept", x: -10, y: 0, weight: 1, clusterId: "p" },
      { id: "2", kind: "concept", x: 10, y: 4, weight: 1, clusterId: "p" },
      { id: "3", kind: "concept", x: 0, y: -4, weight: 1, clusterId: "q" },
      { id: "4", kind: "resource", x: 0, y: 0, weight: 0.3 },
    ]);
    expect(g.origin).toBe("real");
    expect(g.clusters).toEqual([
      { id: "p", count: 2 },
      { id: "q", count: 1 },
    ]);
    expect(g.bounds.halfExtent).toBe(10);
    expect(g.bounds.cx).toBe(0);
  });
});

describe("buildBlobBuffers (the mapping)", () => {
  it("is deterministic: the same graphs, placements and seed give identical buffers", () => {
    const a = buildBlobBuffers({ graphs, placements: place(), params });
    const b = buildBlobBuffers(graphs, place(), params);
    expect(a.points.local).toEqual(b.points.local);
    expect(a.points.alpha).toEqual(b.points.alpha);
    expect(a.courses.map((c) => [c.axis, c.omega])).toEqual(b.courses.map((c) => [c.axis, c.omega]));
    const other = buildBlobBuffers({ graphs, placements: place(), params: { ...params, seed: 7 } });
    expect(other.points.local).not.toEqual(a.points.local);
    // The seed moves only depth (lobes, jitter) and the tumble; the face (x, -z) is the layout itself.
    for (let i = 0; i < a.points.count; i++) {
      expect(other.points.local[i * 3]).toBeCloseTo(a.points.local[i * 3], 9);
      expect(other.points.local[i * 3 + 2]).toBeCloseTo(a.points.local[i * 3 + 2], 9);
    }
  });

  it("keeps every star inside its ellipsoid (face radius R, depth semi-axis depth * R) and writes one point per node", () => {
    const b = buildBlobBuffers({ graphs, placements: place(), params });
    expect(b.points.count).toBe(graphs.get("8.223")!.nodes.length + graphs.get("18.06")!.nodes.length);
    expect(b.budget.draws).toBe(1);
    for (let i = 0; i < b.points.count; i++) {
      const c = b.courses[b.points.course[i]];
      const x = b.points.local[i * 3] / c.radius;
      const y = b.points.local[i * 3 + 1] / (c.radius * params.depth);
      const z = b.points.local[i * 3 + 2] / c.radius;
      expect(x * x + y * y + z * z).toBeLessThanOrEqual(1 + 1e-6);
      expect(b.points.radius[i]).toBeLessThanOrEqual(1);
      expect(b.points.gen[i]).toBe(1);
    }
    expect(b.courses.every((c) => !c.swapping && c.origin === "real")).toBe(true);
  });

  it("is denser in the core than at the rim: the mean normalised radius of the visible stars is below 0.55 and falls with a smaller core", () => {
    const soft = buildBlobBuffers({ graphs, placements: place(), params: { ...params, core: 0.6 } });
    const mid = buildBlobBuffers({ graphs, placements: place(), params: { ...params, core: 0.35 } });
    const sharp = buildBlobBuffers({ graphs, placements: place(), params: { ...params, core: 0.2 } });
    for (const b of [soft, mid, sharp]) for (const c of b.courses) expect(c.meanRadius).toBeLessThan(0.55);
    expect(sharp.courses[0].meanRadius).toBeLessThan(mid.courses[0].meanRadius);
    expect(mid.courses[0].meanRadius).toBeLessThan(soft.courses[0].meanRadius);
    let inner = 0;
    let outer = 0;
    for (let i = 0; i < mid.points.count; i++) {
      if (mid.points.alpha[i] <= 0) continue;
      const c = mid.courses[mid.points.course[i]];
      const r = Math.hypot(mid.points.local[i * 3], mid.points.local[i * 3 + 2]) / c.radius;
      if (r < 0.5) inner += 1;
      else outer += 1;
    }
    expect(inner).toBeGreaterThan(outer);
  });

  it("gives each topic cluster its own depth (a lobe), the biggest nearest the mid-plane, all within +-0.75", () => {
    const g = graphs.get("8.223")!;
    const depths = clusterDepths(g, mulberry32(1));
    expect(depths.size).toBe(g.clusters.length);
    const values = [...depths.values()];
    expect(new Set(values.map((v) => v.toFixed(6))).size).toBe(values.length);
    for (const v of values) expect(Math.abs(v)).toBeLessThanOrEqual(0.75 + 1e-9);
    const biggest = [...g.clusters].sort((p, q) => q.count - p.count)[0];
    expect(Math.abs(depths.get(biggest.id)!)).toBeLessThanOrEqual(Math.min(...values.map((v) => Math.abs(v))) + 1e-9);
    const b = buildBlobBuffers({ graphs, placements: [place()[0]], params });
    const byCluster = new Map<string, number[]>();
    g.nodes.forEach((n, i) => {
      if (n.kind !== "concept" || !n.clusterId) return;
      (byCluster.get(n.clusterId) ?? byCluster.set(n.clusterId, []).get(n.clusterId)!).push(b.points.local[i * 3 + 1]);
    });
    const means = [...byCluster.values()].map((ys) => ys.reduce((s, y) => s + y, 0) / ys.length);
    expect(Math.max(...means) - Math.min(...means)).toBeGreaterThan(0.2 * params.depth * b.courses[0].radius);
  });

  it("hides files and LOD'd concepts (alpha 0) and brightens heavy concepts", () => {
    const g = graphs.get("8.223")!;
    const b = buildBlobBuffers({ graphs, placements: [place()[0]], params });
    g.nodes.forEach((n, i) => {
      if (n.kind === "resource") expect(b.points.alpha[i]).toBe(0);
    });
    const lod = buildBlobBuffers({ graphs, placements: [place()[0]], params: { ...params, nodeWeight: 0.8 } });
    expect(lod.courses[0].visible).toBeLessThan(b.courses[0].visible);
    expect(lod.courses[0].visible).toBe(g.nodes.filter((n) => n.kind === "concept" && n.weight >= 0.8).length);
  });

  it("tumbles once per 90 .. 180 s about a unit axis, seeded per course", () => {
    for (const id of ["8.223", "18.06", "x"]) {
      const t = tumbleFor(courseRng(5, id));
      expect(Math.hypot(...t.axis)).toBeCloseTo(1, 9);
      const period = (Math.PI * 2) / Math.abs(t.omega);
      expect(period).toBeGreaterThanOrEqual(90);
      expect(period).toBeLessThanOrEqual(180);
    }
    const p = rotateAxis([1, 0, 0], [0, 1, 0], Math.PI / 2);
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[2]).toBeCloseTo(-1, 9);
    const q = rotateAxis([0.3, 0.4, 0.5], [0.6, 0.8, 0], 1.23);
    expect(Math.hypot(...q)).toBeCloseTo(Math.hypot(0.3, 0.4, 0.5), 9);
  });

  it("threads: n strongest concept edges, cluster bridges first; one line draw when any are written", () => {
    const g = graphs.get("8.223")!;
    const t = pickThreads(g, 4);
    expect(t).toHaveLength(4);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    for (const l of t) {
      expect(byId.get(l.source)!.kind).toBe("concept");
      expect(byId.get(l.target)!.kind).toBe("concept");
    }
    const bridges = t.filter((l) => byId.get(l.source)!.clusterId !== byId.get(l.target)!.clusterId).length;
    expect(bridges).toBeGreaterThan(0);
    expect(pickThreads(g, 0)).toHaveLength(0);
    const b = buildBlobBuffers({ graphs, placements: place(), params: { ...params, threads: 3 } });
    expect(b.threads.count).toBe(6);
    expect(b.budget.draws).toBe(2);
  });

  it("placementsFromBeads scales the bead radius and carries the condense of the current course", () => {
    const spec = generateGalaxySpec(1);
    const layout = generateGalaxyLayout({ courses: COURSES.slice(0, 8), currentCourseId: "8.223", seed: 1, geometry: armsFromSpec(spec) });
    const p = placementsFromBeads(layout.beads, 1.4, (b) => (b.kind === "current" ? 0.5 : 0));
    expect(p).toHaveLength(layout.beads.length);
    const cur = p.find((x) => x.current)!;
    expect(cur.condense).toBe(0.5);
    expect(cur.radius).toBeCloseTo(layout.current!.radius * 1.4, 9);
    expect(p.filter((x) => !x.current).every((x) => x.condense === 0)).toBe(true);
  });

  it("a stand-in swapping to the real layout writes both (outgoing first, gen 0), the current graph's stars unchanged, and the crossfade is a 300 ms smoothstep", () => {
    const standIn = standInGraph("8.223", 64);
    const before = buildBlobBuffers({ graphs: new Map([["8.223", standIn]]), placements: [place()[0]], params });
    const real = graphs.get("8.223")!;
    const swap = buildBlobBuffers({ graphs: new Map([["8.223", real]]), placements: [place()[0]], params, outgoing: new Map([["8.223", standIn]]) });
    const after = buildBlobBuffers({ graphs: new Map([["8.223", real]]), placements: [place()[0]], params });
    expect(swap.points.count).toBe(standIn.nodes.length + real.nodes.length);
    expect(swap.courses[0].swapping).toBe(true);
    expect(swap.courses[0].visible).toBe(after.courses[0].visible);
    // The outgoing stand-in keeps the exact positions it had while current; the real one lands where it will stay.
    const n0 = standIn.nodes.length;
    expect(swap.points.local.slice(0, n0 * 3)).toEqual(before.points.local.slice(0, n0 * 3));
    expect(swap.points.gen.slice(0, n0).every((g) => g === 0)).toBe(true);
    expect(swap.points.local.slice(n0 * 3)).toEqual(after.points.local);
    expect(swap.points.gen.slice(n0).every((g) => g === 1)).toBe(true);
    expect(after.courses[0].swapping).toBe(false);
    expect(swapMixAt(1000, 1000)).toBe(0);
    expect(swapMixAt(1000, 1000 + BLOB_SWAP_MS / 2)).toBeCloseTo(0.5, 9);
    expect(swapMixAt(1000, 1000 + BLOB_SWAP_MS)).toBe(1);
    expect(swapMixAt(1000, 5000)).toBe(1);
    // C1 at both ends: no pop at the start or the end of the swap.
    expect(swapMixAt(1000, 1003)).toBeLessThan(0.001);
    expect(swapMixAt(1000, 1000 + BLOB_SWAP_MS - 3)).toBeGreaterThan(0.999);
  });
});

describe("cellsPerUnitAt (the stage's cells per disc unit)", () => {
  it("the hero framing puts a 0.085 R bead at ~14 cells radius on a 450-cell-high target", () => {
    const C = cellsPerUnitAt(3.3, 40, 450);
    expect(0.085 * C).toBeGreaterThan(12);
    expect(0.085 * C).toBeLessThan(18);
  });
});
