/**
 * QA harness contract for the constellation (`window.__constellation`).
 *
 * The WebGL twin installs the controller in development (or with `?qa=1`;
 * `components/stage/layers/constellation/twin-dev-api.ts`), its layout half
 * delegating to the layout owner (`KnowledgeCanvas`, `LayoutControl` on the
 * bridge); `tools/qa/constellation/capture.mjs` drives it to capture every
 * state as the twin's self-regression baseline (the Canvas2D renderer it was
 * first measured against went on 2026-10-13, gate 2). Everything in this file
 * is renderer-agnostic and pure so the anchor choices can be unit-tested.
 */

import type { Lens } from "@/lib/graphModel";

export interface Camera2D {
  x: number;
  y: number;
  k: number;
}

export interface ParityNode {
  id: string;
  kind: "concept" | "resource";
  label: string;
  weight: number;
  radius: number;
  x: number;
  y: number;
  cluster?: string;
  clusterId?: string;
  constellation?: string;
  mastery?: number | null;
}

export interface ParityCluster {
  id: string;
  label: string;
  x: number;
  y: number;
  count: number;
  mastery: number;
  memberIds: string[];
}

export interface ParityLink {
  id: string;
  source: string;
  target: string;
  kind: "concept" | "resource";
}

/** Everything the twin needs to reproduce one captured frame. */
export interface LayoutSnapshot {
  version: 1;
  course: { id: string; code: string | null; name: string };
  graphHash: string;
  theme: "light" | "dark";
  size: { w: number; h: number; dpr: number };
  camera: Camera2D;
  labelLayer: "clusters" | "nodes";
  frozenNow: number | null;
  hovered: string | null;
  selected: string | null;
  routeIds: string[];
  arrivingIds: string[];
  /** Arrival timestamps relative to the frozen clock (`frozenNow - bornAt`). */
  arrivingAgeMs: Record<string, number>;
  weakTraceIds: string[];
  weakPulseAgeMs: number | null;
  emphasis: string[] | null;
  nodes: ParityNode[];
  links: ParityLink[];
  clusters: ParityCluster[];
  /** Screen-space hit boxes of the cluster labels drawn in the last frame. */
  clusterLabelBoxes: { x0: number; y0: number; x1: number; y1: number; memberIds: string[] }[];
}

export interface RouteArrivingOptions {
  route?: string[];
  arriving?: string[];
  /** Pop phase in [0, 1] of the arriving stars under a frozen clock. */
  phase?: number;
}

export interface ConstellationDevApi {
  version: 1;
  renderer: "twin";
  /**
   * Resolves once fonts are loaded and the layout has been settled and unchanged
   * for a while. Note the product reheats (`syncLayout`) after each data arrival,
   * which takes ~340 ticks of real frames; `whenQuiet` + `relayout` is the fast,
   * timing-independent path the capture script uses.
   */
  ready: Promise<void>;
  /** Resolves when the graph data (model and layout identity) has not changed for `quietMs`. */
  whenQuiet(quietMs?: number): Promise<void>;
  /** A fresh wait: settled layout, unchanged for `quietMs`. */
  whenSettled(quietMs?: number): Promise<LayoutSnapshot>;
  /** Reseeds and settles the layout synchronously from the current model (deterministic). */
  relayout(): void;
  settled(): boolean;
  getCamera(): Camera2D;
  setCamera(camera: Camera2D): void;
  fit(duration?: number): void;
  fitTo(ids: string[], duration?: number): void;
  /** Runs the real pointer path at the node's projected position; returns that position. */
  hover(id: string | null): { clientX: number; clientY: number } | null;
  select(id: string | null): void;
  setLens(lens: Lens | null): boolean;
  toggleWeak(on: boolean): boolean;
  toggleFiles(on: boolean): boolean;
  setRouteArriving(on: boolean, options?: RouteArrivingOptions): { routeIds: string[]; arrivingIds: string[] } | null;
  /** Fixes the draw clock (ms); `null` releases it. Pins arrival births and the weak pulse to it. */
  freezeTime(ms: number | null): void;
  setCourse(codeOrId: string): boolean;
  anchors(): { hover: string | null; select: string | null; route: string[]; arriving: string[] };
  ids(): { nodes: string[]; concepts: string[]; resources: string[]; clusters: string[] };
  screenFromWorld(x: number, y: number): { sx: number; sy: number };
  getLayout(): LayoutSnapshot;
}

declare global {
  interface Window {
    __constellation?: ConstellationDevApi;
  }
}

/** Development builds always expose the controller; production needs `?qa=1`. */
export function qaEnabled(search: string, nodeEnv: string | undefined): boolean {
  if (nodeEnv !== "production") return true;
  return new URLSearchParams(search).get("qa") === "1";
}

interface Weighted {
  id: string;
  kind: "concept" | "resource";
  weight: number;
}

function heaviestFirst(a: Weighted, b: Weighted): number {
  if (a.weight !== b.weight) return b.weight - a.weight;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Fixed nodes for the hover and selected states: the two heaviest concepts. */
export function pickAnchors(nodes: readonly Weighted[]): { hover: string | null; select: string | null } {
  const concepts = nodes.filter((node) => node.kind === "concept").sort(heaviestFirst);
  const hover = concepts[0]?.id ?? null;
  const select = concepts[1]?.id ?? hover;
  return { hover, select };
}

/**
 * A study-route stand-in: from the hover anchor, walk to the heaviest unvisited
 * concept neighbour until `length` nodes or a dead end. Consecutive ids are
 * linked, so the canvas draws it as a path.
 */
export function pickRoute(
  nodes: readonly Weighted[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  length = 5,
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const start = pickAnchors(nodes).hover;
  if (!start) return [];
  const route = [start];
  const seen = new Set(route);
  while (route.length < length) {
    const here = route[route.length - 1];
    const candidates: Weighted[] = [];
    for (const id of adjacency.get(here) ?? []) {
      const node = byId.get(id);
      if (node && node.kind === "concept" && !seen.has(id)) candidates.push(node);
    }
    if (candidates.length === 0) break;
    candidates.sort(heaviestFirst);
    route.push(candidates[0].id);
    seen.add(candidates[0].id);
  }
  return route;
}

/** FNV-1a over the sorted node and link ids: the same graph hashes the same in any order. */
export function graphHash(nodeIds: readonly string[], linkIds: readonly string[]): string {
  let value = 2166136261;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      value ^= text.charCodeAt(i);
      value = Math.imul(value, 16777619);
    }
    value ^= 0x1f;
    value = Math.imul(value, 16777619);
  };
  for (const id of [...nodeIds].sort()) feed(`n:${id}`);
  for (const id of [...linkIds].sort()) feed(`l:${id}`);
  return (value >>> 0).toString(16).padStart(8, "0");
}
