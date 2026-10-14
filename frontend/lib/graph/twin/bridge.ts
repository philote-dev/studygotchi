/**
 * The shared constellation state between the layout owner and the renderer
 * (plan T-3 step 1; since gate 2, 2026-10-13, the WebGL twin is the one
 * renderer and `KnowledgeCanvas` only owns the layout).
 *
 * `KnowledgeCanvas` publishes here, each render, the ONE `Layout` it owns (the
 * d3 simulation and the positioned nodes), the model it was built from and the
 * props the workspace hands it (emphasis, route, selection, arrivals, weak
 * traces) plus the callbacks that reach the store. Every imperative camera
 * request the workspace makes through `CanvasHandle` (`fit`, `fitTo`, `focus`,
 * `zoomBy`, `onResize`) is also announced here. The twin subscribes: it draws
 * the positions, answers the requests with its camera and drives the store
 * actions. `layoutControl` is the layout owner's half of the QA controller
 * (`window.__constellation`, installed by the twin): settle, reseed, quiet.
 */

import type { Layout } from "@/lib/forceLayout";
import type { GraphModel } from "@/lib/graphModel";
import { layoutService, type LayoutService } from "@/lib/graph/worker/layout-service";

export interface ConstellationHoverInfo {
  id: string;
  screenX: number;
  screenY: number;
}

export interface ConstellationShared {
  layout: Layout;
  model: GraphModel;
  emphasis: Set<string> | null;
  routeIds: string[];
  selectedId: string | null;
  arrivingIds: string[];
  weakFlash: boolean;
  weakTraceIds: string[];
  onSelect: (id: string | null) => void;
  onHover: (info: ConstellationHoverInfo | null) => void;
}

export type ConstellationHandleCall =
  | { method: "fit"; duration?: number }
  | { method: "fitTo"; ids: string[]; duration?: number }
  | { method: "focus"; id: string; zoom?: number }
  | { method: "zoomBy"; factor: number }
  | { method: "onResize"; fn: (() => void) | null };

/**
 * The layout owner's QA hooks (development, or `?qa=1`): the capture harness
 * reseeds and settles the layout deterministically through these, via the
 * twin's `window.__constellation`.
 */
export interface LayoutControl {
  /** The layout has settled and stayed put for 800 ms. */
  ready: Promise<void>;
  /** No layout or model change for `quietMs`. */
  whenQuiet(quietMs?: number): Promise<void>;
  /** Settled, and no change for `quietMs`. */
  whenSettled(quietMs?: number): Promise<void>;
  /** Reseed and settle synchronously from the current model (captures only). */
  relayout(): void;
  /** The simulation's alpha is below its floor. */
  settled(): boolean;
}

export interface ConstellationBridge {
  /** The layout owner's current state, null while no constellation is mounted. */
  readonly state: ConstellationShared | null;
  /** Renderers subscribed right now (the twin while mounted). */
  readonly readers: number;
  /** How a fresh layout gets settled: cache, Worker (when a reader defers) or the synchronous fallback (T-4b). */
  readonly layouts: LayoutService;
  /** The layout owner's QA hooks while it is mounted and the harness is enabled. */
  layoutControl: LayoutControl | null;
  publish(state: ConstellationShared | null): void;
  subscribe(listener: (state: ConstellationShared | null) => void): () => void;
  /** A `CanvasHandle` request the workspace made of the 2D canvas. */
  call(call: ConstellationHandleCall): void;
  onCall(listener: (call: ConstellationHandleCall) => void): () => void;
}

export function createConstellationBridge(layouts: LayoutService = layoutService): ConstellationBridge {
  let state: ConstellationShared | null = null;
  const listeners = new Set<(state: ConstellationShared | null) => void>();
  const callListeners = new Set<(call: ConstellationHandleCall) => void>();
  return {
    layouts,
    layoutControl: null,
    get state() {
      return state;
    },
    get readers() {
      return listeners.size;
    },
    publish(next) {
      state = next;
      for (const listener of listeners) listener(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    call(call) {
      for (const listener of callListeners) listener(call);
    },
    onCall(listener) {
      callListeners.add(listener);
      return () => {
        callListeners.delete(listener);
      };
    },
  };
}

/** The app-wide bridge: one constellation at a time. */
export const constellationBridge: ConstellationBridge = createConstellationBridge();

declare global {
  interface Window {
    /** Development only: the bridge, for the QA scripts (layout settle outcomes, state). */
    __constellationBridge?: ConstellationBridge;
  }
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  window.__constellationBridge = constellationBridge;
}
