/**
 * The coastal residents' walk: one deterministic simulation over the shared 2.5-D collision API.
 * Each body chases a point sliding round a ring about its district's anchor (snapped onto land
 * where the ring crosses water), steers round the registered colliders with three whiskers,
 * sweeps its circle (no tunnelling), refuses steps into the sea, and is kept apart from the others.
 * Pure: no three.js, no clock, no randomness beyond the seeded start angles.
 */
import { type BiomeLayout, type DistrictKind, type DistrictProgress, seededDistrictPlan } from '../layout/biome-layout'
import { sampleTerrain } from '../layout/terrain'
import { type ColliderSet, openDirection, penetrationDepth, resolveCircle, separateCircles, steerAround, sweepCircle } from '../../collision/colliders'

/** Half-extent of each district's anchor ruin the walkers must stay outside. */
export const ANCHOR_FOOTPRINT_M: Record<DistrictKind, number> = {
  'cliff-village': 21,
  'archaeology-ridge': 20,
  'dry-terraces': 23,
  'drowned-forum': 19,
  'working-quay': 22,
}

/** Extra metres past the footprint so bodies clear walls, columns and crates. */
export const WALK_CLEARANCE_M = 5

/** The residents are drawn at scale 2 (1.65 m creatures); the blob body is ~0.5 m wide at scale 1. */
export const WALKER_RADIUS_M = 1.0

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

export function walkRadius(districtId: DistrictKind): number {
  return ANCHOR_FOOTPRINT_M[districtId] + WALK_CLEARANCE_M
}

/** Land a resident may stand on: limestone or a terrace pad above the sea (never shallows or the drowned forum). */
export function isWalkLand(layout: BiomeLayout, x: number, z: number): boolean {
  const s = sampleTerrain(layout, x, z)
  return (s.material === 'limestone' || s.material === 'terrace') && s.height >= layout.seaLevel
}

/** Districts with any progress, in band order: the walkers are dealt round these. */
export function activeDistricts(layout: BiomeLayout, progress: DistrictProgress): DistrictKind[] {
  return [...layout.districts].sort((a, b) => a.band - b.band).filter((d) => (progress[d.id] ?? 0) > 0).map((d) => d.id)
}

/** Point on a ring round the district anchor, snapped onto land if the ring hits water. */
export function walkPoint(layout: BiomeLayout, seed: number, districtId: DistrictKind, angle: number): { x: number; z: number } {
  const [cx, cz] = seededDistrictPlan(layout, seed)[districtId].center
  const radius = walkRadius(districtId)
  const minRadius = ANCHOR_FOOTPRINT_M[districtId] + 3
  const tries = [0, 0.14, -0.14, 0.28, -0.28, 0.45, -0.45, 0.7, -0.7, 1.05, -1.05, 1.5, -1.5, Math.PI]
  for (const delta of tries) {
    for (const scale of [1, 1.12, 1.24, 0.94]) {
      const r = radius * scale
      if (r < minRadius) continue
      const a = angle + delta
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      if (isWalkLand(layout, x, z)) return { x, z }
    }
  }
  return { x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius }
}

/* ---------- cached terrain lookups ---------- */

const RING_CELL = Math.PI / 360
const RING_CELLS = 720
const LAND_CELL = 0.5
const LAND_OFFSET = 1 << 16
const LAND_STRIDE = 1 << 17

const ringCache = new WeakMap<BiomeLayout, Map<string, Map<number, { x: number; z: number }>>>()
const landCache = new WeakMap<BiomeLayout, Map<number, boolean>>()

export function walkPointCached(layout: BiomeLayout, seed: number, districtId: DistrictKind, angle: number): { x: number; z: number } {
  let bySeed = ringCache.get(layout)
  if (!bySeed) {
    bySeed = new Map()
    ringCache.set(layout, bySeed)
  }
  const key = `${seed}:${districtId}`
  let ring = bySeed.get(key)
  if (!ring) {
    ring = new Map()
    bySeed.set(key, ring)
  }
  const cell = ((Math.round(angle / RING_CELL) % RING_CELLS) + RING_CELLS) % RING_CELLS
  let point = ring.get(cell)
  if (!point) {
    point = walkPoint(layout, seed, districtId, cell * RING_CELL)
    ring.set(cell, point)
  }
  return point
}

/**
 * Whether a whole 0.5 m cell is walkable land. The authored coast is a hard step (2.4 m land right
 * at the polygon edge), so every cell passes a 3 × 3 stencil at 0.25 m pitch: the cached answer is
 * conservative, never "land" where `isWalkLand` would say sea anywhere in the cell.
 */
function cellIsLand(layout: BiomeLayout, cx: number, cz: number): boolean {
  const centre = sampleTerrain(layout, cx, cz)
  if (!(centre.material === 'limestone' || centre.material === 'terrace') || centre.height < layout.seaLevel) return false
  const h = LAND_CELL / 2
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if ((i || j) && !isWalkLand(layout, cx + i * h, cz + j * h)) return false
  return true
}

export function isWalkLandCached(layout: BiomeLayout, x: number, z: number): boolean {
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

/* ---------- walker simulation ---------- */

export interface WalkerBody {
  index: number
  district: DistrictKind
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
  /** Holding still (asleep at night, or dismantled): no walking, still kept clear. */
  still: boolean
  r: number
  /** Position before the separation pass (restored if separation pushed the body off the shore). */
  px: number
  pz: number
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function approachAngle(from: number, to: number, k: number): number {
  return wrapAngle(from + wrapAngle(to - from) * k)
}

function slideAlongShore(layout: BiomeLayout, set: ColliderSet, x: number, z: number, toX: number, toZ: number, r: number): { x: number; z: number } | null {
  for (const [tx, tz] of [
    [toX, z],
    [x, toZ],
  ]) {
    if (Math.abs(tx - x) + Math.abs(tz - z) < 1e-9) continue
    const slid = sweepCircle(set, x, z, tx, tz, r)
    if (isWalkLandCached(layout, slid.x, slid.z)) return { x: slid.x, z: slid.z }
  }
  return null
}

function ringMotion(index: number): { dir: 1 | -1; omega: number } {
  return { dir: index % 2 === 0 ? 1 : -1, omega: 0.2 + (index % 3) * 0.04 }
}

function freeWalkAngle(layout: BiomeLayout, seed: number, district: DistrictKind, angle: number, dir: number, set: ColliderSet, r: number): { angle: number; x: number; z: number } {
  let a = angle
  let point = walkPointCached(layout, seed, district, a)
  for (let i = 0; i < 90; i++) {
    const safe = resolveCircle(set, point.x, point.z, r, 6)
    if (penetrationDepth(set, safe.x, safe.z, r) < 1e-6 && isWalkLandCached(layout, safe.x, safe.z)) return { angle: a, x: safe.x, z: safe.z }
    a += 0.12 * dir
    point = walkPointCached(layout, seed, district, a)
  }
  return { angle: a, ...point }
}

export function createWalker(layout: BiomeLayout, seed: number, set: ColliderSet, districts: readonly DistrictKind[], index: number, r = WALKER_RADIUS_M): WalkerBody {
  const district = districts[index % districts.length]
  const { dir, omega } = ringMotion(index)
  const start = index * 0.85 + seed * 0.37
  const free = freeWalkAngle(layout, seed, district, start, dir, set, r)
  const ahead = walkPointCached(layout, seed, district, free.angle + 0.05 * dir)
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
    px: free.x,
    pz: free.z,
  }
}

export function createWalkers(layout: BiomeLayout, seed: number, set: ColliderSet, districts: readonly DistrictKind[], count: number, r = WALKER_RADIUS_M): WalkerBody[] {
  const out: WalkerBody[] = []
  if (districts.length === 0) return out
  for (let index = 0; index < count; index++) out.push(createWalker(layout, seed, set, districts, index, r))
  return out
}

/** Separation and the safety push only (no walking). */
export function settleWalkers(layout: BiomeLayout, walkers: WalkerBody[], set: ColliderSet): void {
  separateCircles(walkers, WALKER_RADIUS_M)
  for (const w of walkers) {
    const safe = resolveCircle(set, w.x, w.z, w.r, RESOLVE_ITERATIONS)
    if (safe.hit && isWalkLandCached(layout, safe.x, safe.z)) {
      w.x = safe.x
      w.z = safe.z
    }
  }
}

/** One fixed step for every walker (see the module note). Deterministic. */
export function stepWalkers(layout: BiomeLayout, seed: number, walkers: WalkerBody[], set: ColliderSet, dtRaw: number): void {
  const dt = Math.min(MAX_DT, Math.max(0, dtRaw))
  if (dt <= 0) return
  const turnK = 1 - Math.exp(-dt * TURN_RATE)
  const accelK = 1 - Math.exp(-dt * ACCEL_RATE)
  const shore = (x: number, z: number) => !isWalkLandCached(layout, x, z)

  for (const w of walkers) {
    if (w.still) {
      w.speed = 0
      w.moving = false
      continue
    }
    const fastForward = w.stall > STALL_FASTFORWARD_S ? 3 : 1
    w.angle += dt * w.omega * w.dir * fastForward
    const target = walkPointCached(layout, seed, w.district, w.angle)
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
      const landing = isWalkLandCached(layout, moved.x, moved.z) ? moved : slideAlongShore(layout, set, w.x, w.z, moved.x, moved.z, w.r)
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

  // Separation may nudge a body off the shore; such a body keeps its pre-separation spot (the
  // pair re-separates next frame along a direction that stays on land).
  for (const w of walkers) {
    w.px = w.x
    w.pz = w.z
  }
  separateCircles(walkers, WALKER_RADIUS_M)
  for (const w of walkers) {
    if (isWalkLandCached(layout, w.x, w.z)) continue
    const slid = slideAlongShore(layout, set, w.px, w.pz, w.x, w.z, w.r)
    w.x = slid ? slid.x : w.px
    w.z = slid ? slid.z : w.pz
  }

  for (const w of walkers) {
    const safe = resolveCircle(set, w.x, w.z, w.r, RESOLVE_ITERATIONS)
    if (safe.hit && isWalkLandCached(layout, safe.x, safe.z)) {
      w.x = safe.x
      w.z = safe.z
    }
    if (w.stall > STALL_RELOCATE_S) {
      const free = freeWalkAngle(layout, seed, w.district, w.angle + 0.3 * w.dir, w.dir, set, w.r)
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
