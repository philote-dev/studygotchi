/**
 * The 2D constellation's per-node and per-edge draw rules as pure functions.
 * `hash` and `starProfile` are ported verbatim from `KnowledgeCanvas.tsx`
 * (they are module-private there); the alpha, width, colour and keep rules
 * follow its draw loop line by line. Budgets, palettes and the backbone rules
 * are imported, never re-typed.
 */

import { spacePalette, type SpacePalette } from "@/lib/graphTheme";
import { edgeBackboneScore, edgeDrawBudget, keepBackboneEdge } from "@/lib/space-field";
import type { TwinDrawState, TwinLayout, TwinLink, TwinNode } from "./types";

/** Stable string hash used for all visual variation (KnowledgeCanvas `hash`). */
export function hash(id: string, salt = 0): number {
  let value = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i += 1) {
    value ^= id.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export interface StarProfile {
  core: number;
  glow: number;
  opacity: number;
  rays: boolean;
}

/** KnowledgeCanvas `starProfile`: core / glow radii in CSS px for a node at zoom `k`. */
export function starProfile(id: string, radius: number, kind: "concept" | "resource", zoom: number): StarProfile {
  const variation = 0.76 + (hash(id, 19) % 250) / 1000;
  const familiarityCore = 1.55 + ((radius - 18) / 25) * 3.1;
  const core = Math.max(1.15, (kind === "concept" ? familiarityCore : 1.45) * variation * Math.sqrt(Math.max(zoom, 0.32)));
  return {
    core,
    glow: core * (kind === "concept" ? 6.2 : 4.4),
    opacity: kind === "concept" ? 0.78 + variation * 0.22 : 0.56 + variation * 0.18,
    rays: kind === "concept" && core > 3.8,
  };
}

/** The ray angle of a star that has rays (KnowledgeCanvas `drawStar`). */
export function rayAngle(id: string): number {
  return ((hash(id, 41) % 1000) / 1000) * Math.PI;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** `#rrggbb` or `rgba(r, g, b, a)` / `rgb(r, g, b)` -> straight RGBA (0-255, 0-1). */
export function parseColor(css: string): Rgba {
  const text = css.trim();
  if (text.startsWith("#")) {
    const n = text.slice(1);
    const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text);
  if (!match) throw new Error(`parseColor: unsupported colour "${css}"`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
}

/**
 * The focus set of the frame: hover wins over the route, the route over the
 * lens emphasis; null means everything is emphasised.
 */
export function focusSetFor(layout: TwinLayout, state: TwinDrawState): ReadonlySet<string> | null {
  if (state.hoveredId) {
    return new Set<string>([state.hoveredId, ...(layout.adjacency.get(state.hoveredId) ?? [])]);
  }
  if (state.routeIds.length > 0) return new Set(state.routeIds);
  return state.emphasis;
}

/** Node alpha under a focus set: 1 inside (or with no set), 0.14 outside. */
export function alphaFor(id: string, focusSet: ReadonlySet<string> | null): number {
  if (!focusSet) return 1;
  return focusSet.has(id) ? 1 : 0.14;
}

/** Consecutive pairs of the route, both directions, as `a|b` keys. */
export function routeEdgeKeys(routeIds: readonly string[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < routeIds.length - 1; i += 1) {
    s.add(`${routeIds[i]}|${routeIds[i + 1]}`);
    s.add(`${routeIds[i + 1]}|${routeIds[i]}`);
  }
  return s;
}

export interface EdgeStyle {
  /** Drawn as a solid stroke this frame (the backbone / focus / route keep rule). */
  keep: boolean;
  /** Marked as a weak trace while the weak lens is on (drawn dashed in its own pass). */
  weak: boolean;
  onRoute: boolean;
  lit: boolean;
  /** `ctx.globalAlpha` of the solid stroke. */
  alpha: number;
  /** `ctx.lineWidth` in CSS px. */
  width: number;
  /** `ctx.strokeStyle` of the solid stroke (its own alpha multiplies `alpha`). */
  color: string;
}

export interface EdgeStyleContext {
  zoom: number;
  focusSet: ReadonlySet<string> | null;
  routeEdges: ReadonlySet<string>;
  weakTraces: ReadonlySet<string>;
  palette: SpacePalette;
}

/** KnowledgeCanvas edge branch for one link. `a`/`b` are the endpoint nodes. */
export function edgeStyle(link: TwinLink, a: TwinNode, b: TwinNode, ctx: EdgeStyleContext): EdgeStyle {
  const { focusSet, zoom, palette } = ctx;
  const onRoute = ctx.routeEdges.has(`${link.source}|${link.target}`);
  const weak = ctx.weakTraces.size > 0 && ctx.weakTraces.has(link.id);
  const lit = onRoute || (!focusSet ? false : focusSet.has(link.source) && focusSet.has(link.target));
  const score = edgeBackboneScore({
    kind: link.kind,
    directed: link.directed,
    type: link.type,
    sourceWeight: a.weight,
    targetWeight: b.weight,
  });
  const keep = onRoute || lit || keepBackboneEdge(score, zoom);
  const lod = edgeDrawBudget(zoom);
  const dim = !onRoute && !lit;
  const alpha = focusSet ? (lit ? 1 : 0.08) : dim ? lod.alpha : 1;
  const color = lit || onRoute ? palette.edgeStrong : link.kind === "resource" ? palette.edgeResource : palette.edge;
  const width = onRoute ? 1.4 : lit ? 1.1 : lod.width;
  return { keep, weak, onRoute, lit, alpha, width, color };
}

/** Mid-point bow of an edge in CSS px (KnowledgeCanvas `curve`). */
export function edgeCurvePx(linkId: string, zoom: number): number {
  return ((hash(linkId, 7) % 1000) / 1000 - 0.5) * 32 * Math.min(1, zoom);
}

export interface NodeStyle {
  profile: StarProfile;
  alpha: number;
  /** Selected, on the route, or mid-pop: the glow widens by 1.22. */
  active: boolean;
  /** Arrival pop scale (1 when settled). */
  scale: number;
  /** Hidden this frame: resources in the cluster layer unless selected / on the route. */
  hidden: boolean;
}

export interface NodeStyleContext {
  zoom: number;
  layer: "clusters" | "nodes";
  focusSet: ReadonlySet<string> | null;
  selectedId: string | null;
  routeSet: ReadonlySet<string>;
  arrivingAgeMs: ReadonlyMap<string, number>;
}

/** KnowledgeCanvas node branch for one node. */
export function nodeStyle(node: TwinNode, ctx: NodeStyleContext): NodeStyle {
  const profile = starProfile(node.id, node.radius, node.kind, ctx.zoom);
  const isSelected = ctx.selectedId === node.id;
  const onRoute = ctx.routeSet.has(node.id);
  const hidden = ctx.layer === "clusters" && node.kind === "resource" && !isSelected && !onRoute;
  const age = ctx.arrivingAgeMs.get(node.id);
  const born = age !== undefined;
  const pop = born ? Math.min(1, Math.max(0, age) / 520) : 1;
  const scale = born ? 0.25 + (1 - Math.pow(1 - pop, 3)) * 1.05 : 1;
  return {
    profile,
    alpha: alphaFor(node.id, ctx.focusSet),
    active: isSelected || onRoute || (born && pop < 1),
    scale,
    hidden,
  };
}

/** Nebula dust behind a cluster (KnowledgeCanvas dust loop), radius in CSS px. */
export function dustStyle(
  cluster: { count: number; mastery: number | null | undefined },
  zoom: number,
  palette: SpacePalette,
): { tint: string; radius: number; core: number } {
  const tint = (cluster.mastery ?? 0.45) >= 0.6 ? palette.nebula[0] : palette.nebula[1];
  const radius = 58 + Math.sqrt(cluster.count) * 30 * Math.min(1.15, Math.max(0.55, zoom));
  const core = palette.halo === "#080716" ? 0.34 : 0.22;
  return { tint, radius, core };
}

export function paletteFor(theme: "light" | "dark"): SpacePalette {
  return spacePalette(theme);
}
