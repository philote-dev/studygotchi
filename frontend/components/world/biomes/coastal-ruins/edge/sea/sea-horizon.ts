/**
 * Sea horizon: pure numbers and seeded placement for the water side of the coastal outer world
 * (The Wind Waker, Sea of Thieves). The authored water disc is pushed out to the horizon radius
 * and its fog is replaced beyond the land by a horizon haze; a haze wall at that radius lifts the
 * haze colour into the sky; far islands and sea stacks thicken in three bands toward the horizon;
 * a far sail crosses the southern sea about every 90 s; at night a moon path lies on the water.
 *
 * Distances are metres from the plate centre unless they say "depth" (view depth from the camera,
 * the quantity three's linear fog uses).
 */
import { COASTAL_PALETTE as P, type BiomeLayout, seeded } from '../../layout/biome-layout'
import { outerLandField } from '../endless/outer-world'
import { type BarrierPlan, inPoseFrame, vistaKeepClear } from '../barriers/geography'
import { edgePose } from '../poses'

export const SEA_HORIZON = {
  /** Radius of the far water disc (outer mode) and of the horizon haze wall. */
  horizonRadius: 2500,
  /** The wall reaches this high so its top edge is never in frame (camera box top 320 m, pitch ≥ 12°). */
  wallHeight: 420,
  /** The wall starts this far under the water so the disc edge behind it is covered. */
  wallDepth: 4,
  /** Height over which the horizon glow fades into the sky. */
  glowHeight: 120,
  /** View depth where the haze starts to diverge from the scene fog (beyond any land the camera can see). */
  hazeNear: 1000,
  /** View depth where the far water is fully the haze colour (before the nearest wall section). */
  hazeFar: 1500,
} as const

export interface SeaPalette {
  /** Albedo of the water: the authored colour, exactly. */
  water: string
  /** Screen colour of the horizon haze band (what the water and the sky both meet). */
  haze: string
  /** Moon path tint (night only). */
  moon: string
}

export function seaPalette(night: boolean): SeaPalette {
  if (night) return { water: P.waterNight, haze: '#2a3f4f', moon: '#c7d4ea' }
  return { water: P.water, haze: '#dde8e8', moon: '#000000' }
}

/* ---------- colour helpers (sRGB hex) ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function lerpHex(a: string, b: string, k: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k)
}

/** The authored water disc is 78 % opaque over the authored sea bed; the opaque far pieces use this blend. */
export const AUTHORED_SEABED = { day: '#246f89', night: P.waterNight } as const
export const WATER_OPACITY = 0.78

export function waterBlend(night: boolean): string {
  return lerpHex(night ? AUTHORED_SEABED.night : AUTHORED_SEABED.day, night ? P.waterNight : P.water, WATER_OPACITY)
}

/* ---------- far islands ---------- */

export type IslandKind = 'stack' | 'islet' | 'island'

export interface IslandBand {
  index: number
  rMin: number
  rMax: number
  count: number
  kind: IslandKind
  /** Footprint radius range, metres. */
  size: [number, number]
  /** Height above the water, metres. */
  height: [number, number]
}

/** Three depth bands: sea stacks near, low islets in the middle, far island silhouettes toward the horizon. */
export const ISLAND_BANDS: readonly IslandBand[] = [
  { index: 0, rMin: 320, rMax: 600, count: 18, kind: 'stack', size: [4, 10], height: [6, 18] },
  { index: 1, rMin: 650, rMax: 1150, count: 14, kind: 'islet', size: [16, 40], height: [6, 16] },
  { index: 2, rMin: 1200, rMax: 2000, count: 9, kind: 'island', size: [70, 180], height: [22, 55] },
]

export interface IslandPiece {
  band: number
  kind: IslandKind
  x: number
  z: number
  r: number
  yaw: number
  size: number
  height: number
  /** 0..1 brightness jitter for the instance tint. */
  tint: number
}

/** Far sail: a chord through the southern sea, beyond the ring, inside the south window's frame. */
export const SAIL_PATH = {
  radius: 380,
  halfSweepDeg: 20,
  /** Bearing of the chord's midpoint (edge-pose convention: from +z toward +x). */
  bearingDeg: 0,
  speed: 9,
} as const

const CHORD_HALF = Math.sin((SAIL_PATH.halfSweepDeg * Math.PI) / 180) * SAIL_PATH.radius
const CHORD_OFFSET = Math.cos((SAIL_PATH.halfSweepDeg * Math.PI) / 180) * SAIL_PATH.radius

function distanceToChord(x: number, z: number): number {
  const t = Math.min(CHORD_HALF, Math.max(-CHORD_HALF, x))
  return Math.hypot(x - t, z - CHORD_OFFSET)
}

/** Seeded islands in three bands: open sea, clear of coasts, the ring, the vistas and their windows, and the sail. */
export function farIslands(layout: BiomeLayout, seed: number, plan: BarrierPlan): IslandPiece[] {
  const rng = seeded(seed * 53 + 101)
  const keepClear = vistaKeepClear(plan)
  const overview = edgePose('overview')!
  const out: IslandPiece[] = []
  for (const band of ISLAND_BANDS) {
    let guard = 0
    let placed = 0
    while (placed < band.count && guard++ < band.count * 40) {
      const a = rng() * Math.PI * 2
      const r = Math.sqrt(band.rMin * band.rMin + rng() * (band.rMax * band.rMax - band.rMin * band.rMin))
      const x = Math.sin(a) * r
      const z = Math.cos(a) * r
      const size = band.size[0] + rng() * (band.size[1] - band.size[0])
      const height = band.height[0] + rng() * (band.height[1] - band.height[0])
      if (outerLandField(layout, x, z) >= -(40 + size)) continue
      if (plan.ring.some((m) => Math.hypot(m.x - x, m.z - z) <= size + Math.max(m.rx, m.rz) + 10)) continue
      if (plan.vistas.some((v) => Math.hypot(v.x - x, v.z - z) <= 120)) continue
      if (keepClear.some((k) => Math.hypot(k.x - x, k.z - z) <= k.r + size)) continue
      if (distanceToChord(x, z) <= size + 24) continue
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < (p.size + size) * 1.3)) continue
      if (inPoseFrame(overview, x, height, z, -1, 2.6) || inPoseFrame(overview, x, 0, z, -1, 2.6)) continue
      out.push({ band: band.index, kind: band.kind, x, z, r, yaw: rng() * Math.PI * 2, size, height, tint: rng() })
      placed++
    }
  }
  return out
}

/* ---------- the far sail ---------- */

export interface Crossing {
  startAt: number
  duration: number
  dir: 1 | -1
}

const CROSSING_SECONDS = (CHORD_HALF * 2) / SAIL_PATH.speed

/** One crossing about every 90 s (seeded 78–102), direction alternating. */
export function sailSchedule(seed: number, count = 60): Crossing[] {
  const rng = seeded(seed * 41 + 13)
  const out: Crossing[] = []
  let t = 8 + rng() * 20
  let dir: 1 | -1 = rng() < 0.5 ? 1 : -1
  for (let i = 0; i < count; i++) {
    out.push({ startAt: t, duration: CROSSING_SECONDS, dir })
    t += 78 + rng() * 24
    dir = dir === 1 ? -1 : 1
  }
  return out
}

export interface SailState {
  visible: boolean
  x: number
  z: number
  yaw: number
  /** 0..1 along the chord. */
  k: number
}

/** Writes the sail's state at `time` into `out` (no allocation; the frame loop calls this). */
export function sailStateInto(schedule: Crossing[], time: number, out: SailState): SailState {
  for (const crossing of schedule) {
    if (time < crossing.startAt) break
    const local = time - crossing.startAt
    if (local >= crossing.duration) continue
    const k = local / crossing.duration
    const along = (k * 2 - 1) * CHORD_HALF * crossing.dir
    const bearing = (SAIL_PATH.bearingDeg * Math.PI) / 180
    const outX = Math.sin(bearing)
    const outZ = Math.cos(bearing)
    const sideX = outZ
    const sideZ = -outX
    out.visible = true
    out.x = outX * CHORD_OFFSET + sideX * along
    out.z = outZ * CHORD_OFFSET + sideZ * along
    out.yaw = Math.atan2(sideX * crossing.dir, sideZ * crossing.dir)
    out.k = k
    return out
  }
  out.visible = false
  out.x = 0
  out.z = 0
  out.yaw = 0
  out.k = 0
  return out
}

export function sailStateAt(schedule: Crossing[], time: number): SailState {
  return sailStateInto(schedule, time, { visible: false, x: 0, z: 0, yaw: 0, k: 0 })
}

/* ---------- night ---------- */

/** Unit XZ direction from the viewer toward the moon: out over the southern sea, a little west. */
export const MOON_DIR: [number, number] = (() => {
  const x = -0.26
  const z = 0.966
  const l = Math.hypot(x, z)
  return [x / l, z / l]
})()
