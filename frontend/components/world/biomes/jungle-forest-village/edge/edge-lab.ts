import { edgePose, type EdgePoseId } from './poses'

/**
 * Lab state lives in the URL (`?edge=none|outer&pose=<id>`) so the capture harness, the panel
 * and the scene agree. `outer` (the expansive world) is the product default; `none` is the land
 * as it shipped before the direction, kept for side-by-side captures. Changing the state
 * dispatches `ice-edge-lab` (the harness dispatches the same event for every land).
 */
export const EDGE_LAB_EVENT = 'ice-edge-lab'

export type EdgeMode = 'none' | 'outer'
export const EDGE_MODES: readonly EdgeMode[] = ['none', 'outer']

export interface EdgeLabState {
  /** True whenever `edge` or `pose` is in the URL: shows the floating panel. */
  active: boolean
  mode: EdgeMode
  pose: EdgePoseId | null
}

export function edgeModeFromSearch(search: string | URLSearchParams): EdgeMode {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search
  return params.get('edge') === 'none' ? 'none' : 'outer'
}

export function edgeLabFromSearch(search: string | URLSearchParams): EdgeLabState {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search
  return {
    active: params.has('edge') || params.has('pose'),
    mode: edgeModeFromSearch(params),
    pose: edgePose(params.get('pose'))?.id ?? null,
  }
}
