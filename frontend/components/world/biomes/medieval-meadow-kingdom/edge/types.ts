/**
 * Edge rollout on the meadow kingdom (Philote's pick from the ice lab, 2026-10-10): one composed
 * technique, `outer`, that is the endless meadow continuation plus the barrier geography and its
 * four vista windows, with the gentle land-anchored bend baked in. `none` is the baseline (the
 * land as shipped) for the comparison captures.
 */
export type EdgeMode = 'none' | 'outer'

export const EDGE_MODES: readonly EdgeMode[] = ['none', 'outer']

/** The product default when no `?edge=` is given. */
export const DEFAULT_EDGE_MODE: EdgeMode = 'outer'

export function isEdgeMode(value: string | null | undefined): value is EdgeMode {
  return value === 'none' || value === 'outer'
}

export const EDGE_PITCH = {
  name: 'Endless meadow with barriers',
  lineage:
    'Breath of the Wild / Ghost of Tsushima (the land continues, LOD rings, aerial perspective) composed with Skyrim / Journey / God of War (geography encloses the land; composed gaps frame distant unreachable landmarks), plus Animal Crossing’s gentle roll.',
  pitch:
    'Beyond the plate the meadow simply goes on: a hedgerow patchwork of fields with copses, haystacks and oaks thinning with distance, the river winding north past a far mill to its source under the ridge and south into a lake, hills rising in rows toward one northern horizon, everything seam-exact to the plate, fogged to 1.6 km and tinted toward the sky, and curling gently under the horizon. A ridge line, forest edges and the lake enclose the kingdom; four composed windows on the outward poses frame a castle on a crag, a cathedral spire over a walled city in the haze, a windmill turning on a western hill and a monastery across the lake, each with one light at night.',
} as const
