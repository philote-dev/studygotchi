/**
 * Residents of the highlands as walkers: one deterministic simulation on the shared collision
 * API. Each body chases a point sliding round a ring about its district centre, steers round
 * the registered colliders with three whiskers, sweeps its circle (no tunnelling), refuses steps
 * off the slabs or into the painted water, and is kept apart from the others. No randomness, no
 * clock: the same inputs give the same parade.
 */
import type { DistrictKind, GeneratedDistrict } from '../layout/biome-layout'
import { isLandAt } from '../layout/terrain'
import { type ColliderSet, openDirection, penetrationDepth, resolveCircle, separateCircles, steerAround, sweepCircle } from '../../collision/colliders'

/** Which district each resident parades in (the archipelago is boat-only). */
export const WALKER_DISTRICTS: readonly DistrictKind[] = [
  'fjord-village',
  'fjord-village',
  'fjord-village',
  'basalt-canyon',
  'basalt-canyon',
  'highland-hamlet',
  'highland-hamlet',
  'highland-hamlet',
  'geothermal-farms',
  'geothermal-farms',
]

/** Ring radius about the district centre, metres: inside the footprint, among the houses. */
export const PARADE_RADIUS_M: Record<DistrictKind, number> = {
  'fjord-village': 13,
  'basalt-canyon': 12.5,
  'highland-hamlet': 13,
  'geothermal-farms': 12,
  archipelago: 0,
}

/** The resident figure: a 0.35 m capsule at `creatureScale` 1.5, plus a little clearance. */
export const WALKER_RADIUS_M = 0.62
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

export interface WalkerBody {
  index: number
  district: DistrictKind
  dir: 1 | -1
  omega: number
  angle: number
  x: number
  z: number
  heading: number
  speed: number
  side: -1 | 0 | 1
  stall: number
  escape: number
  travelled: number
  moving: boolean
  blocked: boolean
  r: number
}

/* ---------- land ---------- */

const LAND_CELL = 0.5
const LAND_OFFSET = 1 << 16
const LAND_STRIDE = 1 << 17
const landCache = new Map<number, boolean>()

/** Walkable land for a body of `WALKER_RADIUS_M`, on 0.5 m cells (pure function of the cell). */
export function isParadeLand(x: number, z: number): boolean {
  const ix = Math.round(x / LAND_CELL)
  const iz = Math.round(z / LAND_CELL)
  const key = (ix + LAND_OFFSET) * LAND_STRIDE + (iz + LAND_OFFSET)
  let land = landCache.get(key)
  if (land === undefined) {
    land = isLandAt(ix * LAND_CELL, iz * LAND_CELL, WALKER_RADIUS_M)
    landCache.set(key, land)
  }
  return land
}

function centreOf(districts: readonly GeneratedDistrict[], kind: DistrictKind): [number, number] {
  const d = districts.find((entry) => entry.id === kind) ?? districts[0]
  return d.center
}

/** Point on the district ring, snapped onto land if the ring runs into the fjord. */
export function paradePoint(districts: readonly GeneratedDistrict[], kind: DistrictKind, angle: number): { x: number; z: number } {
  const [cx, cz] = centreOf(districts, kind)
  const radius = PARADE_RADIUS_M[kind]
  const tries = [0, 0.14, -0.14, 0.28, -0.28, 0.45, -0.45, 0.7, -0.7, 1.05, -1.05, Math.PI]
  for (const delta of tries) {
    for (const scale of [1, 1.12, 1.24, 0.88]) {
      const a = angle + delta
      const x = cx + Math.cos(a) * radius * scale
      const z = cz + Math.sin(a) * radius * scale
      if (isParadeLand(x, z)) return { x, z }
    }
  }
  return { x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius }
}

const PARADE_CELL = Math.PI / 360
const PARADE_CELLS = 720
const paradeCache = new WeakMap<readonly GeneratedDistrict[], Map<string, Map<number, { x: number; z: number }>>>()

function paradePointCached(districts: readonly GeneratedDistrict[], kind: DistrictKind, angle: number): { x: number; z: number } {
  let byDistrict = paradeCache.get(districts)
  if (!byDistrict) {
    byDistrict = new Map()
    paradeCache.set(districts, byDistrict)
  }
  let ring = byDistrict.get(kind)
  if (!ring) {
    ring = new Map()
    byDistrict.set(kind, ring)
  }
  const cell = ((Math.round(angle / PARADE_CELL) % PARADE_CELLS) + PARADE_CELLS) % PARADE_CELLS
  let point = ring.get(cell)
  if (!point) {
    point = paradePoint(districts, kind, cell * PARADE_CELL)
    ring.set(cell, point)
  }
  return point
}

/* ---------- bodies ---------- */

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function approachAngle(from: number, to: number, k: number): number {
  return wrapAngle(from + wrapAngle(to - from) * k)
}

function ringMotion(index: number): { dir: 1 | -1; omega: number } {
  return { dir: index % 2 === 0 ? 1 : -1, omega: 0.2 + (index % 3) * 0.04 }
}

function freeParadeAngle(districts: readonly GeneratedDistrict[], kind: DistrictKind, angle: number, dir: number, set: ColliderSet, r: number): { angle: number; x: number; z: number } {
  let a = angle
  let point = paradePointCached(districts, kind, a)
  for (let i = 0; i < 80; i++) {
    const safe = resolveCircle(set, point.x, point.z, r, 6)
    if (penetrationDepth(set, safe.x, safe.z, r) < 1e-6 && isParadeLand(safe.x, safe.z)) return { angle: a, x: safe.x, z: safe.z }
    a += 0.12 * dir
    point = paradePointCached(districts, kind, a)
  }
  return { angle: a, ...point }
}

export function createWalker(districts: readonly GeneratedDistrict[], set: ColliderSet, kinds: readonly DistrictKind[], index: number, r = WALKER_RADIUS_M): WalkerBody {
  const district = kinds[index]
  const { dir, omega } = ringMotion(index)
  const start = index * 0.85 + kinds.indexOf(district) * 0.4
  const free = freeParadeAngle(districts, district, start, dir, set, r)
  const ahead = paradePointCached(districts, district, free.angle + 0.05 * dir)
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
    r,
  }
}

export function createWalkers(districts: readonly GeneratedDistrict[], set: ColliderSet, kinds: readonly DistrictKind[] = WALKER_DISTRICTS, count = kinds.length, r = WALKER_RADIUS_M): WalkerBody[] {
  const out: WalkerBody[] = []
  for (let index = 0; index < Math.min(count, kinds.length); index++) out.push(createWalker(districts, set, kinds, index, r))
  return out
}

/** Separation and the safety push only (no walking). */
export function settleWalkers(walkers: WalkerBody[], set: ColliderSet): void {
  separateCircles(walkers, WALKER_RADIUS_M)
  for (const w of walkers) {
    const safe = resolveCircle(set, w.x, w.z, w.r, RESOLVE_ITERATIONS)
    if (safe.hit && isParadeLand(safe.x, safe.z)) {
      w.x = safe.x
      w.z = safe.z
    }
  }
}

function slideAlongShore(set: ColliderSet, x: number, z: number, toX: number, toZ: number, r: number): { x: number; z: number } | null {
  for (const [tx, tz] of [
    [toX, z],
    [x, toZ],
  ]) {
    if (Math.abs(tx - x) + Math.abs(tz - z) < 1e-9) continue
    const slid = sweepCircle(set, x, z, tx, tz, r)
    if (isParadeLand(slid.x, slid.z)) return { x: slid.x, z: slid.z }
  }
  return null
}

/** One fixed step for every walker (see the file comment). */
export function stepWalkers(districts: readonly GeneratedDistrict[], walkers: WalkerBody[], set: ColliderSet, dtRaw: number): void {
  const dt = Math.min(MAX_DT, Math.max(0, dtRaw))
  if (dt <= 0) return
  const turnK = 1 - Math.exp(-dt * TURN_RATE)
  const accelK = 1 - Math.exp(-dt * ACCEL_RATE)
  const shore = (x: number, z: number) => !isParadeLand(x, z)

  for (const w of walkers) {
    const fastForward = w.stall > STALL_FASTFORWARD_S ? 3 : 1
    w.angle += dt * w.omega * w.dir * fastForward
    const target = paradePointCached(districts, w.district, w.angle)
    const dx = target.x - w.x
    const dz = target.z - w.z
    const dist = Math.hypot(dx, dz)
    const maxSpeed = CHASE_FACTOR * w.omega * PARADE_RADIUS_M[w.district]
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
      const landing = isParadeLand(moved.x, moved.z) ? moved : slideAlongShore(set, w.x, w.z, moved.x, moved.z, w.r)
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
    if (safe.hit && isParadeLand(safe.x, safe.z)) {
      w.x = safe.x
      w.z = safe.z
    }
    if (w.stall > STALL_RELOCATE_S) {
      const free = freeParadeAngle(districts, w.district, w.angle + 0.3 * w.dir, w.dir, set, w.r)
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
