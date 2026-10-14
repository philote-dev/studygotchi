/**
 * The course fraction a land grows by (ship handoff §2): regions reached over
 * every region plus the hidden concepts. One rule for `WorldPage` (the live
 * land) and the land prefetch (which builds the plate for the band this
 * fraction falls in). `DEFAULT_LAND_PROGRESS` is what the page shows before
 * its payload lands.
 */
import type { WorldResponse } from "./types";

export const DEFAULT_LAND_PROGRESS = 0.68;

export function landProgressOf(world: WorldResponse | null | undefined): number {
  if (!world) return DEFAULT_LAND_PROGRESS;
  const reached = world.regions.filter((region) => region.semantic_state !== "frontier").length;
  const total = world.regions.length + world.hidden_concept_count;
  return total > 0 ? reached / total : DEFAULT_LAND_PROGRESS;
}
