import type { ComponentType } from 'react'
import type { BiomeLayout, MountainProfile } from '../layout/biome-layout'
import type { IceCameraLimits } from '../camera/stations'
import type { SkyGrade } from '../scene/sky-blend'

/**
 * Edge lab: six ways real games hide the end of the world, built side by side on the ice land
 * so Philote can compare them from identical camera poses (`?edge=<id>&pose=<pose>`).
 */
export type EdgeTechniqueId = 'endless' | 'parallax' | 'curvature' | 'barriers' | 'sea' | 'cloudsea' | 'combined'

export const EDGE_TECHNIQUE_IDS: readonly EdgeTechniqueId[] = [
  'endless',
  'parallax',
  'curvature',
  'barriers',
  'sea',
  'cloudsea',
  'combined',
]

export interface EdgeSceneProps {
  layout: BiomeLayout
  night: boolean
  storm: boolean
  seed: number
  reducedMotion: boolean
  /**
   * The mountain profile the authored plate is built with, when the caller knows it (the product
   * scene always does): techniques that seat on the plate's rows then build in the first render
   * instead of reading the plate back from the scene graph after a commit.
   */
  profile?: MountainProfile
}

export interface EdgeTechnique {
  id: EdgeTechniqueId
  /** Short display name for the lab panel and the comparison sheet. */
  name: string
  /** Which shipped games do this; one line. */
  lineage: string
  /** What to look for at the edge; one paragraph for Philote. */
  pitch: string
  /**
   * Outer-world geometry, rendered inside BiomeScene after the authored land. It must not
   * change the authored mainland, its districts, residents, or camera stations.
   */
  Scene: ComponentType<EdgeSceneProps>
  /** Optional sky / fog / light overrides layered on the base day, night or storm grade. */
  sky?: (grade: SkyGrade, context: { night: boolean; storm: boolean }) => SkyGrade
  /** Optional tighter camera limits (never looser than the lab's free limits). */
  camera?: Partial<Pick<IceCameraLimits, 'pitchMinDeg' | 'pitchMaxDeg' | 'minDistance' | 'maxDistance'>>
}
