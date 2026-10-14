import type { ComponentType } from 'react'

/**
 * Vision lab: three composition blockouts per land, judged from the same cinematic poses.
 * A blockout is massing, not detail: terrain relief, the hero architecture's silhouette,
 * districts as coloured volumes, water, paths. Philote picks one per land; the pick is then
 * built to full fidelity in the product land.
 */
export type LandId = 'ice-town' | 'medieval-meadow-kingdom' | 'coastal-ruins' | 'jungle-forest-village' | 'nordic-volcanic-highlands' | 'frontier-town'

export const LAND_IDS: readonly LandId[] = [
  'ice-town',
  'medieval-meadow-kingdom',
  'coastal-ruins',
  'jungle-forest-village',
  'nordic-volcanic-highlands',
  'frontier-town',
]

export type DirectionId = 'a' | 'b' | 'c'
export const DIRECTION_IDS: readonly DirectionId[] = ['a', 'b', 'c']

/** Cinematic poses; the lab adds a free orbit on top. */
export type PoseId = 'hero' | 'walk' | 'overview' | 'reverse'
export const POSE_IDS: readonly PoseId[] = ['hero', 'walk', 'overview', 'reverse']

export interface Pose {
  id: PoseId
  /** Camera position and look-at in blockout metres (the land is ~300 m across, centred at 0,0). */
  position: readonly [number, number, number]
  target: readonly [number, number, number]
  fov?: number
}

export interface BlockoutSceneProps {
  night: boolean
  seed: number
}

export interface Direction {
  id: DirectionId
  /** The composition's name, e.g. "Citadel on the Crag". */
  name: string
  /** What it borrows from (Minas Tirith, Ilios, the Ruins map, ...) and how it differs. */
  lineage: string
  /** One paragraph for Philote: the big idea, the verticality, the silhouette, where the districts live, what the characters walk past. */
  pitch: string
  /** Three to five strongest reasons this is the one. */
  strengths: readonly string[]
  /** Honest risks: gameplay fit, cost, camera, progress bands. */
  risks: readonly string[]
  /** The massing blockout. Must render terrain relief, hero architecture, districts as volumes, water and paths. */
  Scene: ComponentType<BlockoutSceneProps>
  /** Poses for this composition; every PoseId must be present. */
  poses: readonly Pose[]
}

export interface LandVision {
  id: LandId
  name: string
  /** The land's story in one line (from its biome brief). */
  story: string
  directions: readonly [Direction, Direction, Direction]
}
