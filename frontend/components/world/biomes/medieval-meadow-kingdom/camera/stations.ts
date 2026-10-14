/**
 * Camera stations (biome-world-structure.md §6, district station per the pass-3 review).
 * Pitch = elevation above the tangent plane, azimuth measured from +z (front) toward +x.
 * Distances derived from what must fit the frame.
 */

export type StationId = 'arrival' | 'overview' | 'district' | 'resident'

export interface Station {
  id: StationId
  label: string
  pitchDeg: number
  azimuthDeg: number
  fov: number
  /** Fraction of the frame width the subject chord should fill; undefined → fixed distance. */
  fitWidth?: number
  distance?: number
  /** Look-at height above the subject centre. */
  targetLift: number
}

export const STATIONS: Record<StationId, Station> = {
  arrival: { id: 'arrival', label: 'Arrival', pitchDeg: 34, azimuthDeg: 8, fov: 36, fitWidth: 0.82, targetLift: 3 },
  overview: { id: 'overview', label: 'Overview', pitchDeg: 38, azimuthDeg: 8, fov: 36, fitWidth: 0.9, targetLift: 3 },
  /** Frames the district shape at ~70 % of the frame width (creature size follows the scale rule). */
  district: { id: 'district', label: 'District', pitchDeg: 36, azimuthDeg: 8, fov: 36, fitWidth: 0.8, targetLift: 2.4 },
  resident: { id: 'resident', label: 'Resident', pitchDeg: 34, azimuthDeg: 8, fov: 36, distance: 9, targetLift: 1.2 },
}

/** Product-land roam inside the shared south/front diorama contract. */
export const CAMERA_LIMITS = {
  preferredHeadingDeg: 8,
  yawDeg: 35,
  pitchMinDeg: 34,
  pitchMaxDeg: 40,
  minDistance: 22,
  maxDistance: 300,
  minDolly: 0.42,
  maxDolly: 1.65,
} as const

/**
 * Free roam (edge rollout, Philote 2026-10-10): the camera orbits all the way round, drops to a
 * 12° horizon look and pulls back far enough to see the whole plate, while the look-at stays on
 * the land and the camera inside a ±460 m box. The stations above keep the diorama values; only
 * the roam limits widened.
 */
export interface FreeCameraLimits {
  /** Half yaw range in degrees; 180 means unlimited orbit. */
  yawDeg: number
  pitchMinDeg: number
  pitchMaxDeg: number
  minDistance: number
  maxDistance: number
}

export const MEADOW_FREE_CAMERA_LIMITS: FreeCameraLimits = {
  yawDeg: 180,
  pitchMinDeg: 12,
  pitchMaxDeg: 64,
  minDistance: 40,
  maxDistance: 380,
}

export interface Box {
  min: [number, number, number]
  max: [number, number, number]
}

/** CameraControls.setBoundary clamps the look-at, not the camera. This box is the authored land. */
export const MEADOW_LOOK_BOX: Box = {
  min: [-140, -1, -135],
  max: [140, 40, 135],
}

/** Where the camera may sit: all round the land, low enough for a horizon shot, never under the plate. */
export const MEADOW_CAMERA_BOX: Box = {
  min: [-460, 10, -460],
  max: [460, 300, 460],
}

function clampToBox(box: Box, x: number, y: number, z: number): [number, number, number] {
  return [
    Math.min(box.max[0], Math.max(box.min[0], x)),
    Math.min(box.max[1], Math.max(box.min[1], y)),
    Math.min(box.max[2], Math.max(box.min[2], z)),
  ]
}

export function clampLookTarget(x: number, y: number, z: number, box: Box = MEADOW_LOOK_BOX): [number, number, number] {
  return clampToBox(box, x, y, z)
}

export function clampCameraPosition(x: number, y: number, z: number, box: Box = MEADOW_CAMERA_BOX): [number, number, number] {
  return clampToBox(box, x, y, z)
}

export function insideBox(box: Box, x: number, y: number, z: number): boolean {
  return x >= box.min[0] && x <= box.max[0] && y >= box.min[1] && y <= box.max[1] && z >= box.min[2] && z <= box.max[2]
}

export function clampDioramaYaw(yawDeg: number): number {
  return Math.min(CAMERA_LIMITS.yawDeg, Math.max(-CAMERA_LIMITS.yawDeg, yawDeg))
}

export function clampDioramaPitch(pitchDeg: number): number {
  return Math.min(CAMERA_LIMITS.pitchMaxDeg, Math.max(CAMERA_LIMITS.pitchMinDeg, pitchDeg))
}

export function clampDolly(dolly: number): number {
  return Math.min(CAMERA_LIMITS.maxDolly, Math.max(CAMERA_LIMITS.minDolly, dolly))
}

/** Fixed front-facing acceptance pose used for the −35/0/+35 yaw checks. */
export function overviewPoseForYaw(yawDeg: number, dolly = 1): CameraOverride {
  return {
    pitchDeg: STATIONS.overview.pitchDeg,
    azimuthDeg: clampDioramaYaw(yawDeg),
    dolly: clampDolly(dolly),
    fov: STATIONS.overview.fov,
  }
}

export interface CameraOverride {
  pitchDeg: number
  azimuthDeg: number
  dolly: number
  fov: number
}

export function defaultOverride(station: Station): CameraOverride {
  return {
    pitchDeg: clampDioramaPitch(station.pitchDeg),
    azimuthDeg: clampDioramaYaw(station.azimuthDeg),
    dolly: 1,
    fov: station.fov,
  }
}

/** Distance so that a chord of `width` metres fills `fraction` of the frame width. */
export function fitDistance(width: number, fraction: number, fovDeg: number, aspect: number): number {
  const fovV = (fovDeg * Math.PI) / 180
  const halfH = Math.atan(Math.tan(fovV / 2) * aspect)
  return width / (2 * fraction * Math.tan(halfH))
}

export interface Pose {
  position: [number, number, number]
  target: [number, number, number]
}

export function poseFor(
  station: Station,
  override: CameraOverride,
  subject: { center: [number, number, number]; chord: number },
  aspect: number,
): Pose {
  const distance =
    (station.fitWidth !== undefined
      ? fitDistance(subject.chord, station.fitWidth, override.fov, aspect)
      : (station.distance ?? 10)) * override.dolly
  const pitch = (clampDioramaPitch(override.pitchDeg) * Math.PI) / 180
  const azimuth = (clampDioramaYaw(override.azimuthDeg) * Math.PI) / 180
  const horizontal = Math.cos(pitch) * distance
  const target: [number, number, number] = [
    subject.center[0],
    subject.center[1] + station.targetLift,
    subject.center[2],
  ]
  return {
    position: [
      target[0] + Math.sin(azimuth) * horizontal,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(azimuth) * horizontal,
    ],
    target,
  }
}

/** The product overview as CameraRig frames the land (centre on the origin, 184 m chord) at a given aspect. */
export function overviewPose(aspect: number, chord = 184): Pose {
  return poseFor(STATIONS.overview, defaultOverride(STATIONS.overview), { center: [0, 0, 0], chord }, aspect)
}

/** Dive start: high above the arrival pose, so the flight passes the cloud layer (h ≈ 14 m). */
export function divePose(arrival: Pose): Pose {
  return {
    position: [arrival.position[0] * 1.35, arrival.position[1] * 5.2, arrival.position[2] * 1.35],
    target: arrival.target,
  }
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
