/**
 * Continuous condensation of the constellation into its galaxy bead (T-4a),
 * and its inverse, the bloom out of the planet's point (`enter`).
 *
 * One parameter `t` in [0, 1]: 0 is the full graph exactly as the 2D canvas
 * draws it (the transform is skipped entirely, so the render is bit-identical),
 * 1 is every star inside a tight seeded disc around `anchor` with a one-cell
 * core, no edges, no dust, no labels. Everything in between is a smoothstep
 * blend, so a spring driving `t` sees C1 curves at both ends (no pop at 0 or 1)
 * and the bloom is the same curve read backwards. Positions are blended in
 * SCREEN space (the camera stays the 2D camera), so the bead sits where the
 * galaxy / planet puts it regardless of zoom.
 *
 *   edges   gone by t = 0.6     dust gone by 0.85
 *   cluster labels gone by 0.2  node labels gone by 0.3
 *   core -> 1 px, glow -> 2 px, rays -> 0, all by t = 1
 */

import { beadRadiusFor } from "@/lib/galaxy/layout";
import { hash } from "./style";
import type { TwinSize } from "./types";

export interface CondenseAnchor {
  /** Screen position of the bead, CSS px of the constellation box. */
  x: number;
  y: number;
  /** Disc radius in CSS px the stars collapse into. */
  radius: number;
}

export interface CondenseCurves {
  t: number;
  /** Position / glyph blend, smoothstep(t). */
  blend: number;
  edges: number;
  dust: number;
  clusterLabels: number;
  nodeLabels: number;
}

export function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function fadeOut(from: number, to: number, t: number): number {
  return 1 - smoothstep01((t - from) / (to - from));
}

/** Monotone fade curves for one `t`. */
export function condenseCurves(t: number): CondenseCurves {
  const c = Math.min(1, Math.max(0, t));
  return {
    t: c,
    blend: smoothstep01(c),
    edges: fadeOut(0, 0.6, c),
    dust: fadeOut(0.2, 0.85, c),
    clusterLabels: fadeOut(0, 0.2, c),
    nodeLabels: fadeOut(0.1, 0.3, c),
  };
}

/** The galaxy's bead radius for this course, in CSS px of the box (the galaxy disc spans ~0.8 of the short side at rung 3). */
export function beadScreenRadius(concepts: number, size: TwinSize): number {
  return beadRadiusFor(concepts) * 0.4 * Math.min(size.w, size.h);
}

/** The point inside the bead disc star `id` collapses to (seeded, area-uniform). */
export function beadPoint(id: string, anchor: CondenseAnchor): { x: number; y: number } {
  const angle = (hash(id, 53) / 4294967296) * Math.PI * 2;
  const r = Math.sqrt(hash(id, 59) / 4294967296) * anchor.radius;
  return { x: anchor.x + Math.cos(angle) * r, y: anchor.y + Math.sin(angle) * r };
}

/** Blend a screen position toward its bead point. */
export function condensePoint(sx: number, sy: number, id: string, anchor: CondenseAnchor, blend: number): { x: number; y: number } {
  if (blend <= 0) return { x: sx, y: sy };
  const target = beadPoint(id, anchor);
  return { x: sx + (target.x - sx) * blend, y: sy + (target.y - sy) * blend };
}

/** Core radius 1 px and glow radius 2 px at the bead: one cell at the stage grain. */
export const BEAD_CORE_PX = 1;
export const BEAD_GLOW_PX = 2;

export function condenseGlyph(core: number, glow: number, rayLength: number, blend: number): { core: number; glow: number; rayLength: number } {
  return {
    core: core + (BEAD_CORE_PX - core) * blend,
    glow: glow + (BEAD_GLOW_PX - glow) * blend,
    rayLength: rayLength * (1 - blend),
  };
}

/**
 * `condense` (constellation -> galaxy) and `enter` (planet -> constellation)
 * combined into the one effective `t` and anchor: whichever collapse is
 * stronger wins its anchor. `enter = 1` and `condense = 0` is the plain graph.
 */
export function effectiveCondense(
  condense: number,
  enter: number,
  galaxyAnchor: CondenseAnchor,
  planetAnchor: CondenseAnchor,
): { t: number; anchor: CondenseAnchor } {
  const fromEnter = 1 - Math.min(1, Math.max(0, enter));
  const c = Math.min(1, Math.max(0, condense));
  return c >= fromEnter ? { t: c, anchor: galaxyAnchor } : { t: fromEnter, anchor: planetAnchor };
}

/** Altitude bands (lib/stage/altitude.ts rungs: constellation 2, galaxy 3; planet 1). */
export function condenseFromL(L: number): number {
  return smoothstep01((L - 2.05) / (2.7 - 2.05));
}

export function enterFromL(L: number): number {
  return smoothstep01((L - 1.4) / (2.0 - 1.4));
}
