/**
 * Pure rules for the world layer (S4-1): which lands the stage hosts, the
 * land's pixel grain, and how the world and planet passes fade across the
 * world rung's altitude band. No three.js, no React.
 */
import { WORLD_RISE } from "@/lib/stage/hop";
import { PIXEL_PROFILE } from "@/components/world/biomes/ice-town/render/PixelComposer";
import type { LocalBiomeId } from "@/components/world/biomes/types";

/**
 * Lands rendered through the stage (permanent since gate 4, 2026-10-13: the
 * ice land). Every other developed biome keeps its own `DevelopedBiomeCanvas`
 * until it gets the same guards (plan open decision 8: one task per biome,
 * same pattern as S4-1). Those lands are outside the cloud dive: they
 * dissolve in over the planet, register with the director as the world rung
 * and as a ready world layer (`useOwnCanvasLand`), and the stage pauses
 * behind their opaque canvas while the director rests there.
 */
export const STAGE_WORLD_BIOMES: ReadonlySet<LocalBiomeId> = new Set<LocalBiomeId>(["ice-town"]);

/** Developed biomes that still mount their own WebGL canvas. */
export const OWN_CANVAS_BIOMES: readonly LocalBiomeId[] = [
  "frontier-town",
  "coastal-ruins",
  "jungle-forest-village",
  "medieval-meadow-kingdom",
  "nordic-volcanic-highlands",
  "ice-golden",
];

export function stageHostsBiome(visual: LocalBiomeId): boolean {
  return STAGE_WORLD_BIOMES.has(visual);
}

/**
 * The ice land's own grain: `PixelComposer`'s locked 2 px cell with its
 * normal / depth edge strengths. Inside the stage the cell is the stage grain
 * (`StageFrame.pixel`, 2 CSS px at rest, the same number); the edge strengths
 * are the land's own, since the globe's planet pass has no edge pass and the
 * world pass carries its own `RenderPixelatedPass`.
 */
export const ICE_TOWN_STAGE_GRAIN = {
  pixelSize: PIXEL_PROFILE.pixelSize,
  normalEdgeStrength: PIXEL_PROFILE.normalEdgeStrength,
  depthEdgeStrength: PIXEL_PROFILE.depthEdgeStrength,
} as const;

/**
 * Where the world rung's band ends and the planet's begins: the world pass is
 * whole up to the cloud deck (L 0.5) and gone under the full deck (0.7); the
 * planet pass comes in over the same window (S4-2: `lib/stage/hop.ts`
 * `WORLD_RISE`, whose cloud deck is whole from 0.46 to 0.68, the mask for both
 * swaps). 1 everywhere the stage sat before S4, so flag-off behaviour is
 * unchanged.
 */
export const WORLD_BAND = { full: WORLD_RISE.worldFull, gone: WORLD_RISE.worldGone } as const;

export { planetFromWorldFadeAt, worldPassFadeAt } from "@/lib/stage/hop";
