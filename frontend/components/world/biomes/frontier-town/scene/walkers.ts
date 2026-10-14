/**
 * The residents' walk, as a deterministic simulation over the shared collider API. Each walker
 * still chases the little figure-of-eight around its district centre the scene has always drawn
 * (x = cx + 8 sin t, z = cz + 6 sin(2t + 0.4), t = 0.35 s + phase), but now it steers round the
 * buildings, cacti and fences with three whiskers, sweeps its circle (no tunnelling), backs out
 * of pockets, and is kept apart from the others. Pure: no three.js, no clock of its own.
 */
import type { generateLayout } from '../layout/biome-layout'
import { type ColliderSet, openDirection, penetrationDepth, resolveCircle, separateCircles, steerAround, sweepCircle } from '../../collision/colliders'

/** Creature scale 2.4 draws a ~2.5 m wide body; the circle is a little tighter so pairs can pass. */
export const WALKER_RADIUS = 1.2
export const STEER_LOOKAHEAD = 3.2
const MAX_SPEED = 4.2
const ARRIVE = 2.0
const TURN_RATE = 6
const ACCEL_RATE = 5
const STALL_SPEED = 0.2
const STALL_ESCAPE_S = 0.6
const ESCAPE_S = 1.0
const RESOLVE_ITERATIONS = 4
const MAX_DT = 0.1

export interface FrontierWalker {
  index: number
  home: [number, number]
  phase: number
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
  r: number
}

/** The wander point a walker chases at `time` seconds (the figure-of-eight the scene has always used). */
export function wanderTarget(home: [number, number], phase: number, time: number): { x: number; z: number } {
  const t = time * 0.35 + phase
  return { x: home[0] + Math.sin(t) * 8, z: home[1] + Math.sin(t * 2 + 0.4) * 6 }
}

/** Walker `i` lives in district `i % districts` (the scene's casting). */
export function walkerHome(generated: ReturnType<typeof generateLayout>, index: number): [number, number] {
  const d = generated.districts[index % generated.districts.length]
  return [d.center[0], d.center[1]]
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function approachAngle(from: number, to: number, k: number): number {
  return wrapAngle(from + wrapAngle(to - from) * k)
}

export function createWalker(generated: ReturnType<typeof generateLayout>, set: ColliderSet, index: number, r = WALKER_RADIUS): FrontierWalker {
  const home = walkerHome(generated, index)
  const phase = index * 1.7
  const start = wanderTarget(home, phase, 0)
  // Start clear of anything the figure-of-eight passes through (a headframe base, a crate stack).
  let safe = resolveCircle(set, start.x, start.z, r, 8)
  if (penetrationDepth(set, safe.x, safe.z, r) > 1e-6) {
    // Boxed in: try the most open direction out to a few radii.
    for (let push = 2; push <= 12 && penetrationDepth(set, safe.x, safe.z, r) > 1e-6; push += 2) {
      const dir = openDirection(set, start.x, start.z, r, push * r, 0)
      safe = resolveCircle(set, start.x + Math.cos(dir.heading) * push * r, start.z + Math.sin(dir.heading) * push * r, r, 8)
    }
  }
  const ahead = wanderTarget(home, phase, 0.3)
  return {
    index,
    home,
    phase,
    x: safe.x,
    z: safe.z,
    heading: Math.atan2(ahead.z - safe.z, ahead.x - safe.x),
    speed: 0,
    side: 0,
    stall: 0,
    escape: 0,
    travelled: 0,
    moving: true,
    r,
  }
}

export function createWalkers(generated: ReturnType<typeof generateLayout>, set: ColliderSet, count: number, r = WALKER_RADIUS): FrontierWalker[] {
  const out: FrontierWalker[] = []
  for (let i = 0; i < count; i++) out.push(createWalker(generated, set, i, r))
  separateCircles(out, r)
  for (const w of out) {
    const safe = resolveCircle(set, w.x, w.z, w.r, RESOLVE_ITERATIONS)
    w.x = safe.x
    w.z = safe.z
  }
  return out
}

/**
 * One step for every walker at scene time `time` (seconds): chase the wander point, steer round
 * the colliders, ease heading and speed, sweep the circle, then push the bodies apart and give
 * each a final push out of any collider. Deterministic: no randomness.
 */
export function stepWalkers(walkers: FrontierWalker[], set: ColliderSet, time: number, dtRaw: number): void {
  const dt = Math.min(MAX_DT, Math.max(0, dtRaw))
  if (dt <= 0) return
  const turnK = 1 - Math.exp(-dt * TURN_RATE)
  const accelK = 1 - Math.exp(-dt * ACCEL_RATE)
  for (const w of walkers) {
    const target = wanderTarget(w.home, w.phase, time)
    const dx = target.x - w.x
    const dz = target.z - w.z
    const dist = Math.hypot(dx, dz)
    const goal = dist < 0.05 ? 0 : MAX_SPEED * Math.min(1, dist / ARRIVE)
    const desired = dist > 1e-6 ? Math.atan2(dz, dx) : w.heading

    const steer = steerAround(set, w.x, w.z, desired, w.r, STEER_LOOKAHEAD, w.side)
    w.side = steer.side
    let aim = steer.heading
    let want = goal
    if (w.escape <= 0 && w.stall > STALL_ESCAPE_S) w.escape = ESCAPE_S
    if (w.escape > 0) {
      const out = openDirection(set, w.x, w.z, w.r, STEER_LOOKAHEAD, desired)
      aim = out.heading
      want = out.free > w.r ? MAX_SPEED * 0.6 : 0
      w.escape -= dt
    }
    w.heading = approachAngle(w.heading, aim, turnK)
    w.speed += (want - w.speed) * accelK
    w.moving = want > 0.2

    const step = w.speed * dt
    let walked = 0
    if (step > 1e-6) {
      const moved = sweepCircle(set, w.x, w.z, w.x + Math.cos(w.heading) * step, w.z + Math.sin(w.heading) * step, w.r)
      walked = Math.hypot(moved.x - w.x, moved.z - w.z)
      w.x = moved.x
      w.z = moved.z
    }
    w.travelled += walked
    if (goal > 0.3 && walked / dt < STALL_SPEED) w.stall += dt
    else w.stall = 0
  }

  separateCircles(walkers, WALKER_RADIUS)

  for (const w of walkers) {
    const safe = resolveCircle(set, w.x, w.z, w.r, RESOLVE_ITERATIONS)
    if (safe.hit) {
      w.x = safe.x
      w.z = safe.z
    }
  }
}
