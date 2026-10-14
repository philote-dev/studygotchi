import { edgePosePosition, type EdgePose } from '../poses'

/**
 * World curvature, the pure geometry. The land is the top of a small planet: beyond `start`
 * metres from the land centre every vertex drops by `k · (r − start)²`. Inside `start` nothing
 * moves, so the town is identical from every camera; the parabola is C1 at `start`, so there
 * is no crease where the roll begins.
 *
 * Anchoring the bend on the land rather than on the camera (the Subway Surfers variant) is
 * deliberate: the overview camera sits ~200 m from the town, so a camera-relative bend that
 * starts at 120 m would already sink the far districts by 10+ m in the product pose.
 */
export interface BendParams {
  /** Curvature, metres of drop per metre² beyond the start radius. */
  k: number
  /** Radius from the land centre where the drop begins; the look box reaches 150 m. */
  start: number
}

/** 1/1250: from the four outward poses the horizon sits 6–8° lower; the plate edge dips 8 cm. */
export const BEND: BendParams = { k: 0.0008, start: 160 }

/** Metres a vertex at planar distance `d` from the bend origin drops. */
export function bendOffset(d: number, k: number, start: number): number {
  const t = Math.max(0, d - start)
  return k * t * t
}

/** d(offset)/dd: the tilt of the rolled ground at planar distance `d`. */
export function bendSlope(d: number, k: number, start: number): number {
  return 2 * k * Math.max(0, d - start)
}

/** Camera position and the planar unit vector it looks along, from a lab pose. */
export function poseRay(pose: EdgePose): { camera: [number, number, number]; dir: [number, number] } {
  const camera = edgePosePosition(pose)
  const dx = pose.target[0] - camera[0]
  const dz = pose.target[2] - camera[2]
  const length = Math.hypot(dx, dz) || 1
  return { camera, dir: [dx / length, dz / length] }
}

/** Depression angle of a flat sea point `distance` metres out, from the pose's camera height. */
export function flatHorizonDepressionDeg(pose: EdgePose, distance: number, seaLevel = -0.4): number {
  const { camera } = poseRay(pose)
  return (Math.atan2(camera[1] - seaLevel, distance) * 180) / Math.PI
}

export interface Horizon {
  /** Angle below horizontal of the apparent horizon (the ray tangent to the rolled sea). */
  depressionDeg: number
  /** Planar distance from the camera to the tangent point. */
  distance: number
  /** Radius of the tangent point from the land centre. */
  radius: number
  /** How far that point has dropped. */
  drop: number
}

/**
 * Walk along the pose's view azimuth and find the ray with the smallest depression: everything
 * beyond that point has rolled under. Sampled numerically because the camera is not at the
 * bend origin, so the closed form (d* = √(h/k + s²)) only holds for a centred camera.
 */
export function horizonFromPose(pose: EdgePose, bend: BendParams, seaLevel = -0.4, maxDistance = 2400): Horizon {
  const { camera, dir } = poseRay(pose)
  let best: Horizon = { depressionDeg: Infinity, distance: 0, radius: 0, drop: 0 }
  for (let d = 1; d <= maxDistance; d += 1) {
    const x = camera[0] + dir[0] * d
    const z = camera[2] + dir[1] * d
    const radius = Math.hypot(x, z)
    const drop = bendOffset(radius, bend.k, bend.start)
    const depressionDeg = (Math.atan2(camera[1] - (seaLevel - drop), d) * 180) / Math.PI
    if (depressionDeg < best.depressionDeg) best = { depressionDeg, distance: d, radius, drop }
  }
  return best
}

/** Vertical extent of a pose's frame in depression angle (the lab camera's FOV is 26°). */
export function poseFrameDeg(pose: EdgePose, fovDeg = 26): { top: number; bottom: number } {
  return { top: pose.pitchDeg - fovDeg / 2, bottom: pose.pitchDeg + fovDeg / 2 }
}
