import * as THREE from 'three'

/**
 * Pure helpers for the Nordic Volcanic Highlands blockouts: seeded randomness, value-noise fBm,
 * a faceted heightfield whose triangles are sorted into material buckets (turf, basalt, sand,
 * snow, ice, lava), ribbon paths that hug the terrain, and blue-noise scatter. Nothing here
 * touches React or WebGL, so the samplers can be reasoned about (and tested) as plain maths.
 */

export type XZ = readonly [number, number]

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const deg = (d: number) => (d * Math.PI) / 180

export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Deterministic mulberry32 generator; every scatter threads one of these, never Math.random. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashInt(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hashInt(x0, y0, seed)
  const b = hashInt(x0 + 1, y0, seed)
  const c = hashInt(x0, y0 + 1, seed)
  const d = hashInt(x0 + 1, y0 + 1, seed)
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy)
}

/** Fractal value noise in 0..1; `scale` is the metres per base octave cell. */
export function fbm(x: number, y: number, seed: number, scale = 40, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let total = 0
  let amp = 1
  let freq = 1 / scale
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    total += amp * valueNoise(x * freq + 13.7 * i, y * freq - 7.1 * i, seed + i * 101)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return total / norm
}

export function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1)
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

/** Distance to a polyline plus the normalised parameter (0 at the first point, 1 at the last) of the nearest point. */
export function polylineNearest(px: number, pz: number, pts: readonly XZ[]): { d: number; t: number } {
  let best = Number.POSITIVE_INFINITY
  let bestT = 0
  let total = 0
  const lengths: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    lengths.push(l)
    total += l
  }
  let acc = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1)
    const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
    if (d < best) {
      best = d
      bestT = total === 0 ? 0 : (acc + t * lengths[i]) / total
    }
    acc += lengths[i]
  }
  return { d: best, t: bestT }
}

export function polylineDistance(px: number, pz: number, pts: readonly XZ[]): number {
  return polylineNearest(px, pz, pts).d
}

/** Chaikin corner cutting: a cheap smooth curve through a coarse control polyline. */
export function smoothPolyline(pts: readonly XZ[], iterations = 2): XZ[] {
  let current: XZ[] = [...pts]
  for (let k = 0; k < iterations; k++) {
    if (current.length < 3) return current
    const next: XZ[] = [current[0]]
    for (let i = 0; i < current.length - 1; i++) {
      const [ax, az] = current[i]
      const [bx, bz] = current[i + 1]
      next.push([lerp(ax, bx, 0.25), lerp(az, bz, 0.25)], [lerp(ax, bx, 0.75), lerp(az, bz, 0.75)])
    }
    next.push(current[current.length - 1])
    current = next
  }
  return current
}

export function resamplePolyline(pts: readonly XZ[], step: number): XZ[] {
  const out: XZ[] = [pts[0]]
  let carry = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len === 0) continue
    let s = step - carry
    while (s <= len) {
      const t = s / len
      out.push([lerp(ax, bx, t), lerp(az, bz, t)])
      s += step
    }
    carry = len - (s - step)
  }
  const last = pts[pts.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last)
  return out
}

/** Point at polar offset from a centre; bearing 0° = east (+x), 90° = south (+z, toward the default camera). */
export function polar(cx: number, cz: number, r: number, bearingDeg: number): XZ {
  return [cx + r * Math.cos(deg(bearingDeg)), cz + r * Math.sin(deg(bearingDeg))]
}

/** Volcano shoulder: concave cone profile, steep near the summit, flattening toward the foot. */
export function cone(x: number, z: number, cx: number, cz: number, radius: number, height: number, power = 1.7): number {
  const r = Math.hypot(x - cx, z - cz)
  if (r >= radius) return 0
  return height * Math.pow(1 - r / radius, power)
}

/** Max of several cones: the rounded shoulders that close a land's edge instead of a flat-topped wall. */
export function shoulders(x: number, z: number, list: readonly (readonly [number, number, number, number])[], power = 1.5): number {
  let h = 0
  for (const [cx, cz, radius, height] of list) h = Math.max(h, cone(x, z, cx, cz, radius, height, power))
  return h
}

/** Bowl subtracted from a summit to make an asymmetric caldera notch. */
export function bowl(x: number, z: number, cx: number, cz: number, radius: number, depth: number): number {
  const r = Math.hypot(x - cx, z - cz)
  return depth * (1 - smoothstep(radius * 0.45, radius, r))
}

export interface TerrainSample {
  h: number
  tag: string
}

export type TerrainSampler = (x: number, z: number) => TerrainSample

export interface ClassifyInfo {
  tag: string
  /** Face normal y: 1 = flat, 0 = vertical. */
  ny: number
  y: number
  x: number
  z: number
}

export interface HeightfieldSpec {
  half: number
  cells: number
  seed: number
  /** Vertex jitter as a fraction of a cell, so facets read as hewn rock rather than a grid. */
  jitter?: number
  /** Triangles whose highest vertex sits below this are dropped (hidden under opaque water). */
  dropBelow?: number
  sample: TerrainSampler
  classify: (info: ClassifyInfo) => string | null
}

export interface Heightfield {
  geometries: Record<string, THREE.BufferGeometry>
  triangles: number
}

/**
 * Faceted heightfield. Every triangle is pushed into the bucket its classifier picks, so one
 * sampler yields a turf mesh, a basalt mesh, a snow mesh and so on, each rendered with a single
 * flat `Surf` colour. Non-indexed positions plus computeVertexNormals give the low-poly facets.
 */
export function buildHeightfield(spec: HeightfieldSpec): Heightfield {
  const { half, cells, seed, jitter = 0.33, dropBelow = Number.NEGATIVE_INFINITY, sample, classify } = spec
  const n = cells + 1
  const cell = (half * 2) / cells
  const xs = new Float32Array(n * n)
  const zs = new Float32Array(n * n)
  const ys = new Float32Array(n * n)
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix
      const edge = ix === 0 || iz === 0 || ix === cells || iz === cells
      const jx = edge ? 0 : (hashInt(ix, iz, seed) - 0.5) * 2 * jitter * cell
      const jz = edge ? 0 : (hashInt(ix, iz, seed + 7) - 0.5) * 2 * jitter * cell
      const x = -half + ix * cell + jx
      const z = -half + iz * cell + jz
      xs[i] = x
      zs[i] = z
      ys[i] = sample(x, z).h
    }
  }

  const buckets = new Map<string, number[]>()
  let triangles = 0
  const push = (a: number, b: number, c: number) => {
    const ax = xs[a]
    const ay = ys[a]
    const az = zs[a]
    let bx = xs[b]
    let by = ys[b]
    let bz = zs[b]
    let cx = xs[c]
    let cy = ys[c]
    let cz = zs[c]
    if (Math.max(ay, by, cy) < dropBelow) return
    // Orient so the face normal points up.
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (ny < 0) {
      ;[bx, cx] = [cx, bx]
      ;[by, cy] = [cy, by]
      ;[bz, cz] = [cz, bz]
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const len = Math.hypot(nx, ny, nz) || 1
    const mx = (ax + bx + cx) / 3
    const my = (ay + by + cy) / 3
    const mz = (az + bz + cz) / 3
    const bucket = classify({ tag: sample(mx, mz).tag, ny: ny / len, y: my, x: mx, z: mz })
    if (!bucket) return
    let arr = buckets.get(bucket)
    if (!arr) {
      arr = []
      buckets.set(bucket, arr)
    }
    arr.push(ax, ay, az, bx, by, bz, cx, cy, cz)
    triangles += 1
  }

  for (let iz = 0; iz < cells; iz++) {
    for (let ix = 0; ix < cells; ix++) {
      const i00 = iz * n + ix
      const i10 = i00 + 1
      const i01 = i00 + n
      const i11 = i01 + 1
      if (hashInt(ix, iz, seed + 99) > 0.5) {
        push(i00, i10, i11)
        push(i00, i11, i01)
      } else {
        push(i00, i10, i01)
        push(i10, i11, i01)
      }
    }
  }

  const geometries: Record<string, THREE.BufferGeometry> = {}
  for (const [bucket, arr] of buckets) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
    geometry.computeVertexNormals()
    geometries[bucket] = geometry
  }
  return { geometries, triangles }
}

/**
 * A path, stair or quay ribbon that follows a smoothed polyline and sits `lift` above the
 * terrain. `heightAt` may ignore the terrain to produce a level bridge deck.
 */
export function ribbonGeometry(points: readonly XZ[], width: number, heightAt: (x: number, z: number) => number, lift = 0.3, step = 3, smooth = 2): THREE.BufferGeometry {
  const pts = resamplePolyline(smoothPolyline(points, smooth), step)
  const positions: number[] = []
  const left: number[][] = []
  const right: number[][] = []
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(pts.length - 1, i + 1)]
    let dx = next[0] - prev[0]
    let dz = next[1] - prev[1]
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const lx = pts[i][0] - dz * width * 0.5
    const lz = pts[i][1] + dx * width * 0.5
    const rx = pts[i][0] + dz * width * 0.5
    const rz = pts[i][1] - dx * width * 0.5
    left.push([lx, heightAt(lx, lz) + lift, lz])
    right.push([rx, heightAt(rx, rz) + lift, rz])
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const l0 = left[i]
    const l1 = left[i + 1]
    const r0 = right[i]
    const r1 = right[i + 1]
    positions.push(...l0, ...r0, ...l1, ...r0, ...r1, ...l1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Blue-noise-ish scatter inside a disc: rejection sampling with a minimum spacing and a capped attempt budget. */
export function scatterDisc(rng: () => number, cx: number, cz: number, radius: number, count: number, minDist: number, accept?: (x: number, z: number) => boolean): XZ[] {
  const out: XZ[] = []
  let attempts = 0
  while (out.length < count && attempts < count * 40) {
    attempts += 1
    const a = rng() * Math.PI * 2
    const r = Math.sqrt(rng()) * radius
    const x = cx + Math.cos(a) * r
    const z = cz + Math.sin(a) * r
    if (accept && !accept(x, z)) continue
    if (out.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < minDist)) continue
    out.push([x, z])
  }
  return out
}

/** Points spaced along a polyline, optionally offset sideways; handy for racks, stones, posts and houses along a lane. */
export function alongPolyline(points: readonly XZ[], step: number, offset = 0, smooth = 1): Array<{ x: number; z: number; yaw: number }> {
  const pts = resamplePolyline(smooth > 0 ? smoothPolyline(points, smooth) : points, step)
  const out: Array<{ x: number; z: number; yaw: number }> = []
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(pts.length - 1, i + 1)]
    const dx = next[0] - prev[0]
    const dz = next[1] - prev[1]
    const len = Math.hypot(dx, dz) || 1
    out.push({ x: pts[i][0] - (dz / len) * offset, z: pts[i][1] + (dx / len) * offset, yaw: Math.atan2(-dz, dx) })
  }
  return out
}
