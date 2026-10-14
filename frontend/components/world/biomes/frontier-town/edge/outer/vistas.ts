/**
 * Barriers and vistas: the pure plan. No three.js here.
 *
 * The reachable land is enclosed by geography (Skyrim's walls, Journey's dunes, God of War's
 * framed views): a mesa wall to the north behind the authored skyline, a gorge with a canyon rim
 * to the east, a dune ridge to the south, a hoodoo-studded escarpment to the west. Each outward
 * comparison pose looks through one composed window in that enclosure at a place you can see
 * but never reach, with exactly one light at night: a mesa-top settlement with a water tower, a
 * train crossing a timber trestle, a mission bell tower across the dry lake, a radio mast on a
 * far butte winking red.
 *
 * The lab camera shapes every number: FOV 26° on 16:9, outward poses at 14–15°, so the frame
 * top is 1–2° below the horizon and anything taller than the camera eye is cropped. Landmarks
 * therefore stand 310–430 m from their pose camera with their tops below its eye height.
 */
import { backdropHeightAt } from '../../layout/skyline'
import { FRONTIER_FREE_FOV } from '../../camera/limits'
import { FRONTIER_POSES, type FrontierPose, type FrontierPoseId, frontierPosePosition } from '../poses'

/* ---------- camera frame maths ---------- */

export const FRAME = { fovDeg: FRONTIER_FREE_FOV, aspect: 16 / 9 } as const

export interface Cam {
  x: number
  y: number
  z: number
}

export function poseCamera(pose: FrontierPose): Cam {
  const [x, y, z] = frontierPosePosition(pose)
  return { x, y, z }
}

/** Direction the pose looks (camera → target), degrees from +z toward +x. */
export function viewBearingDeg(pose: FrontierPose): number {
  return (pose.azimuthDeg + 180) % 360
}

export function wrapDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

export function bearingDeltaDeg(a: number, b: number): number {
  return Math.abs(wrapDeg(a - b))
}

export function bearingOf(x: number, z: number): number {
  return ((Math.atan2(x, z) * 180) / Math.PI + 360) % 360
}

/** Degrees below the horizontal from the camera to a point (positive = looking down). */
export function elevationDownDeg(cam: Cam, x: number, y: number, z: number): number {
  return (Math.atan2(cam.y - y, Math.hypot(x - cam.x, z - cam.z)) * 180) / Math.PI
}

export function frameTopDeg(pose: FrontierPose): number {
  return pose.pitchDeg - FRAME.fovDeg / 2
}

export function frameBottomDeg(pose: FrontierPose): number {
  return pose.pitchDeg + FRAME.fovDeg / 2
}

export function frameHalfWidthDeg(): number {
  return (Math.atan(Math.tan((FRAME.fovDeg * Math.PI) / 360) * FRAME.aspect) * 180) / Math.PI
}

/** Horizontal angle of a point off the pose's view direction. */
export function lateralDeg(pose: FrontierPose, x: number, z: number): number {
  const cam = poseCamera(pose)
  return bearingDeltaDeg(bearingOf(x - cam.x, z - cam.z), viewBearingDeg(pose))
}

/** Whether a world point lands inside the pose's frame, with a safety margin (degrees). */
export function inPoseFrame(pose: FrontierPose, x: number, y: number, z: number, margin = 0.6): boolean {
  const down = elevationDownDeg(poseCamera(pose), x, y, z)
  if (down < frameTopDeg(pose) + margin || down > frameBottomDeg(pose) - margin) return false
  return lateralDeg(pose, x, z) <= frameHalfWidthDeg() - margin
}

/** Point along the pose's horizontal view ray, `t` metres from the camera. */
export function alongRay(pose: FrontierPose, t: number): { x: number; z: number } {
  const cam = poseCamera(pose)
  const view = (viewBearingDeg(pose) * Math.PI) / 180
  return { x: cam.x + Math.sin(view) * t, z: cam.z + Math.cos(view) * t }
}

/* ---------- windows ---------- */

export type VistaId = 'north' | 'east' | 'south' | 'west'
export const VISTA_IDS: readonly VistaId[] = ['north', 'east', 'south', 'west']

const VISTA_POSES: Record<VistaId, FrontierPoseId> = { north: 'north-out', east: 'east-out', south: 'south-out', west: 'west-out' }

export function outwardPose(id: VistaId): FrontierPose {
  return FRONTIER_POSES.find((pose) => pose.id === VISTA_POSES[id])!
}

/**
 * Where each barrier stands, as the coordinate the pose ray crosses it at. North: the mesa wall
 * (row A) is a z line; east: the gorge centreline is an x line; south: the dune crest is a z
 * line; west: the escarpment is an x line. The window is cut where the ray crosses.
 */
export const BARRIER_LINE: Record<VistaId, number> = { north: -315, east: 385, south: 285, west: -330 }

/** Half-width of each window along its barrier, metres: wide enough to read, walls on both sides. */
export const WINDOW_HALF: Record<VistaId, number> = { north: 62, east: 70, south: 48, west: 52 }

export interface Window {
  id: VistaId
  poseId: FrontierPoseId
  /** Window centre on the barrier (the ray crossing). */
  x: number
  z: number
  /** Along-barrier coordinate of the centre (x for north / south, z for east / west). */
  along: number
  halfWidth: number
  /** Metres from the pose camera to the crossing. */
  fromCamera: number
}

/** Metres along the ray where it reaches the barrier line of a window's side. */
export function barrierCrossingT(pose: FrontierPose, id: VistaId): number {
  const cam = poseCamera(pose)
  const view = (viewBearingDeg(pose) * Math.PI) / 180
  const dx = Math.sin(view)
  const dz = Math.cos(view)
  const line = BARRIER_LINE[id]
  return id === 'north' || id === 'south' ? (line - cam.z) / dz : (line - cam.x) / dx
}

export function windows(): Window[] {
  return VISTA_IDS.map((id) => {
    const pose = outwardPose(id)
    const t = barrierCrossingT(pose, id)
    const p = alongRay(pose, t)
    const along = id === 'north' || id === 'south' ? p.x : p.z
    return { id, poseId: pose.id, x: p.x, z: p.z, along, halfWidth: WINDOW_HALF[id], fromCamera: t }
  })
}

/** 1 inside the window (full opening), easing to 0 past its half-width plus `feather`. */
export function windowOpening(w: Window, along: number, feather = 30): number {
  const d = Math.abs(along - w.along)
  if (d <= w.halfWidth) return 1
  const t = Math.min(1, (d - w.halfWidth) / feather)
  return 1 - t * t * (3 - 2 * t)
}

/* ---------- landmarks ---------- */

export type VistaKind = 'mesa-town' | 'trestle' | 'mission' | 'mast'

export interface Vista {
  id: VistaId
  kind: VistaKind
  x: number
  z: number
  /** Faces the pose camera (local +z toward the camera). */
  yaw: number
  /** Ground height the landmark stands on (the outer heightfield there). */
  base: number
  /** Silhouette height above `base`, metres. */
  height: number
  fromCamera: number
  light: 'warm' | 'red'
}

/**
 * Per window: how far along the pose's centre ray the landmark stands, what ground it stands on
 * and how tall it is. The numbers keep the top under the frame top and the base above the
 * barrier crest in front of it (see the sightline test).
 */
export const VISTA_SPEC: Record<VistaId, { kind: VistaKind; fromCamera: number; base: number; height: number; light: 'warm' | 'red' }> = {
  north: { kind: 'mesa-town', fromCamera: 440, base: 56, height: 16, light: 'warm' },
  east: { kind: 'trestle', fromCamera: 350, base: 0, height: 9, light: 'warm' },
  south: { kind: 'mission', fromCamera: 420, base: 0.5, height: 22, light: 'warm' },
  west: { kind: 'mast', fromCamera: 450, base: 10, height: 34, light: 'red' },
}

export function vistas(): Vista[] {
  return VISTA_IDS.map((id) => {
    const pose = outwardPose(id)
    const cam = poseCamera(pose)
    const spec = VISTA_SPEC[id]
    const p = alongRay(pose, spec.fromCamera)
    return {
      id,
      kind: spec.kind,
      x: p.x,
      z: p.z,
      yaw: Math.atan2(cam.x - p.x, cam.z - p.z),
      base: spec.base,
      height: spec.height,
      fromCamera: spec.fromCamera,
      light: spec.light,
    }
  })
}

export function vista(id: VistaId): Vista {
  return vistas().find((v) => v.id === id)!
}

/* ---------- sightlines ---------- */

/** Height of the line of sight from the camera to (x, y, z) when it passes over (px, pz). */
export function sightlineHeightAt(cam: Cam, x: number, y: number, z: number, px: number, pz: number): number {
  const total = Math.hypot(x - cam.x, z - cam.z)
  const t = Math.hypot(px - cam.x, pz - cam.z) / Math.max(1e-6, total)
  return cam.y + (y - cam.y) * t
}

/**
 * Clearance of a sightline over everything in front of the landmark: the authored skyline (at
 * the worst course band) and the outer heightfield (`groundAt`), sampled every `step` metres.
 * Positive = clear by that many metres at the tightest point.
 */
export function sightlineClearance(
  pose: FrontierPose,
  target: { x: number; y: number; z: number },
  groundAt: (x: number, z: number) => number,
  fraction = 1,
  step = 4,
): { clearance: number; at: [number, number] } {
  const cam = poseCamera(pose)
  const total = Math.hypot(target.x - cam.x, target.z - cam.z)
  let clearance = Infinity
  let at: [number, number] = [cam.x, cam.z]
  for (let t = step; t < total - 1; t += step) {
    const k = t / total
    const px = cam.x + (target.x - cam.x) * k
    const pz = cam.z + (target.z - cam.z) * k
    const los = cam.y + (target.y - cam.y) * k
    const ground = Math.max(groundAt(px, pz), backdropHeightAt(px, pz, fraction))
    const c = los - ground
    if (c < clearance) {
      clearance = c
      at = [px, pz]
    }
  }
  return { clearance, at }
}
