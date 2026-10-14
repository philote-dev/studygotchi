/**
 * One frame of twin input, as `TwinRuntime.frame()` builds it from the shared
 * bridge (lib/graph/twin/bridge.ts): the 2D canvas's layout and props plus the
 * twin's own camera, hover, clocks. `frameChanged` is the dirty check that
 * keeps the GPU buffers and the DOM labels still while nothing moved.
 */

import type { SpaceLabelLayer } from "@/lib/constellationLabels";
import type { Camera2D, TwinDrawState, TwinLayout, TwinSize } from "@/lib/graph/twin/types";

export interface TwinSourceFrame {
  cam: Camera2D;
  size: TwinSize;
  layout: TwinLayout & { clusterMembers: ReadonlyMap<string, readonly string[]> };
  state: TwinDrawState;
  graphHash: string;
  /** Something is time-driven this frame (arrival pops, weak traces): redraw every frame. */
  animating: boolean;
  /** The weak-lens pulse, 1 -> 0 over 1600 ms (0 at rest). */
  weakPulse: number;
  weakPulseAgeMs: number | null;
  labelLayer: SpaceLabelLayer;
}

/**
 * True when a frame would draw differently from `prev`: camera, box, theme,
 * graph, any node position, or the interaction state. Time only matters while
 * something is animating, which keeps the frame dirty.
 */
export function frameChanged(prev: TwinSourceFrame | null, next: TwinSourceFrame): boolean {
  if (!prev) return true;
  if (next.animating) return true;
  if (prev.cam.x !== next.cam.x || prev.cam.y !== next.cam.y || prev.cam.k !== next.cam.k) return true;
  if (prev.size.w !== next.size.w || prev.size.h !== next.size.h) return true;
  if (prev.graphHash !== next.graphHash) return true;
  // The runtime hands out fresh node objects only when a position moved.
  if (prev.layout.nodes !== next.layout.nodes) return true;
  if (prev.layout.links !== next.layout.links) return true;
  if (prev.layout.clusters.length !== next.layout.clusters.length) return true;
  const s = prev.state;
  const t = next.state;
  if (s.theme !== t.theme || s.selectedId !== t.selectedId || s.hoveredId !== t.hoveredId) return true;
  if (s.emphasis !== t.emphasis) return true;
  if (s.routeIds !== t.routeIds && s.routeIds.join("|") !== t.routeIds.join("|")) return true;
  if (s.weakTraceIds !== t.weakTraceIds) return true;
  if (s.arrivingAgeMs.size !== t.arrivingAgeMs.size) return true;
  if (prev.weakPulse !== next.weakPulse) return true;
  if ((s.condense?.t ?? 0) !== (t.condense?.t ?? 0)) return true;
  return false;
}
