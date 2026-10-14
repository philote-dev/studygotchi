/**
 * Main-thread side of the land build (2026-10-14, the cloud dive's hold):
 * a small Worker pool, the per-build caches, and the installers that hand the
 * results to the scene's pure modules (`primeLayoutScatter`, `primeCoastGrid`,
 * `primeOuterSteps`; the terrain mesh is read from here by `scene/Terrain.tsx`).
 *
 *   ensureLandBuild(params)   start (or reuse) the whole build; resolves when every part is installed
 *   isLandBuilt(params)       synchronous: every part installed (the world layer mounts the scene then)
 *   peekTerrainMesh(key)      the plate's buffers for a band, or null while they are being built
 *
 * The plate's sampled heightfield (~2 MB) is kept in `sessionStorage` through
 * `typed-array-store`, so a reload in the same tab skips the 1.2 s of
 * `sampleTerrain` and only redoes normals and colours (~0.25 s, in the Worker).
 * Where there is no Worker (SSR, tests, an old browser) the same jobs run in
 * this thread through `runLandJob`, which is also how the tests drive the
 * protocol (`createLandBuildClient({ createWorker })` takes a fake).
 */
import { primeBarrierPlan } from "@/components/world/biomes/ice-town/edge/barriers/geography";
import { primeCoastGrid } from "@/components/world/biomes/ice-town/edge/endless/outer-world";
import { primeOuterSteps } from "@/components/world/biomes/ice-town/edge/endless/outer-mesh";
import { layoutScatterReady, primeLayoutScatter } from "@/components/world/biomes/ice-town/layout/terrain";
import { mountainProfileForBand } from "@/components/world/biomes/ice-town/layout/biome-layout";
import { TERRAIN_SEGMENTS, finishTerrainMesh, mergeTerrainRows, sampleTerrainFields, terrainRowRanges, type TerrainFields, type TerrainMesh, type TerrainRows } from "@/components/world/biomes/ice-town/layout/terrain-build";
import { iceLandParams, landJobTransferables, landLayout, outerKey, runLandJob, scatterKey, terrainKey, type LandBuildParams, type LandJob, type LandJobResult, type LandReply } from "./land-build";
import { landMeasure } from "./land-marks";
import { createTypedArrayStore, defaultSessionStorage, type TypedArrayStore } from "./typed-array-store";

/** The subset of `Worker` the pool uses (a test passes a fake). */
export interface WorkerLike {
  postMessage(message: LandJob, transfer?: Transferable[]): void;
  onmessage: ((event: { data: LandReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

export interface LandBuildClientOptions {
  /** null: no Worker, every job runs in this thread. */
  createWorker?: (() => WorkerLike) | null;
  /** Workers at most (the terrain rows split across `poolSize - 2`, the other two take the outer world and the scatter). */
  poolSize?: number;
  store?: TypedArrayStore;
  now?: () => number;
  /** Lattice segments of the plate (tests build a small one). */
  segments?: number;
}

export interface LandBuildClient {
  ensureLandBuild(params: LandBuildParams): Promise<void>;
  ensureTerrain(params: LandBuildParams): Promise<TerrainMesh>;
  /** The plate built in this thread now (the path without a Worker); cached like the others. */
  terrainSync(params: LandBuildParams): TerrainMesh;
  isLandBuilt(params: LandBuildParams): boolean;
  peekTerrainMesh(key: string): TerrainMesh | null;
  /** Whether jobs leave this thread (a Worker factory exists and the pool has not broken). */
  readonly offThread: boolean;
  /** For tests and the perf readout: job timings, newest last. */
  readonly history: readonly { kind: LandJob["kind"]; ms: number; thread: "worker" | "main" }[];
  dispose(): void;
}

const TERRAIN_LRU = 3;
export const TERRAIN_STORE_PREFIX = "sg:land:";

function defaultWorkerFactory(): (() => WorkerLike) | null {
  if (typeof Worker === "undefined" || typeof window === "undefined") return null;
  return () => new Worker(new URL("./land-build.worker.ts", import.meta.url)) as unknown as WorkerLike;
}

function defaultPoolSize(): number {
  const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(2, Math.min(6, cores - 1));
}

export function createLandBuildClient(options: LandBuildClientOptions = {}): LandBuildClient {
  const createWorker = options.createWorker === undefined ? defaultWorkerFactory() : options.createWorker;
  const poolSize = options.poolSize ?? defaultPoolSize();
  const store = options.store ?? createTypedArrayStore(defaultSessionStorage(), { prefix: TERRAIN_STORE_PREFIX, cap: 4 * 1024 * 1024, maxEntryBytes: 3 * 1024 * 1024 });
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const segments = options.segments ?? TERRAIN_SEGMENTS;
  const history: { kind: LandJob["kind"]; ms: number; thread: "worker" | "main" }[] = [];

  /* ---------- pool ---------- */

  interface Slot {
    worker: WorkerLike;
    busy: boolean;
  }
  const slots: Slot[] = [];
  const queue: { job: LandJob; resolve: (r: LandJobResult) => void; reject: (e: Error) => void }[] = [];
  let nextId = 1;
  /**
   * Set when a Worker could not be created or errored (its module failed to load, a CSP, a crash):
   * from then on every job runs in this thread, as without a Worker. Without this a broken pool
   * would reject every build and the land would mount with no ground, forever.
   */
  let poolBroken = false;
  const offThread = () => createWorker !== null && !poolBroken;

  function runHere(job: LandJob): LandJobResult {
    const t0 = now();
    const { result } = runLandJob(job);
    history.push({ kind: job.kind, ms: now() - t0, thread: "main" });
    return result;
  }

  /** The pool is unusable: let the Workers go and run what is queued in this thread. */
  function breakPool(): void {
    poolBroken = true;
    for (const s of slots) s.worker.terminate();
    slots.length = 0;
    const pending = queue.splice(0, queue.length);
    for (const p of pending) settleHere(p);
  }

  function settleHere(p: { job: LandJob; resolve: (r: LandJobResult) => void; reject: (e: Error) => void }): void {
    try {
      p.resolve(runHere(p.job));
    } catch (error) {
      p.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function pump(): void {
    if (!offThread()) return;
    while (queue.length) {
      let slot = slots.find((s) => !s.busy);
      if (!slot && slots.length < poolSize) {
        try {
          slot = { worker: createWorker!(), busy: false };
        } catch {
          breakPool();
          return;
        }
        slots.push(slot);
      }
      if (!slot) return;
      const next = queue.shift()!;
      const s = slot;
      s.busy = true;
      const t0 = now();
      s.worker.onmessage = (event) => {
        s.busy = false;
        s.worker.onmessage = null;
        s.worker.onerror = null;
        const reply = event.data;
        if (reply.id !== next.job.id) {
          next.reject(new Error(`land-build: reply ${reply.id} for job ${next.job.id}`));
        } else if (reply.ok) {
          history.push({ kind: next.job.kind, ms: reply.ms, thread: "worker" });
          landMeasure(`worker:${next.job.kind}`, t0, now());
          next.resolve(reply.result);
        } else next.reject(new Error(reply.error));
        pump();
      };
      s.worker.onerror = () => {
        s.worker.onmessage = null;
        s.worker.onerror = null;
        // A finish whose fields were moved into this Worker cannot run here (the buffers are
        // detached): `ensureTerrain` resamples in this thread instead.
        const movedIn = landJobTransferables(next.job).length > 0;
        breakPool();
        if (movedIn) next.reject(new Error("land-build: the Worker failed with the job's buffers"));
        else settleHere(next);
      };
      s.worker.postMessage(next.job, landJobTransferables(next.job));
    }
  }

  type JobSpec = LandJob extends infer J ? (J extends LandJob ? Omit<J, "id"> : never) : never;

  function run(job: JobSpec): Promise<LandJobResult> {
    const full = { ...job, id: nextId++ } as LandJob;
    if (!offThread()) {
      // No Worker: the same job in this thread (SSR, tests, an old browser, a pool that broke).
      try {
        return Promise.resolve(runHere(full));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return new Promise((resolve, reject) => {
      queue.push({ job: full, resolve, reject });
      pump();
    });
  }

  /* ---------- terrain ---------- */

  const meshes = new Map<string, TerrainMesh>();
  const terrainInflight = new Map<string, Promise<TerrainMesh>>();

  function rememberMesh(key: string, mesh: TerrainMesh): TerrainMesh {
    meshes.delete(key);
    meshes.set(key, mesh);
    while (meshes.size > TERRAIN_LRU) meshes.delete(meshes.keys().next().value as string);
    return mesh;
  }

  async function sampleFields(params: LandBuildParams): Promise<TerrainFields> {
    // Rows in slices three times the workers the outer and scatter jobs leave free: the plate's rows
    // are uneven (the range costs more than the sea), so small slices balance the pool; one job
    // when there is no pool.
    const jobs = offThread() ? 3 * Math.max(1, Math.min(4, poolSize - 2)) : 1;
    const parts = await Promise.all(
      terrainRowRanges(jobs, segments).map(async ([rowFrom, rowTo]) => {
        const r = await run({ kind: "terrain-rows", params, rowFrom, rowTo, segments });
        if (r.kind !== "terrain-rows") throw new Error("land-build: wrong reply");
        return r.rows as TerrainRows;
      }),
    );
    return mergeTerrainRows(parts);
  }

  function ensureTerrain(params: LandBuildParams): Promise<TerrainMesh> {
    const key = terrainKey(params, segments);
    const hit = meshes.get(key);
    if (hit) return Promise.resolve(hit);
    const inflight = terrainInflight.get(key);
    if (inflight) return inflight;
    const promise = (async () => {
      const wasOffThread = offThread();
      try {
        // A reload in this tab: the sampled heightfield is in `sessionStorage`; the Worker decodes it
        // and only redoes normals and colours. Anything stale or unreadable falls through to sampling.
        const encoded = store.getEncoded(key);
        if (encoded) {
          try {
            const r = await run({ kind: "terrain-finish", params, encoded });
            if (r.kind === "terrain-finish") return rememberMesh(key, r.mesh);
          } catch {
            /* resample below */
          }
        }
        const fields = await sampleFields(params);
        const r = await run({ kind: "terrain-finish", params, fields, pack: true });
        if (r.kind !== "terrain-finish") throw new Error("land-build: wrong reply");
        if (r.packed) {
          const packed = r.packed;
          // The 2.8 MB write waits for an idle moment; nothing on the dive needs it.
          const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn: () => void) => setTimeout(fn, 250);
          idle(() => store.setEncoded(key, packed));
        }
        return rememberMesh(key, r.mesh);
      } catch (error) {
        // The pool broke under this build (a Worker that would not load, or died holding the
        // merged fields): the plate in this thread, as without a Worker. Any other failure is real.
        if (!(wasOffThread && poolBroken)) throw error;
        return terrainSync(params);
      }
    })();
    terrainInflight.set(key, promise);
    promise.then(
      () => terrainInflight.delete(key),
      () => terrainInflight.delete(key),
    );
    return promise;
  }

  function terrainSync(params: LandBuildParams): TerrainMesh {
    const key = terrainKey(params, segments);
    const hit = meshes.get(key);
    if (hit) return hit;
    const layout = landLayout(params.layoutId);
    const t0 = now();
    const mesh = finishTerrainMesh(layout, sampleTerrainFields(layout, mountainProfileForBand(params.band), segments));
    history.push({ kind: "terrain-finish", ms: now() - t0, thread: "main" });
    return rememberMesh(key, mesh);
  }

  /* ---------- outer world and scatter ---------- */

  const outerDone = new Set<string>();
  const inflight = new Map<string, Promise<void>>();

  function once(key: string, start: () => Promise<void>): Promise<void> {
    const pending = inflight.get(key);
    if (pending) return pending;
    const promise = start();
    inflight.set(key, promise);
    promise.then(
      () => inflight.delete(key),
      () => inflight.delete(key),
    );
    return promise;
  }

  function ensureOuter(params: LandBuildParams): Promise<void> {
    const key = outerKey(params);
    if (outerDone.has(key)) return Promise.resolve();
    return once(key, async () => {
      const r = await run({ kind: "outer", params });
      if (r.kind !== "outer") throw new Error("land-build: wrong reply");
      const layout = landLayout(params.layoutId);
      primeCoastGrid(layout, r.outer.coast.step, r.outer.coast.margin, r.outer.coast.grid);
      primeOuterSteps(layout, r.outer.key, r.outer.steps);
      primeBarrierPlan(layout, r.outer.barriers.key, r.outer.barriers.plan);
      outerDone.add(key);
    });
  }

  function ensureScatter(params: LandBuildParams): Promise<void> {
    const key = scatterKey(params);
    const layout = landLayout(params.layoutId);
    if (layoutScatterReady(layout, params.seed)) return Promise.resolve();
    return once(key, async () => {
      const r = await run({ kind: "scatter", params });
      if (r.kind !== "scatter") throw new Error("land-build: wrong reply");
      primeLayoutScatter(layout, r.scatter);
    });
  }

  function isLandBuilt(params: LandBuildParams): boolean {
    return meshes.has(terrainKey(params, segments)) && outerDone.has(outerKey(params)) && layoutScatterReady(landLayout(params.layoutId), params.seed);
  }

  return {
    ensureLandBuild(params) {
      try {
        return Promise.all([ensureTerrain(params), ensureOuter(params), ensureScatter(params)]).then(() => undefined);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    ensureTerrain,
    terrainSync,
    isLandBuilt,
    peekTerrainMesh: (key) => meshes.get(key) ?? null,
    get offThread() {
      return offThread();
    },
    history,
    dispose() {
      for (const s of slots) s.worker.terminate();
      slots.length = 0;
      queue.length = 0;
    },
  };
}

/** The app-wide client (lazy, so importing this module never spawns a Worker). */
let shared: LandBuildClient | null = null;
export function landBuildClient(): LandBuildClient {
  if (!shared) shared = createLandBuildClient();
  return shared;
}

export function ensureLandBuild(params: LandBuildParams): Promise<void> {
  return landBuildClient().ensureLandBuild(params);
}

export function isLandBuilt(params: LandBuildParams): boolean {
  return landBuildClient().isLandBuilt(params);
}

/** The prefetch's entry: the ice land's build for a course fraction (deduped by band inside the client). */
export function warmIceLand(progress: number): Promise<void> {
  return landBuildClient().ensureLandBuild(iceLandParams(progress));
}
