import type { HeightField } from './heightfield'
import { GEOMETRY_TRIANGLES, layerTriangles, type Budget, type InstancedLayer } from './plan-types'

export const LAND_SIZE = 340
export const LAND_CELLS = 120
export const TRIANGLE_BUDGET = 80_000

export type Classifier = (x: number, z: number, y: number, ny: number) => string

export interface GroundSpec {
  hf: HeightField
  classify: Classifier
  day: Record<string, string>
  night: Record<string, string>
}

export interface DrapedSpec {
  id: string
  positions: Float32Array
  day: string
  night?: string
  castShadow?: boolean
}

export interface WaterSpec {
  y: number
  day: string
  night: string
}

export type Mover =
  | { kind: 'wheel'; p: readonly [number, number, number]; radius: number; yaw: number; color: string }
  | { kind: 'sails'; p: readonly [number, number, number]; radius: number; yaw: number; color: string }

export interface Plan {
  label: string
  ground: GroundSpec
  water: WaterSpec | null
  draped: DrapedSpec[]
  layers: InstancedLayer[]
  movers: Mover[]
  budget: Budget
  /** Named landmarks for tests and notes: world positions of the hero pieces and districts. */
  marks: Record<string, readonly [number, number, number]>
}

export function budgetFor(ground: HeightField, draped: readonly DrapedSpec[], layers: readonly InstancedLayer[], extras = 0): Budget {
  const terrain = ground.cells * ground.cells * 2
  const drapedTris = draped.reduce((sum, item) => sum + item.positions.length / 9, 0)
  const layerTris = layerTriangles(layers)
  return { terrain, layers: layerTris, draped: drapedTris, extras, total: terrain + drapedTris + layerTris + extras }
}

/** Triangles of a water wheel (rim + 8 paddles) or a windmill's four sails. */
export const MOVER_TRIANGLES = {
  wheel: 10 * 4 + 8 * GEOMETRY_TRIANGLES.box,
  sails: 4 * GEOMETRY_TRIANGLES.box,
} as const

export function moverTriangles(movers: readonly Mover[]): number {
  return movers.reduce((sum, mover) => sum + MOVER_TRIANGLES[mover.kind], 0)
}
