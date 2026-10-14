/**
 * Frontier edge lab: `?edge=none` shows the land as it shipped (flat slab, 420 m fog) under the
 * free camera; `?edge=outer` (and no param at all) ships the outer world: the endless red-rock
 * continuation plus the natural barriers and their four vistas.
 */
export type EdgeMode = 'none' | 'outer'

export const EDGE_MODES: readonly EdgeMode[] = ['none', 'outer']

export const DEFAULT_EDGE_MODE: EdgeMode = 'outer'

export function isEdgeMode(value: string | null | undefined): value is EdgeMode {
  return value === 'none' || value === 'outer'
}

/** `?edge=` → mode; absent or unknown → the default (outer, the new world ships on). */
export function edgeModeFromSearch(search: string | URLSearchParams): EdgeMode {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search
  const edge = params.get('edge')
  return isEdgeMode(edge) ? edge : DEFAULT_EDGE_MODE
}
