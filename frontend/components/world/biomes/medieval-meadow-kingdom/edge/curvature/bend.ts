import { type Rect, rectEuclid } from '../../layout/terrain'
import { type EdgePose, edgePosePosition } from '../poses'

/**
 * Gentle world curvature, land-anchored (Animal Crossing's roll, far softer): beyond the authored
 * plate every outer-world vertex drops by `k · d²`, `d` being its Euclidean distance outside the
 * plate rectangle. Inside the plate nothing moves and the parabola is C1 at the edge, so the seam
 * has no crease. Unlike the ice land's shader patch this is baked into the outer geometry and the
 * instance positions at build time: zero runtime cost, and the authored land is never touched.
 *
 * k = 3e-5: 2.7 m at 300 m, 24 m at 900 m, 68 m at 1.5 km. From a 40 m camera at the plate edge
 * the apparent horizon sits ~4° down at ~1.15 km instead of 1.4° at the fog line, so the far
 * fields curl under the sky instead of ending on a fog band.
 */
export interface BendParams {
  k: number
}

export const BEND: BendParams = { k: 0.00003 }

export function bendDrop(outside: number, k: number = BEND.k): number {
  const t = Math.max(0, outside)
  return k * t * t
}

export function bendDropAt(plate: Rect, x: number, z: number, k: number = BEND.k): number {
  return bendDrop(rectEuclid(plate, x, z), k)
}

export interface Horizon {
  /** Angle below horizontal of the apparent horizon (the ray tangent to the rolled ground). */
  depressionDeg: number
  /** Planar distance from the camera to the tangent point. */
  distance: number
}

/**
 * Walk along the pose's view direction over a flat rolled ground and find the ray with the smallest
 * depression: everything beyond that point has curled under.
 */
export function horizonFromPose(pose: EdgePose, plate: Rect, k: number = BEND.k, maxDistance = 3000): Horizon {
  const camera = edgePosePosition(pose)
  const dx = pose.target[0] - camera[0]
  const dz = pose.target[2] - camera[2]
  const length = Math.hypot(dx, dz) || 1
  const dir = [dx / length, dz / length]
  let best: Horizon = { depressionDeg: Infinity, distance: 0 }
  for (let d = 1; d <= maxDistance; d += 2) {
    const x = camera[0] + dir[0] * d
    const z = camera[2] + dir[1] * d
    const drop = bendDropAt(plate, x, z, k)
    const depressionDeg = (Math.atan2(camera[1] + drop, d) * 180) / Math.PI
    if (depressionDeg < best.depressionDeg) best = { depressionDeg, distance: d }
  }
  return best
}
