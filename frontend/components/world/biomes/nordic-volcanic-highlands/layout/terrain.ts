/**
 * The authored ground of the highlands as pure data: two flat land slabs (`LandPlate` extrusions
 * in the scene) cut by the S-fjord, two painted water shapes on top of them, and the water plane
 * under everything. The scene renders these; the walkers, the colliders and the outer world read
 * them. Coordinates: x east, z south (+z toward the front camera), y up, metres.
 */
import type { Point } from './biome-layout'

/** Top of the land slabs (ExtrudeGeometry depth 5 + 0.8 bevel, placed at y = 3). */
export const GROUND_Y = 3.8
/** The flat water plane under the land (scene `Water`). */
export const WATER_Y = -0.85
/** Half-size of that plane: beyond it the outer world draws its own sea. */
export const WATER_PLANE_HALF = 700
/** The slab outline's bevel: the flat top starts this far inside the outline. */
export const PLATE_BEVEL = 1.4

/** The slabs' bounding rectangle: the outer world starts here (inset by `SEAM_INSET`). */
export const PLATE_RECT = { minX: -250, maxX: 250, minZ: -200, maxZ: 520 } as const
/** The outer rings start this far inside the rectangle so the slab's bevel groove is covered. */
export const SEAM_INSET = 1.5
/** Outer land sits this far above the slab top where the two overlap (no z-fight at 600 m). */
export const SEAM_LIFT = 0.08
/** Hidden sea floor of the outer world under the authored water plane. */
export const HIDDEN_SEA_Y = WATER_Y - 0.55

export const LEFT_SLAB: Point[] = [
  [-250, -200], [-6, -200], [-4, -142], [-7, -90], [-18, -38], [-39, 18],
  [-47, 52], [-42, 78], [-29, 112], [-23, 170], [-28, 520], [-250, 520],
]
export const RIGHT_SLAB: Point[] = [
  [44, -200], [250, -200], [250, 520], [34, 520], [27, 170], [18, 126],
  [4, 92], [2, 67], [14, 42], [31, 18], [38, -18], [43, -72], [44, -128],
]
/** Archipelago basin, painted water on the right slab. */
export const BASIN: Point[] = [
  [5, 48], [20, 38], [39, 39], [51, 44], [66, 40], [87, 43], [106, 53],
  [116, 73], [112, 96], [96, 116], [73, 124], [48, 119], [29, 108], [18, 91], [17, 68],
]
export const INLET: Point[] = [[-10, 44], [14, 38], [37, 42], [35, 62], [10, 66], [-5, 59]]

export function pointInPolygon(points: readonly Point[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]
    const [xj, zj] = points[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export function distanceToPolygonEdge(points: readonly Point[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, az] = points[j]
    const [bx, bz] = points[i]
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz || 1
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z)
    if (d < best) best = d
  }
  return best
}

/** Signed distance to the outline, positive inside. */
export function signedDistance(points: readonly Point[], x: number, z: number): number {
  const d = distanceToPolygonEdge(points, x, z)
  return pointInPolygon(points, x, z) ? d : -d
}

/** Signed distance to the nearest slab outline (positive on a slab). */
export function slabDistance(x: number, z: number): number {
  return Math.max(signedDistance(LEFT_SLAB, x, z), signedDistance(RIGHT_SLAB, x, z))
}

/** Signed distance to the painted water on the slabs (positive inside the water). */
export function paintedWaterDistance(x: number, z: number): number {
  return Math.max(signedDistance(BASIN, x, z), signedDistance(INLET, x, z))
}

/**
 * Walkable ground: on a slab's flat top (inside the bevel plus `margin`) and off the painted water
 * by the same margin. The walkers pass their body radius as the margin.
 */
export function isLandAt(x: number, z: number, margin = 0): boolean {
  if (slabDistance(x, z) < PLATE_BEVEL + margin) return false
  return paintedWaterDistance(x, z) < -margin
}

export function inPlateRect(x: number, z: number): boolean {
  return x >= PLATE_RECT.minX && x <= PLATE_RECT.maxX && z >= PLATE_RECT.minZ && z <= PLATE_RECT.maxZ
}

/** Metres from a point to the plate rectangle (0 inside). */
export function plateRectDistance(x: number, z: number): number {
  const dx = Math.max(PLATE_RECT.minX - x, 0, x - PLATE_RECT.maxX)
  const dz = Math.max(PLATE_RECT.minZ - z, 0, z - PLATE_RECT.maxZ)
  return Math.hypot(dx, dz)
}

/**
 * Height the outer world must meet along its inner (seam) boundary: just above the slab top where
 * the slab is, hidden under the water plane where the fjord leaves the plate.
 */
export function seamHeightAt(x: number, z: number): number {
  return slabDistance(x, z) > 0.05 ? GROUND_Y + SEAM_LIFT : HIDDEN_SEA_Y
}

/** Ground height for anything standing on the authored land (flat slabs). */
export function groundHeightAt(x: number, z: number): number {
  return slabDistance(x, z) > 0 ? GROUND_Y : WATER_Y
}
