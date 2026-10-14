import * as THREE from 'three'
import type { Vec2 } from './rng'

/**
 * A sampled heightfield. The land is a square of `size` metres centred at the origin, split
 * into `cells` × `cells` quads; each quad is two triangles with the diagonal alternating per
 * cell so the facets read as a chunky low-poly ground. `heightAt` interpolates on the very same
 * triangles the mesh uses, so roads, fields and props draped with it sit flush on the ground.
 */
export class HeightField {
  readonly size: number
  readonly cells: number
  readonly step: number
  readonly heights: Float32Array
  readonly fn: (x: number, z: number) => number

  constructor(size: number, cells: number, fn: (x: number, z: number) => number) {
    this.size = size
    this.cells = cells
    this.step = size / cells
    this.fn = fn
    const n = cells + 1
    this.heights = new Float32Array(n * n)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.heights[j * n + i] = fn(-size / 2 + i * this.step, -size / 2 + j * this.step)
      }
    }
  }

  private h(i: number, j: number): number {
    const n = this.cells + 1
    const ci = Math.min(this.cells, Math.max(0, i))
    const cj = Math.min(this.cells, Math.max(0, j))
    return this.heights[cj * n + ci]
  }

  /** Mesh-consistent height at a world position (clamped to the land). */
  heightAt(x: number, z: number): number {
    const fx = (x + this.size / 2) / this.step
    const fz = (z + this.size / 2) / this.step
    const i = Math.min(this.cells - 1, Math.max(0, Math.floor(fx)))
    const j = Math.min(this.cells - 1, Math.max(0, Math.floor(fz)))
    const u = Math.min(1, Math.max(0, fx - i))
    const v = Math.min(1, Math.max(0, fz - j))
    const h00 = this.h(i, j)
    const h10 = this.h(i + 1, j)
    const h01 = this.h(i, j + 1)
    const h11 = this.h(i + 1, j + 1)
    if ((i + j) % 2 === 0) {
      // diagonal from (0,0) to (1,1)
      return u > v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h01 - h00) * v + (h11 - h01) * u
    }
    // diagonal from (1,0) to (0,1)
    return u + v < 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v)
  }

  /** Approximate slope (0 flat .. 1 vertical-ish) from finite differences on the sampled grid. */
  slopeAt(x: number, z: number): number {
    const d = this.step
    const dx = (this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d)
    const dz = (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d)
    const g = Math.hypot(dx, dz)
    return g / Math.sqrt(1 + g * g)
  }

  /**
   * Splits the ground triangles into named colour groups. `classify` sees the face centroid,
   * its height, and the face normal's y (1 flat, 0 vertical).
   */
  groups(classify: (x: number, z: number, y: number, ny: number) => string): Map<string, Float32Array> {
    const buckets = new Map<string, number[]>()
    const half = this.size / 2
    const push = (key: string, tri: number[]) => {
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = []
        buckets.set(key, bucket)
      }
      for (const v of tri) bucket.push(v)
    }
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()
    const emit = (p: number[], q: number[], r: number[]) => {
      a.set(p[0], p[1], p[2])
      b.set(q[0], q[1], q[2])
      c.set(r[0], r[1], r[2])
      const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y)
      const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z)
      const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      const len = Math.hypot(nx, ny, nz) || 1
      const key = classify((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, (a.y + b.y + c.y) / 3, ny / len)
      push(key, [...p, ...q, ...r])
    }
    for (let j = 0; j < this.cells; j++) {
      for (let i = 0; i < this.cells; i++) {
        const x0 = -half + i * this.step
        const z0 = -half + j * this.step
        const x1 = x0 + this.step
        const z1 = z0 + this.step
        const p00 = [x0, this.h(i, j), z0]
        const p10 = [x1, this.h(i + 1, j), z0]
        const p01 = [x0, this.h(i, j + 1), z1]
        const p11 = [x1, this.h(i + 1, j + 1), z1]
        // counter-clockwise seen from above (+y): (x0,z0) -> (x0,z1) -> (x1,z1) ...
        if ((i + j) % 2 === 0) {
          emit(p00, p01, p11)
          emit(p00, p11, p10)
        } else {
          emit(p00, p01, p10)
          emit(p10, p01, p11)
        }
      }
    }
    const out = new Map<string, Float32Array>()
    for (const [key, list] of buckets) out.set(key, Float32Array.from(list))
    return out
  }
}

/** Non-indexed geometry with flat (per-face) normals from a raw triangle list. */
export function facetedGeometry(positions: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Anything that can answer "how high is the ground here"; the heightfield or a constant. */
export interface HeightSampler {
  heightAt(x: number, z: number): number
}

/** Triangle strip along a polyline, draped on the heightfield. */
export function ribbonPositions(hf: HeightSampler, points: readonly Vec2[], width: number, lift: number): Float32Array {
  const out: number[] = []
  const left: number[][] = []
  const right: number[][] = []
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    let tx = next[0] - prev[0]
    let tz = next[1] - prev[1]
    const len = Math.hypot(tx, tz) || 1
    tx /= len
    tz /= len
    const nx = -tz
    const nz = tx
    const [px, pz] = points[i]
    const lx = px + nx * width * 0.5
    const lz = pz + nz * width * 0.5
    const rx = px - nx * width * 0.5
    const rz = pz - nz * width * 0.5
    left.push([lx, hf.heightAt(lx, lz) + lift, lz])
    right.push([rx, hf.heightAt(rx, rz) + lift, rz])
  }
  for (let i = 0; i < points.length - 1; i++) {
    out.push(...left[i], ...left[i + 1], ...right[i])
    out.push(...right[i], ...left[i + 1], ...right[i + 1])
  }
  return Float32Array.from(out)
}

export interface DrapedQuad {
  /** Centre, half extents and yaw (radians) of a rectangle on the ground. */
  centre: Vec2
  half: Vec2
  yaw: number
}

/** Rectangles draped on the ground, each subdivided so they follow the facets. */
export function drapedQuadPositions(hf: HeightSampler, quads: readonly DrapedQuad[], lift: number, maxCell = 3): Float32Array {
  const out: number[] = []
  for (const quad of quads) {
    const nu = Math.max(1, Math.ceil((quad.half[0] * 2) / maxCell))
    const nv = Math.max(1, Math.ceil((quad.half[1] * 2) / maxCell))
    const c = Math.cos(quad.yaw)
    const s = Math.sin(quad.yaw)
    const at = (u: number, v: number) => {
      const lx = (u * 2 - 1) * quad.half[0]
      const lz = (v * 2 - 1) * quad.half[1]
      const x = quad.centre[0] + lx * c - lz * s
      const z = quad.centre[1] + lx * s + lz * c
      return [x, hf.heightAt(x, z) + lift, z]
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const p00 = at(i / nu, j / nv)
        const p10 = at((i + 1) / nu, j / nv)
        const p01 = at(i / nu, (j + 1) / nv)
        const p11 = at((i + 1) / nu, (j + 1) / nv)
        out.push(...p00, ...p01, ...p11, ...p00, ...p11, ...p10)
      }
    }
  }
  return Float32Array.from(out)
}

/** Triangle strip along a polyline at a constant height (a river below a weir, a quay deck). */
export function flatRibbonPositions(points: readonly Vec2[], width: number, y: number): Float32Array {
  return ribbonPositions({ heightAt: () => y }, points, width, 0)
}

/** Flat fan from a centre point around a ring (star-shaped polygons such as a lake outline). */
export function flatFanPositions(centre: Vec2, ring: readonly Vec2[], y: number): Float32Array {
  const out: number[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const cross = (a[0] - centre[0]) * (b[1] - centre[1]) - (b[0] - centre[0]) * (a[1] - centre[1])
    if (cross >= 0) out.push(centre[0], y, centre[1], b[0], y, b[1], a[0], y, a[1])
    else out.push(centre[0], y, centre[1], a[0], y, a[1], b[0], y, b[1])
  }
  return Float32Array.from(out)
}

/** Flat polygon (fan) at a fixed height; used for water sheets and plazas on level ground. */
export function flatPolygonPositions(input: readonly Vec2[], y: number): Float32Array {
  let area = 0
  for (let i = 0; i < input.length; i++) {
    const a = input[i]
    const b = input[(i + 1) % input.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  const poly = area >= 0 ? input : [...input].reverse()
  const out: number[] = []
  for (let i = 1; i < poly.length - 1; i++) {
    out.push(poly[0][0], y, poly[0][1], poly[i + 1][0], y, poly[i + 1][1], poly[i][0], y, poly[i][1])
  }
  return Float32Array.from(out)
}
