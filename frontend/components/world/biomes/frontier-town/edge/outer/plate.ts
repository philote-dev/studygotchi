/**
 * The authored plate and the LOD rings around it. Pure: no three.js.
 *
 * The frontier ground has always been one flat slab at y = 0; the authored content (districts
 * after their maximum jitter and yaw, the rails, the arroyo, the lookout rise and the north
 * skyline) sits inside PLATE. The outer world replaces the slab with a flat plate of exactly that
 * rectangle plus three Chebyshev rings of faceted tiles whose lattices meet at every boundary:
 * 10 m cells to 520 m, 20 m to 1120 m, 80 m to OUTER_REACH. Everything the outer world raises is
 * masked to zero within LAND_CLEARANCE of any authored feature, so the seam is the plate's own
 * flat height.
 */
import { FRONTIER_LAYOUT } from '../../layout/biome-layout'
import { skylineExtents } from '../../layout/skyline'

export interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  tag: string
}

export interface Segment {
  a: [number, number]
  b: [number, number]
  halfWidth: number
  tag: string
}

/** Flat authored plate, metres; every edge on the 10 m lattice. */
export const PLATE: Rect = { minX: -240, maxX: 240, minZ: -200, maxZ: 170, tag: 'plate' }

/** Metres of flat ground the outer world keeps around every authored road, building and skyline piece. */
export const LAND_CLEARANCE = 40
/** Where the outer relief reaches full strength (a 60 m ramp past the clearance). */
export const LAND_RAMP = 100
/** Instanced props stay this far from authored features (beyond the clearance). */
export const PROP_CLEARANCE = 60

export interface RingSpec {
  ring: 1 | 2 | 3
  /** Chebyshev outer radius; ring 1's inner boundary is PLATE, the others' is the previous outer. */
  inner: number
  outer: number
  cell: number
}

/** Chebyshev radius of the last ring: the camera reach plus the fog distance fits inside it. */
export const OUTER_REACH = 2480

export const RINGS: readonly RingSpec[] = [
  { ring: 1, inner: 0, outer: 520, cell: 10 },
  { ring: 2, inner: 520, outer: 1120, cell: 20 },
  { ring: 3, inner: 1120, outer: OUTER_REACH, cell: 80 },
]

export function chebyshev(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z))
}

export function insideRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad
}

/** Signed-ish distance to a rectangle: 0 inside, Euclidean outside. */
export function rectDistance(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX)
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ)
  return Math.hypot(dx, dz)
}

export function segmentDistance(s: Segment, x: number, z: number): number {
  const dx = s.b[0] - s.a[0]
  const dz = s.b[1] - s.a[1]
  const len2 = dx * dx + dz * dz || 1
  const t = Math.min(1, Math.max(0, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / len2))
  return Math.max(0, Math.hypot(s.a[0] + dx * t - x, s.a[1] + dz * t - z) - s.halfWidth)
}

/** Which ring a point is in (null on the plate or beyond the reach). */
export function ringAt(x: number, z: number): RingSpec | null {
  if (insideRect(PLATE, x, z)) return null
  const d = chebyshev(x, z)
  for (const ring of RINGS) if (d < ring.outer) return ring
  return null
}

/* ---------- authored features ---------- */

/**
 * World-space footprints of everything authored, conservative over every seed: each district's
 * envelope grown by its full yaw range and jitter, the rail corridor and ties, the telegraph
 * line, the arroyo and waterhole, the lookout rise and the skyline. Seed-independent on purpose:
 * the outer world must not move when the town re-rolls.
 */
export function authoredFeatures(): { rects: Rect[]; segments: Segment[] } {
  const rects: Rect[] = []
  const segments: Segment[] = []
  for (const d of FRONTIER_LAYOUT.districts) {
    const yaw = (d.yawRange * Math.PI) / 180
    const hw = d.envelope[0] / 2
    const hd = d.envelope[1] / 2
    // Rotated envelope's axis-aligned bounds plus jitter plus a 4 m pad for porches and awnings.
    const hx = hw * Math.cos(yaw) + hd * Math.sin(yaw) + d.jitter[0] + 4
    const hz = hw * Math.sin(yaw) + hd * Math.cos(yaw) + d.jitter[1] + 4
    rects.push({ minX: d.center[0] - hx, maxX: d.center[0] + hx, minZ: d.center[1] - hz, maxZ: d.center[1] + hz, tag: d.id })
  }
  // Rails (ties 11 m wide at x = 59) and the telegraph poles beside them.
  rects.push({ minX: 52, maxX: 66, minZ: -135, maxZ: 135, tag: 'rails' })
  rects.push({ minX: 70, maxX: 128, minZ: -114, maxZ: 114, tag: 'telegraph' })
  // Arroyo and waterhole.
  const arroyo: Array<[number, number]> = [
    [-158, -46],
    [-136, -36],
    [-121, -17],
    [-111, 7],
    [-104, 35],
    [-99, 61],
    [-95, 84],
    [-89, 108],
    [-83, 132],
  ]
  for (let i = 1; i < arroyo.length; i++) segments.push({ a: arroyo[i - 1], b: arroyo[i], halfWidth: 5, tag: 'arroyo' })
  rects.push({ minX: -106, maxX: -84, minZ: 76, maxZ: 92, tag: 'waterhole' })
  // Lookout rise.
  rects.push({ minX: 107, maxX: 129, minZ: 54, maxZ: 76, tag: 'landmark' })
  // North skyline (rows, wings, spire).
  const sky = skylineExtents()
  rects.push({ ...sky, tag: 'skyline' })
  return { rects, segments }
}

const FEATURES = authoredFeatures()

/** Metres from (x, z) to the nearest authored feature; 0 on one. */
export function featureDistance(x: number, z: number): number {
  let best = Infinity
  for (const r of FEATURES.rects) {
    const d = rectDistance(r, x, z)
    if (d < best) best = d
  }
  for (const s of FEATURES.segments) {
    const d = segmentDistance(s, x, z)
    if (d < best) best = d
  }
  return best
}

/** Distance to the plate rectangle (0 on it). */
export function plateDistance(x: number, z: number): number {
  return rectDistance(PLATE, x, z)
}

/** Metres past the plate edge over which the outer relief eases in from the flat seam. */
export const EDGE_RAMP = 60

function ease(t: number): number {
  const k = Math.min(1, Math.max(0, t))
  return k * k * (3 - 2 * k)
}

/**
 * 0 on the plate or within LAND_CLEARANCE of an authored feature, rising to 1 by LAND_RAMP and
 * easing in over EDGE_RAMP past the plate edge: every outer height is multiplied by this, so the
 * seam is flat and continuous and nothing reaches the town.
 */
export function landMask(x: number, z: number): number {
  if (insideRect(PLATE, x, z)) return 0
  const d = featureDistance(x, z)
  if (d <= LAND_CLEARANCE) return 0
  return ease((d - LAND_CLEARANCE) / (LAND_RAMP - LAND_CLEARANCE)) * ease(plateDistance(x, z) / EDGE_RAMP)
}

/** A point is clear for an instanced prop: outside the plate and PROP_CLEARANCE from every feature. */
export function propClear(x: number, z: number): boolean {
  return !insideRect(PLATE, x, z) && featureDistance(x, z) >= PROP_CLEARANCE
}
