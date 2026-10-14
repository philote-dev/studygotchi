/**
 * Faceted heightfield builder. The land is sampled on a regular grid, split into triangles with
 * alternating diagonals (the low-poly quilt), and every facet is classified into one flat colour
 * by its centroid, slope and a per-facet hash. Facets of one colour share one non-indexed
 * geometry, so a 300 m land is five or six draw calls and every riser reads as a chunky step.
 * Pure data: no three.js, so the fields can be built and measured in node tests.
 */
import { hash2 } from './noise'

export type FacetClassifier = (cx: number, cy: number, cz: number, ny: number, h: number, top: number) => string | null

export interface HeightfieldSpec {
  xMin: number
  xMax: number
  zMin: number
  zMax: number
  /** Cell size in metres; 3 m keeps a 330 × 360 m land under 27k triangles before culling the seabed. */
  cell: number
  height: (x: number, z: number) => number
  facet: FacetClassifier
}

export interface FacetGroup {
  color: string
  /** Non-indexed triangle soup, 9 floats per facet. */
  positions: Float32Array
}

export interface Heightfield {
  groups: FacetGroup[]
  triangles: number
}

export function buildHeightfield(spec: HeightfieldSpec): Heightfield {
  const { xMin, zMin, cell } = spec
  const nx = Math.max(1, Math.round((spec.xMax - xMin) / cell))
  const nz = Math.max(1, Math.round((spec.zMax - zMin) / cell))
  const stride = nx + 1
  const heights = new Float32Array(stride * (nz + 1))
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) heights[j * stride + i] = spec.height(xMin + i * cell, zMin + j * cell)
  }

  const buckets = new Map<string, number[]>()
  let triangles = 0
  const push = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, i: number, j: number, k: number) => {
    // Normal of (b - a) × (c - a); the vertex orders below are counter-clockwise seen from above.
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    const nx0 = uy * vz - uz * vy
    const ny0 = uz * vx - ux * vz
    const nz0 = ux * vy - uy * vx
    const len = Math.hypot(nx0, ny0, nz0) || 1
    const ny = ny0 / len
    const color = spec.facet((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3, ny, hash2(i * 2 + k, j, 977), Math.max(ay, by, cy))
    if (!color) return
    let list = buckets.get(color)
    if (!list) {
      list = []
      buckets.set(color, list)
    }
    list.push(ax, ay, az, bx, by, bz, cx, cy, cz)
    triangles++
  }

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = xMin + i * cell
      const x1 = x0 + cell
      const z0 = zMin + j * cell
      const z1 = z0 + cell
      const h00 = heights[j * stride + i]
      const h10 = heights[j * stride + i + 1]
      const h01 = heights[(j + 1) * stride + i]
      const h11 = heights[(j + 1) * stride + i + 1]
      if (((i + j) & 1) === 0) {
        push(x0, h00, z0, x0, h01, z1, x1, h10, z0, i, j, 0)
        push(x1, h10, z0, x0, h01, z1, x1, h11, z1, i, j, 1)
      } else {
        push(x0, h00, z0, x0, h01, z1, x1, h11, z1, i, j, 0)
        push(x0, h00, z0, x1, h11, z1, x1, h10, z0, i, j, 1)
      }
    }
  }

  const groups: FacetGroup[] = []
  for (const [color, list] of buckets) groups.push({ color, positions: new Float32Array(list) })
  return { groups, triangles }
}
