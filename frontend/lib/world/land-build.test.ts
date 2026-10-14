import { describe, expect, it, vi } from "vitest";
import { ICE_TOWN_LAYOUT, mountainProfileForBand } from "@/components/world/biomes/ice-town/layout/biome-layout";
import { finishTerrainMesh, sampleTerrainFields } from "@/components/world/biomes/ice-town/layout/terrain-build";
import { districtSlots, floePositions, forestPines, layoutScatterReady, localPaths, propPlacements } from "@/components/world/biomes/ice-town/layout/terrain";
import { createOuterWorld } from "@/components/world/biomes/ice-town/edge/endless/outer-world";
import { primedOuterSteps } from "@/components/world/biomes/ice-town/edge/endless/outer-mesh";
import { barrierPlan } from "@/components/world/biomes/ice-town/edge/barriers/geography";
import { ICE_LAND_SEED, iceLandParams, landBuildKey, landJobTransferables, outerKey, outerOptionsFor, runLandJob, scatterKey, terrainKey, type LandJob, type LandReply } from "./land-build";
import { createLandBuildClient, type WorkerLike } from "./land-build-client";
import { createTypedArrayStore, type StorageLike } from "./typed-array-store";

const SEG = 24;

/** A Worker that runs the real jobs in-process, asynchronously, and reports what it moved. */
function fakeWorker(log: { jobs: LandJob[]; transfers: number[] }): WorkerLike {
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(job, transfer = []) {
      log.jobs.push(job);
      log.transfers.push(transfer.length);
      setTimeout(() => {
        let reply: LandReply;
        try {
          const { result } = runLandJob(job);
          reply = { id: job.id, ok: true, result, ms: 1 };
        } catch (error) {
          reply = { id: job.id, ok: false, error: String(error) };
        }
        w.onmessage?.({ data: reply });
      }, 0);
    },
    terminate: vi.fn(),
  };
  return w;
}

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe("land build: keys", () => {
  it("are deterministic in (layout, seed, band) and separate what each part depends on", () => {
    const a = iceLandParams(0.3);
    const b = iceLandParams(0.5);
    const c = iceLandParams(0.9);
    expect(a).toEqual({ layoutId: "ice-town", seed: ICE_LAND_SEED, band: 2 });
    expect(a.band).toBe(mountainProfileForBand(2).band);
    expect(landBuildKey(a)).toBe(landBuildKey(b));
    expect(landBuildKey(a)).not.toBe(landBuildKey(c));
    // The plate and the shelf grow with the band; the scatter does not.
    expect(terrainKey(a)).not.toBe(terrainKey(c));
    expect(outerKey(a)).not.toBe(outerKey(c));
    expect(scatterKey(a)).toBe(scatterKey(c));
    expect(scatterKey(a)).not.toBe(scatterKey({ ...a, seed: 8 }));
  });
});

describe("land build: jobs are the synchronous build", () => {
  it("terrain rows + finish reproduce finishTerrainMesh bit for bit, and name their transferables", () => {
    const params = iceLandParams(0.68);
    const direct = finishTerrainMesh(ICE_TOWN_LAYOUT, sampleTerrainFields(ICE_TOWN_LAYOUT, mountainProfileForBand(params.band), SEG));
    const rows = runLandJob({ id: 1, kind: "terrain-rows", params, rowFrom: 0, rowTo: SEG + 1, segments: SEG });
    expect(rows.result.kind).toBe("terrain-rows");
    expect(rows.transfer.length).toBe(4);
    if (rows.result.kind !== "terrain-rows") return;
    const { rowFrom: _f, rowTo: _t, ...fields } = rows.result.rows;
    const finishJob: LandJob = { id: 2, kind: "terrain-finish", params, fields, pack: true };
    expect(landJobTransferables(finishJob).length).toBe(4);
    const finish = runLandJob(finishJob);
    expect(finish.result.kind).toBe("terrain-finish");
    if (finish.result.kind !== "terrain-finish") return;
    expect(finish.result.mesh.grid.position).toEqual(direct.grid.position);
    expect(finish.result.mesh.grid.normal).toEqual(direct.grid.normal);
    expect(finish.result.mesh.day).toEqual(direct.day);
    expect(finish.result.mesh.night).toEqual(direct.night);
    expect(finish.transfer.length).toBeGreaterThanOrEqual(8);
    const packed = finish.result.packed!;
    // The packed form round-trips through the encoded finish path.
    const again = runLandJob({ id: 3, kind: "terrain-finish", params, encoded: packed });
    if (again.result.kind !== "terrain-finish") return;
    expect(again.result.mesh.day).toEqual(direct.day);
    expect(again.result.packed).toBeNull();
    // Stored fields for another plate are refused (a stale entry never paints the wrong range).
    expect(() => runLandJob({ id: 4, kind: "terrain-finish", params: { ...params, band: 4 }, encoded: packed })).toThrow(/another plate/);
  });

  it("the outer job carries the coast grid, every ring step and the barrier plan, with transferable buffers", () => {
    const params = iceLandParams(0.68);
    const { result, transfer } = runLandJob({ id: 1, kind: "outer", params });
    expect(result.kind).toBe("outer");
    if (result.kind !== "outer") return;
    const world = createOuterWorld(ICE_TOWN_LAYOUT, params.seed, outerOptionsFor(params.band));
    expect(result.outer.coast.grid).toBe(world.coast.grid);
    expect(result.outer.steps.map((s) => s.kind)).toEqual(["ring", "ring", "ring", "ring", "detail", "drift"]);
    expect(result.outer.barriers.plan).toBe(barrierPlan(ICE_TOWN_LAYOUT, params.seed, { shelf: world }));
    expect(transfer).toContain(world.coast.grid.buffer);
    expect(transfer.length).toBeGreaterThan(9);
  });

  it("the scatter job is what the layout functions return", () => {
    const params = iceLandParams(0.68);
    const { result } = runLandJob({ id: 1, kind: "scatter", params });
    if (result.kind !== "scatter") return;
    expect(result.scatter.placements).toBe(propPlacements(ICE_TOWN_LAYOUT, params.seed));
    expect(result.scatter.pines).toBe(forestPines(ICE_TOWN_LAYOUT, params.seed));
    expect(result.scatter.paths).toBe(localPaths(ICE_TOWN_LAYOUT));
    expect(result.scatter.floes).toBe(floePositions(ICE_TOWN_LAYOUT, params.seed));
    expect(result.scatter.slots.harbour).toBe(districtSlots(ICE_TOWN_LAYOUT, ICE_TOWN_LAYOUT.districts.find((d) => d.id === "harbour")!));
    expect(layoutScatterReady(ICE_TOWN_LAYOUT, params.seed)).toBe(true);
  });
});

describe("land build client: the Worker protocol", () => {
  it("splits the plate across the pool, finishes once, installs every part, and stores the heightfield", async () => {
    const log = { jobs: [] as LandJob[], transfers: [] as number[] };
    const workers: WorkerLike[] = [];
    const storage = memoryStorage();
    const store = createTypedArrayStore(storage, { prefix: "t:", cap: 64 * 1024 * 1024, maxEntryBytes: 64 * 1024 * 1024 });
    const client = createLandBuildClient({
      createWorker: () => {
        const w = fakeWorker(log);
        workers.push(w);
        return w;
      },
      poolSize: 4,
      store,
      segments: SEG,
    });
    const params = iceLandParams(0.68);
    expect(client.offThread).toBe(true);
    expect(client.isLandBuilt(params)).toBe(false);
    await client.ensureLandBuild(params);
    expect(client.isLandBuilt(params)).toBe(true);
    expect(workers.length).toBeLessThanOrEqual(4);
    const kinds = log.jobs.map((j) => j.kind);
    expect(kinds.filter((k) => k === "terrain-rows").length).toBe(3 * 2);
    expect(kinds.filter((k) => k === "terrain-finish").length).toBe(1);
    expect(kinds.filter((k) => k === "outer").length).toBe(1);
    // (The layout memo is module-wide: an earlier test may already have primed the scatter.)
    expect(kinds.filter((k) => k === "scatter").length).toBeLessThanOrEqual(1);
    expect(layoutScatterReady(ICE_TOWN_LAYOUT, params.seed)).toBe(true);
    // The finish moved the merged fields into the Worker (four buffers), rows moved nothing in.
    const finishIndex = kinds.indexOf("terrain-finish");
    expect(log.transfers[finishIndex]).toBe(4);
    expect(log.transfers[kinds.indexOf("terrain-rows")]).toBe(0);
    // Everything is installed for the scene's pure modules.
    const world = createOuterWorld(ICE_TOWN_LAYOUT, params.seed, outerOptionsFor(params.band));
    expect(primedOuterSteps(world)).not.toBeNull();
    expect(client.peekTerrainMesh(terrainKey(params, SEG))).not.toBeNull();
    // A second ensure is free; the stored heightfield reaches storage once the idle write runs.
    const before = log.jobs.length;
    await client.ensureLandBuild(params);
    expect(log.jobs.length).toBe(before);
    await new Promise((r) => setTimeout(r, 300));
    expect(store.getEncoded(terrainKey(params, SEG))).not.toBeNull();
    client.dispose();
    expect(workers.every((w) => (w.terminate as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
  });

  it("a stored heightfield skips the row jobs: only the finish runs", async () => {
    const log = { jobs: [] as LandJob[], transfers: [] as number[] };
    const storage = memoryStorage();
    const store = createTypedArrayStore(storage, { prefix: "t:", cap: 64 * 1024 * 1024, maxEntryBytes: 64 * 1024 * 1024 });
    const params = iceLandParams(0.68);
    const rows = runLandJob({ id: 1, kind: "terrain-rows", params, rowFrom: 0, rowTo: SEG + 1, segments: SEG });
    if (rows.result.kind !== "terrain-rows") return;
    const { rowFrom: _f, rowTo: _t, ...fields } = rows.result.rows;
    const packed = runLandJob({ id: 2, kind: "terrain-finish", params, fields, pack: true });
    if (packed.result.kind !== "terrain-finish") return;
    store.setEncoded(terrainKey(params, SEG), packed.result.packed!);
    const client = createLandBuildClient({ createWorker: () => fakeWorker(log), poolSize: 3, store, segments: SEG });
    await client.ensureTerrain(params);
    expect(log.jobs.map((j) => j.kind)).toEqual(["terrain-finish"]);
    expect(log.jobs[0].kind === "terrain-finish" && typeof log.jobs[0].encoded === "string").toBe(true);
    client.dispose();
  });

  it("without a Worker the same jobs run in this thread, and a failing job rejects without poisoning the cache", async () => {
    const client = createLandBuildClient({ createWorker: null, segments: SEG });
    expect(client.offThread).toBe(false);
    const params = { ...iceLandParams(0.68), layoutId: "nope" as "ice-town" };
    await expect(client.ensureLandBuild(params)).rejects.toThrow(/unknown layout/);
    expect(() => client.isLandBuilt(params)).toThrow(/unknown layout/);
    expect(client.history.length).toBe(0);
    // The real layout builds in-thread: the plate is there synchronously and the rest after the (resolved) jobs.
    const real = iceLandParams(0.68);
    const t0 = Date.now();
    expect(client.terrainSync(real)).toBe(client.peekTerrainMesh(terrainKey(real, SEG)));
    await client.ensureLandBuild(real);
    expect(client.isLandBuilt(real)).toBe(true);
    expect(client.history.map((h) => h.thread)).not.toContain("worker");
    expect(Date.now() - t0).toBeLessThan(20000);
  });

  it("a Worker that errors (its module would not load, a crash) breaks the pool: the build finishes in this thread and stays there", async () => {
    const w: WorkerLike = { onmessage: null, onerror: null, postMessage: () => setTimeout(() => w.onerror?.({ message: "boom" }), 0), terminate: vi.fn() };
    const client = createLandBuildClient({ createWorker: () => w, poolSize: 1, store: createTypedArrayStore(null, { prefix: "t:" }), segments: SEG });
    const params = iceLandParams(0.68);
    expect(client.offThread).toBe(true);
    await client.ensureLandBuild(params);
    expect(client.isLandBuilt(params)).toBe(true);
    expect(client.offThread).toBe(false);
    expect(client.history.map((h) => h.thread)).not.toContain("worker");
    expect((w.terminate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    // A later band builds in-thread at once, with no Worker spawned.
    const spawned = vi.fn(() => w);
    const again = createLandBuildClient({ createWorker: spawned, poolSize: 1, store: createTypedArrayStore(null, { prefix: "t:" }), segments: SEG });
    await again.ensureTerrain(params);
    expect(spawned).toHaveBeenCalledTimes(1);
    expect(again.offThread).toBe(false);
    expect(again.peekTerrainMesh(terrainKey(params, SEG))).not.toBeNull();
    client.dispose();
    again.dispose();
  });

  it("a Worker that cannot be constructed falls back to this thread as well", async () => {
    const client = createLandBuildClient({
      createWorker: () => {
        throw new Error("no module workers");
      },
      poolSize: 2,
      store: createTypedArrayStore(null, { prefix: "t:" }),
      segments: SEG,
    });
    const params = iceLandParams(0.9);
    await client.ensureLandBuild(params);
    expect(client.isLandBuilt(params)).toBe(true);
    expect(client.offThread).toBe(false);
  });

  it("a Worker that dies holding the merged fields resamples the plate in this thread", async () => {
    // Rows reply normally; the finish (whose fields were moved in) errors.
    const log = { jobs: [] as LandJob[], transfers: [] as number[] };
    const createWorker = (): WorkerLike => {
      const inner = fakeWorker(log);
      const w: WorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage(job, transfer) {
          if (job.kind === "terrain-finish" && job.fields) {
            setTimeout(() => w.onerror?.({ message: "died" }), 0);
            return;
          }
          inner.onmessage = (e) => w.onmessage?.(e);
          inner.postMessage(job, transfer);
        },
        terminate: vi.fn(),
      };
      return w;
    };
    const client = createLandBuildClient({ createWorker, poolSize: 3, store: createTypedArrayStore(null, { prefix: "t:" }), segments: SEG });
    const params = iceLandParams(0.68);
    const mesh = await client.ensureTerrain(params);
    expect(mesh.grid.position.length).toBe((SEG + 1) * (SEG + 1) * 3);
    expect(client.offThread).toBe(false);
    expect(client.history.at(-1)).toMatchObject({ kind: "terrain-finish", thread: "main" });
    client.dispose();
  });
});

describe("typed-array store", () => {
  it("round-trips bytes through base64 storage, evicts the oldest past the cap, and keeps oversize entries in memory only", () => {
    const storage = memoryStorage();
    const store = createTypedArrayStore(storage, { prefix: "p:", cap: 40, maxEntryBytes: 40 });
    const a = new Float64Array([1.5, -2.25, 3]);
    expect(store.set("a", a)).toBe(true);
    expect(Array.from(new Float64Array(store.get("a")!))).toEqual([1.5, -2.25, 3]);
    expect(store.keys()).toEqual(["a"]);
    expect(store.set("b", new Uint8Array(12))).toBe(true);
    expect(store.keys()).toEqual(["b"]);
    expect(storage.map.has("p:a")).toBe(false);
    expect(store.get("a")).not.toBeNull();
    expect(store.set("big", new Uint8Array(40))).toBe(false);
    expect(store.get("big")!.byteLength).toBe(40);
    store.clear();
    expect(store.keys()).toEqual([]);
    expect(store.get("a")).toBeNull();
  });
});
