import type { DistrictProgress } from './layout/biome-layout'
import type { CameraOverride, StationId } from './camera/stations'
import type { FrontierPoseId } from './edge/poses'
import type { EdgeMode } from './edge/types'

export type CatastrophePhase = 'calm' | 'dust' | 'impact' | 'ruin' | 'recovering'

export interface LabState {
  progress: DistrictProgress
  residents: number
  seed: number
  night: boolean
  dust: boolean
  train: boolean
  wildlife: boolean
  pixel: boolean
  station: StationId
  focusDistrict: string | null
  camera: CameraOverride
  catastrophe: { districtId: string | null; phase: CatastrophePhase }
  /** Edge lab (`?edge=`): `outer` ships the endless desert + barriers; `none` is the slab as shipped. */
  edge?: EdgeMode
  /** Fixed comparison pose (`?pose=`); null leaves the free camera where the station put it. */
  pose?: FrontierPoseId | null
  /** QA look-at (`?cam=x,y,z,tx,ty,tz`), applied over the pose. */
  customCamera?: { position: [number, number, number]; target: [number, number, number] } | null
  reducedMotion?: boolean
}
