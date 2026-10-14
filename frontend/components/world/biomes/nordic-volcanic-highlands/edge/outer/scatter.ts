/**
 * Seeded far-detail placements on the outer world: moss hummocks on the moor, ember cracks on
 * the lava field, the valley mist layer in the far lowlands, calved bergs in the fjord arm.
 * Pure; the scene instances them.
 */
import { seeded } from '../../layout/biome-layout'
import { smoothstep } from '../../layout/noise'
import { WATER_Y, inPlateRect, plateRectDistance } from '../../layout/terrain'
import { ARM, VOLCANO, armCentre, armHalfWidth, chebyshev, type OuterWorld } from './outer-world'

export interface Instance {
  x: number
  y: number
  z: number
  yaw: number
  sx: number
  sy: number
  sz: number
  /** 0–1 brightness jitter / phase. */
  k: number
}

/** The camera box is ±460; nothing the camera could enter lives inside this radius. */
export const MIST_MIN_RADIUS = 500

/** Squat moss domes on the moor west and north-west of the plate, never on the seam strip. */
export function mossHummocks(world: OuterWorld, count = 260): Instance[] {
  const rng = seeded(world.seed * 23 + 7)
  const out: Instance[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 16) {
    const x = -720 + rng() * 1000
    const z = -520 + rng() * 980
    if (inPlateRect(x, z)) continue
    const d = plateRectDistance(x, z)
    if (d < 14 || d > 420) continue
    const s = world.sample(x, z)
    if (s.material !== 'moss') continue
    const r = 1.6 + rng() * rng() * 3.4
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < r + o.sx + 2.5)) continue
    out.push({ x, y: s.height - 0.1, z, yaw: rng() * Math.PI, sx: r, sy: 0.55 + rng() * 0.7, sz: r * (0.8 + rng() * 0.4), k: rng() })
  }
  return out
}

/** Thin glowing cracks lying on the cooled lava crust east and south-east. */
export function emberCracks(world: OuterWorld, count = 40): Instance[] {
  const rng = seeded(world.seed * 31 + 3)
  const out: Instance[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 40) {
    const x = 200 + rng() * 520
    const z = -360 + rng() * 900
    if (inPlateRect(x, z)) continue
    const d = plateRectDistance(x, z)
    if (d < 50 || d > 360) continue
    const s = world.sample(x, z)
    if (s.material !== 'lava' || s.lava < 0.7) continue
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 22)) continue
    out.push({ x, y: s.height + 0.05, z, yaw: rng() * Math.PI, sx: 5 + rng() * 9, sy: 1, sz: 0.8 + rng() * 0.8, k: rng() })
  }
  return out
}

/**
 * The inversion layer: banks of flattened cloud lobes lying in the hollows beyond the camera's
 * reach, half-sunk into the ground so they hug it, denser up the north corridor behind the
 * volcano, sparse over the open sea. Each bank is a cluster so the layer reads as mist pooled in
 * valleys, not as single puffs.
 */
export function mistLobes(world: OuterWorld, banks = 34): Instance[] {
  const rng = seeded(world.seed * 41 + 19)
  const out: Instance[] = []
  let placed = 0
  let guard = 0
  while (placed < banks && guard++ < banks * 30) {
    const a = rng() * Math.PI * 2
    const r = MIST_MIN_RADIUS + 20 + Math.pow(rng(), 0.9) * 1000
    const cx = Math.sin(a) * r
    const cz = Math.cos(a) * r
    if (chebyshev(cx, cz) < MIST_MIN_RADIUS + 20) continue
    const centre = world.sample(cx, cz)
    // Lowlands only: flats, corridors, the bay shores; never on a mountain flank, rarely at sea.
    if (centre.height > 16 || centre.material === 'mountain' || centre.material === 'snow' || centre.material === 'tuya') continue
    if (centre.material === 'sea' && rng() < 0.75) continue
    if (out.some((o) => Math.hypot(o.x - cx, o.z - cz) < 90)) continue
    const far = smoothstep(500, 1600, r)
    const n = 4 + Math.floor(rng() * 5)
    for (let i = 0; i < n; i++) {
      const ox = (rng() - 0.5) * 70 * (1 + far)
      const oz = (rng() - 0.5) * 50 * (1 + far)
      const x = cx + ox
      const z = cz + oz
      if (chebyshev(x, z) < MIST_MIN_RADIUS) continue
      const s = world.sample(x, z)
      if (s.height > 18 || s.material === 'mountain' || s.material === 'snow' || s.material === 'tuya') continue
      const size = (10 + rng() * 16) * (1 + far * 1.4)
      const sy = size * (0.16 + rng() * 0.08)
      out.push({ x, y: Math.max(s.height, WATER_Y) + sy * 0.55, z, yaw: rng() * Math.PI * 2, sx: size, sy, sz: size * (0.65 + rng() * 0.5), k: rng() })
    }
    placed++
  }
  return out
}

/** Calved bergs floating in the fjord arm between the plate edge and the glacier front. */
export function fjordBergs(world: OuterWorld, count = 9): Instance[] {
  const rng = seeded(world.seed * 53 + 29)
  const out: Instance[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 30) {
    const z = ARM.zMouth - 8 - rng() * (ARM.zMouth - ARM.zHead - 14)
    const half = armHalfWidth(z) - 6
    const x = armCentre(z) + (rng() * 2 - 1) * half
    if (world.landField(x, z) > -4) continue
    const r = 1.4 + rng() * 2.4 + smoothstep(-260, ARM.zHead, z) * 2.5
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < r + o.sx + 4)) continue
    out.push({ x, y: WATER_Y, z, yaw: rng() * Math.PI, sx: r, sy: 0.6 + rng() * 1.1 + r * 0.25, sz: r * (0.7 + rng() * 0.5), k: rng() })
  }
  return out
}

/** Where the volcano's smoke rises from (the crater rim, world metres). */
export function volcanoVent(world: OuterWorld): [number, number, number] {
  const s = world.sample(VOLCANO.x, VOLCANO.z - 2)
  return [VOLCANO.x, s.height + VOLCANO.craterDepth * 0.4, VOLCANO.z - 2]
}
