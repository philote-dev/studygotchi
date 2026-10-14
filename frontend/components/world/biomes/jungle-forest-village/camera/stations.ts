/**
 * Biome stations (the diorama contract: pitch 34–40°, yaw ±35°, camera south/front looking
 * north/back) plus the free-camera limits of the expansive-world direction: the user may orbit
 * all the way round, drop to 12° and zoom out to 380 m, the look-at is boxed to the land, and
 * the outer world (edge/) must hide every plate edge from any pose inside the camera box.
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
  arrival: { id: 'arrival', label: 'Arrival', pitchDeg: 34, azimuthDeg: 18, fov: 30, fitWidth: 0.7, targetLift: 4 },
  overview: { id: 'overview', label: 'Overview', pitchDeg: 38, azimuthDeg: 0, fov: 34, fitWidth: 0.8, targetLift: 3 },
  /** Frames the district shape at ~70 % of the frame width (creature size follows the scale rule). */
  district: { id: 'district', label: 'District', pitchDeg: 36, azimuthDeg: 0, fov: 26, fitWidth: 0.75, targetLift: 1.6 },
  resident: { id: 'resident', label: 'Resident', pitchDeg: 34, azimuthDeg: 0, fov: 26, distance: 9, targetLift: 1.2 },
}

export interface CameraOverride {
  pitchDeg: number
  azimuthDeg: number
  dolly: number
  fov: number
}

export function clampBiomeYaw(azimuthDeg: number): number {
  return Math.min(35, Math.max(-35, azimuthDeg))
}

export interface JungleCameraLimits {
  /** Half yaw range in degrees; 180 means unlimited orbit. */
  yawDeg: number
  pitchMinDeg: number
  pitchMaxDeg: number
  minDistance: number
  maxDistance: number
}

/** Free camera: full orbit, 12–64° pitch, 40–380 m. The stations stay inside this envelope. */
export const JUNGLE_CAMERA_LIMITS: JungleCameraLimits = {
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

/** What the overview looks at (the product pose) and how far it stands. */
export const JUNGLE_LOOK_AT: [number, number, number] = [0, 4, 0]
export const OVERVIEW_DISTANCE = 270
export const ARRIVAL_DISTANCE = 205
export const DISTRICT_DISTANCE = 74
export const RESIDENT_DISTANCE = 10

/** The lab camera frame: the overview station's FOV on a 16:9 capture. */
export const JUNGLE_FRAME = { fovDeg: STATIONS.overview.fov, aspect: 16 / 9 } as const

/** CameraControls.setBoundary clamps the look-at, not the camera. This box is the land (288 × 264 m field plus a margin). */
export const JUNGLE_LOOK_BOX: Box = {
  min: [-150, -1, -140],
  max: [150, 40, 150],
}

/** Where the camera may sit: all round the land, low enough for a horizon shot. */
export const JUNGLE_CAMERA_BOX: Box = {
  min: [-460, 8, -460],
  max: [460, 300, 460],
}

export function clampToBox(box: Box, x: number, y: number, z: number): [number, number, number] {
  return [
    Math.min(box.max[0], Math.max(box.min[0], x)),
    Math.min(box.max[1], Math.max(box.min[1], y)),
    Math.min(box.max[2], Math.max(box.min[2], z)),
  ]
}

/** Camera position for a pitch / azimuth / distance about a target (the convention `poseFor` uses). */
export function orbitPosition(target: readonly [number, number, number], pitchDeg: number, azimuthDeg: number, distance: number): [number, number, number] {
  const pitch = (pitchDeg * Math.PI) / 180
  const azimuth = (azimuthDeg * Math.PI) / 180
  const horizontal = Math.cos(pitch) * distance
  return [target[0] + Math.sin(azimuth) * horizontal, target[1] + Math.sin(pitch) * distance, target[2] + Math.cos(azimuth) * horizontal]
}

export function defaultOverride(station: Station): CameraOverride {
  return { pitchDeg: station.pitchDeg, azimuthDeg: clampBiomeYaw(station.azimuthDeg), dolly: 1, fov: station.fov }
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
  const pitch = (override.pitchDeg * Math.PI) / 180
  const azimuth = (clampBiomeYaw(override.azimuthDeg) * Math.PI) / 180
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
