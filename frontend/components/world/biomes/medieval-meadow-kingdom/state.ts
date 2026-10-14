import type { DistrictProgress } from './layout/biome-layout'
import type { CameraOverride, StationId } from './camera/stations'
import type { EdgePoseId } from './edge/poses'
import type { EdgeMode } from './edge/types'

export type CatastrophePhase = 'calm' | 'blizzard' | 'bang' | 'ruin' | 'recovering'

export interface CatastropheState {
  districtId: string | null
  phase: CatastrophePhase
  /** Seconds since the phase began; the scene advances phases on a timer. */
  startedAt: number
}

export interface LabState {
  progress: DistrictProgress
  residents: number
  seed: number
  night: boolean
  clouds: boolean
  snowfall: boolean
  /** Whale events on/off (the whale is an event, never a fixture). */
  whale: boolean
  pixel: boolean
  showReferences: boolean
  station: StationId
  focusDistrict: string | null
  camera: CameraOverride
  catastrophe: CatastropheState
  diving: boolean
  /** Edge lab (`?edge=`): panel and fixed poses on; `edge` is the outer world on / off (product default `outer`). */
  edgeLab: boolean
  edge: EdgeMode
  pose: EdgePoseId | null
  reducedMotion: boolean
}

export const PHASE_SECONDS: Record<CatastrophePhase, number> = {
  calm: 0,
  blizzard: 2.0,
  bang: 0.6,
  ruin: Number.POSITIVE_INFINITY,
  recovering: 3.0,
}
