/**
 * The patchwork: a warped grid of fields. Grid corners are jittered on a seeded hash and the whole
 * grid is turned a few degrees off the world axes, so the hedgerows never line up with the plate
 * edge or the camera. Pure: the same functions colour the plate decals, the heightfield faces and
 * place the hedgerow segments, so the patchwork is continuous across the plate seam.
 */
import { hash2 } from '../noise'

export interface FieldGrid {
  /** Nominal field size, metres. */
  spacing: number
  /** Corner jitter as a fraction of the spacing (keeps every quad convex while < 0.25). */
  jitter: number
  /** Grid rotation, radians. */
  angle: number
  seed: number
}

export type Point = [number, number]

export function createFieldGrid(seed: number): FieldGrid {
  return { spacing: 56, jitter: 0.22, angle: 0.19 + (seed % 7) * 0.05, seed }
}

function toLocal(grid: FieldGrid, x: number, z: number): Point {
  const c = Math.cos(-grid.angle)
  const s = Math.sin(-grid.angle)
  return [x * c - z * s, x * s + z * c]
}

function toWorld(grid: FieldGrid, u: number, v: number): Point {
  const c = Math.cos(grid.angle)
  const s = Math.sin(grid.angle)
  return [u * c - v * s, u * s + v * c]
}

/** World position of grid corner (i, j), jittered. */
export function fieldCorner(grid: FieldGrid, i: number, j: number): Point {
  const jx = (hash2(i * 3.1 + grid.seed * 0.7, j * 7.3) - 0.5) * 2 * grid.jitter
  const jz = (hash2(i * 5.7, j * 2.9 + grid.seed * 1.3) - 0.5) * 2 * grid.jitter
  return toWorld(grid, (i + jx) * grid.spacing, (j + jz) * grid.spacing)
}

/** The four corners of field (i, j), counter-clockwise seen from above (+x east, +z south). */
export function fieldPolygon(grid: FieldGrid, i: number, j: number): [Point, Point, Point, Point] {
  return [fieldCorner(grid, i, j), fieldCorner(grid, i + 1, j), fieldCorner(grid, i + 1, j + 1), fieldCorner(grid, i, j + 1)]
}

export function fieldCentre(grid: FieldGrid, i: number, j: number): Point {
  const poly = fieldPolygon(grid, i, j)
  return [(poly[0][0] + poly[1][0] + poly[2][0] + poly[3][0]) / 4, (poly[0][1] + poly[1][1] + poly[2][1] + poly[3][1]) / 4]
}

function sideOf(a: Point, b: Point, x: number, z: number): number {
  return (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0])
}

/** Point-in-convex-quad: every edge sees the point on the same side. */
export function pointInQuad(poly: readonly Point[], x: number, z: number): boolean {
  let positive = 0
  let negative = 0
  for (let k = 0; k < 4; k++) {
    const s = sideOf(poly[k], poly[(k + 1) % 4], x, z)
    if (s > 0) positive++
    else if (s < 0) negative++
  }
  return positive === 0 || negative === 0
}

/** Index of the field containing a world point (the nominal cell or one of its neighbours). */
export function fieldIndexAt(grid: FieldGrid, x: number, z: number): [number, number] {
  const [u, v] = toLocal(grid, x, z)
  const i0 = Math.floor(u / grid.spacing)
  const j0 = Math.floor(v / grid.spacing)
  if (pointInQuad(fieldPolygon(grid, i0, j0), x, z)) return [i0, j0]
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (di === 0 && dj === 0) continue
      if (pointInQuad(fieldPolygon(grid, i0 + di, j0 + dj), x, z)) return [i0 + di, j0 + dj]
    }
  }
  return [i0, j0]
}

/** Field tones: 0 the plate's own meadow, 1 light meadow, 2 deeper pasture, 3 hay meadow, 4 ripe wheat. */
export const TONE_WEIGHTS = [0.36, 0.26, 0.2, 0.11, 0.07] as const

export function fieldTone(grid: FieldGrid, i: number, j: number): number {
  const roll = hash2(i * 13.1 + grid.seed * 0.37, j * 7.7 - grid.seed * 0.11)
  let upto = 0
  for (let k = 0; k < TONE_WEIGHTS.length; k++) {
    upto += TONE_WEIGHTS[k]
    if (roll < upto) return k
  }
  return 0
}

/** Field index range whose quads may overlap a world-space rectangle (generous by one cell). */
export function fieldRange(grid: FieldGrid, minX: number, maxX: number, minZ: number, maxZ: number): { i0: number; i1: number; j0: number; j1: number } {
  const corners = [toLocal(grid, minX, minZ), toLocal(grid, maxX, minZ), toLocal(grid, minX, maxZ), toLocal(grid, maxX, maxZ)]
  const us = corners.map((c) => c[0])
  const vs = corners.map((c) => c[1])
  return {
    i0: Math.floor(Math.min(...us) / grid.spacing) - 1,
    i1: Math.ceil(Math.max(...us) / grid.spacing) + 1,
    j0: Math.floor(Math.min(...vs) / grid.spacing) - 1,
    j1: Math.ceil(Math.max(...vs) / grid.spacing) + 1,
  }
}

export interface FieldEdge {
  a: Point
  b: Point
  /** Stable key for the shared edge (south edge of (i, j) or west edge of (i, j)). */
  key: string
  /** Hashed 0–1 roll for this edge: hedge or no hedge, gate position. */
  roll: number
  gate: number
}

/** The two edges each cell owns (its −v and −u sides); every grid edge is emitted exactly once. */
export function fieldEdges(grid: FieldGrid, i: number, j: number): [FieldEdge, FieldEdge] {
  const c00 = fieldCorner(grid, i, j)
  const c10 = fieldCorner(grid, i + 1, j)
  const c01 = fieldCorner(grid, i, j + 1)
  return [
    { a: c00, b: c10, key: `s${i},${j}`, roll: hash2(i * 1.7 + 0.3, j * 4.1 + grid.seed), gate: hash2(i * 9.1, j * 3.3 + 0.5) },
    { a: c00, b: c01, key: `w${i},${j}`, roll: hash2(i * 2.3 + 5.1, j * 6.7 - grid.seed), gate: hash2(i * 4.7 + 2.2, j * 8.9) },
  ]
}

/** Sutherland–Hodgman clip of a convex polygon to an axis-aligned rectangle. */
export function clipPolygonToRect(poly: readonly Point[], minX: number, maxX: number, minZ: number, maxZ: number): Point[] {
  let out: Point[] = [...poly]
  const planes: Array<(p: Point) => number> = [(p) => p[0] - minX, (p) => maxX - p[0], (p) => p[1] - minZ, (p) => maxZ - p[1]]
  for (const inside of planes) {
    const input = out
    out = []
    for (let k = 0; k < input.length; k++) {
      const current = input[k]
      const previous = input[(k + input.length - 1) % input.length]
      const ci = inside(current)
      const pi = inside(previous)
      if (ci >= 0) {
        if (pi < 0) out.push(intersect(previous, current, pi, ci))
        out.push(current)
      } else if (pi >= 0) {
        out.push(intersect(previous, current, pi, ci))
      }
    }
    if (out.length === 0) return out
  }
  return out
}

function intersect(a: Point, b: Point, da: number, db: number): Point {
  const t = da / (da - db)
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

export function polygonArea(poly: readonly Point[]): number {
  let area = 0
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]
    const b = poly[(k + 1) % poly.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area) / 2
}
