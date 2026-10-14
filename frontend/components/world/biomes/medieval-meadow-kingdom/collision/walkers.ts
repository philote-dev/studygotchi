/**
 * The meadow's walkers: one deterministic simulation over the shared collider API. Each resident
 * chases a point sliding round a ring about its district's anchor, steers round the registered
 * colliders with three whiskers, sweeps its circle (no tunnelling), refuses steps into the river,
 * and is kept apart from the others. No randomness, no clock: the vitest simulation and the scene
 * run the same code.
 */
import type { DistrictId, DistrictProgress, GeneratedKingdom } from '../layout/biome-layout'
import { districtAnchor, sampleTerrain } from '../layout/terrain'
import {
  type ColliderSet,
  openDirection,
  penetrationDepth,
  resolveCircle,
  separateCircles,
  steerAround,
  sweepCircle,
} from '../../collision/colliders'

/** Radius of the anchor piece each ring circles (oak, mill, market platform, windmill, castle plinth). */
export const ANCHOR_FOOTPRINT_M: Record<DistrictId, number> = {
  'forest-hamlet': 1.3,
  'river-village': 4.8,
  'bridge-market': 7.2,
  'farm-common': 2.8,
  'castle-court': 17,
}

/** Extra metres past the footprint so bodies clear sheds, canopies and the plinth's step. */
export const WALK_CLEARANCE_M = 5.5

/** The resident body as the camera sees it: 0.5 m blob × 2.22 scale, a hair under the visual width. */
export const WALKER_RADIUS_M = 0.9

/** Whisker length for `steerAround`: about two body lengths. */
export const STEER_LOOKAHEAD_M = 2.4

const CHASE_FACTOR = 1.35
const ARRIVE_M = 1.5
const TURN_RATE = 6
const ACCEL_RATE = 5
const STALL_SPEED = 0.15
const STALL_ESCAPE_S = 0.5
const ESCAPE_S = 1.0
const STALL_FASTFORWARD_S = 0.8
const STALL_RELOCATE_S = 3
const RESOLVE_ITERATIONS = 4
const MAX_DT = 0.1

export function walkRadius(districtId: DistrictId): number {
  return ANCHOR_FOOTPRINT_M[districtId] + WALK_CLEARANCE_M
}

/** Dry ground: anything the authored sampler does not call water. */
export function isLand(layout: GeneratedKingdom, x: number, z: number): boolean {
  return sampleTerrain(layout, x, z).material !== 'water'
}

/** Point on a ring around the district anchor, snapped onto land if the ring crosses the river. */
export function ringPoint(layout: GeneratedKingdom, districtId: DistrictId, angle: number): { x: number; z: number } {
  const district = layout.districts.find((entry) => entry.id === districtId) ?? layout.districts[0]
  const [cx, , cz] = districtAnchor(layout, district)
  const radius = walkRadius(districtId)
  const minRadius = ANCHOR_FOOTPRINT_M[districtId] + 2.5
  const tries = [0, 0.14, -0.14, 0.28, -0.28, 0.45, -0.45, 0.7, -0.7, 1.05, -1.05, Math.PI]
  for (const delta of tries) {
    for (const scale of [1, 1.12, 1.24, 0.94]) {
      const r = radius * scale
      if (r < minRadius) continue
      const a = angle + delta
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      if (isLand(layout, x, z)) return { x, z }
    }
  }
  return { x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius }
}

/* ---------- cached lookups ---------- */

const RING_CELL = Math.PI / 360
const RING_CELLS = 720
const LAND_CELL = 0.5
const LAND_OFFSET = 1 << 16
const LAND_STRIDE = 1 << 17

const ringCache = new WeakMap<GeneratedKingdom, Map<string, Map<number, { x: number; z: number }>>>()
const landCache = new WeakMap<GeneratedKingdom, Map<number, boolean>>()

export function ringPointCached(layout: GeneratedKingdom, districtId: DistrictId, angle: number): { x: number; z: number } {
  let byDistrict = ringCache.get(layout)
  if (!byDistrict) {
    byDistrict = new Map()
    ringCache.set(layout, byDistrict)
  }
  let ring = byDistrict.get(districtId)
  if (!ring) {
    ring = new Map()
    byDistrict.set(districtId, ring)
  }
  const cell = ((Math.round(angle / RING_CELL) % RING_CELLS) + RING_CELLS) % RING_CELLS
  let point = ring.get(cell)
  if (!point) {
    point = ringPoint(layout, districtId, cell * RING_CELL)
    ring.set(cell, point)
  }
  return point
}

/** Whether a whole 0.5 m cell is land: conservative near the water (3 × 3 stencil at 0.25 m). */
function cellIsLand(layout: GeneratedKingdom, cx: number, cz: number): boolean {
  const centre = sampleTerrain(layout, cx, cz)
  if (centre.material === 'water') return false
  if (centre.material !== 'bank') return true
  const h = LAND_CELL / 2
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue
      if (!isLand(layout, cx + i * h, cz + j * h)) return false
    }
  }
  return true
}

export function isLandCached(layout: GeneratedKingdom, x: number, z: number): boolean {
  let grid = landCache.get(layout)
  if (!grid) {
    grid = new Map()
    landCache.set(layout, grid)
  }
  const ix = Math.round(x / LAND_CELL)
  const iz = Math.round(z / LAND_CELL)
  const key = (ix + LAND_OFFSET) * LAND_STRIDE + (iz + LAND_OFFSET)
  let land = grid.get(key)
  if (land === undefined) {
    land = cellIsLand(layout, ix * LAND_CELL, iz * LAND_CELL)
    grid.set(key, land)
  }
  return land
}

/* ---------- bodies ---------- */

export interface WalkerBody {
  index: number
  district: DistrictId
  dir: 1 | -1
  omega: number
  angle: number
  x: number
  z: number
  /** Facing, atan2(dz, dx), eased. */
  heading: number
  speed: number
  side: -1 | 0 | 1
  stall: number
  escape: number
  travelled: number
  moving: boolean
  blocked: boolean
  /** Asleep (night): no walking, still kept clear of colliders and each other. */
  still: boolean
  r: number
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function approachAngle(from: number, to: number, k: number): number {
  return wrapAngle(from + wrapAngle(to - from) * k)
}

function slideAlongShore(layout: GeneratedKingdom, set: ColliderSet, x: number, z: number, toX: number, toZ: number, r: number): { x: number; z: number } | null {
  for (const [tx, tz] of [
    [toX, z],
    [x, toZ],
  ]) {
    if (Math.abs(tx - x) + Math.abs(tz - z) < 1e-9) continue
    const slid = sweepCircle(set, x, z, tx, tz, r)
    if (isLandCached(layout, slid.x, slid.z)) return { x: slid.x, z: slid.z }
  }
  return null
}

function ringMotion(index: number): { dir: 1 | -1; omega: number } {
  return { dir: index % 2 === 0 ? 1 : -1, omega: 0.2 + (index % 3) * 0.04 }
}

function freeRingAngle(layout: GeneratedKingdom, district: DistrictId, angle: number, dir: number, set: ColliderSet, r: number): { angle: number; x: number; z: number } {
  let a = angle
  let point = ringPointCached(layout, district, a)
  for (let i = 0; i < 80; i++) {
    const safe = resolveCircle(set, point.x, point.z, r, 6)
    if (penetrationDepth(set, safe.x, safe.z, r) < 1e-6 && isLandCached(layout, safe.x, safe.z)) {
      return { angle: a, x: safe.x, z: safe.z }
    }
    a += 0.12 * dir
    point = ringPointCached(layout, district, a)
  }
  return { angle: a, ...point }
}

/** The districts the residents walk in: every district with progress, cycled (as `residentSeats` did). */
export function walkerDistricts(layout: GeneratedKingdom, progress: DistrictProgress, count: number): DistrictId[] {
  const active = layout.districts.filter((district) => (progress[district.id] ?? 0) > 0)
  if (active.length === 0) return []
  return Array.from({ length: count }, (_, index) => active[index % active.length].id)
}

export function createWalker(layout: GeneratedKingdom, set: ColliderSet, districts: readonly DistrictId[], index: number, r = WALKER_RADIUS_M): WalkerBody {
  const district = districts[index]
  const { dir, omega } = ringMotion(index)
  const start = index * 0.85 + layout.districts.findIndex((d) => d.id === district) * 0.4
  const free = freeRingAngle(layout, district, start, dir, set, r)
  const ahead = ringPointCached(layout, district, free.angle + 0.05 * dir)
  return {
    index,
    district,
    dir,
    omega,
    angle: free.angle,
    x: free.x,
    z: free.z,
    heading: Math.atan2(ahead.z - free.z, ahead.x - free.x),
    speed: 0,
    side: 0,
    stall: 0,
    escape: 0,
    travelled: 0,
    moving: true,
    blocked: false,
    still: false,
    r,
  }
}

export function createWalkers(layout: GeneratedKingdom, set: ColliderSet, districts: readonly DistrictId[], r = WALKER_RADIUS_M): WalkerBody[] {
  return districts.map((_, index) => createWalker(layout, set, districts, index, r))
}

/** Separation and the safety push only (no walking). */
export function settleWalkers(layout: GeneratedKingdom, walkers: WalkerBody[], set: ColliderSet): void {
  separateCircles(walkers, WALKER_RADIUS_M)
  for (const w of walkers) {
    const safe = resolveCircle(set, w.x, w.z, w.r, RESOLVE_ITERATIONS)
    if (safe.hit && isLandCached(layout, safe.x, safe.z)) {
      w.x = safe.x
      w.z = safe.z
    }
  }
}

/**
 * One fixed step for every walker (see parade.ts on the ice land for the reasoning): ring angle
 * advances, three-whisker steering toward the ring point, eased heading and speed, a swept move
 * that slides along colliders and the shore, then separation and a final safety push.
 */
export function stepWalkers(layout: GeneratedKingdom, walkers: WalkerBody[], set: ColliderSet, dtRaw: number): void {
  const dt = Math.min(MAX_DT, Math.max(0, dtRaw))
  if (dt <= 0) return
  const turnK = 1 - Math.exp(-dt * TURN_RATE)
  const accelK = 1 - Math.exp(-dt * ACCEL_RATE)
  const shore = (x: number, z: number) => !isLandCached(layout, x, z)

  for (const w of walkers) {
    if (w.still) {
      w.speed = 0
      w.moving = false
      continue
    }
    const fastForward = w.stall > STALL_FASTFORWARD_S ? 3 : 1
    w.angle += dt * w.omega * w.dir * fastForward
    const target = ringPointCached(layout, w.district, w.angle)
    const dx = target.x - w.x
    const dz = target.z - w.z
    const dist = Math.hypot(dx, dz)
    const maxSpeed = CHASE_FACTOR * w.omega * walkRadius(w.district)
    const goal = dist < 0.05 ? 0 : maxSpeed * Math.min(1, dist / ARRIVE_M)
    const desired = dist > 1e-6 ? Math.atan2(dz, dx) : w.heading

    const steer = steerAround(set, w.x, w.z, desired, w.r, STEER_LOOKAHEAD_M, w.side, shore)
    w.side = steer.side
    w.blocked = steer.blocked
    let aim = steer.heading
    let want = goal
    if (w.escape <= 0 && w.stall > STALL_ESCAPE_S) w.escape = ESCAPE_S
    if (w.escape > 0) {
      const out = openDirection(set, w.x, w.z, w.r, STEER_LOOKAHEAD_M, desired, shore)
      aim = out.heading
      want = out.free > w.r ? maxSpeed * 0.7 : 0
      w.escape -= dt
    }
    w.heading = approachAngle(w.heading, aim, turnK)
    w.speed += (want - w.speed) * accelK
    w.moving = want > 0.2

    const step = w.speed * dt
    let walked = 0
    if (step > 1e-6) {
      const moved = sweepCircle(set, w.x, w.z, w.x + Math.cos(w.heading) * step, w.z + Math.sin(w.heading) * step, w.r)
      const landing = isLandCached(layout, moved.x, moved.z) ? moved : slideAlongShore(layout, set, w.x, w.z, moved.x, moved.z, w.r)
      if (landing) {
        walked = Math.hypot(landing.x - w.x, landing.z - w.z)
        w.x = landing.x
        w.z = landing.z
        if (moved.hit || landing !== moved) w.blocked = true
      } else {
        w.blocked = true
        w.speed *= 0.5
      }
    }
    w.travelled += walked
    if (goal > 0.3 && walked / dt < STALL_SPEED) w.stall += dt
    else w.stall = 0
  }

  separateCircles(walkers, WALKER_RADIUS_M)

  for (const w of walkers) {
    const safe = resolveCircle(set, w.x, w.z, w.r, RESOLVE_ITERATIONS)
    if (safe.hit && isLandCached(layout, safe.x, safe.z)) {
      w.x = safe.x
      w.z = safe.z
    }
    if (!w.still && w.stall > STALL_RELOCATE_S) {
      const free = freeRingAngle(layout, w.district, w.angle + 0.3 * w.dir, w.dir, set, w.r)
      w.angle = free.angle
      w.x = free.x
      w.z = free.z
      w.stall = 0
      w.escape = 0
      w.speed = 0
      w.side = 0
    }
  }
}
