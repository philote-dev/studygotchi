/**
 * The stage's URL parameters: the two that are left now that every slice is
 * permanent (2026-10-13, gates 1-4). There is no stage flag system any more:
 * the sky, the planet, the constellation twin, the galaxy rung, the
 * stage-hosted land and the hops are the product, and `prefers-reduced-motion`
 * is the only behaviour switch (`lib/stage/hop.ts` `reducedHopAt`).
 *
 *   ?perf=1        the stage frame-time overlay
 *   ?rung=galaxy   (dev / captures) teleport the director to that stop at mount
 *
 * `?stage=...` in any form (`twin`, `nogalaxy`, `hop=0`, `nosky`, `planet`, a
 * comma list, repeated) is an unknown parameter and changes nothing
 * (`params.test.ts` pins it; `tools/qa/stage/verify.mjs` measures it). The
 * `NEXT_PUBLIC_STAGE_*` env and the `sg.stage.*` localStorage keys are not read.
 */
import { RUNGS, type Rung } from "./rungs";

export interface StageParams {
  perf: boolean;
  rung: Rung | null;
}

export const STAGE_PARAMS_AT_REST: StageParams = { perf: false, rung: null };

function searchParams(search: string | null | undefined): URLSearchParams {
  return new URLSearchParams(search?.startsWith("?") ? search.slice(1) : (search ?? ""));
}

/** `?perf=1`: show the stage frame-time overlay. */
export function stagePerfRequested(search: string | null | undefined): boolean {
  return searchParams(search).get("perf") === "1";
}

/** `?rung=galaxy` (dev): the stop the director should teleport to at mount; null when absent or unknown. */
export function stageRungFromSearch(search: string | null | undefined): Rung | null {
  const value = searchParams(search).get("rung")?.trim().toLowerCase();
  return value && (RUNGS as readonly string[]).includes(value) ? (value as Rung) : null;
}

export function stageParamsFromSearch(search: string | null | undefined): StageParams {
  return { perf: stagePerfRequested(search), rung: stageRungFromSearch(search) };
}

/**
 * The rung the director starts at rest on for a cold load of `pathname`:
 * `/knowledge` is the constellation (the galaxy with `?rung=galaxy`, the
 * stop mirrored at rest), `/earth?land=` the world, everything else the
 * planet. The mirrored `?rung=` wins where it names a stop.
 */
export function restRungForRoute(pathname: string, search: string | null | undefined): Rung {
  const mirrored = stageRungFromSearch(search);
  if (/^\/knowledge(\/|$)/.test(pathname)) return mirrored ?? "constellation";
  if (/^\/(earth|world)(\/|$)/.test(pathname)) {
    if (searchParams(search).get("land")) return "world";
    return mirrored ?? "planet";
  }
  return "planet";
}
