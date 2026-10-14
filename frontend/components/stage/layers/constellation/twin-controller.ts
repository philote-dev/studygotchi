/**
 * The twin's per-frame brain: takes a `TwinSourceFrame`, rebuilds the render
 * buffers and the label placement when the frame changed, and tells the GL
 * layer and the DOM label layer. No React, no GL: the scene uploads what is
 * here, the label layer paints what is here.
 */

import {
  allocEdgeBuffers,
  buildDust,
  buildEdges,
  buildNodes,
  buildWeakEdges,
  placeLabels,
  weakDashOffset,
  type DustBuffers,
  type EdgeBuffers,
  type LabelPlacement,
  type NodeBuffers,
} from "@/lib/graph/twin/buffers";
import { paletteFor } from "@/lib/graph/twin/style";
import type { TwinSize } from "@/lib/graph/twin/types";
import type { SpacePalette } from "@/lib/graphTheme";
import { createTextMeasurer, labelFaces, type TextMeasurer } from "./twin-text";
import { frameChanged, type TwinSourceFrame } from "./twin-source";

export interface TwinFrameOutput {
  frame: TwinSourceFrame;
  palette: SpacePalette;
  dust: DustBuffers;
  nodes: NodeBuffers;
  edges: EdgeBuffers;
  /** Dashed weak traces (count 0 unless the weak lens lists some). */
  weakEdges: EdgeBuffers;
  weakDashOffset: number;
  labels: LabelPlacement;
  /** Monotonic: bumps whenever the buffers were rebuilt. */
  version: number;
}

export interface TwinController {
  /** Feed the latest frame; returns the output when it changed, null when nothing moved. */
  update(frame: TwinSourceFrame | null): TwinFrameOutput | null;
  readonly current: TwinFrameOutput | null;
  /** Subscribe to rebuilt outputs (the DOM label layer). */
  subscribe(listener: (output: TwinFrameOutput | null) => void): () => void;
  /** Fonts finished loading: re-measure and rebuild on the next update. */
  invalidate(): void;
  readonly measurer: TextMeasurer;
  readonly size: TwinSize | null;
}

export function createTwinController(): TwinController {
  const measurer = createTextMeasurer();
  const listeners = new Set<(output: TwinFrameOutput | null) => void>();
  let current: TwinFrameOutput | null = null;
  let edges: EdgeBuffers | null = null;
  let weakEdges: EdgeBuffers | null = null;
  let forced = true;
  let version = 0;

  const emit = (output: TwinFrameOutput | null) => {
    for (const listener of listeners) listener(output);
  };

  return {
    get current() {
      return current;
    },
    get measurer() {
      return measurer;
    },
    get size() {
      return current?.frame.size ?? null;
    },
    invalidate() {
      measurer.reset();
      forced = true;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => {
        listeners.delete(listener);
      };
    },
    update(frame) {
      if (!frame) {
        if (current) {
          current = null;
          emit(null);
        }
        return null;
      }
      if (!forced && current && !frameChanged(current.frame, frame)) return null;
      forced = false;
      const palette = paletteFor(frame.state.theme);
      const links = frame.layout.links.length;
      if (!edges || edges.capacity < links) edges = allocEdgeBuffers(links);
      if (!weakEdges || weakEdges.capacity < links) weakEdges = allocEdgeBuffers(links);
      const nodeIndex = new Map(frame.layout.nodes.map((n) => [n.id, n]));
      buildEdges(frame.layout, frame.cam, frame.size, frame.state, palette, edges, nodeIndex);
      buildWeakEdges(frame.layout, frame.cam, frame.size, frame.state, palette, frame.weakPulse, weakEdges, nodeIndex);
      version += 1;
      current = {
        frame,
        palette,
        dust: buildDust(frame.layout, frame.cam, palette, frame.state.condense?.dust ?? 1),
        nodes: buildNodes(frame.layout, frame.cam, frame.state, palette),
        edges,
        weakEdges,
        weakDashOffset: weakDashOffset(frame.state.now),
        labels: placeLabels(frame.layout, frame.cam, frame.size, frame.state, palette, labelFaces(), (text, font) => measurer.measure(text, font)),
        version,
      };
      emit(current);
      return current;
    },
  };
}
