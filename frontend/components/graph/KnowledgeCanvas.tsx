"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from "react";
import { createLayout, syncLayout, type Layout } from "@/lib/forceLayout";
import { qaEnabled } from "@/lib/graph/parity/dev-api";
import { constellationBridge, type LayoutControl } from "@/lib/graph/twin/bridge";
import type { GraphModel } from "@/lib/graphModel";

/**
 * The constellation's LAYOUT OWNER. Since gate 2 (2026-10-13) the WebGL twin
 * (`components/stage/layers/constellation`) is the one renderer of the
 * knowledge constellation, and the Canvas2D drawing path that lived here
 * (nebula dust, edges, stars, labels, hit testing, pan / zoom / drag) is gone;
 * what stays is what the twin consumes: the ONE d3 `Layout` (created, kept
 * warm across file inserts, reheated for structural shifts), published on the
 * shared bridge together with the workspace's props and store callbacks, the
 * `CanvasHandle` the workspace calls (announced on the bridge, answered by the
 * twin's camera), and the QA harness's layout half (`LayoutControl`: reseed
 * and settle deterministically for the captures). It renders no DOM.
 */
export interface CanvasHandle {
  fit: (duration?: number) => void;
  /** Frame a subset - a lens, a gap set, a study route. */
  fitTo: (ids: string[], duration?: number) => void;
  focus: (id: string, zoom?: number) => void;
  zoomBy: (factor: number) => void;
  /** Called after a width change so the caller can re-frame. */
  onResize: (fn: (() => void) | null) => void;
}

export interface HoverInfo {
  id: string;
  screenX: number;
  screenY: number;
}

interface Props {
  model: GraphModel;
  /** Lens emphasis. null means emphasise everything. */
  emphasis: Set<string> | null;
  /** Backend study route, drawn as a prominent path. */
  routeIds: string[];
  selectedId: string | null;
  arrivingIds?: string[];
  weakFlash?: boolean;
  /** Specific weak-area sequences — only mounted while the Weak Areas lens is on. */
  weakTraceIds?: string[];
  onSelect: (id: string | null) => void;
  onHover: (info: HoverInfo | null) => void;
  handleRef: RefObject<CanvasHandle | null>;
}

export function KnowledgeCanvas({
  model,
  emphasis,
  routeIds,
  selectedId,
  arrivingIds = [],
  weakFlash = false,
  weakTraceIds = [],
  onSelect,
  onHover,
  handleRef,
}: Props) {
  // Keep the last settled sky so a dropped file can reheat in place instead of
  // reseeding every star. Bulk hydrates still start from a fresh layout.
  const layoutRef = useRef<Layout | null>(null);
  // Harness only: bumping this reseeds and settles synchronously, so a capture
  // never depends on how far an asynchronous reheat got. Always 0 in production.
  const [qaRelayout, setQaRelayout] = useState(0);
  // Which (relayout nonce, model) the harness layout was built from. StrictMode
  // invokes the memo twice; the second pass must hand back that layout untouched
  // instead of reheating it through syncLayout.
  const qaBuiltRef = useRef<{ seq: number; model: GraphModel; layout: Layout } | null>(null);
  const layout = useMemo(() => {
    const prev = layoutRef.current;
    const built = qaBuiltRef.current;
    if (qaRelayout > 0 && built && built.seq === qaRelayout && built.model === model && built.layout === prev) {
      return prev;
    }
    const nextIds = new Set(model.nodes.map((node) => node.id));
    const prevIds = new Set(prev?.nodes.map((node) => node.id) ?? []);
    let shared = 0;
    let added = 0;
    for (const id of nextIds) {
      if (prevIds.has(id)) shared += 1;
      else added += 1;
    }
    const qaFresh = qaRelayout > 0 && built?.seq !== qaRelayout;

    let next: Layout;
    if (!prev || shared === 0 || added > 8 || qaFresh) {
      if (prev) prev.simulation.stop();
      next = createLayout(model);
      // Settled through the shared bridge: a cache hit applies positions at once, otherwise the
      // layout Worker (the twin defers to it), with the synchronous settle as the fallback
      // (lib/graph/worker/layout-service.ts).
      constellationBridge.layouts.settle(next, model);
      if (qaFresh) qaBuiltRef.current = { seq: qaRelayout, model, layout: next };
    } else if (added === 0) {
      for (const node of prev.nodes) {
        const fresh = model.byId.get(node.id);
        if (fresh) node.node = fresh;
      }
      const prevLinkIds = new Set(prev.links.map((link) => link.id));
      const linksSame =
        prevLinkIds.size === model.links.length && model.links.every((link) => prevLinkIds.has(link.id));
      next = linksSame ? prev : syncLayout(prev, model);
    } else {
      next = syncLayout(prev, model);
    }
    layoutRef.current = next;
    return next;
  }, [model, qaRelayout]);

  useEffect(
    () => () => {
      layoutRef.current?.simulation.stop();
    },
    [],
  );

  // Every camera request the workspace makes is announced on the bridge; the twin answers it.
  useImperativeHandle(
    handleRef,
    () => ({
      fit: (duration) => constellationBridge.call({ method: "fit", duration }),
      fitTo: (ids, duration) => constellationBridge.call({ method: "fitTo", ids, duration }),
      focus: (id, zoom) => constellationBridge.call({ method: "focus", id, zoom }),
      onResize: (fn) => constellationBridge.call({ method: "onResize", fn }),
      zoomBy: (factor) => constellationBridge.call({ method: "zoomBy", factor }),
    }),
    [],
  );

  // Share the one layout and the workspace's props with the twin (lib/graph/twin/bridge.ts).
  useEffect(() => {
    constellationBridge.publish({
      layout,
      model,
      emphasis,
      routeIds,
      selectedId,
      arrivingIds,
      weakFlash,
      weakTraceIds,
      onSelect,
      onHover,
    });
  }, [layout, model, emphasis, routeIds, selectedId, arrivingIds, weakFlash, weakTraceIds, onSelect, onHover]);
  useEffect(() => () => constellationBridge.publish(null), []);

  // --- QA harness (development or ?qa=1 only): the layout half of `window.__constellation` ----
  const qaRef = useRef({ layout, model });
  qaRef.current = { layout, model };
  useEffect(() => {
    if (typeof window === "undefined" || !qaEnabled(window.location.search, process.env.NODE_ENV)) return;
    const current = () => qaRef.current;
    const settled = () => {
      const sim = current().layout.simulation;
      return sim.alpha() < sim.alphaMin();
    };
    const quiet = (quietMs: number, requireSettled: boolean) =>
      new Promise<void>((resolve) => {
        let lastLayout = current().layout;
        let lastModel = current().model;
        let since = performance.now();
        const tick = () => {
          const now = performance.now();
          if (current().layout !== lastLayout || current().model !== lastModel || (requireSettled && !settled())) {
            lastLayout = current().layout;
            lastModel = current().model;
            since = now;
          }
          if (now - since >= quietMs) resolve();
          else window.setTimeout(tick, 50);
        };
        tick();
      });
    const control: LayoutControl = {
      ready: document.fonts.ready.then(() => quiet(800, true)),
      whenQuiet: (quietMs = 1500) => quiet(quietMs, false),
      whenSettled: (quietMs = 800) => quiet(quietMs, true),
      relayout: () => setQaRelayout((n) => n + 1),
      settled,
    };
    constellationBridge.layoutControl = control;
    return () => {
      if (constellationBridge.layoutControl === control) constellationBridge.layoutControl = null;
    };
  }, []);

  return null;
}
