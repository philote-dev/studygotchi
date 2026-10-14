/**
 * Warming a land before the cloud dive (gate 4, 2026-10-13): hovering or
 * settling on a landmark loads the biome's code chunk and that course's world
 * payload, so when the dive's camera reaches the cloud deck the land is ready
 * to draw under it (`CLOUD_HOLD` in `lib/stage/hop.ts` parks the camera
 * inside the clouds otherwise).
 *
 * The world payload is cached as a promise per course and handed out ONCE
 * (`takePrefetchedWorld`): `WorldPage`'s first load takes it, every later
 * load (an ingest, a retry) fetches fresh as before. A prefetch that fails is
 * forgotten, so the page runs its own fetch and error path. Pure apart from
 * the injected fetch and the dynamic imports, so vitest covers the cache.
 */
import { DEFAULT_LAND_PROGRESS, landProgressOf } from "./land-progress";
import type { WorldResponse } from "./types";

export type LandVisual = "ice-town" | "frontier-town" | "coastal-ruins" | "jungle-forest-village" | "medieval-meadow-kingdom" | "nordic-volcanic-highlands" | "ice-golden" | "island";

export interface LandPrefetchCache {
  /** Start (or reuse) the fetch for `courseId`; `fetch` runs at most once per course until taken or failed. */
  warm(courseId: string, fetch: () => Promise<WorldResponse>): Promise<WorldResponse | null>;
  /** The pending or resolved prefetch for `courseId`, removed from the cache; null when none. */
  take(courseId: string): Promise<WorldResponse> | null;
  has(courseId: string): boolean;
  clear(): void;
}

export function createLandPrefetchCache(): LandPrefetchCache {
  const worlds = new Map<string, Promise<WorldResponse>>();
  return {
    warm(courseId, fetch) {
      const existing = worlds.get(courseId);
      if (existing) return existing.then((w) => w, () => null);
      let promise: Promise<WorldResponse>;
      try {
        promise = Promise.resolve(fetch());
      } catch (error) {
        promise = Promise.reject(error);
      }
      worlds.set(courseId, promise);
      return promise.then(
        (world) => world,
        () => {
          if (worlds.get(courseId) === promise) worlds.delete(courseId);
          return null;
        },
      );
    },
    take(courseId) {
      const promise = worlds.get(courseId) ?? null;
      if (promise) worlds.delete(courseId);
      return promise;
    },
    has: (courseId) => worlds.has(courseId),
    clear: () => worlds.clear(),
  };
}

/** The app-wide cache (`WorldPage` takes from it). */
export const landPrefetch = createLandPrefetchCache();

/** Which code chunks a land needs: the stage-hosted land for ice-town, the canvas for the others. */
export function landChunks(visual: LandVisual): (() => Promise<unknown>)[] {
  switch (visual) {
    case "ice-town":
    case "ice-golden":
      return [() => import("@/components/world/biomes/DevelopedBiomeCanvas"), () => import("@/components/world/biomes/DevelopedBiomeStageHost")];
    case "island":
      return [() => import("@/components/world/WorldCanvas")];
    default:
      return [() => import("@/components/world/biomes/DevelopedBiomeCanvas")];
  }
}

const chunksWarmed = new Set<LandVisual>();

/**
 * The stage-hosted land's scene build (`lib/world/land-build.ts`): the plate's heightfield, the
 * outer shelf and every placement, in the Worker pool. Started for the band the page shows before
 * its payload lands (`DEFAULT_LAND_PROGRESS`) and again, if different, for the course's own band
 * once the payload is here, so the dive finds the plate it will mount already built.
 */
function warmLandBuild(visual: LandVisual, world: Promise<WorldResponse | null>): void {
  if (visual !== "ice-town") return;
  // The client is loaded lazily with the land's code: the earth page never bundles the plate maths.
  const warm = (progress: number) => import("./land-build-client").then((m) => m.warmIceLand(progress)).catch(() => undefined);
  void warm(DEFAULT_LAND_PROGRESS);
  void world.then((w) => {
    if (w) void warm(landProgressOf(w));
  });
}

/** Load the land's code (once per visual), its world payload (once per course, until taken) and its scene build. */
export function prefetchLand(courseId: string, visual: LandVisual, fetch: () => Promise<WorldResponse>): void {
  if (!chunksWarmed.has(visual)) {
    chunksWarmed.add(visual);
    for (const load of landChunks(visual)) void load().catch(() => chunksWarmed.delete(visual));
  }
  warmLandBuild(visual, landPrefetch.warm(courseId, fetch));
}

/** `WorldPage`: the prefetched world for this course, if one is in flight or landed; null to fetch as usual. */
export function takePrefetchedWorld(courseId: string): Promise<WorldResponse> | null {
  return landPrefetch.take(courseId);
}
