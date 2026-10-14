/**
 * The 2D constellation's camera behaviour as pure functions: zoom limits, the
 * fit rule, zoom-about-pointer, pan, and the easeOutCubic tween. Ported line
 * by line from `KnowledgeCanvas.tsx` (`fitNodes`, `onWheel`, `zoomBy`,
 * `animateTo`) so the twin's camera lands on the same numbers.
 */

import { FIT_CLUSTER_ZOOM } from "@/lib/constellationLabels";
import type { Camera2D, TwinSize } from "./types";

export const MIN_ZOOM = 0.18;
export const MAX_ZOOM = 3.2;
export { FIT_CLUSTER_ZOOM };

/** Tween durations the 2D canvas uses (ms). */
export const TWEEN = { fit: 380, fitTo: 420, focus: 340, zoomBy: 180, refit: 900, lensRefit: 220 } as const;

export function clampZoom(k: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
}

export interface FitNode {
  x: number;
  y: number;
  /** Drawn radius in world units (`node.radius`), part of the fitted bounds like `boundsOf`. */
  radius: number;
}

/** `boundsOf(nodes, pad)` from lib/forceLayout for plain nodes. */
export function boundsOfNodes(nodes: readonly FitNode[], pad = 40): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.radius);
    minY = Math.min(minY, n.y - n.radius);
    maxX = Math.max(maxX, n.x + n.radius);
    maxY = Math.max(maxY, n.y + n.radius);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** KnowledgeCanvas `fitNodes`: frame `nodes` (padded 60) at 92 %, capped by `zoomCap`; null when nothing to frame. */
export function fitTarget(nodes: readonly FitNode[], size: TwinSize, zoomCap = MAX_ZOOM): Camera2D | null {
  const b = boundsOfNodes(nodes, 60);
  const { w, h } = size;
  if (!b || w === 0 || h === 0) return null;
  const k = Math.max(MIN_ZOOM, Math.min(zoomCap, Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY)) * 0.92));
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, k };
}

/** `zoomBy`: multiply the zoom, clamped, same centre. */
export function zoomByTarget(cam: Camera2D, factor: number): Camera2D {
  return { ...cam, k: clampZoom(cam.k * factor) };
}

/** `focus`: centre on a node, never zooming out. */
export function focusTarget(cam: Camera2D, node: { x: number; y: number }, zoom = 1.35): Camera2D {
  return { x: node.x, y: node.y, k: Math.max(cam.k, zoom) };
}

/** `onWheel`: the world point under the pointer (px, py in CSS px of the box) stays put. */
export function wheelZoom(cam: Camera2D, size: TwinSize, px: number, py: number, deltaY: number): Camera2D {
  const { w, h } = size;
  const wx = (px - w / 2) / cam.k + cam.x;
  const wy = (py - h / 2) / cam.k + cam.y;
  const factor = Math.exp(-deltaY * 0.0016);
  const k = clampZoom(cam.k * factor);
  return { k, x: wx - (px - w / 2) / k, y: wy - (py - h / 2) / k };
}

/** Drag pan by a pointer delta in CSS px. */
export function pan(cam: Camera2D, dx: number, dy: number): Camera2D {
  return { ...cam, x: cam.x - dx / cam.k, y: cam.y - dy / cam.k };
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** The camera `(now − start) / duration` into a tween from `from` to `target`. */
export function tweenCamera(from: Camera2D, target: Camera2D, start: number, duration: number, now: number): { cam: Camera2D; done: boolean } {
  const t = Math.min(1, (now - start) / duration);
  const e = easeOutCubic(t);
  return {
    cam: {
      x: from.x + (target.x - from.x) * e,
      y: from.y + (target.y - from.y) * e,
      k: from.k + (target.k - from.k) * e,
    },
    done: t >= 1,
  };
}

export interface CameraTween {
  from: Camera2D;
  target: Camera2D;
  start: number;
  duration: number;
}

/**
 * The twin's camera: current value plus at most one running tween, stepped by
 * the frame loop (the 2D canvas used its own rAF chain; stepping from the
 * render loop gives the same curve one frame at a time).
 */
export class TwinCamera {
  cam: Camera2D = { x: 0, y: 0, k: 1 };
  tween: CameraTween | null = null;

  /** `animateTo`: instant for duration <= 0, otherwise a fresh tween from the current camera. */
  animateTo(target: Camera2D, duration: number, now: number): void {
    if (duration <= 0) {
      this.tween = null;
      this.cam = target;
      return;
    }
    this.tween = { from: { ...this.cam }, target, start: now, duration };
  }

  /** Set instantly and cancel any tween (`setCamera` of the harness, drag pan, wheel). */
  set(cam: Camera2D): void {
    this.tween = null;
    this.cam = cam;
  }

  /** Advance the tween to `now`; returns true when the camera moved. */
  step(now: number): boolean {
    if (!this.tween) return false;
    const { cam, done } = tweenCamera(this.tween.from, this.tween.target, this.tween.start, this.tween.duration, now);
    this.cam = cam;
    if (done) this.tween = null;
    return true;
  }
}
