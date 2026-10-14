/**
 * React hooks over the land build client: a component asks for a build (or
 * just the plate) and re-renders when it lands. Nothing here computes on the
 * main thread while a Worker exists; without one (tests, SSR, an old
 * browser) the client runs the same jobs in-thread.
 */
import { startTransition, useEffect, useReducer, useRef } from "react";
import type { TerrainMesh } from "@/components/world/biomes/ice-town/layout/terrain-build";
import { landBuildClient } from "./land-build-client";
import { landBuildKey, terrainKey, type LandBuildParams } from "./land-build";

/**
 * Whether the whole land build for `params` is installed; starts it when it is not. `null` (a
 * land that has no Worker build) reads as built. A build that fails resolves to built as well:
 * the scene then mounts and computes what is missing synchronously, as it always could.
 */
export function useLandBuilt(params: LandBuildParams | null): boolean {
  const key = params ? landBuildKey(params) : null;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const built = params ? landBuildClient().isLandBuilt(params) : true;
  const failed = useRef<string | null>(null);
  useEffect(() => {
    if (!params || built) return;
    let live = true;
    landBuildClient()
      .ensureLandBuild(params)
      .then(
        () => live && startTransition(bump),
        () => {
          failed.current = key;
          if (live) startTransition(bump);
        },
      );
    return () => {
      live = false;
    };
    // The key stands for the params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, built]);
  return built || failed.current === key;
}

/**
 * The plate's buffers for `params` (its band), or null while the Worker builds them. Keeps the
 * previous plate across a band change so the land never drops its ground while the next one is
 * sampled; without a Worker the client builds in-thread, at once.
 */
export function useTerrainMesh(params: LandBuildParams): TerrainMesh | null {
  const client = landBuildClient();
  const key = terrainKey(params);
  const cached = client.peekTerrainMesh(key) ?? (client.offThread ? null : client.terrainSync(params));
  const last = useRef<TerrainMesh | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (cached) return;
    let live = true;
    client.ensureTerrain(params).then(
      () => live && bump(),
      () => live && bump(),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cached]);
  if (cached) last.current = cached;
  return last.current;
}
