import { DIRECTION_IDS, LAND_IDS, POSE_IDS, type DirectionId, type LandId, type PoseId } from './lands/types'

export interface LabState {
  land: LandId
  direction: DirectionId
  /** null = free orbit from the hero pose. */
  pose: PoseId | null
  night: boolean
  seed: number
}

export const INITIAL_STATE: LabState = { land: 'ice-town', direction: 'a', pose: 'hero', night: false, seed: 7 }

export function stateFromSearch(search: string): LabState {
  const params = new URLSearchParams(search)
  const land = params.get('land')
  const dir = params.get('dir')
  const pose = params.get('pose')
  return {
    land: (LAND_IDS as readonly string[]).includes(land ?? '') ? (land as LandId) : INITIAL_STATE.land,
    direction: (DIRECTION_IDS as readonly string[]).includes(dir ?? '') ? (dir as DirectionId) : INITIAL_STATE.direction,
    pose: pose === 'free' ? null : (POSE_IDS as readonly string[]).includes(pose ?? '') ? (pose as PoseId) : INITIAL_STATE.pose,
    night: params.get('night') === '1',
    seed: Number(params.get('seed') ?? INITIAL_STATE.seed) || INITIAL_STATE.seed,
  }
}

export function searchFromState(state: LabState): string {
  const params = new URLSearchParams()
  params.set('land', state.land)
  params.set('dir', state.direction)
  params.set('pose', state.pose ?? 'free')
  if (state.night) params.set('night', '1')
  if (state.seed !== INITIAL_STATE.seed) params.set('seed', String(state.seed))
  return `?${params.toString()}`
}
