/**
 * Hit testing with the 2D canvas's rules (`pick`, `pickCluster` in
 * KnowledgeCanvas): the nearest star whose pick radius `glow·0.55 + 8` px
 * contains the pointer; cluster-label boxes tested last-painted first.
 */

import { screenFromWorld } from "./camera";
import { starProfile } from "./style";
import type { Camera2D, TwinSize } from "./types";

export interface HitNode {
  id: string;
  kind: "concept" | "resource";
  radius: number;
  x: number;
  y: number;
}

export function pickRadius(node: HitNode, zoom: number): number {
  return starProfile(node.id, node.radius, node.kind, zoom).glow * 0.55 + 8;
}

/** The star under (px, py) in CSS px of the box, or null. */
export function hitNode<T extends HitNode>(cam: Camera2D, size: TwinSize, nodes: readonly T[], px: number, py: number): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const node of nodes) {
    const { sx, sy } = screenFromWorld(cam, size, node.x, node.y);
    const r = pickRadius(node, cam.k);
    const d = (px - sx) ** 2 + (py - sy) ** 2;
    if (d <= r * r && d < bestDist) {
      best = node;
      bestDist = d;
    }
  }
  return best;
}

export interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  memberIds: string[];
}

/** The cluster-label box under (px, py); the last painted wins, as on the 2D canvas. */
export function hitClusterLabel<T extends LabelBox>(boxes: readonly T[], px: number, py: number): T | null {
  for (let i = boxes.length - 1; i >= 0; i -= 1) {
    const box = boxes[i];
    if (px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1) return box;
  }
  return null;
}
