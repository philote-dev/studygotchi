export const BASE_RADIUS = 16
export const BASE_HEIGHT = 2.4
export const BASE_TOP = BASE_HEIGHT
export const SNOW_CAP_THICKNESS = 0.08
export const TERRAIN_RADIUS = 13

/**
 * Four bouquet slots shared by every family. Heights are the roster order
 * P1 → P4 (32 / 28 / 28 / 24 m). Families may override positions, yaw, lean
 * and crown radius with their own `placements` but must keep the anchor rule:
 * base inside TERRAIN_RADIUS, crown projecting beyond BASE_RADIUS, lean 8–12°.
 */
export type BouquetSlot = 'hero' | 'front-left' | 'back-right' | 'front-right'

export interface BouquetPlacement {
  id: BouquetSlot
  position: readonly [number, number, number]
  height: 32 | 28 | 24
  yaw: number
  outwardLean: number
  crownRadius: number
}

export const SLOT_ORDER: readonly BouquetSlot[] = ['hero', 'front-left', 'back-right', 'front-right']

export const BOUQUET_PLACEMENTS: readonly BouquetPlacement[] = [
  { id: 'hero', position: [-1, BASE_TOP, -6.5], height: 32, yaw: 0.08, outwardLean: 0.18, crownRadius: 9 },
  { id: 'front-left', position: [-7.1, BASE_TOP, 3.4], height: 28, yaw: 0.08, outwardLean: 0.14, crownRadius: 4.5 },
  { id: 'back-right', position: [6.6, BASE_TOP, -3.2], height: 28, yaw: -0.18, outwardLean: 0.18, crownRadius: 9 },
  { id: 'front-right', position: [6, BASE_TOP, 4.2], height: 24, yaw: 0.16, outwardLean: 0.2, crownRadius: 10 },
] as const

export function placementFor(slot: BouquetSlot, placements: readonly BouquetPlacement[] = BOUQUET_PLACEMENTS): BouquetPlacement {
  const found = placements.find((entry) => entry.id === slot)
  if (!found) throw new Error(`No bouquet placement for slot ${slot}`)
  return found
}

export function projectedCrownRadius(placement: BouquetPlacement): number {
  return Math.hypot(placement.position[0], placement.position[2]) + Math.sin(placement.outwardLean) * placement.height + placement.crownRadius
}

export function outwardRotation(placement: BouquetPlacement): readonly [number, number, number] {
  const radius = Math.hypot(placement.position[0], placement.position[2])
  return [
    (placement.outwardLean * placement.position[2]) / radius,
    placement.yaw,
    (-placement.outwardLean * placement.position[0]) / radius,
  ]
}

export interface TerrainLobe {
  position: readonly [number, number, number]
  radius: number
  height: number
  stretch: readonly [number, number]
}

export function terrainLobes(): readonly TerrainLobe[] {
  return [
    { position: [0, BASE_TOP, 0], radius: 7.6, height: 3.2, stretch: [1.2, 1] },
    { position: [-1.5, BASE_TOP, -5.8], radius: 6.3, height: 4.3, stretch: [1.05, 0.9] },
    { position: [-6.2, BASE_TOP, 3], radius: 5.2, height: 3, stretch: [0.9, 1.1] },
    { position: [5.8, BASE_TOP, -2.8], radius: 5.8, height: 3.7, stretch: [1, 0.92] },
    { position: [5.3, BASE_TOP, 3.6], radius: 5.6, height: 3.2, stretch: [1.05, 0.9] },
    { position: [0.5, BASE_TOP, 5], radius: 4.8, height: 2.2, stretch: [1.25, 0.8] },
  ] as const
}
