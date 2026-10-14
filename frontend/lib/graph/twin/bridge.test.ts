import { describe, expect, it, vi } from "vitest";
import { createConstellationBridge, type ConstellationShared } from "./bridge";

function shared(): ConstellationShared {
  return {
    layout: { nodes: [], links: [], simulation: {} as ConstellationShared["layout"]["simulation"] },
    model: { nodes: [], links: [], byId: new Map(), adjacency: new Map(), incident: new Map() },
    emphasis: null,
    routeIds: [],
    selectedId: null,
    arrivingIds: [],
    weakFlash: false,
    weakTraceIds: [],
    onSelect: () => {},
    onHover: () => {},
  };
}

describe("constellation bridge", () => {
  it("replays the current state to a new subscriber and fans out publishes", () => {
    const bridge = createConstellationBridge();
    const seen: (ConstellationShared | null)[] = [];
    bridge.subscribe((s) => seen.push(s));
    expect(seen).toEqual([null]);
    const s1 = shared();
    bridge.publish(s1);
    expect(bridge.state).toBe(s1);
    expect(seen[1]).toBe(s1);
    const late: (ConstellationShared | null)[] = [];
    const off = bridge.subscribe((s) => late.push(s));
    expect(late).toEqual([s1]);
    off();
    bridge.publish(null);
    expect(late).toHaveLength(1);
    expect(seen.at(-1)).toBeNull();
  });

  it("forwards CanvasHandle calls to listeners", () => {
    const bridge = createConstellationBridge();
    const calls = vi.fn();
    const off = bridge.onCall(calls);
    bridge.call({ method: "fit", duration: 0 });
    bridge.call({ method: "fitTo", ids: ["a"], duration: 420 });
    expect(calls).toHaveBeenCalledTimes(2);
    expect(calls).toHaveBeenLastCalledWith({ method: "fitTo", ids: ["a"], duration: 420 });
    off();
    bridge.call({ method: "zoomBy", factor: 1.35 });
    expect(calls).toHaveBeenCalledTimes(2);
  });
});
