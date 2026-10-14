/**
 * The QA controller of the constellation (`window.__constellation`,
 * `renderer: "twin"`): the `ConstellationDevApi` contract
 * `tools/qa/constellation/capture.mjs` drives (since gate 2, 2026-10-13, the
 * twin is the one renderer and these captures are its self-regression
 * baseline). The layout-side members (`whenQuiet`, `relayout`, `settled`,
 * `whenSettled`, `ready`) delegate to the layout owner's `LayoutControl` on
 * the bridge (`KnowledgeCanvas`), since the simulation is its and reaches the
 * twin through the bridge. Camera, hover, selection, clocks, the route /
 * arriving override and the snapshot are the twin's own.
 */

import { graphHash, pickAnchors, pickRoute, type ConstellationDevApi, type LayoutSnapshot } from "@/lib/graph/parity/dev-api";
import { getIdentity, selectCourse } from "@/lib/identity";
import type { CondenseAnchor } from "@/lib/graph/twin/condense";
import { constellationBridge } from "@/lib/graph/twin/bridge";
import type { TwinRuntime } from "./twin-runtime";

/** Twin-only additions to the controller (T-4 captures): drive the condense / enter curves directly. */
export interface TwinDevExtras {
  setCondense(t: number | null): void;
  setEnter(t: number | null): void;
  setAnchor(anchor: CondenseAnchor | null): void;
  getCondense(): { condense: number; enter: number; anchor: CondenseAnchor; planetAnchor: CondenseAnchor };
}

export type TwinDevApi = ConstellationDevApi & { twin: TwinDevExtras };

export function installTwinDevApi(runtime: TwinRuntime, dpr: () => number): () => void {
  const control = () => constellationBridge.layoutControl;
  const weighted = () => runtime.nodes.map((n) => ({ id: n.id, kind: n.kind, weight: n.weight }));
  const adjacency = () => runtime.model?.adjacency ?? new Map<string, Set<string>>();
  const settled = () => {
    const c = control();
    if (c) return c.settled();
    const sim = runtime.layout?.simulation;
    return sim ? sim.alpha() < sim.alphaMin() : false;
  };
  const snapshot = (): LayoutSnapshot => {
    const identity = getIdentity();
    const course = identity.courses.find((c) => c.id === identity.courseId);
    const frame = runtime.frame();
    const ages: Record<string, number> = {};
    for (const [id, born] of runtime.arrivingAt) ages[id] = runtime.now - born;
    const nodes = runtime.nodes;
    const links = runtime.model?.links ?? [];
    const camera = { ...runtime.camera.cam };
    return {
      version: 1,
      course: { id: identity.courseId, code: course?.code ?? null, name: course?.name ?? identity.courseName },
      graphHash: graphHash(nodes.map((n) => n.id), links.map((l) => l.id)),
      theme: runtime.theme,
      size: { ...runtime.size, dpr: dpr() },
      camera,
      labelLayer: frame?.labelLayer ?? "clusters",
      frozenNow: runtime.qaClock,
      hovered: runtime.hovered,
      selected: frame?.state.selectedId ?? null,
      routeIds: [...runtime.routeIds],
      arrivingIds: [...runtime.arrivingIds],
      arrivingAgeMs: ages,
      weakTraceIds: [...(frame?.state.weakTraceIds ?? [])],
      weakPulseAgeMs: frame?.weakPulseAgeMs ?? null,
      emphasis: frame?.state.emphasis ? [...frame.state.emphasis] : null,
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ id: l.id, source: l.source, target: l.target, kind: l.kind })),
      clusters: (frame?.layout.clusters ?? []).map((c) => ({
        id: c.id,
        label: c.label,
        x: c.x,
        y: c.y,
        count: c.count,
        mastery: c.mastery,
        memberIds: [...(frame?.layout.clusterMembers.get(c.id) ?? [])],
      })),
      clusterLabelBoxes: (runtime.placement?.clusterBoxes ?? []).map((b) => ({ ...b, memberIds: [...b.memberIds] })),
    };
  };
  const quiet = (quietMs: number, requireSettled: boolean) =>
    new Promise<LayoutSnapshot>((resolve) => {
      let lastLayout = runtime.layout;
      let lastModel = runtime.model;
      let since = performance.now();
      const tick = () => {
        const now = performance.now();
        if (runtime.layout !== lastLayout || runtime.model !== lastModel || (requireSettled && !settled())) {
          lastLayout = runtime.layout;
          lastModel = runtime.model;
          since = now;
        }
        if (now - since >= quietMs) resolve(snapshot());
        else window.setTimeout(tick, 50);
      };
      tick();
    });
  const clickPressed = (selector: string, on: boolean) => {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (!button) return false;
    if ((button.getAttribute("aria-pressed") === "true") !== on) button.click();
    return true;
  };

  const api: TwinDevApi = {
    version: 1,
    renderer: "twin",
    twin: {
      setCondense: (t) => {
        runtime.devOverride = { ...runtime.devOverride, condense: t ?? undefined };
      },
      setEnter: (t) => {
        runtime.devOverride = { ...runtime.devOverride, enter: t ?? undefined };
      },
      setAnchor: (anchor) => {
        runtime.devOverride = { ...runtime.devOverride, anchor };
      },
      getCondense: () => {
        const { galaxy, planet } = runtime.anchors();
        const o = runtime.devOverride;
        return { condense: o?.condense ?? runtime.condense, enter: o?.enter ?? runtime.enter, anchor: o?.anchor ?? galaxy, planetAnchor: o?.anchor ?? planet };
      },
    },
    ready: document.fonts.ready.then(async () => {
      const c = control();
      if (c) await c.ready;
      else await quiet(800, true);
    }),
    whenQuiet: (quietMs = 1500) => {
      const c = control();
      return c ? c.whenQuiet(quietMs) : quiet(quietMs, false).then(() => undefined);
    },
    whenSettled: (quietMs = 800) => {
      const c = control();
      return c ? c.whenSettled(quietMs).then(() => quiet(0, false)) : quiet(quietMs, true);
    },
    relayout: () => control()?.relayout(),
    settled,
    getCamera: () => ({ ...runtime.camera.cam }),
    setCamera: (camera) => runtime.setCamera(camera),
    fit: (duration = 0) => runtime.fit(duration),
    fitTo: (ids, duration = 0) => runtime.fitTo(ids, duration),
    hover: (id) => {
      const el = runtime.element;
      if (!el) return null;
      if (id === null) {
        runtime.clearHover();
        el.style.cursor = "grab";
        return null;
      }
      const node = runtime.nodes.find((n) => n.id === id);
      if (!node) return null;
      const rect = el.getBoundingClientRect();
      const { sx, sy } = runtime.screenFromWorld(node.x, node.y);
      const at = { clientX: rect.left + sx, clientY: rect.top + sy };
      // The real pointer path on the twin: pick, focus set, tooltip, audio event.
      el.dispatchEvent(new PointerEvent("pointermove", { ...at, bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true }));
      return at;
    },
    select: (id) => runtime.select(id),
    setLens: (lens) => clickPressed(`button[data-lens="${lens ?? "all"}"]`, true),
    toggleWeak: (on) => clickPressed(`button[data-lens="${on ? "weak" : "all"}"]`, true),
    toggleFiles: (on) => clickPressed('button[data-dock="files"]', on),
    setRouteArriving: (on, options = {}) => {
      if (!on) {
        runtime.arrivingAt.clear();
        runtime.qaOverride = null;
        return null;
      }
      const route = options.route ?? pickRoute(weighted(), adjacency(), 5);
      const arriving = options.arriving ?? route.slice(-2);
      runtime.qaPopPhase = options.phase ?? 0.4;
      for (const id of arriving) runtime.arrivingAt.set(id, runtime.now - runtime.qaPopPhase * 520);
      runtime.qaOverride = { routeIds: route, arrivingIds: arriving };
      return { routeIds: route, arrivingIds: arriving };
    },
    freezeTime: (ms) => runtime.freezeTime(ms),
    setCourse: (codeOrId) => {
      const course = getIdentity().courses.find((c) => c.id === codeOrId || c.code === codeOrId);
      if (!course) return false;
      selectCourse(course.id);
      return true;
    },
    anchors: () => {
      const route = pickRoute(weighted(), adjacency(), 5);
      return { ...pickAnchors(weighted()), route, arriving: route.slice(-2) };
    },
    ids: () => {
      const nodes = runtime.nodes;
      const frame = runtime.frame();
      return {
        nodes: nodes.map((n) => n.id),
        concepts: nodes.filter((n) => n.kind === "concept").map((n) => n.id),
        resources: nodes.filter((n) => n.kind === "resource").map((n) => n.id),
        clusters: (frame?.layout.clusters ?? []).map((c) => c.id),
      };
    },
    screenFromWorld: (x, y) => runtime.screenFromWorld(x, y),
    getLayout: snapshot,
  };

  window.__constellation = api;
  return () => {
    if (window.__constellation === api) delete window.__constellation;
  };
}
