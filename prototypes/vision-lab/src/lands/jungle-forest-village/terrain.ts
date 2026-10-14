import * as THREE from 'three'
import type { HeightFn } from './lib'

/**
 * Heightfield → flat-shaded, non-indexed terrain with one material group per surface class.
 * The grid is dense (innerStep) across the land and widens geometrically to `outerHalf` so the far
 * hills reach the fog without a visible plane edge. Each cell picks the diagonal with the smaller
 * height difference, which keeps ridges and cliff lips crisp instead of saw-toothed.
 */
export type Classifier = (x: number, z: number, y: number, normalY: number) => number

export interface TerrainSpec {
  height: HeightFn
  classify: Classifier
  /** Colour per material index returned by `classify`. */
  materials: readonly string[]
  innerHalf: number
  innerStep: number
  outerCells: number
  outerHalf: number
}

export function gridAxis(spec: TerrainSpec): number[] {
  const { innerHalf, innerStep, outerCells, outerHalf } = spec
  const inner = Math.round((2 * innerHalf) / innerStep)
  const coords: number[] = []
  for (let k = outerCells; k >= 1; k--) coords.push(-(innerHalf + (outerHalf - innerHalf) * Math.pow(k / outerCells, 1.5)))
  for (let i = 0; i <= inner; i++) coords.push(-innerHalf + (i * 2 * innerHalf) / inner)
  for (let k = 1; k <= outerCells; k++) coords.push(innerHalf + (outerHalf - innerHalf) * Math.pow(k / outerCells, 1.5))
  return coords
}

export function buildTerrain(spec: TerrainSpec): THREE.BufferGeometry {
  const xs = gridAxis(spec)
  const zs = xs
  const nx = xs.length
  const nz = zs.length
  const heights = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) heights[j * nx + i] = spec.height(xs[i], zs[j])

  const buckets: number[][] = spec.materials.map(() => [])
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    const nxx = uy * vz - uz * vy
    const nyy = uz * vx - ux * vz
    const nzz = ux * vy - uy * vx
    const len = Math.hypot(nxx, nyy, nzz) || 1
    const index = spec.classify((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, nyy / len)
    buckets[Math.min(buckets.length - 1, Math.max(0, index))].push(ax, ay, az, bx, by, bz, cx, cy, cz)
  }

  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const x0 = xs[i]
      const x1 = xs[i + 1]
      const z0 = zs[j]
      const z1 = zs[j + 1]
      const h00 = heights[j * nx + i]
      const h10 = heights[j * nx + i + 1]
      const h01 = heights[(j + 1) * nx + i]
      const h11 = heights[(j + 1) * nx + i + 1]
      if (Math.abs(h00 - h11) <= Math.abs(h10 - h01)) {
        tri(x0, h00, z0, x0, h01, z1, x1, h11, z1)
        tri(x0, h00, z0, x1, h11, z1, x1, h10, z0)
      } else {
        tri(x1, h10, z0, x0, h00, z0, x0, h01, z1)
        tri(x1, h10, z0, x0, h01, z1, x1, h11, z1)
      }
    }
  }

  const total = buckets.reduce((sum, bucket) => sum + bucket.length, 0)
  const positions = new Float32Array(total)
  const geometry = new THREE.BufferGeometry()
  let offset = 0
  buckets.forEach((bucket, index) => {
    positions.set(bucket, offset)
    geometry.addGroup(offset / 3, bucket.length / 3, index)
    offset += bucket.length
  })
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}
