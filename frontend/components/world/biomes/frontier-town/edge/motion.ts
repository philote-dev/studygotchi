import type * as THREE from 'three'
import type { Route } from './outer/beyond-build'
import type { SmokeSource } from './outer/places'
import type { TrestleBuilt } from './outer/structures'

/**
 * Everything in the outer world that moves registers here, and ONE `useFrame` (OuterMotion in
 * Outer.tsx) drives it all: the far train, the mast beacon, the two carts, the smoke and dust
 * puffs, the ferry raft and the windmill wheels. Refs only; nothing here allocates per frame.
 */
export interface OuterMotionRefs {
  train: THREE.Group | null
  trainRun: { built: TrestleBuilt; length: number; dx: number; dz: number; yaw: number } | null
  beacon: THREE.MeshToonMaterial | null
  carts: THREE.InstancedMesh | null
  cartRoutes: Route[]
  smoke: THREE.InstancedMesh | null
  smokeSources: Array<SmokeSource & { y: number }>
  raft: THREE.Group | null
  raftPose: { x: number; y: number; z: number; yaw: number } | null
  wheels: THREE.InstancedMesh | null
  wheelPoses: Array<{ x: number; y: number; z: number; yaw: number; scale: number }>
}

export function emptyMotion(): OuterMotionRefs {
  return { train: null, trainRun: null, beacon: null, carts: null, cartRoutes: [], smoke: null, smokeSources: [], raft: null, raftPose: null, wheels: null, wheelPoses: [] }
}

/** Puffs per smoke source. */
export const PUFFS = 4
/** Train: metres per second along the line, and the pause (seconds) while it is hidden in the portal. */
export const TRAIN = { speed: 2.1, pause: 28 } as const
/** Beacon: period and the fraction of it the light is on. */
export const BEACON = { period: 2.2, on: 0.28 } as const
/** Carts walk the lanes at a mule's pace. */
export const CART_SPEED = 1.5

/** Where along its run the train is at time `t`, as metres from the start, or null while hidden. */
export function trainProgress(t: number, runLength: number): number | null {
  const travel = runLength / TRAIN.speed
  const cycle = travel + TRAIN.pause
  const k = ((t % cycle) + cycle) % cycle
  return k < travel ? k * TRAIN.speed : null
}

export function beaconOn(t: number): boolean {
  const k = ((t % BEACON.period) + BEACON.period) % BEACON.period
  return k < BEACON.period * BEACON.on
}

/** Puff `j` of source `i` at time `t`: its phase 0 → 1 from the chimney top to gone. */
export function puffPhase(t: number, i: number, j: number, dust: boolean): number {
  const speed = dust ? 0.06 : 0.085
  return (((t * speed + j / PUFFS + i * 0.173) % 1) + 1) % 1
}
