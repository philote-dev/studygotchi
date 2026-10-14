/**
 * Seeded randomness and value noise for the medieval blockouts. Everything that varies is
 * driven by one `mulberry32` stream or by `hash2` so a seed reproduces the same kingdom
 * (procedural-gen skill: own your randomness, generate into data first).
 */

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stateless integer-lattice hash in 0..1. */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function fade(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Smooth value noise in 0..1 on a 1-unit lattice. */
export function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const tx = fade(x - x0)
  const tz = fade(z - z0)
  const a = hash2(x0, z0, seed)
  const b = hash2(x0 + 1, z0, seed)
  const c = hash2(x0, z0 + 1, seed)
  const d = hash2(x0 + 1, z0 + 1, seed)
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz)
}

/** Fractal Brownian motion in 0..1; `scale` is the wavelength of the first octave in metres. */
export function fbm(x: number, z: number, seed: number, scale: number, octaves = 4, gain = 0.5, lacunarity = 2): number {
  let total = 0
  let amp = 1
  let norm = 0
  let freq = 1 / scale
  for (let i = 0; i < octaves; i++) {
    total += amp * valueNoise(x * freq + i * 17.3, z * freq + i * 9.1, seed + i * 101)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return total / norm
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = clamp((v - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Night variant of a day hex colour: darker and pushed toward blue, the product's night grade. */
export function nightTone(hex: string, keep = 0.42): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const mix = (v: number, target: number) => Math.round(clamp(v * keep + target * (1 - keep) * 0.35, 0, 255))
  const out = (mix(r, 30) << 16) | (mix(g, 42) << 8) | mix(b, 80)
  return `#${out.toString(16).padStart(6, '0')}`
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

export function range(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng()
}

export type Vec2 = readonly [number, number]

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Distance from a point to a polyline (metres). */
export function polylineDistance(points: readonly Vec2[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz || 1
    const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1)
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z)
    if (d < best) best = d
  }
  return best
}

export function pointInPolygon(poly: readonly Vec2[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Signed distance to a polygon: negative inside, positive outside. */
export function polygonSignedDistance(poly: readonly Vec2[], x: number, z: number): number {
  const closed = [...poly, poly[0]]
  const d = polylineDistance(closed, x, z)
  return pointInPolygon(poly, x, z) ? -d : d
}

/** Resample a polyline at roughly `step` metres, keeping the original endpoints. */
export function resample(points: readonly Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [points[0]]
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.round(len / step))
    for (let k = 1; k <= n; k++) out.push([lerp(ax, bx, k / n), lerp(az, bz, k / n)])
  }
  return out
}

/** Catmull-Rom smoothing of a control polyline into `perSegment` points per span. */
export function smoothPolyline(points: readonly Vec2[], perSegment = 6): Vec2[] {
  if (points.length < 3) return [...points]
  const out: Vec2[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment
      const t2 = t * t
      const t3 = t2 * t
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
      const z = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      out.push([x, z])
    }
  }
  out.push(points[points.length - 1])
  return out
}

/** Point and unit tangent at arc-length fraction `t` of a polyline. */
export function alongPolyline(points: readonly Vec2[], t: number): { point: Vec2; tangent: Vec2 } {
  const lengths: number[] = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + dist2(points[i - 1], points[i]))
  const target = clamp(t, 0, 1) * lengths[lengths.length - 1]
  for (let i = 1; i < points.length; i++) {
    if (lengths[i] >= target) {
      const span = lengths[i] - lengths[i - 1] || 1
      const u = (target - lengths[i - 1]) / span
      const a = points[i - 1]
      const b = points[i]
      const tx = (b[0] - a[0]) / span
      const tz = (b[1] - a[1]) / span
      return { point: [lerp(a[0], b[0], u), lerp(a[1], b[1], u)], tangent: [tx, tz] }
    }
  }
  const a = points[points.length - 2]
  const b = points[points.length - 1]
  const len = dist2(a, b) || 1
  return { point: b, tangent: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] }
}
