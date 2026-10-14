import { coastalRuins } from './coastal-ruins'
import { frontierTown } from './frontier-town'
import { iceTown } from './ice-town'
import { jungleForestVillage } from './jungle-forest-village'
import { medievalMeadowKingdom } from './medieval-meadow-kingdom'
import { nordicVolcanicHighlands } from './nordic-volcanic-highlands'
import type { DirectionId, LandId, LandVision } from './types'

export type { BlockoutSceneProps, Direction, DirectionId, LandId, LandVision, Pose, PoseId } from './types'
export { DIRECTION_IDS, LAND_IDS, POSE_IDS } from './types'

export const LANDS: readonly LandVision[] = [
  iceTown,
  medievalMeadowKingdom,
  coastalRuins,
  jungleForestVillage,
  nordicVolcanicHighlands,
  frontierTown,
]

export function landVision(id: LandId | string | null | undefined): LandVision | null {
  return LANDS.find((land) => land.id === id) ?? null
}

export function direction(land: LandVision, id: DirectionId | string | null | undefined) {
  return land.directions.find((entry) => entry.id === id) ?? land.directions[0]
}
