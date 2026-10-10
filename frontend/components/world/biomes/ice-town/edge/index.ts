import { barriers } from './barriers'
import { cloudsea } from './cloudsea'
import { curvature } from './curvature'
import { endless } from './endless'
import { parallax } from './parallax'
import { sea } from './sea'
import type { EdgeTechnique, EdgeTechniqueId } from './types'

export type { EdgeSceneProps, EdgeTechnique, EdgeTechniqueId } from './types'
export { EDGE_TECHNIQUE_IDS } from './types'

/** Menu order; also the column order on the comparison sheets. */
export const EDGE_TECHNIQUES: readonly EdgeTechnique[] = [endless, parallax, curvature, barriers, sea, cloudsea]

export function edgeTechnique(id: EdgeTechniqueId | null | undefined): EdgeTechnique | null {
  if (!id) return null
  return EDGE_TECHNIQUES.find((technique) => technique.id === id) ?? null
}

export function isEdgeTechniqueId(value: string | null | undefined): value is EdgeTechniqueId {
  return EDGE_TECHNIQUES.some((technique) => technique.id === value)
}

/** `?edge=<id>` selects a technique; `?edge=none` (or an unknown id) is the baseline with the lab rig on. */
export function edgeTechniqueFromSearch(search: string | URLSearchParams): EdgeTechnique | null {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search
  const id = params.get('edge')
  return isEdgeTechniqueId(id) ? edgeTechnique(id) : null
}
