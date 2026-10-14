/**
 * Coastal Ruins camera stations. Pitch is elevation; azimuth runs from +z toward +x.
 *
 * Station distances are render units (the land is drawn at `layout.renderScale`, 0.17); the free
 * camera limits and boxes below are metres, the land's own unit, and `toRender` converts.
 */
import type { BiomeLayout } from '../layout/biome-layout'

export type StationId = 'arrival' | 'overview' | 'district' | 'landmark' | 'resident'

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
  arrival: { id: 'arrival', label: 'Arrival', pitchDeg: 36, azimuthDeg: 12, fov: 27, distance: 72, targetLift: 3.5 },
  overview: { id: 'overview', label: 'Overview', pitchDeg: 39, azimuthDeg: 0, fov: 27, distance: 76, targetLift: 3 },
  district: { id: 'district', label: 'District', pitchDeg: 36, azimuthDeg: 20, fov: 27, fitWidth: 0.75, targetLift: 2 },
  landmark: { id: 'landmark', label: 'Landmark', pitchDeg: 36, azimuthDeg: 18, fov: 27, fitWidth: 0.72, targetLift: 3 },
  resident: { id: 'resident', label: 'Resident', pitchDeg: 34, azimuthDeg: 12, fov: 27, distance: 10, targetLift: 1.25 },
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
  const pitch = (Math.min(40, Math.max(34, override.pitchDeg)) * Math.PI) / 180
  const azimuth = (Math.min(35, Math.max(-35, override.azimuthDeg)) * Math.PI) / 180
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

/** Globe-height dive start; clouds occlude the 40–60 % crossfade window. */
export function divePose(arrival: Pose): Pose {
  return {
    position: [arrival.position[0] * 1.45, arrival.position[1] * 5.4, arrival.position[2] * 1.45],
    target: arrival.target,
  }
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** What the overview / arrival stations frame: the mainland centre, a little south so the escarpment is the back. */
export function overviewSubject(layout: BiomeLayout): { center: [number, number, number]; chord: number } {
  const scale = layout.renderScale
  return { center: [8 * scale, layout.groundHeight * scale, 23 * scale], chord: layout.frameRadius * 2 * scale }
}

/* ---------- free camera (metres) ---------- */

export interface CoastalCameraLimits {
  /** Half yaw range in degrees; 180 means unlimited orbit. */
  yawDeg: number
  pitchMinDeg: number
  pitchMaxDeg: number
  /** Metres from the look-at. */
  minDistance: number
  maxDistance: number
}

export interface Box {
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * Full orbit, pitch 12–64° (low enough for the horizon, high enough for a plan view), 40–470 m
 * from the look-at: 470 m zooms past the overview (447 m) and keeps a centred camera inside the
 * ±460 m box at the lowest pitch (470 · cos 12° = 459.7).
 */
export const COASTAL_CAMERA_LIMITS: CoastalCameraLimits = {
  yawDeg: 180,
  pitchMinDeg: 12,
  pitchMaxDeg: 64,
  minDistance: 40,
  maxDistance: 470,
}

/** CameraControls.setBoundary clamps the look-at, not the camera. This box is the land: districts, escarpment, headland. */
export const COASTAL_LOOK_BOX: Box = {
  min: [-160, -1, -130],
  max: [160, 30, 120],
}

/** Where the camera may sit: all round the land, low enough for a horizon shot. */
export const COASTAL_CAMERA_BOX: Box = {
  min: [-460, 8, -460],
  max: [460, 320, 460],
}

function clampToBox(box: Box, x: number, y: number, z: number): [number, number, number] {
  return [
    Math.min(box.max[0], Math.max(box.min[0], x)),
    Math.min(box.max[1], Math.max(box.min[1], y)),
    Math.min(box.max[2], Math.max(box.min[2], z)),
  ]
}

export function clampLookTarget(x: number, y: number, z: number, box: Box = COASTAL_LOOK_BOX): [number, number, number] {
  return clampToBox(box, x, y, z)
}

export function clampCameraPosition(x: number, y: number, z: number, box: Box = COASTAL_CAMERA_BOX): [number, number, number] {
  return clampToBox(box, x, y, z)
}

/** Farthest the camera can be from the land centre: a look-at on the look box's corner plus the full zoom. */
export function cameraReach(limits: CoastalCameraLimits = COASTAL_CAMERA_LIMITS, look: Box = COASTAL_LOOK_BOX): number {
  const corner = Math.hypot(Math.max(-look.min[0], look.max[0]), Math.max(-look.min[2], look.max[2]))
  return corner + limits.maxDistance * Math.cos((limits.pitchMinDeg * Math.PI) / 180)
}

/** Metres → render units. */
export function toRender(layout: BiomeLayout, point: [number, number, number]): [number, number, number] {
  const s = layout.renderScale
  return [point[0] * s, point[1] * s, point[2] * s]
}

export function boxToRender(layout: BiomeLayout, box: Box): Box {
  return { min: toRender(layout, box.min), max: toRender(layout, box.max) }
}
