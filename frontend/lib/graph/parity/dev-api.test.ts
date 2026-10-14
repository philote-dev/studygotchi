import { describe, expect, it } from "vitest";
import { graphHash, pickAnchors, pickRoute, qaEnabled } from "./dev-api";

const nodes = [
  { id: "c-a", kind: "concept" as const, weight: 0.9 },
  { id: "c-b", kind: "concept" as const, weight: 0.9 },
  { id: "c-c", kind: "concept" as const, weight: 0.6 },
  { id: "c-d", kind: "concept" as const, weight: 0.4 },
  { id: "r-1", kind: "resource" as const, weight: 0.99 },
];

function adjacencyOf(pairs: [string, string][]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }
  return adjacency;
}

describe("qaEnabled", () => {
  it("is on outside production builds", () => {
    expect(qaEnabled("", "development")).toBe(true);
    expect(qaEnabled("", "test")).toBe(true);
  });

  it("needs ?qa=1 in production", () => {
    expect(qaEnabled("", "production")).toBe(false);
    expect(qaEnabled("?qa=1", "production")).toBe(true);
    expect(qaEnabled("?land=8.223&qa=1", "production")).toBe(true);
    expect(qaEnabled("?qa=0", "production")).toBe(false);
  });
});

describe("pickAnchors", () => {
  it("takes the two heaviest concepts, ties broken by id, never a resource", () => {
    expect(pickAnchors(nodes)).toEqual({ hover: "c-a", select: "c-b" });
  });

  it("does not depend on node order", () => {
    expect(pickAnchors([...nodes].reverse())).toEqual(pickAnchors(nodes));
  });

  it("falls back to the same node when only one concept exists", () => {
    expect(pickAnchors([nodes[2], nodes[4]])).toEqual({ hover: "c-c", select: "c-c" });
  });

  it("returns nulls for an empty graph", () => {
    expect(pickAnchors([])).toEqual({ hover: null, select: null });
  });
});

describe("pickRoute", () => {
  const adjacency = adjacencyOf([
    ["c-a", "c-c"],
    ["c-a", "r-1"],
    ["c-c", "c-d"],
    ["c-d", "c-b"],
    ["c-b", "c-a"],
  ]);

  it("walks consecutive linked concepts starting at the hover anchor", () => {
    const route = pickRoute(nodes, adjacency, 4);
    expect(route[0]).toBe("c-a");
    expect(route).toHaveLength(4);
    expect(new Set(route).size).toBe(4);
    for (let i = 0; i < route.length - 1; i += 1) {
      expect(adjacency.get(route[i])?.has(route[i + 1])).toBe(true);
    }
    expect(route.some((id) => id.startsWith("r-"))).toBe(false);
  });

  it("prefers the heavier neighbour so the walk is deterministic", () => {
    // From c-a the concept neighbours are c-c (0.6) and c-b (0.9): c-b wins.
    expect(pickRoute(nodes, adjacency, 2)).toEqual(["c-a", "c-b"]);
  });

  it("stops when no unvisited concept neighbour is left", () => {
    const line = adjacencyOf([["c-a", "c-c"]]);
    expect(pickRoute(nodes, line, 6)).toEqual(["c-a", "c-c"]);
  });

  it("is independent of node order", () => {
    expect(pickRoute([...nodes].reverse(), adjacency, 4)).toEqual(pickRoute(nodes, adjacency, 4));
  });
});

describe("graphHash", () => {
  it("is stable under ordering and changes with content", () => {
    const a = graphHash(["n1", "n2"], ["l1"]);
    expect(graphHash(["n2", "n1"], ["l1"])).toBe(a);
    expect(graphHash(["n1", "n2"], ["l2"])).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
});
