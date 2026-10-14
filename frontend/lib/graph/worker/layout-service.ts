/**
 * How a fresh constellation layout gets its settled positions (T-4b):
 *
 *   1. cache hit (memory / sessionStorage by `layoutHash`)  -> applied at once, no settle
 *   2. deferred (a reader asked for it, e.g. the twin is the renderer, and a
 *      Worker exists)                                        -> the Worker settles; the
 *      simulation is stopped meanwhile; positions are applied when they arrive
 *   3. otherwise (flag off, SSR, tests, no Worker)           -> the synchronous `settle`,
 *      exactly as before, and the result is remembered
 *
 * `KnowledgeCanvas` calls `settle(layout, model)` where it used to call
 * `settle(layout)`. Readers (the twin) watch `pending` so they can hold their
 * first frame until the positions exist, and `onSettled` to re-fit.
 */

import { settle as settleSync, type Layout } from "@/lib/forceLayout";
import type { GraphModel } from "@/lib/graphModel";
import { createLayoutCache, type LayoutCache } from "./layout-cache";
import { layoutHash, type LayoutInputs } from "./layout-hash";
import type { SettleRequest, SettleResponse } from "./forceLayout.worker";

export interface SettleOutcome {
  path: "cache" | "worker" | "sync";
  hash: string;
  /** Main-thread time spent inside `settle()` (ms); ~0 for the cache and Worker paths. */
  ms: number;
  /** Worker time for the worker path, filled in when the positions land. */
  workerMs?: number;
}

export interface LayoutService {
  readonly cache: LayoutCache;
  /** Set by a renderer that can wait for positions (the twin); false keeps the synchronous settle. */
  defer: boolean;
  /** Hashes whose positions are being computed in the Worker. */
  readonly pending: ReadonlySet<string>;
  /** True while `layout` (by hash) is still waiting for the Worker. */
  isPending(layout: Layout): boolean;
  hashOf(model: GraphModel): string;
  inputsOf(model: GraphModel): LayoutInputs;
  /** Settle `layout` (fresh from `createLayout(model)`) by the best path; returns what happened. */
  settle(layout: Layout, model: GraphModel): SettleOutcome;
  /** Fires when a deferred settle landed in its layout. */
  onSettled(listener: (layout: Layout, hash: string, workerMs: number) => void): () => void;
  /** The last outcomes, newest last (for the perf readout). */
  readonly history: readonly SettleOutcome[];
}

export function layoutInputs(model: GraphModel): LayoutInputs {
  return {
    nodes: model.nodes.map((n) => ({ id: n.id, radius: n.radius, labelLength: n.label.length })),
    links: model.links.map((l) => ({ id: l.id, source: l.source, target: l.target })),
  };
}

/** Write `positions` (x, y per node, layout order) into the layout and leave it settled. */
export function applyPositions(layout: Layout, positions: Float64Array): void {
  layout.simulation.stop();
  layout.nodes.forEach((n, i) => {
    n.x = positions[i * 2];
    n.y = positions[i * 2 + 1];
    n.vx = 0;
    n.vy = 0;
  });
  layout.simulation.alpha(0);
}

export function readPositions(layout: Layout): Float64Array {
  const out = new Float64Array(layout.nodes.length * 2);
  layout.nodes.forEach((n, i) => {
    out[i * 2] = n.x;
    out[i * 2 + 1] = n.y;
  });
  return out;
}

export interface LayoutServiceOptions {
  cache?: LayoutCache;
  /** Worker factory; null = no Worker (SSR, tests). */
  createWorker?: (() => Worker) | null;
  now?: () => number;
}

function defaultWorkerFactory(): (() => Worker) | null {
  if (typeof Worker === "undefined" || typeof window === "undefined") return null;
  return () => new Worker(new URL("./forceLayout.worker.ts", import.meta.url));
}

export function createLayoutService(options: LayoutServiceOptions = {}): LayoutService {
  const cache = options.cache ?? createLayoutCache();
  const createWorker = options.createWorker === undefined ? defaultWorkerFactory() : options.createWorker;
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const pending = new Set<string>();
  const waiting = new Map<string, Layout[]>();
  const listeners = new Set<(layout: Layout, hash: string, workerMs: number) => void>();
  const history: SettleOutcome[] = [];
  let worker: Worker | null = null;

  const ensureWorker = (): Worker | null => {
    if (worker || !createWorker) return worker;
    try {
      worker = createWorker();
    } catch {
      return null;
    }
    worker.onmessage = (event: MessageEvent<SettleResponse>) => {
      const { hash, positions, ms } = event.data;
      if (event.data.type !== "settled") return;
      cache.set(hash, positions);
      pending.delete(hash);
      const layouts = waiting.get(hash) ?? [];
      waiting.delete(hash);
      for (const layout of layouts) {
        applyPositions(layout, positions);
        for (const fn of listeners) fn(layout, hash, ms);
      }
      for (const outcome of history) if (outcome.hash === hash && outcome.path === "worker") outcome.workerMs = ms;
    };
    worker.onerror = () => {
      // Fall back: settle everything still waiting on the main thread.
      for (const [hash, layouts] of waiting) {
        pending.delete(hash);
        for (const layout of layouts) {
          settleSync(layout);
          cache.set(hash, readPositions(layout));
          for (const fn of listeners) fn(layout, hash, 0);
        }
      }
      waiting.clear();
      worker = null;
    };
    return worker;
  };

  const record = (outcome: SettleOutcome) => {
    history.push(outcome);
    if (history.length > 20) history.shift();
    return outcome;
  };

  return {
    cache,
    defer: false,
    pending,
    history,
    isPending(layout) {
      for (const layouts of waiting.values()) if (layouts.includes(layout)) return true;
      return false;
    },
    hashOf: (model) => layoutHash(layoutInputs(model)),
    inputsOf: layoutInputs,
    settle(layout, model) {
      const inputs = layoutInputs(model);
      const hash = layoutHash(inputs);
      const cached = cache.get(hash);
      if (cached && cached.length === layout.nodes.length * 2) {
        applyPositions(layout, cached);
        return record({ path: "cache", hash, ms: 0 });
      }
      const w = this.defer ? ensureWorker() : null;
      if (w) {
        layout.simulation.stop();
        const queue = waiting.get(hash);
        if (queue) queue.push(layout);
        else {
          waiting.set(hash, [layout]);
          pending.add(hash);
          const request: SettleRequest = { type: "settle", hash, ...inputs, ticks: 420 };
          w.postMessage(request);
        }
        return record({ path: "worker", hash, ms: 0 });
      }
      const started = now();
      settleSync(layout);
      const ms = now() - started;
      cache.set(hash, readPositions(layout));
      return record({ path: "sync", hash, ms });
    },
    onSettled(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app-wide service (one Worker, one cache). */
export const layoutService: LayoutService = createLayoutService();
