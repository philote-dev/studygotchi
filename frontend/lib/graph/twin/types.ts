/**
 * Inputs of the WebGL twin's pure adapters: the SAME layout the Canvas2D
 * constellation (`components/graph/KnowledgeCanvas.tsx`) draws, as plain data.
 * The twin never runs its own force layout; positions, camera, clusters and
 * the interaction state come from the 2D canvas (through the parity dev-api
 * while the layout memo still lives inside `KnowledgeCanvas`).
 */

import type { Camera2D, ParityCluster, ParityNode } from "@/lib/graph/parity/dev-api";
import type { CondenseCurves } from "./condense";

export type { Camera2D };

export interface TwinSize {
  /** CSS px of the constellation box (the 2D canvas's `sizeRef`). */
  w: number;
  h: number;
}

export type TwinNode = ParityNode;
export type TwinCluster = Pick<ParityCluster, "id" | "label" | "x" | "y" | "count" | "mastery">;

/** A graph link with the fields the backbone score needs (`GraphModelLink` subset). */
export interface TwinLink {
  id: string;
  source: string;
  target: string;
  kind: "concept" | "resource";
  directed: boolean;
  type: string;
}

export interface TwinLayout {
  nodes: TwinNode[];
  links: TwinLink[];
  clusters: TwinCluster[];
  /** node id -> neighbour ids (the model's adjacency), used by the hover focus set. */
  adjacency: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The interaction state the 2D draw loop reads each frame. */
export interface TwinDrawState {
  theme: "light" | "dark";
  emphasis: ReadonlySet<string> | null;
  routeIds: readonly string[];
  selectedId: string | null;
  hoveredId: string | null;
  weakTraceIds: readonly string[];
  /** Arrival age in ms (clock − birth) per arriving node id. */
  arrivingAgeMs: ReadonlyMap<string, number>;
  /** The draw clock in ms (frozen under the harness). */
  now: number;
  /** Condensation fades (T-4); absent (or t = 0) means the plain render, bit-identical to the 2D canvas. */
  condense?: CondenseCurves;
}

export const TWIN_IDLE_STATE: TwinDrawState = {
  theme: "dark",
  emphasis: null,
  routeIds: [],
  selectedId: null,
  hoveredId: null,
  weakTraceIds: [],
  arrivingAgeMs: new Map(),
  now: 0,
};
