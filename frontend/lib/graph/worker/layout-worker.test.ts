import { describe, expect, it, vi } from "vitest";
import { createLayout, settle } from "@/lib/forceLayout";
import type { GraphModel, GraphModelNode } from "@/lib/graphModel";
import { settlePositions, type SettleRequest, type SettleResponse } from "./forceLayout.worker";
import { createLayoutCache, decodePositions, encodePositions, LAYOUT_CACHE_PREFIX, type StorageLike } from "./layout-cache";
import { layoutHash } from "./layout-hash";
import { applyPositions, createLayoutService, layoutInputs, readPositions } from "./layout-service";

function node(id: string, radius: number, label: string): GraphModelNode {
  return { id, kind: "concept", label, radius, weight: 0.5, concept: { id, cluster: "A" } } as unknown as GraphModelNode;
}

function model(seed = 0): GraphModel {
  const nodes = Array.from({ length: 24 }, (_, i) => node(`n${seed}-${i}`, 18 + (i % 5) * 4, `Concept ${i} ${"x".repeat(i % 7)}`));
  const links = nodes.slice(1).map((n, i) => ({
    id: `c:${nodes[Math.floor(i / 2)].id}->${n.id}`,
    source: nodes[Math.floor(i / 2)].id,
    target: n.id,
    type: "RELATED",
    kind: "concept" as const,
    directed: false,
    origin: "course" as const,
  }));
  return { nodes, links, byId: new Map(nodes.map((n) => [n.id, n])), adjacency: new Map(), incident: new Map() };
}

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe("layout hash", () => {
  it("depends on order, radius, label length and links", () => {
    const m = model();
    const a = layoutHash(layoutInputs(m));
    expect(layoutHash(layoutInputs(m))).toBe(a);
    const reordered = { ...m, nodes: [...m.nodes].reverse() };
    expect(layoutHash(layoutInputs(reordered))).not.toBe(a);
    const fatter = { ...m, nodes: m.nodes.map((n, i) => (i === 3 ? { ...n, radius: n.radius + 1 } : n)) };
    expect(layoutHash(layoutInputs(fatter))).not.toBe(a);
    const fewerLinks = { ...m, links: m.links.slice(1) };
    expect(layoutHash(layoutInputs(fewerLinks))).not.toBe(a);
  });
});

describe("worker settle", () => {
  it("settlePositions equals createLayout + settle on the main thread, bit for bit", () => {
    const m = model();
    const reference = createLayout(m);
    settle(reference);
    const positions = settlePositions(layoutInputs(m));
    expect(positions.length).toBe(m.nodes.length * 2);
    reference.nodes.forEach((n, i) => {
      expect(positions[i * 2]).toBe(n.x);
      expect(positions[i * 2 + 1]).toBe(n.y);
    });
  });

  it("applyPositions leaves the layout settled (stopped, alpha 0) at the given positions", () => {
    const m = model();
    const layout = createLayout(m);
    const positions = settlePositions(layoutInputs(m));
    applyPositions(layout, positions);
    expect(layout.simulation.alpha()).toBe(0);
    expect(readPositions(layout)).toEqual(positions);
  });
});

describe("layout cache", () => {
  it("round-trips through base64 and sessionStorage, index oldest first", () => {
    const storage = memoryStorage();
    const cache = createLayoutCache(storage);
    const p = new Float64Array([1.5, -2.25, 1e-9, 1234.5678]);
    expect(decodePositions(encodePositions(p))).toEqual(p);
    cache.set("h1", p);
    cache.set("h2", new Float64Array([1, 2]));
    expect(cache.keys()).toEqual(["h1", "h2"]);
    const fresh = createLayoutCache(storage); // a new tab-session view of the same storage
    expect(fresh.get("h1")).toEqual(p);
    expect(fresh.get("missing")).toBeNull();
    expect(storage.map.has(LAYOUT_CACHE_PREFIX + "h1")).toBe(true);
  });

  it("evicts the oldest entries past the byte cap", () => {
    const storage = memoryStorage();
    const cache = createLayoutCache(storage, 200);
    for (let i = 0; i < 6; i += 1) cache.set(`h${i}`, new Float64Array(8)); // 64 bytes -> 88 chars each
    expect(cache.keys().length).toBeLessThan(6);
    expect(cache.keys().at(-1)).toBe("h5");
    expect(storage.map.has(LAYOUT_CACHE_PREFIX + "h0")).toBe(false);
    expect(cache.get("h5")).not.toBeNull();
  });

  it("works without storage (SSR)", () => {
    const cache = createLayoutCache(null);
    cache.set("h", new Float64Array([1]));
    expect(cache.get("h")).toEqual(new Float64Array([1]));
    expect(cache.keys()).toEqual([]);
  });
});

describe("layout service", () => {
  it("sync path when nothing defers: settles like before and remembers; the next identical model hits the cache", () => {
    const service = createLayoutService({ cache: createLayoutCache(null), createWorker: null });
    const m = model();
    const first = createLayout(m);
    const outcome = service.settle(first, m);
    expect(outcome.path).toBe("sync");
    const reference = createLayout(m);
    settle(reference);
    expect(readPositions(first)).toEqual(readPositions(reference));
    const second = createLayout(m);
    expect(service.settle(second, m).path).toBe("cache");
    expect(readPositions(second)).toEqual(readPositions(first));
    expect(second.simulation.alpha()).toBe(0);
  });

  it("falls back to sync when defer is set but no Worker exists", () => {
    const service = createLayoutService({ cache: createLayoutCache(null), createWorker: null });
    service.defer = true;
    const m = model(1);
    expect(service.settle(createLayout(m), m).path).toBe("sync");
  });

  it("worker path: stops the simulation, marks pending, applies the posted positions and notifies", () => {
    const posted: SettleRequest[] = [];
    const fake = { postMessage: vi.fn((r: SettleRequest) => posted.push(r)), onmessage: null as ((e: MessageEvent<SettleResponse>) => void) | null, onerror: null };
    const service = createLayoutService({ cache: createLayoutCache(null), createWorker: () => fake as unknown as Worker });
    service.defer = true;
    const m = model(2);
    const layout = createLayout(m);
    const outcome = service.settle(layout, m);
    expect(outcome.path).toBe("worker");
    expect(service.pending.has(outcome.hash)).toBe(true);
    expect(service.isPending(layout)).toBe(true);
    expect(posted[0].nodes.length).toBe(m.nodes.length);
    const settled = vi.fn();
    service.onSettled(settled);
    const positions = settlePositions(posted[0]);
    fake.onmessage!({ data: { type: "settled", hash: outcome.hash, positions, ms: 7 } } as MessageEvent<SettleResponse>);
    expect(service.pending.size).toBe(0);
    expect(readPositions(layout)).toEqual(positions);
    expect(layout.simulation.alpha()).toBe(0);
    expect(settled).toHaveBeenCalledWith(layout, outcome.hash, 7);
    // Remembered: the same model is now a cache hit, even without deferring.
    service.defer = false;
    expect(service.settle(createLayout(m), m).path).toBe("cache");
  });
});
