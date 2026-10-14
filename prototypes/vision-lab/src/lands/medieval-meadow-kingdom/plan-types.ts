/**
 * Plain-data description of a blockout. Plans are built by pure functions from a seed and
 * rendered by thin React components, so tests can check budgets and composition without a GPU.
 */

export type Vec3 = readonly [number, number, number]

export interface Item {
  /** World position of the geometry's base (boxes, cones, cylinders) or centre (blobs, planes). */
  p: Vec3
  /** Yaw in radians. */
  ry?: number
  /** Non-uniform scale (metres); unit geometries make this the object's size. */
  s?: Vec3
  /** Optional per-instance tint (hex); the mesh then uses a white toon material. */
  color?: string
}

export interface House {
  p: Vec3
  ry: number
  /** Length along the ridge, depth across it, wall height, roof height (metres). */
  w: number
  d: number
  h: number
  roofH: number
  wall: string
  roof: string
}

export interface Tree {
  p: Vec3
  /** Crown radius (round) or base radius (cone). */
  r: number
  /** Trunk height. */
  trunk: number
  /** Crown height for cones; rounds use 2r. */
  crownH: number
  kind: 'round' | 'cone'
  color: string
}

export type GeometryKey = 'box' | 'prism' | 'cone6' | 'cone4' | 'cyl8' | 'cyl6' | 'ico' | 'plane' | 'arch'

/** Triangles per unit geometry, used to budget a plan before it is rendered. */
export const GEOMETRY_TRIANGLES: Record<GeometryKey, number> = {
  box: 12,
  prism: 6,
  cone6: 12,
  cone4: 8,
  cyl8: 32,
  cyl6: 24,
  ico: 20,
  plane: 2,
  arch: 64,
}

export interface InstancedLayer {
  id: string
  geometry: GeometryKey
  items: Item[]
  /** Material colour when items carry no tint; ignored when `glow` is set. */
  color: string
  /** Glow (emissive at night) instead of a plain surface. */
  glow?: boolean
  castShadow?: boolean
}

export interface Budget {
  terrain: number
  layers: number
  draped: number
  extras: number
  total: number
}

export function layerTriangles(layers: readonly InstancedLayer[]): number {
  return layers.reduce((sum, layer) => sum + layer.items.length * GEOMETRY_TRIANGLES[layer.geometry], 0)
}

export function houseLayers(id: string, houses: readonly House[], windowsPerHouse = 2): InstancedLayer[] {
  const walls: Item[] = []
  const roofs: Item[] = []
  const windows: Item[] = []
  for (const house of houses) {
    walls.push({ p: house.p, ry: house.ry, s: [house.w, house.h, house.d], color: house.wall })
    roofs.push({ p: [house.p[0], house.p[1] + house.h - 0.05, house.p[2]], ry: house.ry, s: [house.w + 0.7, house.roofH, house.d + 0.7], color: house.roof })
    const c = Math.cos(house.ry)
    const s = Math.sin(house.ry)
    for (let k = 0; k < windowsPerHouse; k++) {
      // alternate faces across the ridge; windows sit a hair proud of the wall
      const side = k % 2 === 0 ? 1 : -1
      const along = ((k >> 1) - (windowsPerHouse > 2 ? 0.5 : 0)) * house.w * 0.35
      const off = house.d / 2 + 0.06
      const lx = along
      const lz = side * off
      windows.push({
        p: [house.p[0] + lx * c - lz * s, house.p[1] + Math.min(house.h * 0.55, house.h - 0.8), house.p[2] + lx * s + lz * c],
        ry: house.ry + (side > 0 ? 0 : Math.PI),
        s: [0.9, 1.1, 1],
      })
    }
  }
  return [
    { id: `${id}-walls`, geometry: 'box', items: walls, color: '#ffffff' },
    { id: `${id}-roofs`, geometry: 'prism', items: roofs, color: '#ffffff' },
    { id: `${id}-windows`, geometry: 'plane', items: windows, color: '#ffe9a8', glow: true, castShadow: false },
  ]
}

export function treeLayers(id: string, trees: readonly Tree[], trunkColor: string): InstancedLayer[] {
  const rounds: Item[] = []
  const cones: Item[] = []
  const trunks: Item[] = []
  for (const tree of trees) {
    trunks.push({ p: tree.p, s: [tree.r * 0.32, tree.trunk + 0.4, tree.r * 0.32] })
    if (tree.kind === 'round') {
      rounds.push({ p: [tree.p[0], tree.p[1] + tree.trunk + tree.r * 0.85, tree.p[2]], ry: tree.p[0] * 0.37, s: [tree.r * 2, tree.r * 2.1, tree.r * 2], color: tree.color })
    } else {
      cones.push({ p: [tree.p[0], tree.p[1] + tree.trunk, tree.p[2]], ry: tree.p[2] * 0.21, s: [tree.r * 2, tree.crownH, tree.r * 2], color: tree.color })
    }
  }
  const layers: InstancedLayer[] = [{ id: `${id}-trunks`, geometry: 'box', items: trunks, color: trunkColor }]
  if (rounds.length) layers.push({ id: `${id}-rounds`, geometry: 'ico', items: rounds, color: '#ffffff' })
  if (cones.length) layers.push({ id: `${id}-cones`, geometry: 'cone6', items: cones, color: '#ffffff' })
  return layers
}
