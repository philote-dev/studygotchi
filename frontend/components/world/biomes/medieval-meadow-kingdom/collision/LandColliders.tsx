'use client'

import { useMemo } from 'react'
import { type DistrictProgress, type GeneratedKingdom, type LandmarkStage, courseProgress, greenCrownProfile } from '../layout/biome-layout'
import { useCollider } from '../../collision/ColliderRegistry'
import { meadowLandColliders } from './footprints'

/**
 * Registers every static collider of the land in one group, from the same placement data the
 * meshes use (`footprints.ts`). Re-registers when progress changes the visible buildings, props
 * and landmark stage. `?colliders=1` draws them (ColliderDebug in BiomeScene).
 */
export function LandColliders({ layout, progress, seed, stage }: { layout: GeneratedKingdom; progress: DistrictProgress; seed: number; stage: LandmarkStage }) {
  const shapes = useMemo(() => meadowLandColliders(layout, seed, progress, stage, greenCrownProfile(courseProgress(layout, progress))), [layout, seed, progress, stage])
  useCollider(shapes)
  return null
}
