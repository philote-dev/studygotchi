import { describe, expect, it } from "vitest";
import { spacePalette } from "@/lib/graphTheme";
import { edgeDrawBudget } from "@/lib/space-field";
import { allocEdgeBuffers, buildDust, buildEdges, buildNodes, EDGE_INDICES, EDGE_VERTS, placeLabels } from "./buffers";
import { edgeStyle, nodeStyle, parseColor, starProfile } from "./style";
import { TWIN_IDLE_STATE, type TwinDrawState, type TwinLayout, type TwinLink, type TwinNode } from "./types";

const palette = spacePalette("dark");
const size = { w: 1440, h: 900 };

function concept(id: string, x: number, y: number, weight = 0.8, radius = 30, extra: Partial<TwinNode> = {}): TwinNode {
  return { id, kind: "concept", label: `Concept ${id}`, weight, radius, x, y, cluster: "A", clusterId: "a", constellation: "Alpha", mastery: 0.3, ...extra };
}
function resource(id: string, x: number, y: number, weight = 0.54): TwinNode {
  return { id, kind: "resource", label: `${id}.pdf`, weight, radius: 20, x, y };
}
function link(source: string, target: string, kind: "concept" | "resource" = "concept", directed = false): TwinLink {
  return { id: `${kind[0]}:${source}->${target}`, source, target, kind, directed, type: directed ? "PREREQUISITE_FOR" : "RELATED_TO" };
}

function layoutOf(nodes: TwinNode[], links: TwinLink[]): TwinLayout {
  const adjacency = new Map<string, Set<string>>();
  for (const l of links) {
    (adjacency.get(l.source) ?? adjacency.set(l.source, new Set()).get(l.source)!).add(l.target);
    (adjacency.get(l.target) ?? adjacency.set(l.target, new Set()).get(l.target)!).add(l.source);
  }
  const concepts = nodes.filter((n) => n.kind === "concept");
  const clusters = concepts.length
    ? [
        {
          id: "family:Alpha",
          label: "Alpha",
          x: concepts.reduce((s, n) => s + n.x, 0) / concepts.length,
          y: concepts.reduce((s, n) => s + n.y, 0) / concepts.length,
          count: concepts.length,
          mastery: 0.3,
        },
      ]
    : [];
  return { nodes, links, clusters, adjacency };
}

const nodes = [concept("a", 0, 0, 1, 35), concept("b", 100, 0, 0.9, 30), concept("c", 0, 100, 0.2, 20), resource("r1", 50, 50)];
const links = [link("a", "b", "concept", true), link("b", "c"), link("a", "r1", "resource")];
const layout = layoutOf(nodes, links);
const idle: TwinDrawState = { ...TWIN_IDLE_STATE };

describe("edge rules (KnowledgeCanvas edge branch)", () => {
  const ctx = (zoom: number, focus: ReadonlySet<string> | null = null) => ({
    zoom,
    focusSet: focus,
    routeEdges: new Set<string>(),
    weakTraces: new Set<string>(),
    palette,
  });

  it("zoomed out: backbone edges keep the lod alpha and width, resource edges fall away", () => {
    const strong = edgeStyle(links[0], nodes[0], nodes[1], ctx(0.31));
    expect(strong.keep).toBe(true);
    expect(strong.alpha).toBe(edgeDrawBudget(0.31).alpha); // 0.74
    expect(strong.width).toBe(edgeDrawBudget(0.31).width); // 0.95
    expect(strong.color).toBe(palette.edge);
    const weakLink = edgeStyle(links[1], nodes[1], nodes[2], ctx(0.31)); // weights 0.9 / 0.2 -> score 0.585 < 0.78
    expect(weakLink.keep).toBe(false);
    const res = edgeStyle(links[2], nodes[0], nodes[3], ctx(0.31));
    expect(res.keep).toBe(false);
  });

  it("zoomed in (k >= 1.45) every edge is kept; resource edges take the resource colour", () => {
    expect(edgeStyle(links[1], nodes[1], nodes[2], ctx(2)).keep).toBe(true);
    const res = edgeStyle(links[2], nodes[0], nodes[3], ctx(2));
    expect(res.keep).toBe(true);
    expect(res.color).toBe(palette.edgeResource);
    expect(res.alpha).toBe(0.88);
    expect(res.width).toBe(0.9);
  });

  it("a hover focus set lights its edges at 1 / 1.1 px and dims the rest to 0.08", () => {
    const focus = new Set(["a", "b"]);
    const lit = edgeStyle(links[0], nodes[0], nodes[1], ctx(0.31, focus));
    expect(lit.lit).toBe(true);
    expect(lit.alpha).toBe(1);
    expect(lit.width).toBe(1.1);
    expect(lit.color).toBe(palette.edgeStrong);
    const dim = edgeStyle(links[1], nodes[1], nodes[2], ctx(2, focus));
    expect(dim.alpha).toBe(0.08);
  });

  it("route edges are 1.4 px strong strokes and always kept", () => {
    const route = edgeStyle(links[1], nodes[1], nodes[2], { ...ctx(0.31), routeEdges: new Set(["b|c", "c|b"]) });
    expect(route.onRoute).toBe(true);
    expect(route.keep).toBe(true);
    expect(route.width).toBe(1.4);
    expect(route.alpha).toBe(1);
  });

  it("base edges are visible at Fit and lit / route edges still read brighter, in both themes", () => {
    for (const theme of ["dark", "light"] as const) {
      const pal = spacePalette(theme);
      const strokeAlpha = (css: string) => parseColor(css).a;
      // The lift: effective base alpha (stroke alpha x lod alpha) is at least 0.14 at Fit (was ~0.10-0.12).
      const base = edgeStyle(links[0], nodes[0], nodes[1], { ...ctx(0.31), palette: pal });
      const baseEffective = strokeAlpha(base.color) * base.alpha;
      expect(baseEffective).toBeGreaterThanOrEqual(0.14);
      // Capped so the lit / route stroke has headroom to stand out.
      expect(strokeAlpha(pal.edge)).toBeLessThanOrEqual(0.3);
      expect(strokeAlpha(pal.edgeResource)).toBeLessThan(strokeAlpha(pal.edge));
      expect(strokeAlpha(pal.edgeStrong)).toBeLessThanOrEqual(0.85);
      const lit = edgeStyle(links[0], nodes[0], nodes[1], { ...ctx(0.31, new Set(["a", "b"])), palette: pal });
      const litEffective = strokeAlpha(lit.color) * lit.alpha;
      expect(litEffective).toBeGreaterThan(baseEffective * 3);
      // Widths are untouched by the lift.
      expect(base.width).toBe(edgeDrawBudget(0.31).width);
      expect(lit.width).toBe(1.1);
    }
  });

  it("weak traces are flagged only while the weak lens lists them", () => {
    const marked = edgeStyle(links[1], nodes[1], nodes[2], { ...ctx(0.31), weakTraces: new Set([links[1].id]) });
    expect(marked.weak).toBe(true);
    expect(edgeStyle(links[1], nodes[1], nodes[2], ctx(0.31)).weak).toBe(false);
  });
});

describe("node rules", () => {
  it("hides resources in the cluster layer unless selected or on the route", () => {
    const base = { zoom: 0.31, layer: "clusters" as const, focusSet: null, selectedId: null, routeSet: new Set<string>(), arrivingAgeMs: new Map() };
    expect(nodeStyle(nodes[3], base).hidden).toBe(true);
    expect(nodeStyle(nodes[3], { ...base, selectedId: "r1" }).hidden).toBe(false);
    expect(nodeStyle(nodes[3], { ...base, layer: "nodes" }).hidden).toBe(false);
    expect(nodeStyle(nodes[0], base).hidden).toBe(false);
  });

  it("selected and route nodes are active (1.22 glow); arriving nodes pop on the 520 ms curve", () => {
    const base = { zoom: 1, layer: "nodes" as const, focusSet: null, selectedId: null, routeSet: new Set<string>(), arrivingAgeMs: new Map() };
    expect(nodeStyle(nodes[0], base).active).toBe(false);
    expect(nodeStyle(nodes[0], { ...base, selectedId: "a" }).active).toBe(true);
    const popping = nodeStyle(nodes[0], { ...base, arrivingAgeMs: new Map([["a", 0.4 * 520]]) });
    expect(popping.active).toBe(true);
    expect(popping.scale).toBeCloseTo(0.25 + (1 - Math.pow(0.6, 3)) * 1.05, 9); // 1.0732
    expect(nodeStyle(nodes[0], { ...base, arrivingAgeMs: new Map([["a", 5000]]) }).scale).toBe(1.3);
  });

  it("focus dims to 0.14", () => {
    const base = { zoom: 1, layer: "nodes" as const, focusSet: new Set(["b"]), selectedId: null, routeSet: new Set<string>(), arrivingAgeMs: new Map() };
    expect(nodeStyle(nodes[0], base).alpha).toBe(0.14);
    expect(nodeStyle(nodes[1], base).alpha).toBe(1);
  });

  it("starProfile floors the core at 1.15 px and gives rays only to big concept cores", () => {
    const small = starProfile("x", 18, "concept", 0.2);
    expect(small.core).toBeGreaterThanOrEqual(1.15);
    expect(small.rays).toBe(false);
    const big = starProfile("x", 43, "concept", 3);
    expect(big.rays).toBe(big.core > 3.8);
    expect(big.glow).toBeCloseTo(big.core * 6.2);
    expect(starProfile("x", 20, "resource", 1).glow).toBeCloseTo(starProfile("x", 20, "resource", 1).core * 4.4);
  });
});

describe("buffers", () => {
  it("node buffers carry one instance per layout node", () => {
    const b = buildNodes(layout, { x: 0, y: 0, k: 0.31 }, idle, palette);
    expect(b.count).toBe(nodes.length);
    expect(b.position.length).toBe(nodes.length * 2);
    expect(b.alpha[3]).toBe(0); // resource hidden in the cluster layer
    expect(b.alpha[0]).toBe(1);
    expect(b.glow[0]).toBeCloseTo(starProfile("a", 35, "concept", 0.31).glow);
    expect(b.starColor).toEqual([1, 246 / 255, 223 / 255]);
  });

  it("edge buffers hold every link; zoomed in, every link is drawn", () => {
    const out = allocEdgeBuffers(layout.links.length);
    expect(out.capacity).toBe(links.length);
    expect(out.index.length).toBe(links.length * EDGE_INDICES);
    buildEdges(layout, { x: 50, y: 50, k: 2 }, size, idle, palette, out);
    expect(out.count).toBe(links.length);
    // Every vertex of the first edge has the lod colour and half width.
    const edge = parseColor(palette.edge);
    for (let v = 0; v < EDGE_VERTS; v += 1) {
      expect(out.color[v * 4 + 3]).toBeCloseTo(edge.a * 0.88, 6);
      expect(out.half[v]).toBeCloseTo(0.45);
      expect(Math.abs(out.side[v])).toBe(1);
    }
    // Arc length grows monotonically along the strip and is about the chord minus the insets.
    expect(out.along[0]).toBe(0);
    const last = out.along[EDGE_VERTS - 1];
    const inset = starProfile("a", 35, "concept", 2).core + 1 + starProfile("b", 30, "concept", 2).core + 1;
    expect(last).toBeGreaterThan(100 * 2 - inset - 1);
    expect(last).toBeLessThan(100 * 2 - inset + 8);
  });

  it("zoomed out only the backbone is packed, in link order", () => {
    const out = allocEdgeBuffers(layout.links.length);
    buildEdges(layout, { x: 50, y: 50, k: 0.31 }, size, idle, palette, out);
    expect(out.count).toBe(1);
    expect(out.color[3]).toBeCloseTo(parseColor(palette.edge).a * 0.74, 6);
    expect(out.half[0]).toBeCloseTo(0.475);
  });

  it("edge endpoints are inset by core + 1 px along the chord, in world units", () => {
    const cam = { x: 50, y: 50, k: 2 };
    const out = allocEdgeBuffers(1);
    buildEdges(layoutOf([nodes[0], nodes[1]], [links[0]]), cam, size, idle, palette, out);
    const insetA = (starProfile("a", 35, "concept", 2).core + 1) / cam.k;
    expect(out.position[0]).toBeCloseTo(insetA, 5); // first sample x, world
    expect(out.position[1]).toBeCloseTo(0, 5);
    // normals are unit length; at the curve's midpoint the tangent is the chord, so the normal is vertical
    for (let v = 0; v < EDGE_VERTS; v += 1) expect(Math.hypot(out.normal[v * 2], out.normal[v * 2 + 1])).toBeCloseTo(1, 5);
    const mid = Math.floor(EDGE_VERTS / 2) - 1; // sample 6 of 13, left side
    expect(Math.abs(out.normal[mid * 2 + 1])).toBeCloseTo(1, 3);
  });

  it("dust: one gradient per cluster with the 2D radius rule and tint", () => {
    const d = buildDust(layout, { x: 0, y: 0, k: 0.31 }, palette);
    expect(d.count).toBe(1);
    expect(d.radius[0]).toBeCloseTo(58 + Math.sqrt(3) * 30 * 0.55);
    expect(d.color[3]).toBeCloseTo(0.34, 6); // dark core alpha
    const red = parseColor(palette.nebula[1]);
    expect(d.color[0]).toBeCloseTo(red.r / 255);
    expect(buildDust(layout, { x: 0, y: 0, k: 0.31 }, spacePalette("light")).color[3]).toBeCloseTo(0.22, 6);
  });
});

describe("labels", () => {
  const faces = { display: "Display", ui: "UI" };
  const measure = (text: string, font: string) => text.length * (font.startsWith("700") ? 7 : 6);

  it("cluster layer: cluster names centred 18 px above the centroid, 12 px below k 0.55, nothing for nodes", () => {
    const cam = { x: 33, y: layout.clusters[0].y, k: 0.31 };
    const { labels, clusterBoxes } = placeLabels(layout, cam, size, idle, palette, faces, measure);
    expect(labels).toHaveLength(1);
    const l = labels[0];
    expect(l.kind).toBe("cluster");
    expect(l.align).toBe("center");
    expect(l.size).toBe(12);
    expect(l.font).toBe("700 12px Display");
    expect(l.color).toBe(palette.labelStrong);
    expect(l.y).toBeCloseTo(450 - 18);
    expect(l.x).toBeCloseTo(720 + (layout.clusters[0].x - 33) * 0.31);
    expect(clusterBoxes[0].x1 - clusterBoxes[0].x0).toBeCloseTo(l.width + 6 + 20);
  });

  it("cluster layer at k > 0.55 uses 13 px and skips a colliding second cluster", () => {
    const two: TwinLayout = { ...layout, clusters: [layout.clusters[0], { ...layout.clusters[0], id: "family:Beta", label: "Beta", x: layout.clusters[0].x + 1 }] };
    const { labels } = placeLabels(two, { x: 33, y: 33, k: 0.7 }, size, idle, palette, faces, measure);
    expect(labels).toHaveLength(1);
    expect(labels[0].size).toBe(13);
  });

  it("node layer: concept names by weight threshold, resources only from k 1.25, forced labels win collisions", () => {
    const cam = { x: 50, y: 50, k: 1.2 };
    const { labels } = placeLabels(layout, cam, size, idle, palette, faces, measure);
    // threshold 0.35 at k 1.2: a (1), b (0.9) pass, c (0.2) fails, resource r1 skipped below 1.25
    expect(labels.map((l) => l.id).sort()).toEqual(["a", "b"]);
    const a = labels.find((l) => l.id === "a")!;
    expect(a.font).toBe("500 11.5px UI");
    expect(a.align).toBe("left");
    expect(a.x).toBeCloseTo(720 + (0 - 50) * 1.2 + starProfile("a", 35, "concept", 1.2).glow * 0.56 + 5);
    expect(a.y).toBeCloseTo(450 + (0 - 50) * 1.2 + 1);
    const atTwo = placeLabels(layout, { x: 50, y: 50, k: 2 }, size, idle, palette, faces, measure);
    expect(atTwo.labels.map((l) => l.id).sort()).toEqual(["a", "b", "c", "r1"]);
    expect(atTwo.labels.find((l) => l.id === "r1")!.size).toBe(10.5);
    expect(atTwo.labels.find((l) => l.id === "r1")!.color).toBe(palette.labelDim);
  });

  it("forced (selected) labels are 600 weight, strong colour and placed even in the cluster layer", () => {
    const { labels } = placeLabels(layout, { x: 33, y: 33, k: 0.31 }, size, { ...idle, selectedId: "c" }, palette, faces, measure);
    const c = labels.find((l) => l.id === "c")!;
    expect(c.weight).toBe(600);
    expect(c.color).toBe(palette.labelStrong);
    expect(c.text).toBe("Concept c");
  });
});
