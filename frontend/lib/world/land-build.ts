/**
 * The land build (2026-10-14, the cloud dive's hold): every pure, heavy step
 * of mounting the ice land, as jobs a Worker can run and the main thread can
 * install. The scene used to do all of this synchronously in `useMemo` at
 * mount, ~1.9 s in development inside the cloud deck; now it runs here, from
 * the hover / settle prefetch (`land-prefetch.ts`) so it overlaps the planet
 * approach, and the mount only assembles three.js objects from the results.
 *
 * Deterministic in its parameters (layout id, seed, growth band): the same
 * job gives the same bytes on any thread, which `land-build.test.ts` checks
 * against the synchronous path. No DOM, no React: this module is what the
 * Worker imports (`land-build.worker.ts`) and what tests run in-process.
 *
 *   terrain-rows    lattice rows [rowFrom, rowTo) of the plate's heightfield (the pool splits these)
 *   terrain-finish  normals + day and night colours around the merged fields
 *   outer           the endless shelf: its coast field and every LOD ring and detail step
 *   scatter         slots, props, paths, pines, groves, floes, harbour and forest fixtures
 */
import { ICE_TOWN_LAYOUT, mountainProfileForBand, type BiomeLayout } from "@/components/world/biomes/ice-town/layout/biome-layout";
import {
  TERRAIN_SEGMENTS,
  fieldsFromBytes,
  fieldsToBytes,
  finishTerrainMesh,
  mergeTerrainRows,
  sampleTerrainFields,
  sampleTerrainRows,
  terrainFieldsTransferables,
  terrainGridKey,
  terrainMeshTransferables,
  terrainProfileFor,
  terrainRowRanges,
  type TerrainFields,
  type TerrainMesh,
  type TerrainRows,
} from "@/components/world/biomes/ice-town/layout/terrain-build";
import { buildLayoutScatter, type LayoutScatter } from "@/components/world/biomes/ice-town/layout/terrain";
import { buildOuterWorldAll, outerStepsTransferables, type BuildStep } from "@/components/world/biomes/ice-town/edge/endless/outer-mesh";
import { createOuterWorld, outerWorldKey, type OuterWorldOptions } from "@/components/world/biomes/ice-town/edge/endless/outer-world";
import { barrierPlan, barrierPlanKey, type BarrierPlan } from "@/components/world/biomes/ice-town/edge/barriers/geography";
import { decodeBytes, encodeBytes } from "./typed-array-store";

export type LandLayoutId = "ice-town";

export interface LandBuildParams {
  layoutId: LandLayoutId;
  seed: number;
  /** Growth band (0–4) of the mountain profile the plate is built with. */
  band: number;
}

export const LAND_LAYOUTS: Record<LandLayoutId, BiomeLayout> = { "ice-town": ICE_TOWN_LAYOUT };

/** The ice land's scatter seed (floes, pines, props): one land, one seed (`IceTownMount`). */
export const ICE_LAND_SEED = 7;

/** The build the ice land mounts at a course fraction: its seed and the growth band of its range (`terrainProfileFor`). */
export function iceLandParams(progress: number): LandBuildParams {
  return { layoutId: "ice-town", seed: ICE_LAND_SEED, band: terrainProfileFor(progress).band };
}

export function landLayout(id: LandLayoutId): BiomeLayout {
  const layout = LAND_LAYOUTS[id];
  if (!layout) throw new Error(`land-build: unknown layout ${id}`);
  return layout;
}

/** The outer world options the product's `combined` edge builds with for a band (the authored profile, nothing else). */
export function outerOptionsFor(band: number): OuterWorldOptions {
  return { mountainProfile: mountainProfileForBand(band) };
}

/* ---------- keys ---------- */

export function terrainKey(p: LandBuildParams, segments = TERRAIN_SEGMENTS): string {
  return terrainGridKey(landLayout(p.layoutId), p.band, segments);
}

export function outerKey(p: LandBuildParams): string {
  return `outer:${p.layoutId}:${outerWorldKey(p.seed, outerOptionsFor(p.band))}`;
}

export function scatterKey(p: LandBuildParams): string {
  return `scatter:${p.layoutId}:${p.seed}`;
}

export function landBuildKey(p: LandBuildParams): string {
  return `${p.layoutId}:s${p.seed}:b${p.band}`;
}

/* ---------- jobs ---------- */

export type LandJob =
  | { id: number; kind: "terrain-rows"; params: LandBuildParams; rowFrom: number; rowTo: number; segments?: number }
  /**
   * Finish from merged `fields` (transferred in) or from their `encoded` form out of
   * `sessionStorage` (decoded off the main thread); `pack` asks for the encoded form back, to store.
   */
  | { id: number; kind: "terrain-finish"; params: LandBuildParams; fields?: TerrainFields; encoded?: string; pack?: boolean }
  | { id: number; kind: "outer"; params: LandBuildParams }
  | { id: number; kind: "scatter"; params: LandBuildParams };

export interface OuterBuild {
  key: string;
  coast: { step: number; margin: number; grid: Float64Array };
  steps: BuildStep[];
  /** The barrier ring seated on this shelf (`combined` renders both). */
  barriers: { key: string; plan: BarrierPlan };
}

export type LandJobResult =
  | { kind: "terrain-rows"; rows: TerrainRows }
  | { kind: "terrain-finish"; mesh: TerrainMesh; packed: string | null }
  | { kind: "outer"; outer: OuterBuild }
  | { kind: "scatter"; scatter: LayoutScatter };

export type LandReply = { id: number; ok: true; result: LandJobResult; ms: number } | { id: number; ok: false; error: string };

/** Run one job in this thread; `transfer` lists the buffers to move with the reply. */
export function runLandJob(job: LandJob): { result: LandJobResult; transfer: ArrayBuffer[] } {
  const layout = landLayout(job.params.layoutId);
  switch (job.kind) {
    case "terrain-rows": {
      const rows = sampleTerrainRows(layout, mountainProfileForBand(job.params.band), job.rowFrom, job.rowTo, job.segments ?? TERRAIN_SEGMENTS);
      return { result: { kind: "terrain-rows", rows }, transfer: terrainFieldsTransferables(rows) };
    }
    case "terrain-finish": {
      const fields = job.fields ?? (job.encoded ? fieldsFromBytes(decodeBytes(job.encoded)) : null);
      if (!fields) throw new Error("land-build: terrain-finish without usable fields");
      if (fields.band !== job.params.band || fields.extent !== layout.worldExtent) throw new Error("land-build: stored fields are for another plate");
      const packed = job.pack ? encodeBytes(fieldsToBytes(fields)) : null;
      const mesh = finishTerrainMesh(layout, fields);
      return { result: { kind: "terrain-finish", mesh, packed }, transfer: terrainMeshTransferables(mesh) };
    }
    case "outer": {
      const outer = buildOuter(layout, job.params);
      return { result: { kind: "outer", outer }, transfer: [...outerStepsTransferables(outer.steps), outer.coast.grid.buffer as ArrayBuffer] };
    }
    case "scatter": {
      const scatter = buildLayoutScatter(layout, job.params.seed);
      return { result: { kind: "scatter", scatter }, transfer: [] };
    }
  }
}

export function buildOuter(layout: BiomeLayout, p: LandBuildParams): OuterBuild {
  const options = outerOptionsFor(p.band);
  const world = createOuterWorld(layout, p.seed, options);
  const plan = barrierPlan(layout, p.seed, { shelf: world });
  return {
    key: outerWorldKey(p.seed, options),
    coast: { step: world.coast.step, margin: world.coast.margin, grid: world.coast.grid },
    steps: buildOuterWorldAll(world),
    barriers: { key: barrierPlanKey(p.seed, world), plan },
  };
}

/** The buffers a job's input must move into the Worker (the merged fields of a finish). */
export function landJobTransferables(job: LandJob): ArrayBuffer[] {
  return job.kind === "terrain-finish" && job.fields ? terrainFieldsTransferables(job.fields) : [];
}

/* ---------- the synchronous path (SSR, tests, no Worker) ---------- */

export interface LandBuild {
  params: LandBuildParams;
  terrain: TerrainMesh;
  outer: OuterBuild;
  scatter: LayoutScatter;
}

/** Everything in this thread, as the Worker jobs would produce it; `rowJobs` splits the sampling like the pool does (for the determinism test). */
export function buildLandSync(p: LandBuildParams, rowJobs = 1, segments = TERRAIN_SEGMENTS): LandBuild {
  const layout = landLayout(p.layoutId);
  const fields =
    rowJobs <= 1
      ? sampleTerrainFields(layout, mountainProfileForBand(p.band), segments)
      : mergeTerrainRows(terrainRowRanges(rowJobs, segments).map(([rowFrom, rowTo]) => sampleTerrainRows(layout, mountainProfileForBand(p.band), rowFrom, rowTo, segments)));
  return { params: p, terrain: finishTerrainMesh(layout, fields), outer: buildOuter(layout, p), scatter: buildLayoutScatter(layout, p.seed) };
}
