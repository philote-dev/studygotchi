/**
 * Heightfield → faceted, flat-shaded triangle soup bucketed by colour. Every triangle is
 * classified once (height band, slope, zone) so the terrain renders as a handful of meshes,
 * each with one shared `<Surf>` material; no vertex colours, no textures.
 */
export type HeightFn = (x: number, z: number) => number
export type ClassifyFn = (x: number, z: number, y: number, ny: number) => string

export interface FieldPart {
  positions: Float32Array
  normals: Float32Array
}

export interface Heightfield {
  parts: Record<string, FieldPart>
  triangles: number
  size: number
  segments: number
}

/** Seabed below this is hidden by the opaque abyss plane, so those triangles are never emitted. */
export const ABYSS = -8.3

export function buildHeightfield(height: HeightFn, classify: ClassifyFn, size: number, segments: number): Heightfield {
  const n = segments + 1
  const half = size / 2
  const step = size / segments
  const ys = new Float32Array(n * n)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ys[j * n + i] = height(-half + i * step, -half + j * step)

  const buckets = new Map<string, number[]>()
  let triangles = 0
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    if (ay < ABYSS && by < ABYSS && cy < ABYSS) return
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    const key = classify((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, ny)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
    }
    bucket.push(ax, ay, az, nx, ny, nz, bx, by, bz, nx, ny, nz, cx, cy, cz, nx, ny, nz)
    triangles++
  }

  for (let j = 0; j < segments; j++) {
    const z0 = -half + j * step
    const z1 = z0 + step
    for (let i = 0; i < segments; i++) {
      const x0 = -half + i * step
      const x1 = x0 + step
      const y00 = ys[j * n + i]
      const y10 = ys[j * n + i + 1]
      const y01 = ys[(j + 1) * n + i]
      const y11 = ys[(j + 1) * n + i + 1]
      // Split each cell along the diagonal with the smaller height difference: terrace risers and
      // cliff edges then follow the relief instead of sawing across it.
      if (Math.abs(y00 - y11) <= Math.abs(y10 - y01)) {
        tri(x0, y00, z0, x0, y01, z1, x1, y11, z1)
        tri(x0, y00, z0, x1, y11, z1, x1, y10, z0)
      } else {
        tri(x0, y00, z0, x0, y01, z1, x1, y10, z0)
        tri(x1, y10, z0, x0, y01, z1, x1, y11, z1)
      }
    }
  }

  const parts: Record<string, FieldPart> = {}
  for (const [key, data] of buckets) {
    const count = data.length / 6
    const positions = new Float32Array(count * 3)
    const normals = new Float32Array(count * 3)
    for (let v = 0; v < count; v++) {
      positions[v * 3] = data[v * 6]
      positions[v * 3 + 1] = data[v * 6 + 1]
      positions[v * 3 + 2] = data[v * 6 + 2]
      normals[v * 3] = data[v * 6 + 3]
      normals[v * 3 + 1] = data[v * 6 + 4]
      normals[v * 3 + 2] = data[v * 6 + 5]
    }
    parts[key] = { positions, normals }
  }
  return { parts, triangles, size, segments }
}

/** Gradient magnitude by central differences; the layouts use it to keep houses off risers. */
export function slopeAt(height: HeightFn, x: number, z: number, eps = 1.5): number {
  const dx = height(x + eps, z) - height(x - eps, z)
  const dz = height(x, z + eps) - height(x, z - eps)
  return Math.hypot(dx, dz) / (2 * eps)
}
