import type { ComponentType } from 'react'
import type { BiomeLayout } from '../layout/biome-layout'

/**
 * Edge lab for the highlands (`?edge=none|outer&pose=<id>`). One composed technique, `outer`,
 * is the shipped look: the endless continuation plus the barriers and vistas, the valley mist
 * and the sea horizon. `none` is the land as authored, for comparison from the same poses.
 */
export type EdgeTechniqueId = 'outer'

export const EDGE_TECHNIQUE_IDS: readonly EdgeTechniqueId[] = ['outer']

/** With no `edge` param the shipped look is the outer world. */
export const DEFAULT_TECHNIQUE: EdgeTechniqueId = 'outer'

export interface EdgeSceneProps {
  layout: BiomeLayout
  night: boolean
  storm: boolean
  seed: number
  reducedMotion: boolean
  /** Frozen scene time under a fixed lab pose (deterministic captures); null runs live. */
  frozenTime: number | null
}

export interface EdgeTechnique {
  id: EdgeTechniqueId
  name: string
  /** Which shipped games do this; one line. */
  lineage: string
  /** What to look for at the edge; one paragraph for Philote. */
  pitch: string
  /** Outer-world geometry, rendered inside BiomeScene after the authored land. */
  Scene: ComponentType<EdgeSceneProps>
}
