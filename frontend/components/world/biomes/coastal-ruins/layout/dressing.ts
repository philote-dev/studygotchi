/**
 * Authored placement data for the land's fixed dressing (Terrain.tsx draws it; the collision
 * footprints derive from it). Metres, +x east, +z south. Kept pure so vitest can read it.
 */
import { type SkylineProfile, seeded } from './biome-layout'

/** Stone clusters: x, y, z, yaw; scale 0.75 + (index % 3) · 0.14. */
export const STONE_SPOTS: ReadonlyArray<[number, number, number, number]> = [
  [-74, 2.45, -66, 0.4], [-67, 2.45, -19, 1.2], [24, 2.45, -39, 2.1], [33, 2.45, -8, 0.7],
  [-73, 2.45, 28, 1.8], [31, 2.45, 35, 0.2], [116, 2.45, -18, 1.1], [-53, 2.45, 54, 2.5],
]

export function stoneSpotScale(index: number): number {
  return 0.75 + (index % 3) * 0.14
}

/** Olive trees outside the districts: x, y, z, scale. */
export const OLIVE_SPOTS: ReadonlyArray<[number, number, number, number]> = [
  [-61, 2.45, -58, 0.85], [-58, 2.45, -48, 0.72], [17, 2.45, -61, 0.82], [27, 2.45, -53, 0.68],
  [35, 2.45, -31, 0.74], [-72, 2.45, 8, 0.78], [-62, 2.45, 16, 0.65], [34, 2.45, 16, 0.7],
]

/** StoneCluster local pieces at scale 1: dx, dz, dodecahedron radius (drawn with x-scale 1.25). */
export const STONE_PIECES: ReadonlyArray<[number, number, number]> = [
  [0, 0, 1.15],
  [1.35, 0.4, 0.72],
  [-1.05, 0.7, 0.62],
]

/* ---------- escarpment ---------- */

export interface Shoulder {
  x: number
  z: number
  width: number
  depth: number
  scale: number
  offset: number
}

/** The nine limestone shoulders, revealed in a fixed order by the skyline profile. */
export function shoulderData(profile: SkylineProfile): Shoulder[] {
  const rng = seeded(3401)
  const all = Array.from({ length: 9 }, (_, index) => ({
    x: -108 + index * 27 + (rng() - 0.5) * 4,
    z: -95 - Math.abs(index - 4) * 1.2 + (rng() - 0.5) * 3,
    width: 20 + rng() * 7,
    depth: 11 + rng() * 4,
    scale: 0.72 + rng() * 0.3,
    offset: (rng() - 0.5) * 5,
  }))
  const order = [4, 1, 7, 2, 6, 3, 5, 0, 8]
  return order.slice(0, profile.shoulders).map((index) => all[index])
}

export interface FootBlock {
  x: number
  z: number
  width: number
  depth: number
  height: number
  yaw: number
}

/** The continuous foot of the escarpment: twelve 27 m blocks. */
export function footBlocks(): FootBlock[] {
  return Array.from({ length: 12 }, (_, index) => ({
    x: -137.5 + index * 25,
    z: -89 - (index % 3) * 1.2,
    width: 27,
    depth: 15 + (index % 2) * 2,
    height: 5.5 + (index % 4) * 0.55,
    yaw: (index % 2 ? 1 : -1) * 0.035,
  }))
}

export interface BackBlock {
  x: number
  z: number
  height: number
  width: number
  depth: number
  yaw: number
}

/** The fixed second row behind the shoulders. */
export function backRow(): BackBlock[] {
  const rng = seeded(910)
  return Array.from({ length: 10 }, (_, index) => ({
    x: -135 + index * 30,
    z: -122 + (rng() - 0.5) * 6,
    height: 7 + rng() * 3,
    width: 26 + rng() * 7,
    depth: 10 + rng() * 4,
    yaw: (index % 2 ? 1 : -1) * 0.06,
  }))
}

/** Watch-village x positions on the escarpment top at 100 %. */
export const WATCH_X: readonly number[] = [-91, -24, 48, 108]
