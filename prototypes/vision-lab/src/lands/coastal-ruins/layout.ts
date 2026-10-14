import type { Bag, Batch } from './bag'
import type { ClassifyFn, Heightfield } from './heightfield'
import type { ColorKey } from './palette'

export interface Windmill {
  x: number
  y: number
  z: number
  yaw: number
}

/** One skiff circling slowly on the water; the only per-frame motion in a direction that has it. */
export interface Skiff {
  cx: number
  cz: number
  radius: number
  speed: number
  phase: number
}

export interface Layout {
  field: Heightfield
  batches: Batch[]
  windmills: Windmill[]
  /** Beacon lamp position for the night point light. */
  lamp: [number, number, number] | null
  skiff: Skiff | null
  triangles: number
}

/** Two sail bars plus a six-sided hub. */
export const SAIL_TRIANGLES = 2 * 12 + 24
/** Hull, stripe, cabin, mast, sail. */
export const SKIFF_TRIANGLES = 5 * 12

export type ZoneFn = (x: number, z: number, y: number) => ColorKey | null

/**
 * Field patchwork for open farmland: a rotated grid of plots hashed to scrub (olive green), pale
 * stubble or the plain cap. Pure colour classification, no geometry.
 */
export function patchwork(x: number, z: number, seed: number): ColorKey | null {
  const c = Math.cos(0.32)
  const s = Math.sin(0.32)
  const u = Math.floor((x * c - z * s) / 17)
  const v = Math.floor((x * s + z * c) / 12)
  let h = (Math.imul(u, 0x27d4eb2d) ^ Math.imul(v, 0x165667b1) ^ Math.imul(seed + 7, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0
  const t = ((h ^ (h >>> 13)) >>> 0) / 4294967296
  if (t < 0.34) return 'scrub'
  if (t < 0.5) return 'plaza'
  return null
}

/**
 * Shared coast classifier: zones (plazas, mosaic floors) first, then depth bands below the
 * waterline (sand → shelf → deep gives the shallow-to-deep gradient through the water sheet), a
 * foam line at the waterline, warm limestone wherever the facet is steep, scrub on the high caps.
 */
export function coastClassify(zone: ZoneFn, scrubAbove: number): ClassifyFn {
  return (x, z, y, ny) => {
    const special = zone(x, z, y)
    if (special) return special
    if (y < -5.5) return 'deep'
    if (y < -2.2) return 'shelf'
    if (y < -0.35) return 'sand'
    if (y < 0.45) return 'foam'
    if (ny < 0.55) return 'cliff'
    return y > scrubAbove ? 'scrub' : 'cap'
  }
}

export function finish(field: Heightfield, bag: Bag, windmills: Windmill[], lamp: [number, number, number] | null, skiff: Skiff | null): Layout {
  const triangles = field.triangles + bag.triangles() + windmills.length * SAIL_TRIANGLES + (skiff ? SKIFF_TRIANGLES : 0)
  return { field, batches: bag.batches, windmills, lamp, skiff, triangles }
}
