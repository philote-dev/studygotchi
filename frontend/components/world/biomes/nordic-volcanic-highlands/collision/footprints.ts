/**
 * The one list of ground-plane colliders for the highlands: the authored districts (from the
 * placement tables), the hand-built landmarks standing at the current band, and the ambient
 * dressing. Everything the scene draws on the slabs is registered from here, so the walkers
 * steer round exactly what is drawn.
 */
import type { Collider } from '../../collision/colliders'
import { type BiomeLayout, type DistrictProgress, courseProgress } from '../layout/biome-layout'
import { type Dressing, dressing, dressingColliders } from '../layout/dressing'
import { type Band, bandForFraction, landmarkColliders, landmarksForBand } from '../layout/landmarks'
import { landColliders } from '../layout/placements'

export type Footprint = Collider & { tag: string; id: string }

export interface LandFootprints {
  band: Band
  authored: Footprint[]
  landmarks: Footprint[]
  dressing: Footprint[]
  all: Footprint[]
  items: Dressing[]
}

export function landFootprints(layout: BiomeLayout, seed: number, progress: DistrictProgress): LandFootprints {
  const band = bandForFraction(courseProgress(layout, progress))
  const authored = landColliders(layout, seed, progress)
  const landmarks = landmarksForBand(band).flatMap((spec) => landmarkColliders(spec, band))
  const items = dressing(layout, seed)
  const dressed = dressingColliders(items)
  return { band, authored, landmarks, dressing: dressed, all: [...authored, ...landmarks, ...dressed], items }
}
