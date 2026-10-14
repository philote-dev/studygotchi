/**
 * Jungle residents: a deterministic 2.5-D walker simulation on the shared collision API
 * (`biomes/collision/colliders.ts`). Each body chases a point sliding round a parade ring near
 * its district's anchor, steers round the registered colliders with three whiskers, sweeps its
 * circle (no tunnelling), refuses steps into the river / lagoon / sluice, and is kept apart from
 * the others. No randomness, no clock: the vitest simulation and the scene run the same code.
 */
import {
  type ColliderSet,
  openDirection,
  penetrationDepth,
  resolveCircle,
  separateCircles,
  steerAround,
  sweepCircle,
} from '../../collision/colliders'
import { JUNGLE_LAYOUT as L, type DistrictId, type SeededDistrict } from '../layout/jungle-layout'
import { districtPoint, isJungleWater, isOnPlate } from '../layout/placements'

/** Body radius of a resident drawn at the land's creature scale (dodecahedron body r 0.55 × 1.65). */
export const WALKER_RADIUS_M = 0.55 * L.creature.scale

/** Whisker length for `steerAround`: about two body lengths. */
export const STEER_LOOKAHEAD_M = 2.4

/** Where each district's residents parade: a district-local ring centre on dry ground and its radius. */
export const PARADE_RINGS: Record<DistrictId, { local: [number, number]; radius: number }> = {
  canopy: { local: [0, 0], radius: 9 },
  falls: { local: [-8, 2], radius: 6.5 },
  lagoon: { local: [-2, -14], radius: 7 },
  ruins: { local: [0, 0], radius: 11 },
  riverworks: { local: [-12, 2], radius: 7 },
}

/** Resident i parades in district i mod 5, in layout order. */
export function walkerDistrict(index: number): DistrictId {
  return L.districts[index % L.districts.length].id
}

/* ---------- tuning (as the ice parade) ---------- */

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
  r: number
}

export interface WalkerWorld {
  districts: readonly SeededDistrict[]
}

export function isWalkable(world: WalkerWorld, x: number, z: number): boolean {
  return isOnPlate(x, z) && !isJungleWater(x, z, world.districts)
}

/** Candidate shifts (district-local metres) tried, in order, when the nominal ring runs into water. */
const RING_SHIFTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-3, 0],
  [-6, 0],
  [-9, 0],
  [-12, 0],
  [0, -4],
  [0, 4],
  [-6, -6],
  [-6, 6],
  [3, 0],
  [6, 0],
  [-15, 0],
  [-18, 0],
]
const RING_SAMPLES = 24

function ringWalkable(world: WalkerWorld, cx: number, cz: number, radius: number): number {
  let dry = 0
  for (let k = 0; k < RING_SAMPLES; k++) {
    const a = (k / RING_SAMPLES) * Math.PI * 2
    if (isWalkable(world, cx + Math.cos(a) * radius, cz + Math.sin(a) * radius)) dry += 1
  }
  return dry
}

/**
 * World centre of a district's parade ring: the nominal local anchor, shifted (deterministically,
 * by the first entry of `RING_SHIFTS` that works) when the seeded district centre lands the ring
 * in the river, so every seed parades on dry ground.
 */
export function ringCentre(world: WalkerWorld, districtId: DistrictId): [number, number] {
  const district = world.districts.find((entry) => entry.id === districtId) ?? world.districts[0]
  const ring = PARADE_RINGS[districtId]
  let best: [number, number] = districtPoint(district, ring.local[0], ring.local[1])
  let bestDry = -1
  for (const [sx, sz] of RING_SHIFTS) {
    const [cx, cz] = districtPoint(district, ring.local[0] + sx, ring.local[1] + sz)
    if (!isWalkable(world, cx, cz)) continue
    const dry = ringWalkable(world, cx, cz, ring.radius)
    if (dry > bestDry) {
      best = [cx, cz]
      bestDry = dry
    }
    if (dry === RING_SAMPLES) break
  }
  return best
}

/** Point on the district's parade ring, snapped onto dry ground if the ring runs into water. */
export function paradePoint(world: WalkerWorld, districtId: DistrictId, angle: number): { x: number; z: number } {
  const [cx, cz] = ringCentre(world, districtId)
  const radius = PARADE_RINGS[districtId].radius
  const tries = [0, 0.14, -0.14, 0.28, -0.28, 0.45, -0.45, 0.7, -0.7, 1.05, -1.05, Math.PI]
  for (const delta of tries) {
    for (const scale of [1, 1.12, 1.24, 0.88, 0.5]) {
      const r = radius * scale
      const a = angle + delta
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      if (isWalkable(world, x, z)) return { x, z }
    }
  }
  // The ring centre itself is dry by construction.
  return { x: cx, z: cz }
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function approachAngle(from: number, to: number, k: number): number {
  return wrapAngle(from + wrapAngle(to - from) * k)
}

function slideAlongShore(world: WalkerWorld, set: ColliderSet, x: number, z: number, toX: number, toZ: number, r: number): { x: number; z: number } | null {
  for (const [tx, tz] of [
    [toX, z],
    [x, toZ],
  ]) {
    if (Math.abs(tx - x) + Math.abs(tz - z) < 1e-9) continue
    const slid = sweepCircle(set, x, z, tx, tz, r)
    if (isWalkable(world, slid.x, slid.z)) return { x: slid.x, z: slid.z }
  }
  return null
}

/** Ring speeds: a stroll (0.12–0.18 rad/s on 6.5–11 m rings ≈ 0.8–2 m/s), alternating direction by index. */
function ringMotion(index: number): { dir: 1 | -1; omega: number } {
  return { dir: index % 2 === 0 ? 1 : -1, omega: 0.12 + (index % 3) * 0.03 }
}

function freeParadeAngle(world: WalkerWorld, district: DistrictId, angle: number, dir: number, set: ColliderSet, r: number): { angle: number; x: number; z: number } {
  let a = angle
  let point = paradePoint(world, district, a)
  for (let i = 0; i < 80; i++) {
    const safe = resolveCircle(set, point.x, point.z, r, 6)
    if (penetrationDepth(set, safe.x, safe.z, r) < 1e-6 && isWalkable(world, safe.x, safe.z)) return { angle: a, x: safe.x, z: safe.z }
    a += 0.12 * dir
    point = paradePoint(world, district, a)
  }
  // Nothing on the ring is clear (never expected on the authored land): stand at the dry ring centre.
  const [cx, cz] = ringCentre(world, district)
  const safe = resolveCircle(set, cx, cz, r, 6)
  return { angle: a, x: safe.x, z: safe.z }
}

export function createWalker(world: WalkerWorld, set: ColliderSet, index: number, r = WALKER_RADIUS_M): WalkerBody {
  const district = walkerDistrict(index)
  const { dir, omega } = ringMotion(index)
  const start = index * 0.85 + L.districts.findIndex((entry) => entry.id === district) * 0.4
  const free = freeParadeAngle(world, district, start, dir, set, r)
  const ahead = paradePoint(world, district, free.angle + 0.05 * dir)
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

export function createWalkers(world: WalkerWorld, set: ColliderSet, count: number, r = WALKER_RADIUS_M): WalkerBody[] {
  const out: WalkerBody[] = []
  for (let index = 0; index < count; index++) out.push(createWalker(world, set, index, r))
  return out
}

/** Separation and the safety push only: standing residents stay out of each other and out of new colliders. */
export function settleWalkers(world: WalkerWorld, walkers: WalkerBody[], set: ColliderSet): void {
  separateCircles(walkers, WALKER_RADIUS_M)
  for (const w of walkers) {
    const safe = resolveCircle(set, w.x, w.z, w.r, RESOLVE_ITERATIONS)
    if (safe.hit && isWalkable(world, safe.x, safe.z)) {
      w.x = safe.x
      w.z = safe.z
    }
  }
}

/** One fixed step for every walker (see the module comment). Deterministic. */
export function stepWalkers(world: WalkerWorld, walkers: WalkerBody[], set: ColliderSet, dtRaw: number): void {
  const dt = Math.min(MAX_DT, Math.max(0, dtRaw))
  if (dt <= 0) return
  const turnK = 1 - Math.exp(-dt * TURN_RATE)
  const accelK = 1 - Math.exp(-dt * ACCEL_RATE)
  const shore = (x: number, z: number) => !isWalkable(world, x, z)

  for (const w of walkers) {
    const fastForward = w.stall > STALL_FASTFORWARD_S ? 3 : 1
    w.angle += dt * w.omega * w.dir * fastForward
    const target = paradePoint(world, w.district, w.angle)
    const dx = target.x - w.x
    const dz = target.z - w.z
    const dist = Math.hypot(dx, dz)
    const maxSpeed = CHASE_FACTOR * w.omega * PARADE_RINGS[w.district].radius
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
      const landing = isWalkable(world, moved.x, moved.z) ? moved : slideAlongShore(world, set, w.x, w.z, moved.x, moved.z, w.r)
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
    if (safe.hit && isWalkable(world, safe.x, safe.z)) {
      w.x = safe.x
      w.z = safe.z
    }
    if (w.stall > STALL_RELOCATE_S) {
      const free = freeParadeAngle(world, w.district, w.angle + 0.3 * w.dir, w.dir, set, w.r)
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
