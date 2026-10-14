import * as THREE from 'three'

/**
 * Frontier Town blockout maths: seeded RNG, value-noise fBm, polyline paths, a flat-shaded
 * heightfield with per-face material groups (so one terrain mesh carries sand, strata and
 * cliff colours), and ribbon strips for roads, rails and water. Generation is plain data
 * first; the kit renders it.
 */

export type Vec3 = readonly [number, number, number]

/** Ochre Railhead palette (biome sheet, direction A) plus the few blockout extras. */
export const PAL = {
  sand: '#d9b07a',
  sandDeep: '#c2925a',
  gravel: '#e9dcbc',
  rock: '#a0522d',
  rockDark: '#6f3d2d',
  strata: '#c98b59',
  ledge: '#dcb27f',
  pasture: '#a39a58',
  timber: '#6b4a3a',
  timberDark: '#3d302b',
  plank: '#8b6a4a',
  teal: '#5f8f8a',
  sage: '#8fa07a',
  cream: '#e3cfa5',
  mission: '#efe4cf',
  adobe: '#c9956a',
  adobeDark: '#a8734f',
  oxblood: '#7a3a30',
  mustard: '#d9a441',
  copper: '#b8703f',
  cactus: '#4f7f48',
  scrub: '#8a9a62',
  water: '#76abc2',
  waterDeep: '#4f8fb0',
  canvas: '#efe0bd',
  lamp: '#ffe9a8',
  headlamp: '#fff4c8',
  iron: '#3a3a40',
  ink: '#241a18',
  road: '#cfae78',
  roadDark: '#b58f5a',
  hay: '#e8c96a',
  cattle: '#5a3e2e',
  cattlePale: '#d8c3a0',
} as const

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
export const TAU = Math.PI * 2

/** mulberry32: one seeded instance per generator, threaded through every choice. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const range = (r: () => number, a: number, b: number) => a + (b - a) * r()
export const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(r() * list.length))]

function hash(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1); cheap and deterministic, enough for blockout relief. */
export function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash(ix, iz, seed)
  const b = hash(ix + 1, iz, seed)
  const c = hash(ix, iz + 1, seed)
  const d = hash(ix + 1, iz + 1, seed)
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz)
}

export function fbm(x: number, z: number, seed: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let total = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    total += amp * vnoise(x * freq, z * freq, seed + i * 101)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return total / norm
}

/**
 * Horizontal strata: flat treads and steep risers every `step` metres. `k` = 0 leaves the slope
 * untouched, 1 is a hard staircase. Used on every cliff so the same bands run across the land.
 */
export function terrace(y: number, step: number, k: number): number {
  const q = Math.floor(y / step) * step
  const f = (y - q) / step
  return q + lerp(f, smoothstep(0.32, 0.68, f), k) * step
}

export interface Path {
  points: readonly Vec3[]
  cum: readonly number[]
  total: number
  /** Nearest point on the path in plan: distance, interpolated height, arc fraction, and the point itself. */
  nearest: (x: number, z: number) => { d: number; y: number; t: number; px: number; pz: number }
  /** Point and plan direction at arc fraction t in [0, 1]. */
  at: (t: number) => { p: Vec3; dir: readonly [number, number] }
}

export function makePath(points: readonly Vec3[]): Path {
  const cum: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]))
  }
  const total = cum[cum.length - 1] || 1
  return {
    points,
    cum,
    total,
    nearest(x, z) {
      let best = Infinity
      let by = points[0][1]
      let bt = 0
      let bpx = points[0][0]
      let bpz = points[0][2]
      for (let i = 1; i < points.length; i++) {
        const [ax, ay, az] = points[i - 1]
        const [bx, byy, bz] = points[i]
        const vx = bx - ax
        const vz = bz - az
        const len2 = vx * vx + vz * vz || 1
        const u = clamp(((x - ax) * vx + (z - az) * vz) / len2, 0, 1)
        const px = ax + vx * u
        const pz = az + vz * u
        const d = Math.hypot(x - px, z - pz)
        if (d < best) {
          best = d
          by = lerp(ay, byy, u)
          bt = (cum[i - 1] + (cum[i] - cum[i - 1]) * u) / total
          bpx = px
          bpz = pz
        }
      }
      return { d: best, y: by, t: bt, px: bpx, pz: bpz }
    },
    at(t) {
      const s = clamp(t, 0, 1) * total
      let i = 1
      while (i < cum.length - 1 && cum[i] < s) i++
      const [ax, ay, az] = points[i - 1]
      const [bx, by, bz] = points[i]
      const u = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)
      const dx = bx - ax
      const dz = bz - az
      const len = Math.hypot(dx, dz) || 1
      return { p: [lerp(ax, bx, u), lerp(ay, by, u), lerp(az, bz, u)], dir: [dx / len, dz / len] }
    },
  }
}

/** Points along a path every `spacing` metres (plus the end), with the plan direction. */
export function samplePath(path: Path, spacing: number, from = 0, to = 1): Array<{ p: Vec3; dir: readonly [number, number] }> {
  const out: Array<{ p: Vec3; dir: readonly [number, number] }> = []
  const n = Math.max(1, Math.floor((path.total * (to - from)) / spacing))
  for (let i = 0; i <= n; i++) out.push(path.at(from + ((to - from) * i) / n))
  return out
}

export interface HeightfieldSpec {
  size: number
  segments: number
  height: (x: number, z: number) => number
  /** Material index for a face from its centroid, height and the normal's y (1 = flat). */
  paint: (x: number, z: number, y: number, ny: number) => number
  materialCount: number
}

/** Non-indexed (flat-shaded) heightfield with one geometry group per material index. */
export function heightfield(spec: HeightfieldSpec): THREE.BufferGeometry {
  const { size, segments: n, height, paint, materialCount } = spec
  const step = size / n
  const half = size / 2
  const hs = new Float32Array((n + 1) * (n + 1))
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) hs[j * (n + 1) + i] = height(-half + i * step, -half + j * step)
  const buckets: number[][] = Array.from({ length: materialCount }, () => [])
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = cx - ax
    const vy = cy - ay
    const vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    const mat = clamp(Math.floor(paint((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, ny / len)), 0, materialCount - 1)
    buckets[mat].push(ax, ay, az, bx, by, bz, cx, cy, cz)
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = -half + i * step
      const x1 = x0 + step
      const z0 = -half + j * step
      const z1 = z0 + step
      const h00 = hs[j * (n + 1) + i]
      const h10 = hs[j * (n + 1) + i + 1]
      const h01 = hs[(j + 1) * (n + 1) + i]
      const h11 = hs[(j + 1) * (n + 1) + i + 1]
      if ((i + j) % 2 === 0) {
        tri(x0, h00, z0, x0, h01, z1, x1, h11, z1)
        tri(x0, h00, z0, x1, h11, z1, x1, h10, z0)
      } else {
        tri(x0, h00, z0, x0, h01, z1, x1, h10, z0)
        tri(x1, h10, z0, x0, h01, z1, x1, h11, z1)
      }
    }
  }
  const total = buckets.reduce((sum, b) => sum + b.length, 0)
  const pos = new Float32Array(total)
  const geo = new THREE.BufferGeometry()
  let offset = 0
  buckets.forEach((b, mat) => {
    pos.set(b, offset)
    geo.addGroup(offset / 3, b.length / 3, mat)
    offset += b.length
  })
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.computeVertexNormals()
  return geo
}

/**
 * A strip of quads along a polyline; each vertex can follow a height sampler so roads drape
 * over relief. Width is constant; `lift` keeps it clear of the terrain facets.
 */
export function ribbon(points: readonly Vec3[], width: number, lift = 0.25, heightAt?: (x: number, z: number) => number): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  const halfW = width / 2
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    let dx = next[0] - prev[0]
    let dz = next[2] - prev[2]
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const sx = -dz
    const sz = dx
    const [x, y, z] = points[i]
    for (const s of [-1, 1]) {
      const px = x + sx * halfW * s
      const pz = z + sz * halfW * s
      const py = (heightAt ? heightAt(px, pz) : y) + lift
      pos.push(px, py, pz)
    }
    if (i > 0) {
      const a = (i - 1) * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/** Signed plan distance to a noisy ellipse: negative inside. Radii a (x axis) and b before yaw. */
export function blobDistance(x: number, z: number, cx: number, cz: number, a: number, b: number, yaw: number, wobble: number, seed: number): number {
  const dx = x - cx
  const dz = z - cz
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const lx = dx * c + dz * s
  const lz = -dx * s + dz * c
  const theta = Math.atan2(lz, lx)
  const r = (a * b) / Math.hypot(b * Math.cos(theta), a * Math.sin(theta))
  const noisy = r * (1 + wobble * (vnoise(Math.cos(theta) * 2.3 + seed, Math.sin(theta) * 2.3 + seed, seed) - 0.5) * 2)
  return Math.hypot(lx, lz) - noisy
}

/** Instanced item: position, optional yaw (or full euler / quaternion) and scale. */
export interface Item {
  p: Vec3
  s: Vec3
  yaw?: number
  euler?: Vec3
  q?: THREE.Quaternion
}

const UP_Z = new THREE.Vector3(0, 0, 1)
/** A box item stretched from a to b (thickness t); for cables, braces, rails and chutes. */
export function segment(a: Vec3, b: Vec3, t: number, t2 = t): Item {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = dir.length() || 1
  dir.divideScalar(len)
  const q = new THREE.Quaternion().setFromUnitVectors(UP_Z, dir)
  return { p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], s: [t, t2, len], q }
}

/** Yaw that points a building's local +z (its front) along the plan direction (fx, fz). */
export const yawToward = (fx: number, fz: number) => Math.atan2(fx, fz)

/** Rotate a local plan offset by yaw (three.js Y rotation) and add to an origin. */
export function placeLocal(x: number, z: number, yaw: number, lx: number, lz: number): readonly [number, number] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [x + lx * c + lz * s, z - lx * s + lz * c]
}
