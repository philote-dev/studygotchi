import type { CameraOverride, StationId } from './camera/stations'
import type { DistrictProgress } from './layout/biome-layout'
import type { EdgePoseId } from './edge/poses'
import type { EdgeMode } from './edge/use-edge-lab'

export type CatastrophePhase = 'calm' | 'squall' | 'quake' | 'ruin' | 'recovering'

export interface CatastropheState {
  districtId: string | null
  phase: CatastrophePhase
  startedAt: number
}

export interface LabState {
  progress: DistrictProgress
  residents: number
  seed: number
  night: boolean
  clouds: boolean
  boatEvent: boolean
  pixel: boolean
  markerMode: boolean
  station: StationId
  focusDistrict: string | null
  camera: CameraOverride
  catastrophe: CatastropheState
  diving: boolean
  /** Outer world on (`outer`, the default) or the land as shipped (`?edge=none`). */
  edge?: EdgeMode
  /** Edge lab (`?edge=` / `?pose=`): the panel shows and a fixed comparison pose may apply. */
  edgeLab?: boolean
  pose?: EdgePoseId | null
  /** `prefers-reduced-motion`: the far sail holds still, the moon path does not shimmer. */
  reducedMotion?: boolean
}

export const PHASE_SECONDS: Record<CatastrophePhase, number> = {
  calm: 0,
  squall: 1.8,
  quake: 0.8,
  ruin: Number.POSITIVE_INFINITY,
  recovering: 2.5,
}
