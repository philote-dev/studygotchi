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

/**
 * Lab camera contract (SHIP-HANDOFF §6 / §7 Q2, Philote 2026-10-10): pitches 30 / 36 / 30 / 18,
 * fit widths 0.7 / 0.7 / 0.75, resident distance 9, FOV 26, free azimuth; values as in
 * prototypes/biome-lab/src/camera/stations.ts. Not the 34–40° / ±35° diorama contract.
 */
export const STATIONS: Record<StationId, Station> = {
  arrival: { id: 'arrival', label: 'Arrival', pitchDeg: 30, azimuthDeg: 16, fov: 26, fitWidth: 0.7, targetLift: 3 },
  overview: { id: 'overview', label: 'Overview', pitchDeg: 36, azimuthDeg: 16, fov: 26, fitWidth: 0.7, targetLift: 2.6 },
  /** Frames the district shape at ~75 % of the frame width along its `stationAzimuth` (creature size follows the scale rule). */
  district: { id: 'district', label: 'District', pitchDeg: 30, azimuthDeg: 30, fov: 26, fitWidth: 0.75, targetLift: 1.6 },
  resident: { id: 'resident', label: 'Resident', pitchDeg: 18, azimuthDeg: 20, fov: 26, distance: 9, targetLift: 1.2 },
}

/** District station azimuth: the layout's per-district `stationAzimuth`, else the station default. */
export function districtStationAzimuth(district: { stationAzimuth?: number } | null | undefined): number {
  return district?.stationAzimuth ?? STATIONS.district.azimuthDeg
}

export interface CameraOverride {
  pitchDeg: number
  azimuthDeg: number
  dolly: number
  fov: number
}

export function defaultOverride(station: Station): CameraOverride {
  return { pitchDeg: station.pitchDeg, azimuthDeg: station.azimuthDeg, dolly: 1, fov: station.fov }
}

export interface IceCameraLimits {
  preferredAzimuthDeg: number
  /** Half yaw range in degrees; 180 means unlimited orbit. */
  yawDeg: number
  pitchMinDeg: number
  pitchMaxDeg: number
  minDistance: number
  maxDistance: number
  /** Keep the camera south of the look-at (the product diorama contract). */
  southOnly: boolean
}

export interface Box {
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * Product roam: whole mainland in frame, harbour through mountains, still boxed. Free azimuth
 * (yawDeg 180 = no CameraControls azimuth clamp); pitch range is the lab rig's polar clamp
 * (0.35–1.25 rad → 18–70°) so every lab station pitch is reachable.
 */
export const ICE_CAMERA_LIMITS: IceCameraLimits = {
  preferredAzimuthDeg: 16,
  yawDeg: 180,
  pitchMinDeg: 18,
  pitchMaxDeg: 70,
  minDistance: 88,
  maxDistance: 360,
  southOnly: false,
}

/**
 * Edge lab (`?edge=`): the camera may orbit all the way round, drop low enough to see the
 * horizon, and truck to every coast so each edge technique is judged where it is weakest.
 * World bounds still exist; the techniques must make them invisible from every reachable pose.
 */
export const ICE_FREE_CAMERA_LIMITS: IceCameraLimits = {
  preferredAzimuthDeg: 16,
  yawDeg: 180,
  pitchMinDeg: 12,
  pitchMaxDeg: 64,
  minDistance: 40,
  maxDistance: 380,
  southOnly: false,
}

/** Mainland centre: town plus a little south so the range stays the back edge. */
export const ICE_LOOK_AT: [number, number, number] = [2, 2.4, 8]
export const ICE_OVERVIEW_CHORD = 176

/** CameraControls.setBoundary clamps the look-at, not the camera. This box is the land. */
export const ICE_LOOK_BOX: Box = {
  min: [-128, -1, -82],
  max: [128, 24, 102],
}

/** Where the camera may sit: wide enough for every station pose (overview at 36° / 0.82, oblique district azimuths). */
export const ICE_CAMERA_BOX: Box = {
  min: [-160, 20, -20],
  max: [196, 220, 300],
}

/** Edge lab look box: every coast of the terrain plate, so the look-at can sit on an edge. */
export const ICE_FREE_LOOK_BOX: Box = {
  min: [-150, -1, -150],
  max: [150, 40, 150],
}

/** Edge lab camera box: all round the land, low enough for a horizon shot. */
export const ICE_FREE_CAMERA_BOX: Box = {
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

export function clampLookTarget(x: number, y: number, z: number, box: Box = ICE_LOOK_BOX): [number, number, number] {
  return clampToBox(box, x, y, z)
}

export function clampCameraPosition(
  x: number,
  y: number,
  z: number,
  targetZ: number,
  box: Box = ICE_CAMERA_BOX,
  southOnly = true,
): [number, number, number] {
  const clamped = clampToBox(box, x, y, z)
  if (!southOnly) return clamped
  const south = Math.max(z, targetZ + 28, box.min[2])
  return [clamped[0], clamped[1], Math.min(box.max[2], south)]
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
  const azimuth = (override.azimuthDeg * Math.PI) / 180
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
