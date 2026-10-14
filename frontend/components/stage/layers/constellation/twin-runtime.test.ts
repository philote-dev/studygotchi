import { describe, expect, it, vi } from "vitest";
import { createConstellationBridge, type ConstellationShared } from "@/lib/graph/twin/bridge";
import { screenFromWorld } from "@/lib/graph/twin/camera";
import { fitTarget, FIT_CLUSTER_ZOOM } from "@/lib/graph/twin/twin-camera";
import { pickRadius } from "@/lib/graph/twin/twin-hit";
import type { Layout, PositionedNode } from "@/lib/forceLayout";
import type { GraphModel, GraphModelNode } from "@/lib/graphModel";
import { TwinRuntime } from "./twin-runtime";

vi.mock("@/lib/audio/events", () => ({ emit: vi.fn() }));

function conceptNode(id: string, radius = 30, weight = 1): GraphModelNode {
  return {
    id,
    kind: "concept",
    label: `Concept ${id}`,
    radius,
    weight,
    concept: { id, cluster: "A", cluster_id: "a", constellation: "Alpha", mastery: 0.3 },
  } as unknown as GraphModelNode;
}

function fixture(): { shared: ConstellationShared; sim: { alphaTarget: ReturnType<typeof vi.fn>; alpha: ReturnType<typeof vi.fn>; restart: ReturnType<typeof vi.fn> } } {
  const nodes: GraphModelNode[] = [conceptNode("a"), conceptNode("b", 20, 0.5), conceptNode("c", 25, 0.8)];
  const positioned: PositionedNode[] = [
    { id: "a", node: nodes[0], x: 0, y: 0 },
    { id: "b", node: nodes[1], x: 200, y: 0 },
    { id: "c", node: nodes[2], x: 0, y: 200 },
  ];
  const sim = { alphaTarget: vi.fn(), alpha: vi.fn(), restart: vi.fn() };
  sim.alphaTarget.mockReturnValue(sim);
  sim.alpha.mockReturnValue(sim);
  const links = [
    { id: "l1", source: "a", target: "b", kind: "concept" as const, directed: false, type: "RELATED", origin: "course" as const },
    { id: "l2", source: "b", target: "c", kind: "concept" as const, directed: true, type: "PREREQUISITE_FOR", origin: "course" as const },
  ];
  const model: GraphModel = {
    nodes,
    links,
    byId: new Map(nodes.map((n) => [n.id, n])),
    adjacency: new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a", "c"])],
      ["c", new Set(["b"])],
    ]),
    incident: new Map(),
  };
  const layout = { nodes: positioned, links: [], simulation: sim } as unknown as Layout;
  return {
    sim,
    shared: { layout, model, emphasis: null, routeIds: [], selectedId: null, arrivingIds: [], weakFlash: false, weakTraceIds: [], onSelect: vi.fn(), onHover: vi.fn() },
  };
}

function runtimeWith(shared: ConstellationShared) {
  const bridge = createConstellationBridge();
  let now = 1000;
  const timers: { fn: () => void; ms: number }[] = [];
  const runtime = new TwinRuntime({
    bridge,
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
  });
  runtime.resize({ w: 1440, h: 900 });
  runtime.start();
  bridge.publish(shared);
  return { runtime, bridge, timers, tick: (ms: number) => (now += ms), flush: () => timers.splice(0).forEach((t) => t.fn()) };
}

const size = { w: 1440, h: 900 };

describe("TwinRuntime", () => {
  it("mirrors the shared layout and fits the whole sky 30 ms after the first layout (instant)", () => {
    const { shared } = fixture();
    const { runtime, timers, flush } = runtimeWith(shared);
    expect(runtime.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(timers[0].ms).toBe(30);
    flush();
    const want = fitTarget(runtime.nodes, size, FIT_CLUSTER_ZOOM)!;
    expect(runtime.camera.cam).toEqual(want);
    expect(runtime.camera.tween).toBeNull();
  });

  it("a later layout eases to the new bounds over 900 ms after 240 ms", () => {
    const { shared } = fixture();
    const { runtime, bridge, timers, flush } = runtimeWith(shared);
    flush();
    const next = fixture().shared;
    bridge.publish(next);
    expect(timers.at(-1)!.ms).toBe(240);
    flush();
    expect(runtime.camera.tween?.duration).toBe(900);
  });

  it("answers the workspace's CanvasHandle calls with its own camera", () => {
    const { shared } = fixture();
    const { runtime, bridge, flush } = runtimeWith(shared);
    flush();
    bridge.call({ method: "zoomBy", factor: 1.35 });
    expect(runtime.camera.tween?.target.k).toBeCloseTo(runtime.camera.cam.k * 1.35);
    expect(runtime.camera.tween?.duration).toBe(180);
    bridge.call({ method: "focus", id: "b", zoom: 1.35 });
    expect(runtime.camera.tween?.target).toEqual({ x: 200, y: 0, k: 1.35 });
    bridge.call({ method: "fitTo", ids: ["a", "b"] });
    expect(runtime.camera.tween?.duration).toBe(420);
    const onResize = vi.fn();
    bridge.call({ method: "onResize", fn: onResize });
    runtime.resize({ w: 1200, h: 900 });
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it("frames carry the twin's camera, the shared props and fresh node arrays only when positions move", () => {
    const { shared } = fixture();
    const { runtime, flush } = runtimeWith(shared);
    flush();
    const f1 = runtime.frame()!;
    const f2 = runtime.frame()!;
    expect(f2.layout.nodes).toBe(f1.layout.nodes);
    shared.layout.nodes[1].x = 210;
    const f3 = runtime.frame()!;
    expect(f3.layout.nodes).not.toBe(f1.layout.nodes);
    expect(f3.layout.nodes[1].x).toBe(210);
    expect(f3.layout.links).toHaveLength(2);
    expect(f3.layout.links[1].directed).toBe(true);
    expect(f3.layout.clusters).toHaveLength(1);
    expect(f3.state.selectedId).toBeNull();
    expect(f3.animating).toBe(false);
  });

  it("hover: the real pointer path picks with the 2D radius rule, reports to the workspace and emits", () => {
    const { shared } = fixture();
    const { runtime, flush } = runtimeWith(shared);
    flush();
    runtime.setCamera({ x: 0, y: 0, k: 2 });
    const { sx, sy } = screenFromWorld(runtime.camera.cam, size, 0, 0);
    runtime.pointerMove({ clientX: sx, clientY: sy, pointerId: 1 });
    expect(runtime.hovered).toBe("a");
    expect(runtime.cursor).toBe("pointer");
    expect(shared.onHover).toHaveBeenLastCalledWith({ id: "a", screenX: sx, screenY: sy });
    expect(runtime.frame()!.state.hoveredId).toBe("a");
    const r = pickRadius({ id: "a", kind: "concept", radius: 30, x: 0, y: 0 }, 2);
    runtime.pointerMove({ clientX: sx + r + 1, clientY: sy, pointerId: 1 });
    expect(runtime.hovered).toBeNull();
    expect(shared.onHover).toHaveBeenLastCalledWith(null);
    expect(runtime.cursor).toBe("grab");
  });

  it("click selects through the workspace callback; drag pans without selecting", () => {
    const { shared, sim } = fixture();
    const { runtime, flush } = runtimeWith(shared);
    flush();
    runtime.setCamera({ x: 0, y: 0, k: 2 });
    const { sx, sy } = screenFromWorld(runtime.camera.cam, size, 0, 0);
    runtime.pointerDown({ clientX: sx, clientY: sy, pointerId: 1 });
    expect(sim.restart).toHaveBeenCalled(); // the handled star is pinned
    runtime.pointerUp({ clientX: sx, clientY: sy, pointerId: 1 });
    expect(shared.onSelect).toHaveBeenCalledWith("a");
    // Empty sky: pan.
    const before = { ...runtime.camera.cam };
    runtime.pointerDown({ clientX: 100, clientY: 100, pointerId: 1 });
    runtime.pointerMove({ clientX: 140, clientY: 110, pointerId: 1 });
    runtime.pointerUp({ clientX: 140, clientY: 110, pointerId: 1 });
    expect(runtime.camera.cam.x).toBeCloseTo(before.x - 40 / 2);
    expect(runtime.camera.cam.y).toBeCloseTo(before.y - 10 / 2);
    expect(shared.onSelect).toHaveBeenCalledTimes(1);
  });

  it("wheel zooms about the pointer; setCamera clamps", () => {
    const { shared } = fixture();
    const { runtime, flush } = runtimeWith(shared);
    flush();
    runtime.setCamera({ x: 0, y: 0, k: 1 });
    const world = { x: -100, y: 50 };
    const s = screenFromWorld(runtime.camera.cam, size, world.x, world.y);
    runtime.wheel({ clientX: s.sx, clientY: s.sy, deltaY: -200 });
    const after = screenFromWorld(runtime.camera.cam, size, world.x, world.y);
    expect(after.sx).toBeCloseTo(s.sx, 6);
    expect(after.sy).toBeCloseTo(s.sy, 6);
    runtime.setCamera({ x: 0, y: 0, k: 99 });
    expect(runtime.camera.cam.k).toBe(3.2);
  });

  it("arrivals pop for 640 ms and the weak pulse pins to the frozen clock", () => {
    const { shared } = fixture();
    const { runtime, bridge, flush, tick } = runtimeWith(shared);
    flush();
    bridge.publish({ ...shared, arrivingIds: ["b"], weakFlash: true, weakTraceIds: ["l2"] });
    let f = runtime.frame()!;
    expect(f.animating).toBe(true);
    expect(f.state.arrivingAgeMs.get("b")).toBe(0);
    expect(f.weakPulse).toBe(1);
    tick(2000);
    runtime.freezeTime(100000);
    f = runtime.frame()!;
    expect(f.state.now).toBe(100000);
    expect(f.state.arrivingAgeMs.get("b")).toBeCloseTo(0.4 * 520);
    expect(f.weakPulseAgeMs).toBe(1600);
    expect(f.weakPulse).toBe(0);
  });
});
