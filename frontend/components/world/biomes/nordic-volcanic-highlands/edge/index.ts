import { outer } from './outer'
import type { EdgeTechnique, EdgeTechniqueId } from './types'

export type { EdgeSceneProps, EdgeTechnique, EdgeTechniqueId } from './types'
export { DEFAULT_TECHNIQUE, EDGE_TECHNIQUE_IDS } from './types'

export const EDGE_TECHNIQUES: readonly EdgeTechnique[] = [outer]

export function edgeTechnique(id: EdgeTechniqueId | null | undefined): EdgeTechnique | null {
  if (!id) return null
  return EDGE_TECHNIQUES.find((technique) => technique.id === id) ?? null
}
