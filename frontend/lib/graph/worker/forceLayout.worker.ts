/**
 * The force layout's synchronous settle, off the main thread. Runs the SAME
 * `createLayout` + `settle` from lib/forceLayout (same d3-force, same seeded
 * LCG, same tick budget) on the inputs the layout depends on, so the positions
 * are bit-identical to a main-thread settle of the same model.
 *
 *   in:  { type: "settle", hash, nodes: { id, radius, labelLength }[], links: { id, source, target }[], ticks }
 *   out: { type: "settled", hash, positions: Float64Array /* x, y per node, model order *\/, ms }
 */

import { createLayout, settle } from "@/lib/forceLayout";
import type { GraphModel } from "@/lib/graphModel";
import type { LayoutInputs } from "./layout-hash";

export interface SettleRequest extends LayoutInputs {
  type: "settle";
  hash: string;
  ticks?: number;
}

export interface SettleResponse {
  type: "settled";
  hash: string;
  positions: Float64Array;
  /** Wall time the settle took inside the Worker (ms). */
  ms: number;
}

/** The pure core: positions for the inputs, in node order. Shared with the synchronous fallback and the tests. */
export function settlePositions(inputs: LayoutInputs, ticks = 420): Float64Array {
  // createLayout only reads id / radius / label.length of a node and id / source / target of a link.
  const model = {
    nodes: inputs.nodes.map((n) => ({ id: n.id, kind: "concept", label: "x".repeat(Math.max(0, n.labelLength)), radius: n.radius, weight: 0 })),
    links: inputs.links.map((l) => ({ id: l.id, source: l.source, target: l.target })),
  } as unknown as GraphModel;
  const layout = createLayout(model);
  settle(layout, ticks);
  const positions = new Float64Array(layout.nodes.length * 2);
  layout.nodes.forEach((n, i) => {
    positions[i * 2] = n.x;
    positions[i * 2 + 1] = n.y;
  });
  return positions;
}

const scope = typeof self !== "undefined" ? (self as unknown as { onmessage: ((e: MessageEvent<SettleRequest>) => void) | null; postMessage: (m: SettleResponse, t?: Transferable[]) => void; document?: unknown }) : null;
if (scope && typeof scope.postMessage === "function" && scope.document === undefined) {
  scope.onmessage = (event) => {
    const request = event.data;
    if (!request || request.type !== "settle") return;
    const started = Date.now();
    const positions = settlePositions(request, request.ticks);
    scope.postMessage({ type: "settled", hash: request.hash, positions, ms: Date.now() - started }, [positions.buffer]);
  };
}
