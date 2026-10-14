/**
 * The twin's runtime: everything the 2D canvas kept in refs, as one object the
 * React layer owns. It reads the shared bridge (layout, model, workspace
 * props), owns the twin's camera (tweens ported from `KnowledgeCanvas`), the
 * hover / drag state, the arrival births and the weak pulse, answers the
 * workspace's `CanvasHandle` requests, drives the store through the same
 * callbacks the 2D canvas was given, and builds the per-frame input of the
 * buffer adapters. No React, no GL, no DOM except the pointer events handed in.
 */

import { emit } from "@/lib/audio/events";
import { buildSpaceClusters, spaceLabelLayer, type SpaceLabelNode } from "@/lib/constellationLabels";
import type { Layout, PositionedNode } from "@/lib/forceLayout";
import { constellationBridge, type ConstellationBridge, type ConstellationHandleCall, type ConstellationShared } from "@/lib/graph/twin/bridge";
import type { LabelPlacement } from "@/lib/graph/twin/buffers";
import { screenFromWorld } from "@/lib/graph/twin/camera";
import { clampZoom, FIT_CLUSTER_ZOOM, fitTarget, focusTarget, pan, TWEEN, TwinCamera, wheelZoom, zoomByTarget } from "@/lib/graph/twin/twin-camera";
import { hitClusterLabel, hitNode } from "@/lib/graph/twin/twin-hit";
import { beadScreenRadius, condenseCurves, condensePoint, effectiveCondense, type CondenseAnchor } from "@/lib/graph/twin/condense";
import { worldFromScreen } from "@/lib/graph/twin/camera";
import type { Camera2D, TwinCluster, TwinDrawState, TwinLink, TwinNode, TwinSize } from "@/lib/graph/twin/types";
import type { TwinSourceFrame } from "./twin-source";

export interface PointerLike {
  clientX: number;
  clientY: number;
  pointerId: number;
}

export interface TwinRuntimeOptions {
  bridge?: ConstellationBridge;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

interface Drag {
  mode: "none" | "pan" | "node";
  nodeId: string | null;
  clusterIds: string[] | null;
  startX: number;
  startY: number;
  moved: boolean;
}

const NO_DRAG: Drag = { mode: "none", nodeId: null, clusterIds: null, startX: 0, startY: 0, moved: false };

export class TwinRuntime {
  readonly camera = new TwinCamera();
  theme: "light" | "dark" = "dark";
  size: TwinSize = { w: 0, h: 0 };
  hovered: string | null = null;
  /** Frozen draw clock (harness); null = wall clock. */
  qaClock: number | null = null;
  qaPopPhase = 0.4;
  qaOverride: { routeIds: string[]; arrivingIds: string[] } | null = null;
  readonly arrivingAt = new Map<string, number>();
  weakPulseAt = 0;
  /** The last frame's label placement (cluster hit boxes). */
  placement: LabelPlacement | null = null;
  /** The box the pointer events are measured against (set by the React layer). */
  element: HTMLElement | null = null;
  cursor = "grab";
  /** T-4: constellation -> galaxy collapse (0 full graph, 1 bead) and planet -> constellation arrival (0 bead, 1 full graph). */
  condense = 0;
  enter = 1;
  /** Bead anchors in CSS px of the box; null = box centre with the course's galaxy bead radius. */
  galaxyAnchor: CondenseAnchor | null = null;
  planetAnchor: CondenseAnchor | null = null;
  /** Harness overrides of the props above (`window.__constellation.twin.*`), null = use the props. */
  devOverride: { condense?: number; enter?: number; anchor?: CondenseAnchor | null } | null = null;
  /**
   * `prefers-reduced-motion: reduce`: the graph renders static. Camera requests land at once
   * (no tweens), arriving stars do not pop, the weak traces neither pulse nor march.
   */
  reducedMotion = false;

  private shared: ConstellationShared | null = null;
  private layoutSeen: Layout | null = null;
  private firstFit = true;
  private fitTimer: unknown = null;
  private onResizeFn: (() => void) | null = null;
  private drag: Drag = { ...NO_DRAG };
  private twinNodes: TwinNode[] = [];
  private nodeIndex = new Map<string, TwinNode>();
  private positioned = new Map<string, PositionedNode>();
  private positions = new Float64Array(0);
  private links: TwinLink[] = [];
  private clusters: ReturnType<typeof buildSpaceClusters> = [];
  private clusterMembers = new Map<string, readonly string[]>();
  private lastArriving: readonly string[] | null = null;
  private lastWeakFlash: boolean | null = null;
  private condensedMemo: { key: string; nodes: TwinNode[]; value: { curves: ReturnType<typeof condenseCurves>; nodes: TwinNode[]; clusters: TwinCluster[] } } | null = null;
  private unsubscribe: (() => void)[] = [];
  private readonly bridge: ConstellationBridge;
  private readonly clock: () => number;
  private readonly timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void };

  constructor(options: TwinRuntimeOptions = {}) {
    this.bridge = options.bridge ?? constellationBridge;
    this.clock = options.now ?? (() => performance.now());
    this.timers = {
      set: options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
      clear: options.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>)),
    };
  }

  /** Subscribe to the bridge; returns the disposer. */
  start(): () => void {
    this.unsubscribe.push(this.bridge.subscribe((state) => this.onShared(state)));
    this.unsubscribe.push(this.bridge.onCall((call) => this.onHandleCall(call)));
    // While the twin renders, a fresh layout may settle in the Worker: the twin holds its
    // frame until the positions land, then frames the whole sky (the 2D canvas's fit(0)
    // already ran on the seed positions, which nobody saw).
    this.bridge.layouts.defer = true;
    this.unsubscribe.push(
      this.bridge.layouts.onSettled((layout) => {
        if (layout === this.layout) this.fit(0);
      }),
    );
    return () => this.stop();
  }

  stop(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.bridge.layouts.defer = false;
    if (this.fitTimer !== null) this.timers.clear(this.fitTimer);
    this.fitTimer = null;
  }

  /** True while any layout is still settling in the Worker: nothing is drawn. */
  get settling(): boolean {
    return this.bridge.layouts.pending.size > 0;
  }

  get now(): number {
    return this.qaClock ?? this.clock();
  }

  get layout(): Layout | null {
    return this.shared?.layout ?? null;
  }

  get model() {
    return this.shared?.model ?? null;
  }

  get nodes(): readonly TwinNode[] {
    return this.twinNodes;
  }

  get routeIds(): string[] {
    return this.qaOverride?.routeIds ?? this.shared?.routeIds ?? [];
  }

  get arrivingIds(): string[] {
    return this.qaOverride?.arrivingIds ?? this.shared?.arrivingIds ?? [];
  }

  // --- shared state ---------------------------------------------------------

  private onShared(state: ConstellationShared | null): void {
    this.shared = state;
    if (!state) {
      this.twinNodes = [];
      this.nodeIndex.clear();
      this.positioned.clear();
      this.links = [];
      this.clusters = [];
      return;
    }
    if (state.layout !== this.layoutSeen) {
      this.layoutSeen = state.layout;
      this.rebuildNodes(state.layout);
      // First layout snaps to the whole sky; a later one eases to the new bounds (KnowledgeCanvas).
      if (this.fitTimer !== null) this.timers.clear(this.fitTimer);
      if (this.firstFit) {
        this.firstFit = false;
        this.fitTimer = this.timers.set(() => this.fit(0), 30);
      } else {
        this.fitTimer = this.timers.set(() => this.fit(TWEEN.refit), 240);
      }
    }
    this.links = state.model.links.map((l) => ({ id: l.id, source: l.source, target: l.target, kind: l.kind, directed: l.directed, type: l.type }));
    this.syncArrivals();
    this.syncWeakPulse();
  }

  private rebuildNodes(layout: Layout): void {
    this.positioned = new Map(layout.nodes.map((pn) => [pn.id, pn]));
    this.positions = new Float64Array(layout.nodes.length * 2);
    this.refreshNodes(layout, true);
  }

  /** Mirror the positioned nodes into plain `TwinNode`s; fresh objects only when something moved. */
  private refreshNodes(layout: Layout, force: boolean): boolean {
    const nodes = layout.nodes;
    if (!force) {
      let moved = nodes.length * 2 !== this.positions.length;
      for (let i = 0; !moved && i < nodes.length; i += 1) {
        if (this.positions[i * 2] !== nodes[i].x || this.positions[i * 2 + 1] !== nodes[i].y) moved = true;
      }
      if (!moved) return false;
    }
    if (this.positions.length !== nodes.length * 2) this.positions = new Float64Array(nodes.length * 2);
    this.twinNodes = nodes.map((pn, i) => {
      this.positions[i * 2] = pn.x;
      this.positions[i * 2 + 1] = pn.y;
      const node = pn.node;
      return {
        id: pn.id,
        kind: node.kind,
        label: node.label,
        weight: node.weight,
        radius: node.radius,
        x: pn.x,
        y: pn.y,
        cluster: node.kind === "concept" ? node.concept.cluster : undefined,
        clusterId: node.kind === "concept" ? node.concept.cluster_id : undefined,
        constellation: node.kind === "concept" ? node.concept.constellation : undefined,
        mastery: node.kind === "concept" ? node.concept.mastery : undefined,
      };
    });
    this.nodeIndex = new Map(this.twinNodes.map((n) => [n.id, n]));
    this.clusters = buildSpaceClusters(this.twinNodes as SpaceLabelNode[], this.shared?.model.adjacency);
    this.clusterMembers = new Map(this.clusters.map((c) => [c.id, c.memberIds]));
    return true;
  }

  private syncArrivals(): void {
    const ids = this.arrivingIds;
    if (ids === this.lastArriving) return;
    this.lastArriving = ids;
    const now = this.now;
    for (const id of ids) if (!this.arrivingAt.has(id)) this.arrivingAt.set(id, now);
  }

  private syncWeakPulse(): void {
    const flash = this.shared?.weakFlash ?? false;
    if (flash === this.lastWeakFlash) return;
    this.lastWeakFlash = flash;
    this.weakPulseAt = flash ? this.clock() : 0;
    if (flash && this.qaClock !== null) this.weakPulseAt = this.qaClock - 1600;
  }

  // --- camera -------------------------------------------------------------

  private fitNodes(subset: readonly TwinNode[], duration: number, zoomCap?: number): void {
    const target = fitTarget(subset, this.size, zoomCap);
    if (!target) return;
    this.camera.animateTo(target, this.reducedMotion ? 0 : duration, this.clock());
  }

  fit(duration: number = TWEEN.fit): void {
    this.fitNodes(this.twinNodes, duration, FIT_CLUSTER_ZOOM);
  }

  fitTo(ids: readonly string[], duration: number = TWEEN.fitTo): void {
    const set = new Set(ids);
    const subset = this.twinNodes.filter((n) => set.has(n.id));
    if (subset.length === 0) return this.fit(duration);
    this.fitNodes(subset, duration);
  }

  focus(id: string, zoom = 1.35): void {
    const n = this.nodeIndex.get(id);
    if (!n) return;
    this.camera.animateTo(focusTarget(this.camera.cam, n, zoom), this.reducedMotion ? 0 : TWEEN.focus, this.clock());
  }

  zoomBy(factor: number): void {
    this.camera.animateTo(zoomByTarget(this.camera.cam, factor), this.reducedMotion ? 0 : TWEEN.zoomBy, this.clock());
  }

  setCamera(cam: Camera2D): void {
    this.camera.set({ x: cam.x, y: cam.y, k: clampZoom(cam.k) });
  }

  private onHandleCall(call: ConstellationHandleCall): void {
    switch (call.method) {
      case "fit":
        return this.fit(call.duration);
      case "fitTo":
        return this.fitTo(call.ids, call.duration);
      case "focus":
        return this.focus(call.id, call.zoom);
      case "zoomBy":
        return this.zoomBy(call.factor);
      case "onResize":
        this.onResizeFn = call.fn;
        return;
    }
  }

  /** The React layer measured the box; a width change re-frames like the 2D canvas's ResizeObserver. */
  resize(size: TwinSize): void {
    const widthChanged = Math.abs(size.w - this.size.w) > 1 && this.size.w !== 0;
    this.size = size;
    if (widthChanged) this.onResizeFn?.();
  }

  screenFromWorld(x: number, y: number): { sx: number; sy: number } {
    return screenFromWorld(this.camera.cam, this.size, x, y);
  }

  // --- pointer (ported from KnowledgeCanvas) -------------------------------

  private local(e: PointerLike): { px: number; py: number } {
    const rect = this.element?.getBoundingClientRect();
    return { px: e.clientX - (rect?.left ?? 0), py: e.clientY - (rect?.top ?? 0) };
  }

  private pick(e: PointerLike): TwinNode | null {
    const { px, py } = this.local(e);
    return hitNode(this.camera.cam, this.size, this.twinNodes, px, py);
  }

  private pickCluster(e: PointerLike) {
    const { px, py } = this.local(e);
    return hitClusterLabel(this.placement?.clusterBoxes ?? [], px, py);
  }

  pointerDown(e: PointerLike): void {
    const cluster = this.pickCluster(e);
    const hit = cluster ? null : this.pick(e);
    this.drag = { mode: hit ? "node" : "pan", nodeId: hit?.id ?? null, clusterIds: cluster?.memberIds ?? null, startX: e.clientX, startY: e.clientY, moved: false };
    if (hit) {
      const pn = this.positioned.get(hit.id);
      const layout = this.layout;
      if (pn && layout) {
        pn.fx = pn.x;
        pn.fy = pn.y;
        layout.simulation.alphaTarget(0.12).alpha(0.22).restart();
      }
    }
    this.cursor = "grabbing";
  }

  pointerMove(e: PointerLike): void {
    const drag = this.drag;
    const cam = this.camera.cam;
    const onHover = this.shared?.onHover;
    if (drag.mode === "none") {
      const cluster = this.pickCluster(e);
      const hit = cluster ? null : this.pick(e);
      const id = hit?.id ?? null;
      this.cursor = cluster || id ? "pointer" : "grab";
      if (id !== this.hovered) {
        this.hovered = id;
        if (id) emit({ type: "star", kind: "hover" });
        onHover?.(id ? { id, screenX: e.clientX, screenY: e.clientY } : null);
      } else if (id) {
        onHover?.({ id, screenX: e.clientX, screenY: e.clientY });
      } else if (!id && this.hovered) {
        this.hovered = null;
        onHover?.(null);
      }
      return;
    }
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    if (drag.mode === "pan") {
      this.camera.set(pan(cam, dx, dy));
      drag.startX = e.clientX;
      drag.startY = e.clientY;
    } else if (drag.nodeId) {
      const pn = this.positioned.get(drag.nodeId);
      const layout = this.layout;
      if (pn && layout) {
        pn.fx = pn.x + dx / cam.k;
        pn.fy = pn.y + dy / cam.k;
        drag.startX = e.clientX;
        drag.startY = e.clientY;
        layout.simulation.alphaTarget(0.12).restart();
      }
    }
  }

  pointerUp(e: PointerLike): void {
    const drag = this.drag;
    const shared = this.shared;
    if (!drag.moved) {
      if (drag.clusterIds?.length) {
        emit({ type: "cluster-focus" });
        this.fitTo(drag.clusterIds);
      } else {
        if (drag.nodeId) emit({ type: "star", kind: "select" });
        shared?.onSelect(drag.nodeId);
      }
    }
    if (drag.nodeId) {
      const pn = this.positioned.get(drag.nodeId);
      if (pn) {
        pn.fx = pn.x;
        pn.fy = pn.y;
      }
      this.layout?.simulation.alphaTarget(0).alpha(0.16).restart();
    }
    const stillUnder = this.pick(e);
    if ((stillUnder?.id ?? null) !== this.hovered) {
      this.hovered = stillUnder?.id ?? null;
      shared?.onHover(stillUnder ? { id: stillUnder.id, screenX: e.clientX, screenY: e.clientY } : null);
    }
    this.drag = { ...NO_DRAG };
    this.cursor = stillUnder ? "pointer" : "grab";
  }

  pointerLeave(): void {
    if (this.hovered) this.hovered = null;
    this.cursor = "grab";
    this.shared?.onHover(null);
  }

  wheel(e: { clientX: number; clientY: number; deltaY: number }): void {
    const { px, py } = this.local({ ...e, pointerId: 0 });
    this.camera.set(wheelZoom(this.camera.cam, this.size, px, py, e.deltaY));
  }

  /** The store selection, through the same callback the workspace gave the 2D canvas. */
  select(id: string | null): void {
    this.shared?.onSelect(id);
  }

  /** Harness `hover(null)`: clear like a pointer leave without an event. */
  clearHover(): void {
    if (this.hovered) this.hovered = null;
    this.cursor = "grab";
    this.shared?.onHover(null);
  }

  // --- harness clocks -------------------------------------------------------

  freezeTime(ms: number | null): void {
    this.qaClock = ms;
    if (ms !== null) {
      for (const id of this.arrivingAt.keys()) this.arrivingAt.set(id, ms - this.qaPopPhase * 520);
      if (this.weakPulseAt) this.weakPulseAt = ms - 1600;
    }
  }

  // --- condensation (T-4) ---------------------------------------------------

  /** The anchors in use: explicit, or the box centre with the galaxy bead radius for this course. */
  anchors(): { galaxy: CondenseAnchor; planet: CondenseAnchor } {
    const concepts = this.twinNodes.reduce((n, node) => n + (node.kind === "concept" ? 1 : 0), 0);
    const fallback: CondenseAnchor = { x: this.size.w / 2, y: this.size.h / 2, radius: beadScreenRadius(concepts, this.size) };
    return { galaxy: this.galaxyAnchor ?? fallback, planet: this.planetAnchor ?? fallback };
  }

  /**
   * Node and cluster positions blended toward the bead in screen space, with
   * the fade curves; null at t = 0 so the plain render stays bit-identical.
   */
  private condensed(): { curves: ReturnType<typeof condenseCurves>; nodes: TwinNode[]; clusters: TwinCluster[] } | null {
    const { galaxy, planet } = this.anchors();
    const o = this.devOverride;
    const { t, anchor } = effectiveCondense(o?.condense ?? this.condense, o?.enter ?? this.enter, o?.anchor ?? galaxy, o?.anchor ?? planet);
    if (t <= 0) return null;
    const cam = this.camera.cam;
    const size = this.size;
    const key = `${t}|${cam.x}|${cam.y}|${cam.k}|${size.w}|${size.h}|${anchor.x}|${anchor.y}|${anchor.radius}`;
    const memo = this.condensedMemo;
    if (memo && memo.key === key && memo.nodes === this.twinNodes) return memo.value;
    const curves = condenseCurves(t);
    const move = <T extends { id: string; x: number; y: number }>(node: T): T => {
      const s = screenFromWorld(cam, size, node.x, node.y);
      const p = condensePoint(s.sx, s.sy, node.id, anchor, curves.blend);
      const w = worldFromScreen(cam, size, p.x, p.y);
      return { ...node, x: w.x, y: w.y };
    };
    const value = {
      curves,
      nodes: this.twinNodes.map(move),
      clusters: this.clusters.map((c) => move({ id: c.id, label: c.label, x: c.x, y: c.y, count: c.count, mastery: c.mastery })),
    };
    this.condensedMemo = { key, nodes: this.twinNodes, value };
    return value;
  }

  // --- per-frame ------------------------------------------------------------

  /** Advance tweens and read the shared layout; the frame the buffer adapters draw, or null without a 2D canvas. */
  frame(): TwinSourceFrame | null {
    const shared = this.shared;
    if (!shared || this.size.w === 0 || this.size.h === 0 || this.settling) return null;
    const wall = this.clock();
    this.camera.step(wall);
    this.refreshNodes(shared.layout, false);
    // Static under reduced motion: a fixed clock (no dash march), every arrival already landed, no pulse.
    const reduced = this.reducedMotion;
    const now = reduced ? 0 : this.now;
    const ages = new Map<string, number>();
    let popping = false;
    for (const [id, born] of this.arrivingAt) {
      const age = reduced ? 640 : now - born;
      ages.set(id, age);
      if (age < 640) popping = true;
    }
    const weakTraceIds = shared.weakTraceIds;
    const condensed = this.condensed();
    const state: TwinDrawState = {
      theme: this.theme,
      emphasis: shared.emphasis,
      routeIds: this.routeIds,
      selectedId: shared.selectedId,
      hoveredId: this.hovered,
      weakTraceIds,
      arrivingAgeMs: ages,
      now,
      condense: condensed?.curves,
    };
    return {
      cam: { ...this.camera.cam },
      size: { ...this.size },
      layout: {
        nodes: condensed?.nodes ?? this.twinNodes,
        links: this.links,
        clusters: condensed?.clusters ?? this.clusters,
        adjacency: shared.model.adjacency,
        clusterMembers: this.clusterMembers,
      },
      state,
      graphHash: "",
      animating: !reduced && (popping || weakTraceIds.length > 0),
      weakPulse: this.weakPulseAt && !reduced ? Math.max(0, 1 - (now - this.weakPulseAt) / 1600) : 0,
      weakPulseAgeMs: this.weakPulseAt ? (reduced ? 1600 : now - this.weakPulseAt) : null,
      labelLayer: spaceLabelLayer(this.camera.cam.k),
    };
  }
}
