/**
 * The river winding on. The authored ribbon stops at (−22, −132) in the north and (42, 190) in
 * the south, on the flat plate. These polylines continue it: the first segment runs straight on
 * from the authored end so the ribbon normals match and the two ribbons butt together exactly,
 * then the river winds north up its valley to a spring under the ridge saddle, and south down
 * to the lake. Pure data.
 */
import type { GeneratedKingdom, Point2 } from '../../layout/biome-layout'
import { distToPolyline } from '../../layout/terrain'

export interface RiverContinuation {
  /** From the authored north end up to the source (first point = authored end). */
  north: Point2[]
  /** From the authored south end down into the lake (first point = authored end). */
  south: Point2[]
  /** The far mill: on the east bank of the north reach, facing the river. */
  mill: { x: number; z: number; yaw: number }
}

const NORTH_BENDS: Point2[] = [
  [-30, -200],
  [-46, -238],
  [-46, -270],
  [-58, -304],
  [-64, -340],
  [-60, -372],
  [-68, -404],
  [-80, -434],
]

const SOUTH_BENDS: Point2[] = [
  [40, 250],
  [54, 285],
  [62, 318],
  [60, 352],
]

/** Spline sample pitch along the continuations, metres. */
export const RIVER_STEP = 10

/**
 * Catmull-Rom through the control points, resampled every `step` metres. The first segment
 * (authored end → straight point) is kept straight so the ribbon butts onto the authored one;
 * from there the bends become one continuous meander of constant width.
 */
export function meander(points: Point2[], step = RIVER_STEP): Point2[] {
  if (points.length < 3) return points
  const out: Point2[] = [points[0], points[1]]
  const at = (i: number) => points[Math.min(points.length - 1, Math.max(0, i))]
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const length = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    const n = Math.max(1, Math.round(length / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  return out
}

export function riverContinuation(layout: GeneratedKingdom): RiverContinuation {
  const river = layout.river
  const northEnd = river[0]
  const northPrev = river[1]
  const southEnd = river[river.length - 1]
  const southPrev = river[river.length - 2]
  const straight = (end: Point2, prev: Point2, length: number): Point2 => {
    const dx = end[0] - prev[0]
    const dz = end[1] - prev[1]
    const l = Math.hypot(dx, dz) || 1
    return [end[0] + (dx / l) * length, end[1] + (dz / l) * length]
  }
  const north = meander([northEnd, straight(northEnd, northPrev, 30), ...NORTH_BENDS])
  const south = meander([southEnd, straight(southEnd, southPrev, 30), ...SOUTH_BENDS])
  // The mill stands on the east bank where the north reach passes z ≈ −262.
  let k = north.findIndex((p) => p[1] <= -262)
  if (k < 1) k = north.length - 1
  const a = north[k - 1]
  const b = north[k]
  const t = (-262 - a[1]) / (b[1] - a[1] || -1)
  const cx = a[0] + (b[0] - a[0]) * t
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l = Math.hypot(dx, dz) || 1
  // Bank normal pointing east-ish, 15.5 m off the centreline (the bank band is 14 m).
  let nx = -dz / l
  let nz = dx / l
  if (nx < 0) {
    nx = -nx
    nz = -nz
  }
  return { north, south, mill: { x: cx + nx * 15.5, z: -262 + nz * 15.5, yaw: Math.atan2(-nx, -nz) } }
}

export interface RiverHit {
  dist: number
  reach: 'authored' | 'north' | 'south'
  /** 0 at the authored end, 1 at the far end of the reach (0 on the authored reach). */
  t: number
}

/** Nearest point on the whole river (authored plus both continuations). */
export function riverDistance(layout: GeneratedKingdom, cont: RiverContinuation, x: number, z: number): RiverHit {
  const a = distToPolyline(layout.river, x, z)
  const n = distToPolyline(cont.north, x, z)
  const s = distToPolyline(cont.south, x, z)
  let best: RiverHit = { dist: a.dist, reach: 'authored', t: 0 }
  if (n.dist < best.dist) best = { dist: n.dist, reach: 'north', t: n.t }
  if (s.dist < best.dist) best = { dist: s.dist, reach: 'south', t: s.t }
  return best
}

/** Water width along a reach: the authored 18 m on the plate, narrowing to a brook at the north source. */
export function riverWidthAt(layout: GeneratedKingdom, cont: RiverContinuation, hit: RiverHit, z: number, plateMinZ: number): number {
  if (hit.reach !== 'north') return layout.riverWidth
  // Full width through the seam and for 60 m beyond it; then a steady narrowing to a brook at the source.
  const source = cont.north[cont.north.length - 1][1]
  const hold = 60
  const k = Math.min(1, Math.max(0, (plateMinZ - z - hold) / (plateMinZ - source - hold)))
  return layout.riverWidth * (1 - 0.86 * Math.pow(k, 1.6))
}

/**
 * Bed level relative to the plate top: 0 on the plate (the ribbon sits at +0.045 there), climbing
 * 6 m to the source beyond the north edge, falling to the lake level beyond the south edge.
 */
export function riverBedAt(cont: RiverContinuation, hit: RiverHit, z: number, plate: { minZ: number; maxZ: number }, lakeLevel: number): number {
  if (hit.reach === 'north') {
    const source = cont.north[cont.north.length - 1][1]
    const k = Math.min(1, Math.max(0, (plate.minZ - z) / (plate.minZ - source)))
    return 6 * k * k
  }
  if (hit.reach === 'south') {
    const k = Math.min(1, Math.max(0, (z - plate.maxZ) / 70))
    return lakeLevel * k * (2 - k)
  }
  return 0
}
