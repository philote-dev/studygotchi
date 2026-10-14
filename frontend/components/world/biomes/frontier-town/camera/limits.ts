/**
 * Free camera for the frontier land (the direction Philote chose on the ice land): full orbit,
 * pitch 12–64°, zoom from one district filling the frame to the whole land, the look-at boxed
 * to the land, the camera boxed to ±460 m. The six diorama stations in ./stations.ts are kept
 * exactly as they were and are only used as the poses the camera starts from.
 */

export interface FrontierCameraLimits {
  /** Half yaw range in degrees; 180 means unlimited orbit. */
  yawDeg: number
  pitchMinDeg: number
  pitchMaxDeg: number
  minDistance: number
  maxDistance: number
}

export interface Box {
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * Distances: a district (≈ 60 m chord) fills the frame at 26° FOV from ~130 m; the authored
 * land (440 m across) fits at ~540 m. The pitch floor is the lab's horizon pitch.
 */
export const FRONTIER_CAMERA_LIMITS: FrontierCameraLimits = {
  yawDeg: 180,
  pitchMinDeg: 12,
  pitchMaxDeg: 64,
  minDistance: 60,
  maxDistance: 540,
}

/** The authored plate (ground, districts, rails, arroyo, back skyline): the look-at stays on it. */
export const FRONTIER_LOOK_BOX: Box = {
  min: [-240, -1, -200],
  max: [240, 60, 170],
}

/** Where a pose may put the camera. */
export const FRONTIER_CAMERA_BOX: Box = {
  min: [-460, 8, -460],
  max: [460, 420, 460],
}

/** Overview station FOV: the lab poses and the free camera share it. */
export const FRONTIER_FREE_FOV = 26

export function clampToBox(box: Box, x: number, y: number, z: number): [number, number, number] {
  return [
    Math.min(box.max[0], Math.max(box.min[0], x)),
    Math.min(box.max[1], Math.max(box.min[1], y)),
    Math.min(box.max[2], Math.max(box.min[2], z)),
  ]
}

/**
 * Furthest the camera can get from the origin along x / z: a look-at on the plate edge plus the
 * maximum dolly, horizontal at the lowest pitch. The outer world's rings must cover this, and
 * its last ring must reach past it by the fog distance.
 */
export function cameraReach(limits: FrontierCameraLimits = FRONTIER_CAMERA_LIMITS, look: Box = FRONTIER_LOOK_BOX): { x: number; z: number } {
  const horizontal = Math.cos((limits.pitchMinDeg * Math.PI) / 180) * limits.maxDistance
  return {
    x: Math.max(Math.abs(look.min[0]), Math.abs(look.max[0])) + horizontal,
    z: Math.max(Math.abs(look.min[2]), Math.abs(look.max[2])) + horizontal,
  }
}

/** Distance so that a chord of `width` metres fills `fraction` of the frame width. */
export function fitDistance(width: number, fraction: number, fovDeg: number, aspect: number): number {
  const fovV = (fovDeg * Math.PI) / 180
  const halfH = Math.atan(Math.tan(fovV / 2) * aspect)
  return width / (2 * fraction * Math.tan(halfH))
}

/** Camera position for a target, pitch (elevation), azimuth (from +z toward +x, target → camera) and distance. */
export function orbitPosition(target: [number, number, number], pitchDeg: number, azimuthDeg: number, distance: number): [number, number, number] {
  const pitch = (pitchDeg * Math.PI) / 180
  const azimuth = (azimuthDeg * Math.PI) / 180
  const horizontal = Math.cos(pitch) * distance
  return [target[0] + Math.sin(azimuth) * horizontal, target[1] + Math.sin(pitch) * distance, target[2] + Math.cos(azimuth) * horizontal]
}

/** Pitch / azimuth / distance of a camera position relative to its target (inverse of `orbitPosition`). */
export function orbitOf(position: [number, number, number], target: [number, number, number]): { pitchDeg: number; azimuthDeg: number; distance: number } {
  const dx = position[0] - target[0]
  const dy = position[1] - target[1]
  const dz = position[2] - target[2]
  const horizontal = Math.hypot(dx, dz)
  return {
    pitchDeg: (Math.atan2(dy, horizontal) * 180) / Math.PI,
    azimuthDeg: ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360,
    distance: Math.hypot(dx, dy, dz),
  }
}
