import type { CameraOverride, StationId } from './camera/stations'
import type { EdgeMode } from './edge/edge-lab'
import type { EdgePoseId } from './edge/poses'
import type { DistrictId, Progress } from './layout/jungle-layout'

export type JungleCatastrophePhase = 'calm' | 'monsoon' | 'strike' | 'overgrowth' | 'recovering'

export interface JungleCatastrophe {
  districtId: DistrictId | null
  phase: JungleCatastrophePhase
  startedAt: number
}

export interface JungleState {
  progress: Progress
  residents: number
  seed: number
  night: boolean
  mist: boolean
  birds: boolean
  waterEvent: boolean
  pixel: boolean
  station: StationId
  focusDistrict: DistrictId | null
  camera: CameraOverride
  catastrophe: JungleCatastrophe
  diving: boolean
  comparison: boolean
  /** The world beyond the plate: `outer` (the product) or `none` (the land as it shipped, for the lab). */
  edge: EdgeMode
  /** Edge lab (`?edge=` or `?pose=` in the URL): shows the floating panel. */
  edgeLab: boolean
  /** Fixed comparison pose from the URL, or null for the station / free camera. */
  pose: EdgePoseId | null
  reducedMotion: boolean
}

export const CATASTROPHE_SECONDS: Record<JungleCatastrophePhase, number> = {
  calm: 0,
  monsoon: 1.8,
  strike: 0.7,
  overgrowth: Number.POSITIVE_INFINITY,
  recovering: 2.4,
}
