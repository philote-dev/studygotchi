import { skylineProfile } from './biome-layout'

/**
 * The authored north/back canyon skyline as data: the two mesa rows, the fogged side wings and
 * the 100 % spire, exactly as `BackdropSkyline` has always placed them (same formulas, same
 * numbers). The scene maps over this; the outer world's sightline tests read it.
 */
export interface SkylineBox {
  row: 0 | 1
  index: number
  x: number
  z: number
  /** Footprint along x / z and the top height (the sand cap's top is at `h`). */
  w: number
  d: number
  h: number
}

export interface SkylineWing {
  side: -1 | 1
  index: number
  x: number
  z: number
  h: number
  yaw: number
  opacity: number
}

export interface SkylineSpire {
  x: number
  z: number
  h: number
  radius: number
}

export interface Skyline {
  rows: SkylineBox[]
  wings: SkylineWing[]
  spire: SkylineSpire | null
}

export const SKYLINE_SEGMENTS = 13
export const SKYLINE_STRATA: readonly number[] = [0.24, 0.5, 0.72]

export function backdropSkyline(fraction: number): Skyline {
  const profile = skylineProfile(fraction)
  const rows: SkylineBox[] = []
  for (const row of [0, 1] as const) {
    for (let i = 0; i < SKYLINE_SEGMENTS; i++) {
      const x = -205 + i * (410 / (SKYLINE_SEGMENTS - 1))
      const z = row ? -166 - Math.cos((i / SKYLINE_SEGMENTS) * Math.PI) * 3 : -142 + Math.sin(i * 1.7) * 3
      const base = row ? profile.far : profile.near
      const h = base * 0.58 + Math.sin(i * 1.9 + row) * 4 + (i % 5 === 0 ? 5 : 0)
      const width = 20 + ((i + row) % 3) * 4
      rows.push({ row, index: i, x, z, w: width, d: row ? 18 : 24, h })
    }
  }
  const wings: SkylineWing[] = []
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 8; i++) {
      wings.push({
        side,
        index: i,
        x: side * (174 + i * 5),
        z: -120 + i * 22,
        h: Math.max(30, profile.near - i * 6.2),
        yaw: side * -0.16,
        opacity: Math.max(0.18, 0.82 - i * 0.09),
      })
    }
  }
  const spire = profile.spire > 0 ? { x: -150, z: -150, h: profile.spire + 2.2, radius: 11 } : null
  return { rows, wings, spire }
}

/** Highest authored skyline surface over a ground point (0 off the skyline); wings count as solid. */
export function backdropHeightAt(x: number, z: number, fraction: number): number {
  const sky = backdropSkyline(fraction)
  let top = 0
  for (const b of sky.rows) {
    if (Math.abs(x - b.x) <= b.w / 2 + 0.25 && Math.abs(z - b.z) <= b.d / 2 + 0.25) top = Math.max(top, b.h)
  }
  for (const w of sky.wings) {
    const dx = x - w.x
    const dz = z - w.z
    const c = Math.cos(w.yaw)
    const s = Math.sin(w.yaw)
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    if (Math.abs(lx) <= 8 && Math.abs(lz) <= 14) top = Math.max(top, w.h)
  }
  if (sky.spire && Math.hypot(x - sky.spire.x, z - sky.spire.z) <= sky.spire.radius) top = Math.max(top, sky.spire.h)
  return top
}

/**
 * The skyline as one solid wall for the camera: inside the two rows' band the gaps between
 * boxes count as the taller neighbour, so a low orbit stops in front of the back wall instead of
 * threading between its boxes. Wings and the spire as in `backdropHeightAt`.
 */
export function backdropWallHeightAt(x: number, z: number, fraction: number): number {
  const sky = backdropSkyline(fraction)
  let minZ = Infinity
  let maxZ = -Infinity
  let minX = Infinity
  let maxX = -Infinity
  for (const b of sky.rows) {
    minZ = Math.min(minZ, b.z - b.d / 2)
    maxZ = Math.max(maxZ, b.z + b.d / 2)
    minX = Math.min(minX, b.x - b.w / 2)
    maxX = Math.max(maxX, b.x + b.w / 2)
  }
  let top = backdropHeightAt(x, z, fraction)
  if (z >= minZ - 2 && z <= maxZ + 2 && x >= minX - 2 && x <= maxX + 2) {
    for (const b of sky.rows) if (Math.abs(x - b.x) <= 20) top = Math.max(top, b.h)
  }
  return top
}

/** Axis-aligned footprint of everything the skyline places, for the outer world's land mask. */
export function skylineExtents(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const sky = backdropSkyline(1)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const b of sky.rows) {
    minX = Math.min(minX, b.x - b.w / 2)
    maxX = Math.max(maxX, b.x + b.w / 2)
    minZ = Math.min(minZ, b.z - b.d / 2)
    maxZ = Math.max(maxZ, b.z + b.d / 2)
  }
  for (const w of sky.wings) {
    // 16 × 28 turned by 0.16 rad: pad with the rotated half-diagonal.
    minX = Math.min(minX, w.x - 11)
    maxX = Math.max(maxX, w.x + 11)
    minZ = Math.min(minZ, w.z - 16)
    maxZ = Math.max(maxZ, w.z + 16)
  }
  if (sky.spire) {
    minX = Math.min(minX, sky.spire.x - sky.spire.radius)
    maxX = Math.max(maxX, sky.spire.x + sky.spire.radius)
    minZ = Math.min(minZ, sky.spire.z - sky.spire.radius)
    maxZ = Math.max(maxZ, sky.spire.z + sky.spire.radius)
  }
  return { minX, maxX, minZ, maxZ }
}
